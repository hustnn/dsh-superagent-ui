/**
 * The companion's routes on the DSH web server, under `/superagent-ui/api/`. Reads, and the one write that switches the main
 * Session's model. Guarded like upstream's management API (`sameOrigin` in upstream `src/app/http.ts`): only a caller on this
 * machine that names the loopback address and sends the request header gets an answer, so a web page in the operator's browser
 * cannot read the agent's transcripts or change its model.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { API_PATH, PLUGIN_NAME, REQUEST_HEADER, type CompanionInfo, type MainModelRequest, type MainModelResult, type ModelSelection, type Transcript } from './api.ts'
import type { Context } from './host.ts'
import { summary, ticketMessages } from './outbox.ts'
import { page } from './transcript.ts'

export const VERSION = '0.3.0'
const PAGE = { default: 200, max: 500 }
const BODY_MAX = 4096

export function sameOrigin(req: Pick<IncomingMessage, 'headers'>, port: number): boolean {
  const host = req.headers.host
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false
  return req.headers[REQUEST_HEADER] === '1' && (req.headers.origin === undefined || req.headers.origin === `http://${host}`)
}

class RouteError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

type Services = Pick<Context, 'logger' | 'sessionPersistence' | 'orchestrator' | 'sessionController' | 'agentDefaultModel'>
/** Answers one request under the API path; `path` is what follows it, `body` the parsed JSON of a POST. */
export async function answer(services: Services, method: string, path: string, query: URLSearchParams, body?: unknown): Promise<unknown> {
  const [head, ...rest] = path.split('/').map(decodeURIComponent)
  if (method === 'POST' && head === 'main-session' && rest[0] === 'model' && rest.length === 1) return switchMainModel(services, mainModelRequest(body))
  if (method !== 'GET') throw new RouteError(405, 'The companion only reads, apart from POST main-session/model')
  if (head === 'info' && !rest.length) return { name: PLUGIN_NAME, version: VERSION, capabilities: ['transcript', 'outbox', 'main-model'] } satisfies CompanionInfo
  if (head === 'transcript' && rest.length === 1) return transcript(services, rest[0]!, query)
  if (head === 'outbox' && !rest.length) {
    const ticket = query.get('ticket')
    if (!ticket) throw new RouteError(400, 'outbox needs ?ticket=<id>')
    await services.orchestrator.ready
    return ticketMessages(services.orchestrator.store.db, ticket)
  }
  if (head === 'outbox' && rest[0] === 'summary' && rest.length === 1) {
    await services.orchestrator.ready
    return summary(services.orchestrator.store.db)
  }
  throw new RouteError(404, 'Unknown operation')
}

async function transcript(services: Services, sessionId: string, query: URLSearchParams): Promise<Transcript> {
  const before = query.has('before') ? Number(query.get('before')) : undefined
  const limit = Math.min(PAGE.max, Math.max(1, Number(query.get('limit')) || PAGE.default))
  if (before !== undefined && !Number.isFinite(before)) throw new RouteError(400, 'before must be a sequence number')
  if (!await services.sessionPersistence.stat(sessionId)) return { sessionId, exists: false, entries: [], more: false, running: false, models: [] }
  const reader = await services.sessionPersistence.open(sessionId, 'read')
  try {
    const { events } = await reader.read()
    return page(sessionId, events, before, limit)
  } finally { await reader.close() }
}

function mainModelRequest(body: unknown): MainModelRequest {
  const model = (body as { model?: unknown } | null | undefined)?.model
  if (model === null) return { model: null }
  const { provider, model: id, reasoningEffort } = (model ?? {}) as Record<string, unknown>
  if (typeof provider !== 'string' || !provider || typeof id !== 'string' || !id || (reasoningEffort !== undefined && typeof reasoningEffort !== 'string'))
    throw new RouteError(400, 'Body must be {"model": {"provider": "…", "model": "…"} | null}')
  return { model: { provider, model: id, ...reasoningEffort === undefined ? {} : { reasoningEffort } } }
}

const sameSelection = (a: ModelSelection, b: ModelSelection) => a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort

/**
 * dsh-superagent only sets a Session's model before its first call and the main Session lives on, so its setting never reaches
 * the running one. DSH's `selectModel` does, as when a person picks a model in DSH's Web UI.
 */
async function switchMainModel(services: Services, request: MainModelRequest): Promise<MainModelResult> {
  await services.orchestrator.ready
  const sessionId = services.orchestrator.masterId
  const before = services.agentDefaultModel.currentSelection()
  let selected: ModelSelection
  try { ({ selected } = await services.sessionController.selectModel({ sessionId, ...request.model ?? before })) }
  catch (error) { throw new RouteError(409, error instanceof Error ? error.message : String(error)) }
  // So that the transcript the console reads next already names this selection.
  await services.sessionPersistence.flush()
  // selectModel also saves its choice as the profile's default, which any Session started on the default would follow. Saves
  // commit in order, so this one lands last. The main Session has switched by now, so a failure here does not undo that.
  if (!sameSelection(selected, before)) await services.agentDefaultModel.saveSelection(before)
    .catch(error => { services.logger.warn('superagent-ui companion: the main Session switched, but the profile default was not put back: %s', String(error)) })
  return { sessionId, model: selected }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > BODY_MAX) throw new RouteError(413, 'The request body is too large')
    chunks.push(chunk)
  }
  try { return size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined }
  catch { throw new RouteError(400, 'The request body is not JSON') }
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(value))
}

/** Claims `/superagent-ui` on the DSH web server; returns the disposer. */
export function registerRoutes(ctx: Context): () => void {
  if (ctx.webServer.host !== '127.0.0.1') throw new Error('The dsh-superagent-ui companion requires a loopback Web server')
  return ctx.webServer.register({ kind: 'prefix', path: API_PATH.slice(0, API_PATH.indexOf('/api/')), handler: async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(API_PATH)) { res.writeHead(404); res.end(); return }
    if (!sameOrigin(req, ctx.webServer.port)) { json(res, 403, { error: 'Same-origin request required' }); return }
    try { json(res, 200, await answer(ctx, req.method ?? 'GET', url.pathname.slice(API_PATH.length), url.searchParams, req.method === 'POST' ? await readJson(req) : undefined)) }
    catch (error) {
      if (error instanceof RouteError) json(res, error.status, { error: error.message })
      else { ctx.logger.warn('superagent-ui companion: %s', String(error)); json(res, 500, { error: error instanceof Error ? error.message : String(error) }) }
    }
  } })
}
