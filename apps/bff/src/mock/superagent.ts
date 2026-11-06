/**
 * A mock dsh-superagent for development and tests. It serves the subset of `/orchestrator/api` the BFF uses, in upstream's
 * shapes, and refuses requests the way upstream's `sameOrigin` does, so the BFF's client is exercised as it is in real use.
 * With `simulate`, a short script changes the world every few seconds so live updates have something to show.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { API_PATH as COMPANION_PATH } from '@dsh-superagent-ui/companion/api'
import { answer as companionAnswer, sameOrigin as companionOrigin } from '@dsh-superagent-ui/companion/http'
import type { DecisionView, OverviewProblem, OverviewView, SearchView, SourceStatus, StateView, ThreadDetailView, TicketRow, TriggerView } from '../upstream/types.ts'
import { REPO, seedProblems, seedSources, seedTickets } from './fixtures.ts'
import { filteredTrigger, seedThreads, threadSummary, ticketPage, type MockThread } from './records.ts'
import { MANDATE_VERSION, SaveRefused, saveBlock, seedDecisions, seedSettings, settingsView, syncFeishu, versionOf, type MockSettings } from './settings.ts'
import { preview, PromptRefusal, promptsView, savePrompts, seedPrompts, type MockPrompts } from './prompts.ts'
import { companionServices, seedCompanion, type MockCompanion } from './companion.ts'
import { seedDirectories } from './directories.ts'

export interface MockWorld {
  tickets: TicketRow[]
  threads: MockThread[]
  /** Messages a Source filtered; they belong to no thread. */
  filtered: (TriggerView & { filtered: { code: string } })[]
  problems: OverviewProblem[]
  sources: SourceStatus[]
  settings: MockSettings
  prompts: MockPrompts
  /** Proactive judgements, newest first. */
  decisions: DecisionView[]
  paused: boolean
  maxWorkers: number
  policyVersion: string
  /** Set to simulate a setup problem, as a fresh deployment has. */
  setupProblem: StateView['setup']['problem']
  /** The companion plugin beside it: worker transcripts and the outbox. */
  companion: MockCompanion
  /** The execution root: a real folder, so development and tests measure and list real files. */
  directories?: string
}

export function seedWorld(now = Date.now()): MockWorld {
  const tickets = seedTickets(now)
  return { tickets, threads: seedThreads(now, tickets), filtered: [filteredTrigger(now)], problems: seedProblems(), sources: seedSources(now),
    settings: seedSettings(now), prompts: seedPrompts(now), decisions: seedDecisions(now), paused: false, maxWorkers: 3, policyVersion: MANDATE_VERSION, setupProblem: null,
    companion: seedCompanion(tickets) }
}

const isQueued = (t: TicketRow) => t.stage === 'working' && t.action === 'queued'
function counts(world: MockWorld) {
  const open = world.tickets.filter(t => t.state === 'open')
  return { running: open.filter(t => t.stage === 'working' && !isQueued(t)).length, queued: open.filter(isQueued).length,
    idle: open.filter(t => t.stage === 'idle').length }
}

export function stateView(world: MockWorld): StateView {
  const { running, queued } = counts(world)
  return {
    setup: { machine: { stateDir: '/Users/operator/.dsh/state/superagent', promptMaxChars: 100000, admissionContextMaxPages: 10, admissionContextTimeoutMs: 15000 },
      problem: world.setupProblem, feishuProblem: null,
      accounts: { repository: REPO, agent: 'acme-agent', feishu: { appId: 'cli_mock', brand: 'feishu', botId: 'ou_bot', name: 'Harness 助手' } } },
    load: { running, queued, maxWorkers: world.maxWorkers }, masterId: 'orchestrator', paused: world.paused, health: {},
  }
}

export function overviewView(world: MockWorld): OverviewView {
  const { running, queued, idle } = counts(world)
  return {
    problems: [...world.setupProblem ? [{ kind: 'setup' as const, ...world.setupProblem }] : [], ...world.problems,
      ...world.paused ? [{ kind: 'executor-paused' as const }] : []],
    person: world.tickets.filter(t => t.state === 'open' && t.stage === 'person'),
    executor: { running, queued, maxWorkers: world.maxWorkers, idle },
    flow: { received: 190, filtered: 53, triggers: 137, judged: 61, accepted: 9, evaluating: 0, dropped: 1 },
    policyVersion: world.policyVersion,
  }
}

function ticketList(world: MockWorld, state: string, limit: number, offset = 0) {
  const items = world.tickets.filter(t => state === 'ended' ? t.state === 'ended' : t.state === 'open' && (state === 'open'
    || (state === 'working' ? t.stage === 'working' : t.stage === state)))
  return { items: items.slice(offset, offset + limit), total: items.length, next_offset: items.length > offset + limit ? offset + limit : null }
}

/** Upstream's `sameOrigin`: loopback Host on its own port, the marker header, and no foreign Origin. */
export function sameOrigin(req: Pick<IncomingMessage, 'headers'>, port: number): boolean {
  const host = req.headers.host
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false
  return req.headers['x-orchestrator-request'] === '1' && (req.headers.origin === undefined || req.headers.origin === `http://${host}`)
}

const DAY = 86_400_000
function threadList(world: MockWorld, filter: string, limit: number) {
  const summaries = world.threads.map(thread => threadSummary(thread, world.tickets))
  const since = new Date(Date.now() - DAY).toISOString()
  const kept = summaries.filter(thread => filter === 'all' || (filter === 'recent' ? thread.lastAt >= since
    : filter === 'evaluating' ? thread.stage === 'evaluating' || thread.stage === 'queued' : thread.stage === 'subscribed'))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
  return { items: kept.slice(0, limit), total: kept.length, next_offset: kept.length > limit ? limit : null }
}

function threadDetail(world: MockWorld, key: string): ThreadDetailView {
  const thread = world.threads.find(item => item.key === key)
  if (!thread) throw new Refusal(404, 'Thread not found')
  const summary = threadSummary(thread, world.tickets)
  const rows = thread.subscriptions.flatMap(id => world.tickets.filter(ticket => ticket.id === id))
  return { ...summary, context: thread.context, correlated: [], decisions: [],
    tickets: rows.map(({ reply: _reply, ...row }) => row), timeline: [...thread.triggers].sort((a, b) => a.at.localeCompare(b.at)), earlier: null }
}

/** Like upstream's search: text, ids, links, `#N` and GitHub URLs find messages, threads and Tickets. */
function search(world: MockWorld, query: string): SearchView {
  const value = query.trim()
  if (!value) return { tickets: [], items: [], threads: [] }
  const lower = value.toLowerCase()
  const number = /^#?(\d+)$/.exec(value)?.[1] ?? /github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/(\d+)/.exec(value)?.[1]
  const named = number ? world.threads.filter(thread => thread.key.endsWith(`/${number}`)).map(thread => thread.key) : []
  const titleOf = (key: string) => world.threads.find(thread => thread.key === key)?.title
  const found = [...world.threads.flatMap(thread => thread.triggers), ...world.filtered]
    .filter(trigger => trigger.id === value || trigger.url === value || trigger.text.toLowerCase().includes(lower))
    .filter(trigger => trigger.human || !named.includes(trigger.threads[0]!))
  return {
    tickets: world.tickets.filter(ticket => ticket.title.toLowerCase().includes(lower) || ticket.threads.some(thread => named.includes(thread.key)))
      .map(({ threads: _threads, reply: _reply, ...row }) => row),
    items: found.sort((a, b) => b.at.localeCompare(a.at)).map(({ text: _text, ...trigger }) =>
      ({ ...trigger, ...'filtered' in trigger ? { filtered: (trigger as { filtered: { code: string } }).filtered } : { threadTitle: titleOf(trigger.threads[0]!) } })),
    threads: named.map(key => threadSummary(world.threads.find(thread => thread.key === key)!, world.tickets)),
  }
}

class Refusal extends Error {
  readonly status: number
  readonly extra: Record<string, unknown>
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) { super(message); this.status = status; this.extra = extra }
}

function handle(world: MockWorld, method: string, path: string, query: URLSearchParams, body: unknown): unknown {
  const ticketAction = /^tickets\/([^/]+)\/(retry|stop)$/.exec(path)
  if (ticketAction) {
    if (method !== 'POST') throw new Refusal(404, 'Unknown operation')
    const ticket = world.tickets.find(t => t.id === decodeURIComponent(ticketAction[1]!))
    if (!ticket) throw new Refusal(404, 'Ticket not found')
    const now = new Date().toISOString()
    if (ticketAction[2] === 'retry') {
      if (!ticket.actions.retry) throw new Refusal(400, 'This ticket has nothing to retry')
      Object.assign(ticket, { stage: 'working', action: 'queued', note: undefined, actions: { retry: false, stop: true }, updatedAt: now,
        summary: '重新派工，等空闲 worker' })
      return { retried: true }
    }
    if (ticket.state === 'ended') throw new Refusal(400, 'The ticket already ended')
    Object.assign(ticket, { state: 'ended', stage: 'ended', action: undefined, attention: undefined, reply: undefined, note: undefined,
      actions: { retry: false, stop: false }, ended: { at: now, by: 'human', outcome: 'stopped' }, updatedAt: now })
    return { stopped: true }
  }
  const ticketPath = /^tickets\/([^/]+)$/.exec(path)
  if (ticketPath && method === 'GET') {
    const row = world.tickets.find(t => t.id === decodeURIComponent(ticketPath[1]!))
    if (!row) throw new Refusal(404, 'Ticket not found')
    return ticketPage(row, world.threads, MANDATE_VERSION)
  }
  const threadPath = /^threads\/([^/]+)(\/unsubscribe)?$/.exec(path)
  if (threadPath) {
    const key = decodeURIComponent(threadPath[1]!)
    if (threadPath[2] && method === 'POST') {
      const thread = world.threads.find(item => item.key === key)
      if (!thread) throw new Refusal(404, 'Thread not found')
      const removed = thread.subscriptions.length > 0
      thread.subscriptions = []
      thread.context = []
      return { removed, thread: key, context_delivery: 'injected' }
    }
    if (!threadPath[2] && method === 'GET') return threadDetail(world, key)
  }
  const settingsPath = /^settings\/([^/]+)$/.exec(path)
  if (settingsPath && method === 'PUT') {
    try {
      const saved = saveBlock(world.settings, decodeURIComponent(settingsPath[1]!), body)
      world.policyVersion = versionOf(world.settings)
      world.maxWorkers = world.settings.executor.maxWorkers
      return saved
    } catch (error) {
      if (error instanceof SaveRefused) throw new Refusal(error.status, error.message, error.extra)
      throw error
    }
  }
  if (path === 'prompts' || path === 'prompts/preview') {
    try {
      if (method === 'GET' && path === 'prompts') return promptsView(world.prompts, query.get('revision') ? Number(query.get('revision')) : undefined)
      if (method === 'PUT' && path === 'prompts') {
        const saved = savePrompts(world.prompts, body)
        for (const session of world.prompts.sessions) if (session.sessionId === 'orchestrator') session.revision = saved.revision
        return { ...saved, context_delivery: 'injected' }
      }
      if (method === 'POST' && path === 'prompts/preview') return preview(body)
    } catch (error) {
      if (error instanceof PromptRefusal) throw new Refusal(error.status, error.message)
      throw error
    }
  }
  const sync = /^policy-sync\/([^/]+)$/.exec(path)
  if (sync && method === 'POST') {
    if (sync[1] !== 'feishu') throw new Refusal(400, 'This Source has no membership sync')
    const result = syncFeishu(world.settings)
    world.policyVersion = versionOf(world.settings)
    return result
  }
  const requeue = /^triggers\/([^/]+)\/requeue$/.exec(path)
  if (requeue && method === 'POST') {
    const id = decodeURIComponent(requeue[1]!)
    world.problems = world.problems.filter(p => !(p.kind === 'eval-unavailable' && p.triggerId === id))
    for (const thread of world.threads) for (const trigger of thread.triggers) if (trigger.id === id) {
      trigger.disposition = { ...trigger.disposition, queued: true, decision: undefined }
      trigger.actions = { requeue: false }
      thread.pending = 1
    }
    return { queued: true }
  }
  const dismiss = /^decisions\/([^/]+)\/dismiss$/.exec(path)
  if (dismiss && method === 'POST') {
    const id = decodeURIComponent(dismiss[1]!)
    world.problems = world.problems.filter(p => !(p.kind === 'eval-unavailable' && p.decisionId === id))
    return { dismissed: true }
  }
  const route = `${method} ${path}`
  switch (route) {
    case 'GET state': return stateView(world)
    case 'GET overview': return overviewView(world)
    case 'GET sources': return world.sources
    case 'GET tickets': return ticketList(world, query.get('state') ?? 'open', Number(query.get('limit') ?? 20), Number(query.get('offset') ?? 0))
    case 'GET threads': return threadList(world, query.get('filter') ?? 'subscribed', Number(query.get('limit') ?? 20))
    case 'GET search': return search(world, query.get('q') ?? '')
    case 'GET settings': {
      const view = settingsView(world.settings, world.policyVersion)
      return view.environment && world.directories ? { ...view, environment: { ...view.environment, root: world.directories } } : view
    }
    case 'GET models': return { default: { provider: 'deepseek', model: 'deepseek-v4' }, routableProviders: ['deepseek'], failures: [],
      groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4', name: 'DeepSeek V4' }, { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }] }] }
    case 'GET policy/history': return { current: world.settings.current, policyVersion: world.policyVersion, items: world.settings.history }
    case 'GET decisions': {
      const kinds = (query.get('kind') ?? '').split(',').filter(Boolean)
      const offset = Number(query.get('offset') ?? 0), limit = Number(query.get('limit') ?? 30)
      const items = world.decisions.filter(decision => !kinds.length || kinds.includes(decision.kind))
      return { items: items.slice(offset, offset + limit), next_offset: offset + limit < items.length ? offset + limit : null }
    }
    case 'POST setup/check': {
      // Upstream refuses when there is nothing to fix; otherwise it restarts, which the mock does by fixing the problem.
      if (!world.setupProblem) throw new Refusal(400, 'Setup is complete; nothing to check', { code: 'setupComplete' })
      world.setupProblem = null
      return { restarting: true }
    }
    case 'POST sources/feishu/labels': {
      // The bot was added to one more chat since the last read.
      const before = Object.keys(world.settings.joined)
      world.settings.joined.oc_harness_ops = 'harness-ops'
      return { added: Object.entries(world.settings.joined).filter(([key]) => !before.includes(key)).map(([, name]) => name) }
    }
    case 'POST sources/github/labels': throw new Refusal(400, 'This Source has no display names to refresh', { code: 'noLabels' })
    case 'POST executor/pause': {
      const paused = (body as { paused?: unknown } | null)?.paused
      if (typeof paused !== 'boolean') throw new Refusal(400, 'Invalid settings: paused')
      world.paused = paused
      return { paused }
    }
  }
  throw new Refusal(404, 'Unknown operation')
}

/** A few changes, one every `stepMs`, so the console's live updates can be watched. */
function script(world: MockWorld): (() => void)[] {
  const now = () => new Date().toISOString()
  const find = (id: string) => world.tickets.find(t => t.id === id)
  return [
    () => { const t = find('tk_151'); if (t?.state === 'open') Object.assign(t, { stage: 'person', action: 'review', updatedAt: now(),
      summary: 'PR #327 已就绪：上传失败最多重试 3 次，带退避；集成测试通过。',
      threads: [...t.threads, { key: 'github:pull/327', source: 'github', title: '上传接口加上重试', url: `https://github.com/${REPO}/pull/327`, facts: {} }],
      reply: { source: 'github', url: `https://github.com/${REPO}/pull/327`, label: { zh: 'PR #327', en: 'PR #327' } } }) },
    () => { const t = find('tk_155'); if (t?.state === 'open') Object.assign(t, { action: undefined, sessionId: 'worker-tk_155', updatedAt: now(), summary: '正在读现有部署文档' }) },
    () => { const t = find('tk_163'); if (t?.state === 'open') Object.assign(t, { stage: 'person', action: 'answer', updatedAt: now(),
      attention: { id: 'att_tk_163', question: '修复需要把路径统一转成 NFC。这会改变已有缓存目录的名字，要不要顺便写一个迁移？' },
      reply: { source: 'github', url: `https://github.com/${REPO}/issues/163`, label: { zh: '中文路径打开失败', en: '中文路径打开失败' } } }) },
  ]
}

export interface MockSuperagent {
  url: string
  port: number
  world: MockWorld
  close(): Promise<void>
}

export async function startMockSuperagent(options: { port?: number; simulate?: boolean; stepMs?: number; world?: MockWorld } = {}): Promise<MockSuperagent> {
  const world = options.world ?? seedWorld()
  const directories = await seedDirectories(world)
  let port = 0
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, value?: unknown) => {
      res.writeHead(status, value === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' })
      res.end(value === undefined ? undefined : JSON.stringify(value))
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    // The companion plugin answers on the same server; without it, its paths get DSH's empty 404.
    if (url.pathname.startsWith(COMPANION_PATH)) {
      if (!world.companion.installed) return reply(404)
      if (!companionOrigin(req, port)) return reply(403, { error: 'Same-origin request required' })
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk as Buffer))
      req.on('end', () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown : undefined
        // Before 0.3.0 the companion only read, and did not say it could do more.
        if (world.companion.legacy && req.method !== 'GET') return reply(405, { error: 'The companion only reads' })
        companionAnswer(companionServices(world.companion), req.method ?? 'GET', url.pathname.slice(COMPANION_PATH.length), url.searchParams, body)
          .then(value => {
            if (!world.companion.legacy || !value || typeof value !== 'object') return reply(200, value)
            if ('capabilities' in value) return reply(200, { ...value, capabilities: ['transcript', 'outbox'] })
            if (!('models' in value)) return reply(200, value)
            const { models: _models, model: _model, next: _next, ...older } = value as Record<string, unknown>
            reply(200, older)
          }, (error: { status?: number; message?: string }) => reply(error.status ?? 500, { error: error.message ?? String(error) }))
      })
      return
    }
    if (!url.pathname.startsWith('/orchestrator/api/')) return reply(404)
    if (!sameOrigin(req, port)) return reply(403, { error: 'Same-origin management request required' })
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      let body: unknown = null
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null } catch { return reply(400, { error: 'The request body is not JSON' }) }
      try {
        reply(200, handle(world, req.method ?? 'GET', url.pathname.slice('/orchestrator/api/'.length), url.searchParams, body))
      } catch (error) {
        if (error instanceof Refusal) return reply(error.status, { error: error.message, ...error.extra })
        reply(500, { error: error instanceof Error ? error.message : String(error) })
      }
    })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', resolve) })
  port = (server.address() as AddressInfo).port
  const steps = options.simulate ? script(world) : []
  const timer = steps.length ? setInterval(() => { steps.shift()?.(); if (!steps.length) clearInterval(timer) }, options.stepMs ?? 20_000) : undefined
  return {
    url: `http://127.0.0.1:${port}`, port, world,
    close: () => new Promise<void>(resolve => { clearInterval(timer); server.closeAllConnections(); server.close(() => resolve()) }).then(directories.remove),
  }
}
