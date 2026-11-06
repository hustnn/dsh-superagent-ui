import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { CompanionInfo, MainModelResult, ModelSelection, OutboxList, OutboxSummary, Transcript } from '../src/api.ts'
import type { SessionEvent } from '../src/host.ts'
import { answer, sameOrigin } from '../src/http.ts'
import { LIMITS, page, project } from '../src/transcript.ts'

/** A worker's first turn, shaped like a real DSH 0.2.1 log: preset bookkeeping, injected context, the Assignment, two steps of tool use. */
const T = 1_800_000_000_000
const assignment = JSON.stringify({ ticket_id: 'tk_1', title: 'Add a README intro', trigger: { from: 'ou_alice', text: '@bot add a README intro, open a PR' } })
const LOG: SessionEvent[] = [
  { type: 'session', seq: 0, time: T, data: {} },
  { type: 'permission/preset', seq: 1, time: T, data: { preset: 'dsh-superagent-worker' } },
  { type: 'agent/inbox/spliced', seq: 2, time: T, data: { inserted: [{ role: 'user', content: [{ type: 'text', text: assignment }] }] } },
  { type: 'turn/start', seq: 3, time: T + 10, data: { turn: 1 } },
  { type: 'user/message', seq: 4, time: T + 10, data: { role: 'user', source: { kind: 'runtime-context', form: 'snapshot' }, content: [{ type: 'text', text: 'Current runtime context.' }] } },
  { type: 'user/message', seq: 5, time: T + 10, data: { id: 'dsh-superagent:a', role: 'user', source: { kind: 'dsh-superagent', form: 'relay' }, content: [{ type: 'text', text: assignment }] } },
  { type: 'request/header', seq: 6, time: T + 11, data: { reason: 'turn' } },
  { type: 'assistant/message', seq: 7, time: T + 20, data: { turn: 1, step: 1, message: { role: 'assistant', content: [
    { type: 'reasoning', text: 'Read the ticket, then the README.' },
    { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{"command":"git status"}' },
    { type: 'tool-call', id: 'c2', name: 'read', arguments: '{"file_path":"README.md"}' }], source: { kind: 'model', provider: 'acme', model: 'flash' } } } },
  { type: 'tool/call', seq: 8, time: T + 20, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"git status"}' } },
  { type: 'job/registered', seq: 9, time: T + 21, data: { jobId: 'j1', toolCall: { callId: 'c1' } } },
  { type: 'job/settled', seq: 10, time: T + 30, data: { jobId: 'j1', toolCall: { callId: 'c1' }, status: 'completed', detail: 'exit code: 0', startedAt: T + 21, finishedAt: T + 30 } },
  { type: 'tool/result', seq: 11, time: T + 30, data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'nothing to commit' }] } } },
  { type: 'tool/call', seq: 12, time: T + 31, data: { turn: 1, step: 1, callId: 'c2', name: 'read', arguments: '{"file_path":"README.md"}' } },
  { type: 'tool/result', seq: 13, time: T + 32, data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c2', content: [{ type: 'text', text: 'not found' }] },
    error: { name: 'ToolError', code: 'ENOENT', reason: 'no such file' } } },
  { type: 'step/end', seq: 14, time: T + 33, data: { turn: 1, step: 1 } },
  { type: 'assistant/message', seq: 15, time: T + 40, data: { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'Opened PR #1.' }], source: { kind: 'model', provider: 'acme', model: 'flash-large' } } } },
  { type: 'turn/end', seq: 16, time: T + 50, data: { turn: 1, reason: { kind: 'completed' } } },
]

describe('transcript', () => {
  it('keeps what a person reads and pairs each tool call with its result and job', () => {
    const entries = project(LOG)
    expect(entries.map(entry => entry.kind)).toEqual(['turn', 'input', 'thinking', 'tool', 'tool', 'say', 'turn'])
    expect(entries[1]).toMatchObject({ kind: 'input', seq: 5, text: assignment })
    expect(entries[3]).toMatchObject({ kind: 'tool', name: 'bash', result: { text: 'nothing to commit' }, job: { status: 'completed', detail: 'exit code: 0', ms: 9 } })
    expect(entries[4]).toMatchObject({ kind: 'tool', name: 'read', result: { error: 'ENOENT: no such file' } })
    expect(entries[6]).toMatchObject({ kind: 'turn', end: 'completed' })
  })
  it('cuts long texts', () => {
    const long = 'x'.repeat(LIMITS.text + 10)
    const [entry] = project([{ type: 'assistant/message', seq: 1, time: T, data: { message: { content: [{ type: 'text', text: long }] } } }])
    expect(entry).toMatchObject({ kind: 'say' })
    expect((entry as { text: string }).text).toHaveLength(LIMITS.text + 1)
  })
  it('names every model the Session called, and the latest', () => {
    expect(page('worker-tk_1', LOG, undefined, 10)).toMatchObject({ models: [{ provider: 'acme', model: 'flash' }, { provider: 'acme', model: 'flash-large' }],
      model: { provider: 'acme', model: 'flash-large' } })
    // A page that does not reach back to the first call still names it: models come from the whole log.
    expect(page('worker-tk_1', LOG, undefined, 1).models).toHaveLength(2)
  })
  it('names a model selected since the latest call until a call uses it', () => {
    const selection = (seq: number, model: string): SessionEvent => ({ type: 'model/selection', seq, time: T + 60, data: { provider: 'acme', model } })
    const call = (seq: number, model: string): SessionEvent => ({ type: 'assistant/message', seq, time: T + 70, data: { message: { content: [{ type: 'text', text: 'ok' }], source: { kind: 'model', provider: 'acme', model } } } })
    expect(page('m', LOG, undefined, 1).next).toBeUndefined()
    expect(page('m', [...LOG, selection(17, 'other')], undefined, 1)).toMatchObject({ model: { model: 'flash-large' }, next: { provider: 'acme', model: 'other' } })
    // A request under way when the selection was made still answers from the old route.
    expect(page('m', [...LOG, selection(17, 'other'), call(18, 'flash-large')], undefined, 1).next).toEqual({ provider: 'acme', model: 'other' })
    const switched = page('m', [...LOG, selection(17, 'other'), call(18, 'other')], undefined, 1)
    expect(switched.model).toEqual({ provider: 'acme', model: 'other' })
    expect(switched.next).toBeUndefined()
  })
  it('pages back from the end and tells a running turn from a finished one', () => {
    const latest = page('worker-tk_1', LOG, undefined, 3)
    expect(latest.entries.map(entry => entry.seq)).toEqual([12, 15, 16])
    expect(latest).toMatchObject({ more: true, running: false })
    const earlier = page('worker-tk_1', LOG, 12, 10)
    expect(earlier.entries.map(entry => entry.seq)).toEqual([3, 5, 7, 8])
    expect(earlier.more).toBe(false)
    expect(page('worker-tk_1', LOG.slice(0, 12), undefined, 10).running).toBe(true)
  })
})

/** Services backed by an in-memory log and an outbox table like upstream's. */
function services(sessions: Record<string, SessionEvent[]> = { 'worker-tk_1': LOG }) {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE outbox (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const add = (id: string, kind: string, status: string, ticketId?: string) => db.prepare('INSERT INTO outbox (id, value) VALUES (?, ?)').run(id, JSON.stringify({
    id, kind, status, text: `${kind} ${id}`, channel: { source: 'feishu', thread: 'feishu:oc_1', address: {} }, ...ticketId ? { ticketId } : {},
    ...status === 'dropped' ? { dropped: { at: '2026-11-02T00:00:00.000Z', reason: 'channelGone' } } : {} }))
  add('m1', 'acknowledgement', 'sent', 'tk_1'); add('m2', 'reply', 'sent', 'tk_1'); add('m3', 'notice', 'dropped', 'tk_1')
  add('m4', 'reply', 'pending', 'tk_2'); add('m5', 'notice', 'sent')
  return {
    logger: { info() {}, warn() {} },
    orchestrator: { ready: Promise.resolve(), masterId: 'orchestrator-1', store: { db } },
    sessionController: { selectModel: async ({ sessionId: _sessionId, ...selected }: { sessionId: string } & ModelSelection) => ({ selected }) },
    agentDefaultModel: { currentSelection: (): ModelSelection => ({ provider: 'acme', model: 'flash' }), saveSelection: async (_selection: ModelSelection) => {} },
    sessionPersistence: {
      stat: async (id: string) => sessions[id] ? { eventCount: sessions[id].length } : undefined,
      open: async (id: string) => ({ read: async () => ({ events: sessions[id]! }), close: async () => {} }),
      flush: async () => {},
    },
  }
}
const get = <T>(path: string, query = '') => answer(services(), 'GET', path, new URLSearchParams(query)) as Promise<T>

describe('routes', () => {
  it('says what it is', async () => {
    expect(await get<CompanionInfo>('info')).toEqual({ name: '@dsh-superagent-ui/companion', version: '0.3.0', capabilities: ['transcript', 'outbox', 'main-model'] })
  })
  it('reads a stored Session, and says when there is none', async () => {
    const found = await get<Transcript>('transcript/worker-tk_1', 'limit=2')
    expect(found).toMatchObject({ exists: true, more: true, running: false })
    expect(found.entries).toHaveLength(2)
    expect(await get<Transcript>('transcript/worker-tk_9')).toEqual({ sessionId: 'worker-tk_9', exists: false, entries: [], more: false, running: false, models: [] })
  })
  it('lists a Ticket’s messages and counts every Ticket’s', async () => {
    const list = await get<OutboxList>('outbox', 'ticket=tk_1')
    expect(list.receipts.map(receipt => [receipt.id, receipt.kind, receipt.status])).toEqual([['m1', 'acknowledgement', 'sent'], ['m2', 'reply', 'sent'], ['m3', 'notice', 'dropped']])
    expect(list.receipts[2]).toMatchObject({ source: 'feishu', thread: 'feishu:oc_1', dropped: { reason: 'channelGone' } })
    const counts = await get<OutboxSummary>('outbox/summary')
    expect(counts.tickets.tk_1).toEqual({ acknowledgement: 1, reply: 1, notice: 1, pending: 0, dropped: 1 })
    expect(counts.tickets.tk_2).toEqual({ acknowledgement: 0, reply: 1, notice: 0, pending: 1, dropped: 0 })
    expect(counts.unticketed).toEqual({ acknowledgement: 0, reply: 0, notice: 1, pending: 0, dropped: 0 })
  })
  it('reads everywhere else, and refuses what it does not know', async () => {
    await expect(answer(services(), 'POST', 'info', new URLSearchParams())).rejects.toMatchObject({ status: 405 })
    await expect(get('main-session/model')).rejects.toMatchObject({ status: 404 })
    await expect(get('outbox')).rejects.toMatchObject({ status: 400 })
    await expect(get('nothing')).rejects.toMatchObject({ status: 404 })
  })
  it('answers only same-origin callers on the loopback address', () => {
    const ok = { host: '127.0.0.1:3082', 'x-superagent-ui-request': '1' }
    expect(sameOrigin({ headers: ok }, 3082)).toBe(true)
    expect(sameOrigin({ headers: { ...ok, host: 'localhost:3082', origin: 'http://localhost:3082' } }, 3082)).toBe(true)
    expect(sameOrigin({ headers: { ...ok, origin: 'https://evil.example' } }, 3082)).toBe(false)
    expect(sameOrigin({ headers: { host: '127.0.0.1:3082' } }, 3082)).toBe(false)
    expect(sameOrigin({ headers: { ...ok, host: 'attacker.example:3082' } }, 3082)).toBe(false)
  })
})

describe('switching the main Session’s model', () => {
  /** DSH's behaviour: a selection is also saved as the default, and saves commit in the order they were made. */
  function dsh(options: { refuse?: string; saveFails?: boolean } = {}) {
    const calls: ({ sessionId: string } & ModelSelection)[] = []
    let current: ModelSelection = { provider: 'acme', model: 'flash' }
    let saves = Promise.resolve()
    const saveSelection = (selection: ModelSelection) => {
      const saved = saves.then(() => { if (options.saveFails) throw new Error('profile is read-only'); current = selection })
      saves = saved.catch(() => {})
      return saved
    }
    const warnings: string[] = []
    const base = services()
    const flushes = { count: 0 }
    return { calls, warnings, flushes, get current() { return current }, services: { ...base,
      sessionPersistence: { ...base.sessionPersistence, flush: async () => { flushes.count++ } },
      logger: { info() {}, warn: (format: string, ...args: unknown[]) => { warnings.push([format, ...args].join(' ')) } },
      agentDefaultModel: { currentSelection: () => ({ ...current }), saveSelection },
      sessionController: { selectModel: async ({ sessionId, ...selected }: { sessionId: string } & ModelSelection) => {
        if (options.refuse) throw new Error(options.refuse)
        calls.push({ sessionId, ...selected })
        saveSelection(selected).catch(() => {})
        return { selected }
      } } } }
  }
  const post = (services: Parameters<typeof answer>[0], body: unknown) => answer(services, 'POST', 'main-session/model', new URLSearchParams(), body) as Promise<MainModelResult>

  it('switches the main Session and leaves the profile default as it was', async () => {
    const host = dsh()
    expect(await post(host.services, { model: { provider: 'acme', model: 'large' } })).toEqual({ sessionId: 'orchestrator-1', model: { provider: 'acme', model: 'large' } })
    expect(host.calls).toEqual([{ sessionId: 'orchestrator-1', provider: 'acme', model: 'large' }])
    // A transcript read right after this names the selection only once it has been written.
    expect(host.flushes.count).toBe(1)
    expect(host.current).toEqual({ provider: 'acme', model: 'flash' })
  })
  it('takes null as the profile default', async () => {
    const host = dsh()
    expect((await post(host.services, { model: null })).model).toEqual({ provider: 'acme', model: 'flash' })
    expect(host.current).toEqual({ provider: 'acme', model: 'flash' })
  })
  it('passes DSH’s refusal on, without touching the default', async () => {
    const host = dsh({ refuse: 'Select an available model before sending a message.' })
    await expect(post(host.services, { model: { provider: 'acme', model: 'gone' } })).rejects.toMatchObject({ status: 409, message: 'Select an available model before sending a message.' })
    expect(host.current).toEqual({ provider: 'acme', model: 'flash' })
  })
  it('still answers when the default cannot be put back: the main Session has switched by then', async () => {
    const host = dsh({ saveFails: true })
    expect((await post(host.services, { model: { provider: 'acme', model: 'large' } })).model.model).toBe('large')
    expect(host.warnings.join()).toContain('profile is read-only')
  })
  it('refuses a body that names no model', async () => {
    for (const body of [undefined, {}, { model: {} }, { model: { provider: 'acme' } }, { model: { provider: 'acme', model: 'm', reasoningEffort: 1 } }])
      await expect(post(dsh().services, body)).rejects.toMatchObject({ status: 400 })
  })
})
