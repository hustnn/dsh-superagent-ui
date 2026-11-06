/**
 * The BFF's HTTP surface. Every `/api` request passes the trust check, then (except the token exchange) the session check.
 * Every route declares a risk tier: the access mode decides on it, and every non-read call lands in the audit log.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { Hono, type Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { streamSSE } from 'hono/streaming'
import type { ApiFailure, CalibrationLabel, ExecutorSettings, LiveEvent, Meta, ModelChoice, PolicySave, PromptConfig, RiskTier, SourceAccountSave, SourceSave, ThreadFilter } from '@dsh-superagent-ui/contract'
import type { AuditLog } from './audit.ts'
import { DiskUsage } from './disk.ts'
import type { Labels } from './labels.ts'
import type { Snapshots } from './snapshots.ts'
import type { LiveHub } from './live.ts'
import { localPrincipal, type AccessMode, type Principal } from './security/access.ts'
import { COOKIE, SESSION_MAX_AGE_S, issueSession, tokenMatches, validSession, type Secrets } from './security/session.ts'
import { trusted } from './security/trust.ts'
import { UpstreamError, type ConnectionMonitor, type UpstreamClient } from './upstream/client.ts'
import type { SetupProblem } from './upstream/types.ts'
import { companionState, saidMessages, transcriptView } from './views/companion.ts'
import { buildHealth } from './views/health.ts'
import { buildCalibration, calibrationSummary, judgements } from './views/calibration.ts'
import { buildHome } from './views/home.ts'
import { buildInsights } from './views/insights.ts'
import { buildPolicy, DraftError, mergePolicy } from './views/policy.ts'
import { buildPrompts, previewView } from './views/prompts.ts'
import { setupText } from './views/reasons.ts'
import { applyRecipe, buildRecipes, previewRecipe } from './views/recipes.ts'
import { buildDirectories, directoryFiles, revealEntry, revealInFinder } from './views/directories.ts'
import { buildExecution, buildSources, checkExecutor, mergeAccount, mergeSource, switchMainModel } from './views/settings.ts'
import { buildSearch, buildThread, buildThreads } from './views/threads.ts'
import { buildBoard, ticketView } from './views/tickets.ts'

export interface AppDeps {
  port: number
  /** Origins besides the BFF's own that may call the API, such as the Vite dev server's. */
  devOrigins: readonly string[]
  secrets: Secrets
  upstream: UpstreamClient
  monitor: ConnectionMonitor
  audit: AuditLog
  labels: Labels
  snapshots: Snapshots
  access: AccessMode
  live: LiveHub
  meta: Meta
  /** The built console to serve, when it exists. */
  staticDir?: string
  /** Replaces Finder, for tests. */
  reveal?: (path: string) => Promise<void>
}

export interface RouteSpec { method: 'GET' | 'POST' | 'PUT'; path: string; tier: RiskTier; action: string }

class BadRequest extends Error {}
class Conflict extends Error {}
class NotFound extends Error {}

type Env = { Variables: { principal: Principal; target?: string } }
type Handler = (c: Context<Env>) => Promise<unknown>

function failure(c: Context, status: 400 | 401 | 403 | 404 | 409 | 503, kind: ApiFailure['error']['kind'], message: string,
  upstream?: ApiFailure['error']['upstream']) {
  return c.json<ApiFailure>({ error: { kind, message, ...upstream ? { upstream } : {} } }, status)
}

export function createApp(deps: AppDeps): { app: Hono<Env>; routes: RouteSpec[] } {
  const { secrets, upstream, monitor, audit, labels, snapshots, access, live } = deps
  const app = new Hono<Env>()
  const routes: RouteSpec[] = []

  app.use('/api/*', async (c, next) => {
    const trust = trusted(name => c.req.header(name), { port: deps.port, origins: deps.devOrigins })
    if (!trust.ok) return failure(c, 403, 'forbidden', `Request refused: untrusted ${trust.reason}`)
    if (c.req.path === '/api/session') return next()
    if (!validSession(secrets.key, getCookie(c, COOKIE))) return failure(c, 401, 'unauthenticated', 'Open the console with the link the BFF printed at startup')
    c.set('principal', localPrincipal)
    return next()
  })

  app.post('/api/session', async c => {
    const body = await c.req.json().catch(() => null) as { token?: unknown } | null
    if (!tokenMatches(secrets.token, body?.token)) return failure(c, 401, 'unauthenticated', 'The token does not match')
    setCookie(c, COOKIE, issueSession(secrets.key), { httpOnly: true, sameSite: 'Strict', path: '/', maxAge: SESSION_MAX_AGE_S })
    return c.json({ ok: true })
  })

  /** Registers one route with its tier; non-GET routes also need `x-console-request: 1`, which no cross-site form can send. */
  const route = (method: RouteSpec['method'], path: string, tier: RiskTier, action: string, handler: Handler, target?: (c: Context<Env>) => string) => {
    routes.push({ method, path, tier, action })
    app.on(method, path, async c => {
      if (method !== 'GET' && c.req.header('x-console-request') !== '1') return failure(c, 403, 'forbidden', 'Missing x-console-request header')
      const principal = c.get('principal')
      const record = (outcome: 'ok' | 'error' | 'denied', detail?: string) => {
        if (tier !== 'read') audit.record({ principal: principal.id, tier, action, target: target?.(c) ?? c.get('target') ?? '', outcome, ...detail ? { detail } : {} })
      }
      const decision = access.authorize(tier, principal)
      if (!decision.ok) { record('denied', decision.reason); return failure(c, 403, 'denied', decision.reason) }
      try {
        const result = await handler(c)
        record('ok')
        if (tier !== 'read') void live.tick()
        return c.json(result as object)
      } catch (error) {
        record('error', error instanceof Error ? error.message : String(error))
        if (error instanceof BadRequest || error instanceof DraftError) return failure(c, 400, 'bad-request', error.message)
        if (error instanceof Conflict) return failure(c, 409, 'conflict', error.message)
        if (error instanceof NotFound) return failure(c, 404, 'not-found', error.message)
        if (error instanceof UpstreamError) {
          if (error.kind === 'rejected') return failure(c, error.status === 404 ? 404 : error.status === 409 ? 409 : 400, error.status === 404 ? 'not-found' : error.status === 409 ? 'conflict' : 'bad-request', error.message)
          return failure(c, 503, 'upstream', error.message, error.kind)
        }
        throw error
      }
    })
  }
  const id = (c: Context<Env>) => c.req.param('id') ?? ''
  const watch = <T>(call: Promise<T>) => monitor.watch(call)
  /** A save names the revision the console read; upstream refuses it when someone saved in between. */
  const guarded = async <T>(call: Promise<T>): Promise<T> => {
    try { return await watch(call) } catch (error) {
      if (error instanceof UpstreamError && error.status === 409) throw new Conflict('设置在你编辑期间被别人改过（可能是主 Session、同步或另一个页面）。重新载入后再保存。')
      throw error
    }
  }
  const json = async <T>(c: Context<Env>) => await c.req.json().catch(() => null) as Partial<T> | null

  route('GET', '/api/meta', 'read', 'meta', async () => deps.meta)
  route('GET', '/api/home', 'read', 'home', () => buildHome(watched(upstream, watch), () => monitor.current, () => calibrationSummary(watched(upstream, watch), labels)))
  route('GET', '/api/health', 'read', 'health', () => buildHealth(watched(upstream, watch), () => monitor.current, () => audit.recent(20)))
  route('POST', '/api/tickets/:id/retry', 'low', 'ticket.retry', async c => { await watch(upstream.retry(id(c))); return { ok: true } }, id)
  route('POST', '/api/tickets/:id/stop', 'high', 'ticket.stop', async c => { await watch(upstream.stop(id(c))); return { ok: true } }, id)
  route('POST', '/api/triggers/:id/requeue', 'low', 'trigger.requeue', async c => watch(upstream.requeue(id(c))), id)
  route('POST', '/api/decisions/:id/dismiss', 'low', 'decision.dismiss', async c => { await watch(upstream.dismiss(id(c))); return { ok: true } }, id)
  route('POST', '/api/executor/pause', 'high', 'executor.pause', async c => {
    const body = await c.req.json().catch(() => null) as { paused?: unknown } | null
    if (typeof body?.paused !== 'boolean') throw new BadRequest('Body must be {"paused": true|false}')
    return watch(upstream.pause(body.paused))
  }, () => 'executor')

  const THREAD_FILTERS: readonly ThreadFilter[] = ['subscribed', 'evaluating', 'recent', 'all']
  route('GET', '/api/board', 'read', 'board', () => buildBoard(watched(upstream, watch), () => monitor.current))
  route('GET', '/api/tickets/:id', 'read', 'ticket', async c => {
    const [page, said] = await Promise.all([watch(upstream.ticket(id(c))), watched(upstream, watch).ticketMessages(id(c))])
    return ticketView(page, monitor.current, saidMessages(said))
  })
  route('GET', '/api/tickets/:id/transcript', 'read', 'ticket', async c => {
    const reads = watched(upstream, watch)
    const [page, info] = await Promise.all([reads.ticket(id(c)), reads.companionInfo()])
    const before = Number(c.req.query('before'))
    const transcript = info && page.sessionId ? await reads.transcript(page.sessionId, Number.isFinite(before) && c.req.query('before') ? before : undefined) : null
    return transcriptView(transcript, companionState(info), page.sessionId || undefined, monitor.current, page.directory || undefined)
  })
  route('GET', '/api/threads', 'read', 'threads', c => {
    const filter = c.req.query('filter') as ThreadFilter | undefined
    return buildThreads(watched(upstream, watch), filter && THREAD_FILTERS.includes(filter) ? filter : 'subscribed', () => monitor.current)
  })
  // Thread keys contain `/` and `:`, so they travel in the query rather than the path.
  route('GET', '/api/thread', 'read', 'thread', c => {
    const key = c.req.query('key')
    if (!key) throw new BadRequest('Query must name the thread: ?key=<thread key>')
    return buildThread(watched(upstream, watch), key, c.req.query('around') || undefined, () => monitor.current)
  })
  route('GET', '/api/search', 'read', 'search', c => buildSearch(watched(upstream, watch), c.req.query('q') ?? ''))
  route('POST', '/api/thread/unsubscribe', 'high', 'thread.unsubscribe', async c => {
    const body = await c.req.json().catch(() => null) as { key?: unknown } | null
    if (typeof body?.key !== 'string' || !body.key) throw new BadRequest('Body must be {"key": "<thread key>"}')
    c.set('target', body.key)
    const { removed } = await watch(upstream.unsubscribe(body.key))
    return { removed }
  })

  route('GET', '/api/policy', 'read', 'policy', () => buildPolicy(watched(upstream, watch), () => monitor.current))
  route('PUT', '/api/policy', 'high', 'policy.save', async c => {
    const body = await c.req.json().catch(() => null) as Partial<PolicySave> | null
    const draft = body?.draft, revisions = body?.revisions
    if (!draft || !Array.isArray(draft.rules) || typeof draft.sources !== 'object' || !['off', 'observe', 'auto'].includes(draft.mode)
      || typeof revisions?.policy !== 'number' || typeof revisions.eval !== 'number') throw new BadRequest('Body must be {"draft": {...}, "revisions": {"policy": n, "eval": n}}')
    const settings = await watch(upstream.settings())
    const policy = mergePolicy(settings.blocks.policy.value, draft)
    const changed: string[] = []
    const save = async (block: 'policy' | 'eval', value: unknown, revision: number) => {
      await guarded(upstream.saveSettings(block, value, revision))
      changed.push(block)
    }
    if (JSON.stringify(policy) !== JSON.stringify(settings.blocks.policy.value)) await save('policy', policy, revisions.policy)
    if (draft.mode !== settings.blocks.eval.value.mode) await save('eval', { ...settings.blocks.eval.value, mode: draft.mode }, revisions.eval)
    c.set('target', changed.join(',') || 'unchanged')
    const after = changed.length ? await watch(upstream.settings()) : settings
    return { policyVersion: after.policyVersion.slice(0, 7), revisions: { policy: after.blocks.policy.revision, eval: after.blocks.eval.revision } }
  })
  route('POST', '/api/policy/sync/:id', 'low', 'policy.sync', async c => { await watch(upstream.policySync(id(c))); return { ok: true } }, id)

  route('GET', '/api/prompts', 'read', 'prompts', c => {
    const value = c.req.query('revision')
    const revision = value ? Number(value) : undefined
    if (revision !== undefined && !Number.isInteger(revision)) throw new BadRequest('revision must be a number')
    return buildPrompts(watched(upstream, watch), revision, () => monitor.current)
  })
  const promptConfig = (value: unknown): PromptConfig => {
    const config = value as PromptConfig | null
    if (!config || typeof config.communication !== 'string' || typeof config.scope !== 'string' || typeof config.delivery !== 'string'
      || typeof config.skills !== 'object' || config.skills === null) throw new BadRequest('A prompt configuration has communication, scope, delivery and skills')
    return config
  }
  route('PUT', '/api/prompts', 'high', 'prompts.save', async c => {
    const body = await json<{ config: PromptConfig; baseRevision: number }>(c)
    if (typeof body?.baseRevision !== 'number') throw new BadRequest('Body must be {"config": {...}, "baseRevision": n}')
    const { revision } = await guarded(upstream.savePrompts(promptConfig(body.config), body.baseRevision))
    c.set('target', `r${revision}`)
    return { revision }
  })
  route('POST', '/api/prompts/preview', 'read', 'prompts.preview', async c => {
    const config = promptConfig(await json<PromptConfig>(c))
    return previewView(await watch(upstream.previewPrompts(config)), config.overrides)
  })

  route('GET', '/api/sources', 'read', 'sources', () => buildSources(watched(upstream, watch), () => monitor.current))
  route('PUT', '/api/sources/:id', 'high', 'source.save', async c => {
    const body = await json<SourceSave>(c)
    if (typeof body?.enabled !== 'boolean' || typeof body.revision !== 'number') throw new BadRequest('Body must be {"enabled": bool, "revision": n, ...}')
    const settings = await watch(upstream.settings())
    const source = settings.sources.find(item => item.id === id(c))
    if (!source) throw new NotFound('没有这个来源')
    const config = mergeSource(source.kind, source.value.config, body as SourceSave)
    return guarded(upstream.saveSettings(`source:${source.id}`, { enabled: body.enabled, config }, body.revision))
  }, id)
  // Which CLI runs with the agent's credentials, and on which repository: local only, like the prepare command. Upstream
  // checks the accounts before it saves and restarts dsh-superagent after; a failed check saves nothing.
  route('PUT', '/api/sources/:id/account', 'local-only', 'source.account', async c => {
    const body = await json<SourceAccountSave>(c)
    if (typeof body?.cli !== 'string' || typeof body.revision !== 'number') throw new BadRequest('Body must be {"cli": "...", "revision": n, "repository"?: "owner/name"}')
    const settings = await watch(upstream.settings())
    const source = settings.sources.find(item => item.id === id(c))
    if (!source) throw new NotFound('没有这个来源')
    const config = mergeAccount(source.kind, source.value.config, body as SourceAccountSave)
    try { return await guarded(upstream.saveSettings(`source:${source.id}`, { enabled: source.value.enabled, config }, body.revision)) }
    catch (error) {
      const problem = error instanceof UpstreamError ? error.body?.setup as SetupProblem | undefined : undefined
      if (problem) throw new DraftError(`账号检查没通过，什么都没保存：${setupText(problem)}`)
      throw error
    }
  }, id)
  route('POST', '/api/sources/:id/labels', 'low', 'source.labels', async c => watch(upstream.refreshLabels(id(c))), id)
  route('POST', '/api/setup/check', 'high', 'setup.check', async () => watch(upstream.setupCheck()))

  route('GET', '/api/execution', 'read', 'execution', () => buildExecution(watched(upstream, watch), () => monitor.current))
  // The prepare command runs in a shell as the operator: changing it is changing what runs on this machine.
  route('PUT', '/api/execution', 'local-only', 'executor.save', async c => {
    const body = await json<{ executor: ExecutorSettings; revision: number }>(c)
    if (!body?.executor || typeof body.revision !== 'number') throw new BadRequest('Body must be {"executor": {...}, "revision": n}')
    const executor = checkExecutor(body.executor as ExecutorSettings)
    const settings = await watch(upstream.settings())
    return guarded(upstream.saveSettings('executor', { ...settings.blocks.executor.value, ...executor }, body.revision)).then(({ revision }) => ({ revision }))
  }, () => 'executor')
  route('PUT', '/api/eval', 'high', 'eval.save', async c => {
    const body = await json<{ timeoutSeconds: number; model: ModelChoice | null; revision: number }>(c)
    if (!Number.isInteger(body?.timeoutSeconds) || typeof body?.revision !== 'number') throw new BadRequest('Body must be {"timeoutSeconds": n, "model": {...}|null, "revision": n}')
    const settings = await watch(upstream.settings())
    const model = body.model ?? null
    const { revision } = await guarded(upstream.saveSettings('eval', { ...settings.blocks.eval.value, timeoutSeconds: body.timeoutSeconds, model }, body.revision))
    if (JSON.stringify(settings.blocks.eval.value.model ?? null) === JSON.stringify(model)) return { revision }
    return { revision, mainModel: await switchMainModel(upstream, model) }
  }, () => 'eval')
  // For a main Session that differs from its setting: one saved before the companion could switch it, or switched in DSH.
  route('POST', '/api/eval/main-model', 'high', 'eval.main-model', async () => {
    const settings = await watch(upstream.settings())
    return switchMainModel(upstream, settings.blocks.eval.value.model ?? null)
  }, () => 'eval')

  const disk = new DiskUsage()
  route('GET', '/api/directories', 'read', 'directories', () => buildDirectories(watched(upstream, watch), disk, () => monitor.current))
  route('POST', '/api/directories/rescan', 'low', 'directories.rescan', async () => { disk.forget(); return { ok: true } })
  route('GET', '/api/directories/files', 'read', 'directories.files', c => {
    const key = c.req.query('key')
    if (!key) throw new BadRequest('Query must name the directory: ?key=<ticket id or folder>')
    return directoryFiles(watched(upstream, watch), disk, key, c.req.query('path') ?? '', () => monitor.current)
  })
  // Opens a window on the machine the BFF runs on, which only someone sitting at it can use.
  route('POST', '/api/directories/reveal', 'local-only', 'directories.reveal', async c => {
    const body = await json<{ key: string; path: string }>(c)
    if (typeof body?.key !== 'string' || !body.key) throw new BadRequest('Body must be {"key": "<ticket id or folder>", "path": "<relative path>"}')
    c.set('target', body.key)
    await revealEntry(watched(upstream, watch), body.key, typeof body.path === 'string' ? body.path : '', deps.reveal ?? revealInFinder)
    return { ok: true }
  })

  route('GET', '/api/insights', 'read', 'insights', () => buildInsights(watched(upstream, watch), snapshots, () => calibrationSummary(watched(upstream, watch), labels), () => monitor.current))

  const recipeUpstream = () => ({ ...watched(upstream, watch),
    saveSettings: (...args: Parameters<UpstreamClient['saveSettings']>) => guarded(upstream.saveSettings(...args)),
    savePrompts: (...args: Parameters<UpstreamClient['savePrompts']>) => guarded(upstream.savePrompts(...args)) })
  route('GET', '/api/recipes', 'read', 'recipes', () => buildRecipes(watched(upstream, watch), () => monitor.current))
  route('POST', '/api/recipes/:id/preview', 'read', 'recipe.preview', async c => previewRecipe(watched(upstream, watch), id(c), (await json<{ chat: string }>(c))?.chat))
  route('POST', '/api/recipes/:id/apply', 'high', 'recipe.apply', async c => {
    const chat = (await json<{ chat: string }>(c))?.chat
    return applyRecipe(recipeUpstream(), id(c), chat)
  }, id)

  route('GET', '/api/calibration', 'read', 'calibration', () => buildCalibration(watched(upstream, watch), labels, () => monitor.current))
  route('POST', '/api/calibration/:id', 'low', 'calibration.label', async c => {
    const body = await c.req.json().catch(() => null) as { label?: unknown; note?: unknown } | null
    const label = body?.label
    if (label !== null && label !== 'right' && label !== 'wrong' && label !== 'scope') throw new BadRequest('Body must be {"label": "right"|"wrong"|"scope"|null}')
    const decision = (await judgements(watched(upstream, watch))).find(item => item.id === id(c))
    if (!decision) throw new NotFound('这条判断不在最近两周的记录里')
    if (label === null) labels.clear(decision.id)
    else labels.set({ decisionId: decision.id, label: label as CalibrationLabel, ...typeof body?.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {},
      outcome: decision.outcome, rules: decision.rules.filter(rule => rule.matched).map(rule => rule.id) })
    return { ok: true }
  }, id)

  routes.push({ method: 'GET', path: '/api/events', tier: 'read', action: 'events' })
  app.get('/api/events', c => streamSSE(c, async stream => {
    let seq = 0
    const send = (event: LiveEvent) => stream.writeSSE({ event: event.type, data: JSON.stringify(event), id: String(++seq) })
    await send({ type: 'connection', connection: monitor.current })
    const unsubscribe = live.subscribe(event => { void send(event) })
    const heartbeat = setInterval(() => { void stream.write(': keep-alive\n\n') }, 15_000)
    await new Promise<void>(resolve => stream.onAbort(resolve))
    clearInterval(heartbeat)
    unsubscribe()
  }))

  app.all('/api/*', c => failure(c, 404, 'not-found', 'Unknown API route'))
  if (deps.staticDir && existsSync(deps.staticDir)) app.get('*', c => serveStatic(c, deps.staticDir!))
  return { app, routes }
}

/** The view builders' upstream reads, each recorded by the connection monitor. */
function watched(upstream: UpstreamClient, watch: <T>(call: Promise<T>) => Promise<T>) {
  return {
    state: () => watch(upstream.state()),
    overview: () => watch(upstream.overview()),
    sources: () => watch(upstream.sources()),
    tickets: (...args: Parameters<UpstreamClient['tickets']>) => watch(upstream.tickets(...args)),
    threads: (...args: Parameters<UpstreamClient['threads']>) => watch(upstream.threads(...args)),
    thread: (...args: Parameters<UpstreamClient['thread']>) => watch(upstream.thread(...args)),
    search: (query: string) => watch(upstream.search(query)),
    settings: () => watch(upstream.settings()),
    policyHistory: () => watch(upstream.policyHistory()),
    ticket: (id: string) => watch(upstream.ticket(id)),
    decisions: (...args: Parameters<UpstreamClient['decisions']>) => watch(upstream.decisions(...args)),
    prompts: (revision?: number) => watch(upstream.prompts(revision)),
    models: () => watch(upstream.models()),
    // The companion is optional: it failing or missing never marks dsh-superagent unreachable, and reads as not installed.
    companionInfo: () => upstream.companionInfo().catch(() => null),
    transcript: (...args: Parameters<UpstreamClient['transcript']>) => upstream.transcript(...args).catch(() => null),
    ticketMessages: (ticketId: string) => upstream.ticketMessages(ticketId).catch(() => null),
    outboxSummary: () => upstream.outboxSummary().catch(() => null),
  }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
}
/** Serves the built console; unknown paths get `index.html` so the console's own routes load. */
function serveStatic(c: Context, root: string) {
  const relative = normalize(decodeURIComponent(c.req.path)).replace(/^([/\\])+/, '')
  let file = join(root, relative)
  if (!file.startsWith(root + sep) && file !== root) return c.text('Not found', 404)
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html')
  const type = TYPES[extname(file)] ?? 'application/octet-stream'
  const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'
  return c.body(readFileSync(file), 200, { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' })
}
