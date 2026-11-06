/**
 * Reads dsh-superagent's outbox: every message it queued for a Channel, kept so an id is never sent twice. The table holds
 * one JSON receipt per row (`id`, `channel`, `text`, `kind`, `ticketId`, `status`, `dropped`), in the order they were queued.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { OutboxCounts, OutboxList, OutboxReceipt, OutboxSummary } from './api.ts'

const TEXT_LIMIT = 2000

interface Receipt { id: string; kind: OutboxReceipt['kind']; status: OutboxReceipt['status']; text: string; ticketId?: string
  channel: { source: string; thread: string }; dropped?: { at: string; reason: string } }

/** One Ticket's messages, oldest first. */
export function ticketMessages(db: DatabaseSync, ticketId: string): OutboxList {
  const rows = db.prepare("SELECT value FROM outbox WHERE value ->> '$.ticketId' = ? ORDER BY rowid").all(ticketId) as { value: string }[]
  return { receipts: rows.map(row => receiptOf(JSON.parse(row.value) as Receipt)) }
}

/** Counts by Ticket. A message counts once under its kind, and once more as `pending` or `dropped` when it did not go out. */
export function summary(db: DatabaseSync): OutboxSummary {
  const rows = db.prepare(`SELECT value ->> '$.ticketId' AS ticket, value ->> '$.kind' AS kind, value ->> '$.status' AS status, COUNT(*) AS n
    FROM outbox GROUP BY 1, 2, 3`).all() as { ticket: string | null; kind: string; status: string; n: number }[]
  const tickets: Record<string, OutboxCounts> = {}
  const unticketed = empty()
  for (const row of rows) {
    const counts = row.ticket ? tickets[row.ticket] ??= empty() : unticketed
    if (row.kind === 'acknowledgement' || row.kind === 'reply' || row.kind === 'notice') counts[row.kind] += Number(row.n)
    if (row.status === 'pending' || row.status === 'dropped') counts[row.status] += Number(row.n)
  }
  return { tickets, unticketed }
}

const empty = (): OutboxCounts => ({ acknowledgement: 0, reply: 0, notice: 0, pending: 0, dropped: 0 })
function receiptOf(receipt: Receipt): OutboxReceipt {
  return { id: receipt.id, kind: receipt.kind, status: receipt.status, source: receipt.channel.source, thread: receipt.channel.thread,
    ...receipt.ticketId ? { ticketId: receipt.ticketId } : {},
    text: receipt.text.length > TEXT_LIMIT ? `${receipt.text.slice(0, TEXT_LIMIT)}…` : receipt.text,
    ...receipt.dropped ? { dropped: receipt.dropped } : {} }
}
