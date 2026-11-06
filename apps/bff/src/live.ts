/**
 * Live updates. Upstream only answers polls, so the BFF polls it on the console's behalf, fingerprints what each view
 * reads, and tells connected consoles which views changed. Consoles then refetch those views. Invalidations carry no data,
 * so a console that reconnects simply refetches everything; nothing needs replaying.
 *
 * Polling runs only while at least one console is connected.
 */
import { createHash } from 'node:crypto'
import type { LiveEvent, ViewName } from '@dsh-superagent-ui/contract'
import type { ConnectionMonitor, UpstreamClient } from './upstream/client.ts'

export type Fingerprints = Record<ViewName, string>
type Reads = Pick<UpstreamClient, 'state' | 'overview' | 'sources' | 'tickets' | 'settings' | 'decisions' | 'prompts'>

const hash = (...values: unknown[]) => createHash('sha256').update(JSON.stringify(values)).digest('base64url')

/** What each view depends on upstream. */
export async function fingerprints(upstream: Reads): Promise<Fingerprints> {
  const [state, overview, sources, open, ended, settings, judged, prompts] = await Promise.all([upstream.state(), upstream.overview(), upstream.sources(),
    upstream.tickets('open', 1000), upstream.tickets('ended', 20), upstream.settings(), upstream.decisions('ignore,accept', 0, 50), upstream.prompts()])
  // Home's next step may be to review new proactive judgements, so it reads them too.
  const home = hash(state, overview, judged)
  const board = hash(state, overview, open, ended)
  // Any change to a Ticket moves its `updatedAt` in the lists, and a new message moves the overview's counts, so these
  // two cover every Ticket and thread page without reading each one.
  const detail = hash(home, board)
  return { home, health: hash(state, overview, sources), board, ticket: board, threads: detail, thread: detail,
    policy: hash(settings, open), calibration: hash(settings, judged),
    // A Session's model request records the revision it read, so only the saved configuration and its defaults count.
    prompts: hash(prompts.revision, prompts.defaultChanged), settings: hash(settings, sources), insights: hash(home, board) }
}

export class LiveHub {
  readonly #probe: () => Promise<Fingerprints>
  readonly #monitor: ConnectionMonitor
  readonly #intervalMs: number
  readonly #clients = new Set<(event: LiveEvent) => void>()
  #last: Fingerprints | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #running: Promise<void> | undefined

  constructor(probe: () => Promise<Fingerprints>, monitor: ConnectionMonitor, intervalMs: number) {
    this.#probe = probe
    this.#monitor = monitor
    this.#intervalMs = intervalMs
    monitor.onChange(connection => this.#emit({ type: 'connection', connection }))
  }

  get clients(): number { return this.#clients.size }

  subscribe(client: (event: LiveEvent) => void): () => void {
    this.#clients.add(client)
    if (this.#clients.size === 1) this.#schedule(0)
    return () => {
      this.#clients.delete(client)
      if (!this.#clients.size) { clearTimeout(this.#timer); this.#timer = undefined; this.#last = undefined }
    }
  }

  /** Polls once now, for example right after the console changed something. Overlapping calls share one poll. */
  tick(): Promise<void> {
    this.#running ??= this.#poll().finally(() => { this.#running = undefined })
    return this.#running
  }

  async #poll(): Promise<void> {
    let next: Fingerprints
    try {
      next = await this.#monitor.watch(this.#probe())
    } catch {
      // The monitor has announced the failure; keep the last fingerprints so recovery invalidates only what changed.
      return
    }
    const previous = this.#last
    this.#last = next
    if (!previous) return
    const views = (Object.keys(next) as ViewName[]).filter(view => next[view] !== previous[view])
    if (views.length) this.#emit({ type: 'invalidate', views })
  }

  #schedule(delayMs: number): void {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(async () => {
      await this.tick()
      if (this.#clients.size) this.#schedule(this.#intervalMs)
    }, delayMs)
  }

  #emit(event: LiveEvent): void {
    for (const client of this.#clients) client(event)
  }

  close(): void {
    clearTimeout(this.#timer)
    this.#clients.clear()
  }
}
