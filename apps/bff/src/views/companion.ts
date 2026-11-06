/**
 * Views of what the companion plugin reads: a worker's transcript, the messages a Ticket's conversations got, and how much
 * the agent says overall. Each degrades to "not installed" when the companion is missing.
 */
import type { CompanionState, Connection, SaidMessage, SpeechStats, TranscriptItem, TranscriptView } from '@dsh-superagent-ui/contract'
import type { CompanionInfo, ModelRef, OutboxList, OutboxSummary, Transcript, TranscriptEntry } from '@dsh-superagent-ui/companion/api'

export const companionState = (info: CompanionInfo | null): CompanionState => info ? { installed: true, version: info.version } : { installed: false }

export function transcriptView(transcript: Transcript | null, companion: CompanionState, sessionId: string | undefined, connection: Connection, directory?: string): TranscriptView {
  if (!transcript) return { connection, companion, ...sessionId ? { sessionId } : {}, exists: false, running: false, more: false, items: [], models: null }
  return { connection, companion, sessionId: transcript.sessionId, exists: transcript.exists, running: transcript.running, more: transcript.more,
    items: transcript.entries.map(entry => transcriptItem(entry, directory)),
    // A companion before 0.2.0 does not report models.
    models: transcript.models ? transcript.models.map(modelLabel) : null, ...transcript.model ? { model: modelLabel(transcript.model) } : {} }
}

export const modelLabel = (model: ModelRef) => `${model.provider} · ${model.model}`

function transcriptItem(entry: TranscriptEntry, directory?: string): TranscriptItem {
  const at = new Date(entry.at).toISOString()
  switch (entry.kind) {
    case 'input': return { kind: 'input', seq: entry.seq, at, ...inputOf(entry.text) }
    case 'thinking': return { kind: 'thinking', seq: entry.seq, at, text: entry.text }
    case 'say': return { kind: 'say', seq: entry.seq, at, text: entry.text, interrupted: !!entry.interrupted }
    case 'turn': return { kind: 'turn', seq: entry.seq, at, text: entry.end === undefined ? `第 ${entry.turn} 轮开始`
      : entry.end === 'completed' ? `第 ${entry.turn} 轮结束` : entry.end === 'interrupted' ? `第 ${entry.turn} 轮被打断` : `第 ${entry.turn} 轮结束（${entry.end}）` }
    case 'tool': {
      const exit = entry.job?.detail?.match(/exit code: (-?\d+)/)?.[1]
      // Paths inside the Ticket's directory read better relative to it.
      const label = toolLabel(entry.args)
      return { kind: 'tool', seq: entry.seq, at, name: entry.name, label: directory && label.startsWith(`${directory}/`) ? label.slice(directory.length + 1) : label, args: entry.args,
        ok: entry.result ? !entry.result.error : null,
        ...entry.result ? { result: entry.result.text } : {}, ...entry.result?.error ? { error: entry.result.error } : {},
        ...exit !== undefined ? { exit } : entry.job?.detail ? { exit: entry.job.detail } : {},
        ...entry.job?.ms !== undefined ? { ms: entry.job.ms } : {} }
    }
  }
}

/**
 * dsh-superagent hands work to a worker as JSON: an Assignment names the Ticket's `title` and the `trigger` that asked for
 * it; a later message carries its `trigger`. Anything else is shown as it came.
 */
function inputOf(text: string): { label: string; text: string } {
  try {
    const value = JSON.parse(text) as { title?: unknown; trigger?: { text?: unknown } }
    const said = typeof value.trigger?.text === 'string' ? value.trigger.text : undefined
    if (typeof value.title === 'string') return { label: '派工', text: said ? `${value.title}\n${said}` : value.title }
    if (said) return { label: '新消息', text: said }
  } catch { /* Not JSON: a plain message. */ }
  return { label: '收到', text }
}

/**
 * What a tool call touched, from its arguments: a command's description, a file, a resource, or for dsh-superagent's own tools
 * what it said or reported. Arguments may be cut, so this also reads unparsable JSON.
 */
export function toolLabel(args: string): string {
  const keys = ['description', 'file_path', 'path', 'resource', 'pattern', 'query', 'url', 'command', 'summary', 'text', 'name', 'job_id']
  let value: Record<string, unknown> | undefined
  try { value = JSON.parse(args) as Record<string, unknown> } catch { /* Cut arguments: fall back to the first readable key. */ }
  for (const key of keys) {
    const found = value ? value[key] : args.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`))?.[1]
    if (typeof found === 'string' && found.trim()) return firstLine(value ? found : found.replace(/\\n/g, '\n').replace(/\\"/g, '"'))
  }
  return ''
}
const firstLine = (text: string) => { const line = text.trim().split('\n')[0]!; return line.length > 160 ? `${line.slice(0, 160)}…` : line }

export function saidMessages(list: OutboxList | null): SaidMessage[] | null {
  return list ? list.receipts.map(receipt => ({ kind: receipt.kind, status: receipt.status, source: receipt.source, text: receipt.text,
    ...receipt.dropped ? { dropped: receipt.dropped } : {} })) : null
}

/** Counts over the given Tickets, which bound the period: a receipt has no time, but its Ticket does. */
export function speechStats(summary: OutboxSummary | null, tickets: { id: string; title: string }[]): SpeechStats | null {
  if (!summary) return null
  const messages = { acknowledgement: 0, reply: 0, notice: 0 }
  let pending = 0, dropped = 0
  const said: { id: string; title: string; count: number }[] = []
  for (const ticket of tickets) {
    const counts = summary.tickets[ticket.id]
    if (!counts) continue
    messages.acknowledgement += counts.acknowledgement; messages.reply += counts.reply; messages.notice += counts.notice
    pending += counts.pending; dropped += counts.dropped
    const count = counts.acknowledgement + counts.reply + counts.notice
    if (count) said.push({ ...ticket, count })
  }
  // On a tie the earlier Ticket in the given order stands out: open ones come before ended ones.
  const top = said.reduce<(typeof said)[number] | undefined>((best, ticket) => !best || ticket.count > best.count ? ticket : best, undefined)
  const counts = said.map(ticket => ticket.count).sort((a, b) => a - b)
  return { tickets: said.length, messages, pending, dropped,
    perTicket: { median: counts.length ? counts[Math.floor((counts.length - 1) / 2)]! : 0, max: top?.count ?? 0, ...top ? { top } : {} } }
}
