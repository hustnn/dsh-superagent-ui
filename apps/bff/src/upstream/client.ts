/** HTTP client for dsh-superagent's management API, and the connection state the BFF reports to the console. */
import type { Connection, UpstreamState } from '@dsh-superagent-ui/contract'
import { API_PATH, REQUEST_HEADER, type CompanionInfo, type MainModelResult, type ModelSelection, type OutboxList, type OutboxSummary, type Transcript } from '@dsh-superagent-ui/companion/api'
import type { DecisionListView, HistoryView, ModelCatalog, OverviewView, PromptConfig, PromptPreview, PromptsView, SearchView, SettingsView, SourceStatus,
  StateView, ThreadDetailView, ThreadListView, TicketFilter, TicketListView, TicketPageView } from './types.ts'

/**
 * A failed upstream call. `rejected` means dsh-superagent answered and refused the request (a 4xx with its error body), so
 * the connection is fine; every other kind says the connection itself is not.
 */
export type UpstreamFailure = Exclude<UpstreamState, 'ok'> | 'rejected'
export class UpstreamError extends Error {
  readonly kind: UpstreamFailure
  readonly status: number
  /** The refusal's JSON body, such as a failed account check's `setup` problem. */
  readonly body: Record<string, unknown> | undefined
  constructor(kind: UpstreamFailure, message: string, status = 0, body?: Record<string, unknown>) {
    super(message)
    this.kind = kind
    this.status = status
    this.body = body
  }
}

type Fetch = typeof fetch
/** Switching a model writes the profile and reloads a plugin through DSH, which takes longer than a read. */
const COMPANION_WRITE_TIMEOUT_MS = 30_000
/** Filters `GET threads` accepts (`THREAD_FILTERS` in upstream `src/app/api.ts`). */
export type ThreadFilter = 'subscribed' | 'evaluating' | 'recent' | 'all'

/**
 * Calls `<url>/orchestrator/api/<path>` the way upstream's own panel does. Upstream accepts a request only when its Host is
 * `127.0.0.1:<port>` or `localhost:<port>`, it carries `x-orchestrator-request: 1`, and any Origin is its own
 * (`sameOrigin` in upstream `src/app/http.ts`). Node's fetch sends the URL's authority as Host and no Origin, so the BFF
 * passes as long as `url` names the loopback address dsh-superagent listens on.
 */
export class UpstreamClient {
  readonly url: string
  readonly #fetch: Fetch
  readonly #timeoutMs: number
  constructor(url: string, options: { fetch?: Fetch; timeoutMs?: number } = {}) {
    this.url = url.replace(/\/+$/, '')
    this.#fetch = options.fetch ?? fetch
    this.#timeoutMs = options.timeoutMs ?? 5000
  }

  async request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
    let response: Response
    try {
      response = await this.#fetch(`${this.url}/orchestrator/api/${path}`, {
        method,
        headers: { 'x-orchestrator-request': '1', ...body === undefined ? {} : { 'content-type': 'application/json' } },
        ...body === undefined ? {} : { body: JSON.stringify(body) },
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
    } catch (error) {
      throw new UpstreamError('unreachable', `dsh-superagent did not answer at ${this.url}: ${messageOf(error)}`)
    }
    const text = await response.text()
    if (response.ok) return (text ? JSON.parse(text) : {}) as T
    const message = errorText(text)
    // The DSH web server answers an empty 404 while dsh-superagent's routes are unmounted, during startup or a restart.
    if (response.status === 404 && !text) throw new UpstreamError('not-mounted', 'dsh-superagent is not running in this DSH profile, or is restarting', 404)
    if (response.status === 403) throw new UpstreamError('forbidden', `dsh-superagent refused the BFF: ${message ?? 'same-origin check failed'}`, 403)
    if (response.status >= 500) throw new UpstreamError('error', message ?? `dsh-superagent answered ${response.status}`, response.status)
    throw new UpstreamError('rejected', message ?? `dsh-superagent answered ${response.status}`, response.status, bodyOf(text))
  }

  state() { return this.request<StateView>('GET', 'state') }
  overview() { return this.request<OverviewView>('GET', 'overview') }
  sources() { return this.request<SourceStatus[]>('GET', 'sources') }
  tickets(state: TicketFilter, limit = 20, offset = 0) { return this.request<TicketListView>('GET', `tickets?state=${state}&limit=${limit}${offset ? `&offset=${offset}` : ''}`) }
  ticket(id: string) { return this.request<TicketPageView>('GET', `tickets/${encodeURIComponent(id)}`) }
  threads(filter: ThreadFilter, limit = 50) { return this.request<ThreadListView>('GET', `threads?filter=${filter}&limit=${limit}`) }
  /** A thread's latest messages, or the page around one message. */
  thread(key: string, around?: string) {
    return this.request<ThreadDetailView>('GET', `threads/${encodeURIComponent(key)}?limit=50${around ? `&around=${encodeURIComponent(around)}` : ''}`)
  }
  search(query: string) { return this.request<SearchView>('GET', `search?q=${encodeURIComponent(query)}`) }
  unsubscribe(key: string) { return this.request<{ removed: boolean }>('POST', `threads/${encodeURIComponent(key)}/unsubscribe`) }
  settings() { return this.request<SettingsView>('GET', 'settings') }
  /** Saves one settings block; upstream refuses with 409 when `revision` is no longer the block's current one. */
  saveSettings(block: 'policy' | 'eval' | 'executor' | `source:${string}`, value: unknown, revision: number) {
    return this.request<{ revision: number; restarting: boolean }>('PUT', `settings/${encodeURIComponent(block)}`, { value, revision })
  }
  policyHistory() { return this.request<HistoryView>('GET', 'policy/history') }
  policySync(source: string) { return this.request<{ policy: unknown }>('POST', `policy-sync/${encodeURIComponent(source)}`) }
  /** Decisions of the given kinds, newest first. */
  prompts(revision?: number) { return this.request<PromptsView>('GET', `prompts${revision === undefined ? '' : `?revision=${revision}`}`) }
  /** Saves a prompt configuration on top of `baseRevision`; upstream refuses with 409 when that is no longer current. */
  savePrompts(config: PromptConfig, baseRevision: number) { return this.request<{ revision: number }>('PUT', 'prompts', { config, baseRevision }) }
  previewPrompts(config: PromptConfig) { return this.request<PromptPreview>('POST', 'prompts/preview', config) }
  models() { return this.request<ModelCatalog>('GET', 'models') }
  decisions(kinds: string, offset = 0, limit = 200) { return this.request<DecisionListView>('GET', `decisions?kind=${kinds}&offset=${offset}&limit=${limit}`) }
  retry(id: string) { return this.request<{ retried: true }>('POST', `tickets/${encodeURIComponent(id)}/retry`) }
  stop(id: string) { return this.request<{ stopped: true }>('POST', `tickets/${encodeURIComponent(id)}/stop`) }
  requeue(triggerId: string) { return this.request<{ queued: boolean }>('POST', `triggers/${encodeURIComponent(triggerId)}/requeue`) }
  dismiss(decisionId: string) { return this.request<{ dismissed: true }>('POST', `decisions/${encodeURIComponent(decisionId)}/dismiss`) }
  pause(paused: boolean) { return this.request<{ paused: boolean }>('POST', 'executor/pause', { paused }) }
  /** Runs setup again by restarting dsh-superagent; refused when setup has nothing to fix. */
  setupCheck() { return this.request<{ restarting: true }>('POST', 'setup/check') }
  /** Rereads a Source's display names, such as the chats the Feishu bot has joined; answers the names it had not known. */
  refreshLabels(source: string) { return this.request<{ added: string[] }>('POST', `sources/${encodeURIComponent(source)}/labels`) }

  /**
   * Calls the companion plugin at `<url>/superagent-ui/api/<path>`, which keeps the management API's same-origin rule with its
   * own header: a read, or a POST when there is a `body`. Answers null when the companion is not installed: the DSH web server
   * answers an empty 404 for a path no plugin claimed.
   */
  async companion<T>(path: string, body?: unknown): Promise<T | null> {
    let response: Response
    try {
      response = await this.#fetch(`${this.url}${API_PATH}${path}`, body === undefined
        ? { headers: { [REQUEST_HEADER]: '1' }, signal: AbortSignal.timeout(this.#timeoutMs) }
        : { method: 'POST', headers: { [REQUEST_HEADER]: '1', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(COMPANION_WRITE_TIMEOUT_MS) })
    } catch (error) {
      throw new UpstreamError('unreachable', `dsh-superagent did not answer at ${this.url}: ${messageOf(error)}`)
    }
    const text = await response.text()
    if (response.ok) return JSON.parse(text) as T
    if (response.status === 404 && !text) return null
    throw new UpstreamError(response.status >= 500 ? 'error' : 'rejected', errorText(text) ?? `the companion answered ${response.status}`, response.status)
  }
  companionInfo() { return this.companion<CompanionInfo>('info') }
  /** A Session's latest steps, or those before `before`. */
  transcript(sessionId: string, before?: number, limit?: number) {
    const query = new URLSearchParams({ ...before === undefined ? {} : { before: String(before) }, ...limit === undefined ? {} : { limit: String(limit) } }).toString()
    return this.companion<Transcript>(`transcript/${encodeURIComponent(sessionId)}${query ? `?${query}` : ''}`)
  }
  ticketMessages(ticketId: string) { return this.companion<OutboxList>(`outbox?ticket=${encodeURIComponent(ticketId)}`) }
  outboxSummary() { return this.companion<OutboxSummary>('outbox/summary') }
  /** Switches the running main Session to `model`, or to the profile's default model when null. */
  switchMainModel(model: ModelSelection | null) { return this.companion<MainModelResult>('main-session/model', { model }) }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause
    return cause instanceof Error ? `${error.message} (${cause.message})` : error.message
  }
  return String(error)
}
function bodyOf(text: string): Record<string, unknown> | undefined {
  try { const value = JSON.parse(text) as unknown; return value && typeof value === 'object' ? value as Record<string, unknown> : undefined } catch { return undefined }
}
function errorText(text: string): string | undefined {
  try {
    const value = JSON.parse(text) as { error?: unknown }
    return typeof value.error === 'string' ? value.error : undefined
  } catch {
    return text ? text.slice(0, 200) : undefined
  }
}

/** The last known reachability of dsh-superagent, updated by every call the BFF makes and announced on change. */
export class ConnectionMonitor {
  #current: Connection
  readonly #listeners = new Set<(connection: Connection) => void>()
  constructor(url: string) {
    this.#current = { upstream: 'ok', url, checkedAt: new Date().toISOString() }
  }
  get current(): Connection { return this.#current }
  onChange(listener: (connection: Connection) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
  ok(): void { this.#set('ok') }
  /** Records a failure; a `rejected` request leaves the connection as it was, since upstream did answer. */
  fail(error: unknown): void {
    if (error instanceof UpstreamError && error.kind === 'rejected') return this.ok()
    this.#set(error instanceof UpstreamError ? error.kind as UpstreamState : 'error', messageOf(error))
  }
  /** Runs one upstream call and records its outcome. */
  async watch<T>(call: Promise<T>): Promise<T> {
    try {
      const value = await call
      this.ok()
      return value
    } catch (error) {
      this.fail(error)
      throw error
    }
  }
  #set(upstream: UpstreamState, detail?: string): void {
    const changed = upstream !== this.#current.upstream || detail !== this.#current.detail
    this.#current = { upstream, url: this.#current.url, ...detail ? { detail } : {}, checkedAt: new Date().toISOString() }
    if (changed) for (const listener of this.#listeners) listener(this.#current)
  }
}
