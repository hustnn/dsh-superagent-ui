/**
 * Turns a DSH Session's event log into the steps a person reads: what it was given, what it thought and said, and each tool
 * call with its result. Everything else in the log (presets, inbox bookkeeping, request headers, prompts) is left out.
 */
import type { ModelRef, ToolJob, Transcript, TranscriptEntry } from './api.ts'
import type { SessionEvent } from './host.ts'

/** How much of each text a page carries; a reader who needs more opens the Session in DSH. */
export const LIMITS = { text: 4000, input: 2000, args: 1000, result: 2000 }
const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max)}…` : text

type Part = { type: string; text?: string }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const parts = (message: unknown): Part[] => {
  const content = record(message).content
  return Array.isArray(content) ? content.filter((part): part is Part => !!part && typeof part === 'object') : []
}
const textOf = (message: unknown) => parts(message).filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n')

/** Projects a whole log; tool results and jobs attach to the call they belong to. */
export function project(events: readonly SessionEvent[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  const calls = new Map<string, Extract<TranscriptEntry, { kind: 'tool' }>>()
  for (const event of events) {
    const data = record(event.data)
    const base = { seq: event.seq, at: event.time }
    switch (event.type) {
      case 'turn/start': entries.push({ kind: 'turn', ...base, turn: Number(data.turn) }); break
      case 'turn/end': entries.push({ kind: 'turn', ...base, turn: Number(data.turn), end: String(record(data.reason).kind ?? 'ended') }); break
      case 'user/message': {
        // DSH also stores the context it injects as user messages (instructions, runtime context, skill catalog, time, job
        // notices), each with its own `source.kind`; only work from dsh-superagent, or a person typing in DSH, is input.
        const source = record(data.source).kind
        if (source !== undefined && source !== 'dsh-superagent' && source !== 'user') break
        const text = textOf(data)
        if (text) entries.push({ kind: 'input', ...base, text: clip(text, LIMITS.input) })
        break
      }
      case 'assistant/message':
        for (const part of parts(data.message)) {
          if (typeof part.text !== 'string' || !part.text.trim()) continue
          if (part.type === 'reasoning') entries.push({ kind: 'thinking', ...base, text: clip(part.text, LIMITS.text) })
          else if (part.type === 'text') entries.push({ kind: 'say', ...base, text: clip(part.text, LIMITS.text), ...data.interrupted ? { interrupted: true as const } : {} })
        }
        break
      case 'tool/call': {
        const call: Extract<TranscriptEntry, { kind: 'tool' }> = { kind: 'tool', ...base, callId: String(data.callId), name: String(data.name), args: clip(String(data.arguments ?? ''), LIMITS.args) }
        calls.set(call.callId, call)
        entries.push(call)
        break
      }
      case 'tool/result': {
        const message = record(data.message)
        const call = calls.get(String(message.toolCallId))
        if (!call) break
        const error = record(data.error)
        call.result = { text: clip(textOf(message), LIMITS.result), at: event.time,
          ...error.name ? { error: [error.code ?? error.name, error.reason].filter(Boolean).join(': ') } : {} }
        break
      }
      case 'job/settled': {
        const call = calls.get(String(record(data.toolCall).callId))
        if (!call) break
        const job: ToolJob = { status: String(data.status) }
        if (typeof data.detail === 'string') job.detail = data.detail
        if (typeof data.startedAt === 'number' && typeof data.finishedAt === 'number') job.ms = data.finishedAt - data.startedAt
        call.job = job
        break
      }
    }
  }
  return entries
}

/**
 * The models a Session called: each assistant message records the route that produced it. A selection stays `next` until a
 * call on that route: a request already under way when it was made still answers from the old one.
 */
export function modelsOf(events: readonly SessionEvent[]): { models: ModelRef[]; model?: ModelRef; next?: ModelRef } {
  const models: ModelRef[] = []
  let model: ModelRef | undefined, next: ModelRef | undefined
  for (const event of events) {
    if (event.type === 'model/selection') {
      const selected = record(event.data)
      if (typeof selected.provider === 'string' && typeof selected.model === 'string') next = { provider: selected.provider, model: selected.model }
      continue
    }
    if (event.type !== 'assistant/message') continue
    const source = record(record(record(event.data).message).source)
    if (source.kind !== 'model' || typeof source.provider !== 'string' || typeof source.model !== 'string') continue
    model = { provider: source.provider, model: source.model }
    if (!models.some(item => item.provider === model!.provider && item.model === model!.model)) models.push(model)
    if (next?.provider === model.provider && next.model === model.model) next = undefined
  }
  return { models, ...model ? { model } : {}, ...next ? { next } : {} }
}

/** The page of entries before `before` (all when unset), at most `limit`, oldest first. */
export function page(sessionId: string, events: readonly SessionEvent[], before: number | undefined, limit: number): Transcript {
  const entries = project(events)
  const earlier = before === undefined ? entries : entries.filter(entry => entry.seq < before)
  const shown = earlier.slice(-limit)
  // A turn runs from its start to its end; one without an end is still running.
  const lastTurn = [...entries].reverse().find(entry => entry.kind === 'turn')
  return { sessionId, exists: true, entries: shown, more: earlier.length > shown.length, running: !!lastTurn && lastTurn.kind === 'turn' && lastTurn.end === undefined,
    ...modelsOf(events) }
}
