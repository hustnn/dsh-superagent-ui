/**
 * Insights: only numbers that change what the operator does next. How long people keep the agent waiting, how its work
 * ended, who wanted it and was turned away, and whether it has enough workers.
 */
import type { Connection, InsightsView, TicketOutcome } from '@dsh-superagent-ui/contract'
import type { Snapshots } from '../snapshots.ts'
import { speechStats } from './companion.ts'
import type { UpstreamClient } from '../upstream/client.ts'
import type { DecisionView } from '../upstream/types.ts'

const DAY = 86_400_000
export const OUTCOME_DAYS = 30
/** Reasons that mean "someone asked, but is not allowed to": the gate's and the Sources' own. */
const TURNED_AWAY = new Set(['senderNotMember', 'not_a_member'])

type Reads = Pick<UpstreamClient, 'overview' | 'tickets' | 'decisions' | 'outboxSummary'>
export async function buildInsights(upstream: Reads, snapshots: Snapshots, calibration: () => Promise<{ mode: string; pending: number; ready: string[] }>,
  connection: () => Connection, now = Date.now()): Promise<InsightsView> {
  const [overview, open, ended, ignored, summary, outbox] = await Promise.all([upstream.overview(), upstream.tickets('open', 1000), upstream.tickets('ended', 1000),
    upstream.decisions('ignore', 0, 200), calibration().catch(() => ({ mode: 'off', pending: 0, ready: [] })), upstream.outboxSummary()])
  const waits = overview.person.map(ticket => now - Date.parse(ticket.updatedAt)).sort((a, b) => a - b)
  const median = waits.length ? waits[Math.floor((waits.length - 1) / 2)]! : null

  const since = new Date(now - OUTCOME_DAYS * DAY).toISOString()
  const all: Partial<Record<TicketOutcome, number>> = {}, proactive: Partial<Record<TicketOutcome, number>> = {}
  for (const ticket of ended.items) {
    if (!ticket.ended || ticket.ended.at < since) continue
    all[ticket.ended.outcome] = (all[ticket.ended.outcome] ?? 0) + 1
    if (ticket.strength === 'inferred') proactive[ticket.ended.outcome] = (proactive[ticket.ended.outcome] ?? 0) + 1
  }

  const week = new Date(now - 7 * DAY).toISOString()
  const groups = new Map<string, { decisions: DecisionView[] }>()
  for (const decision of ignored.items) {
    if (decision.at < week || !decision.reason.some(reason => TURNED_AWAY.has(reason.code))) continue
    const group = groups.get(decision.thread) ?? { decisions: [] }
    group.decisions.push(decision)
    groups.set(decision.thread, group)
  }
  const demand = [...groups.entries()].map(([thread, { decisions }]) => {
    const latest = decisions[0]!
    return { thread, title: latest.threadTitle ?? thread, source: thread.split(':')[0] ?? '', count: decisions.length, latestAt: latest.at, example: latest.preview,
      ...latest.triggerIds[0] ? { triggerId: latest.triggerIds[0] } : {} }
  }).sort((a, b) => b.count - a.count || b.latestAt.localeCompare(a.latestAt))

  const trend = snapshots.since(week)
  return {
    connection: connection(),
    waiting: { count: waits.length, longestMs: waits.at(-1) ?? null, medianMs: median },
    outcomes: { days: OUTCOME_DAYS, all, proactive },
    demand,
    capacity: { maxWorkers: overview.executor.maxWorkers, running: overview.executor.running, queued: overview.executor.queued,
      peakQueued: trend.length ? Math.max(...trend.map(sample => sample.queued)) : null },
    trend,
    calibration: { mode: summary.mode as InsightsView['calibration']['mode'], pending: summary.pending, ready: summary.ready },
    // A message carries no time, so the period is that of its Ticket: open now, or ended within the outcome window.
    speech: speechStats(outbox, [...open.items, ...ended.items.filter(ticket => ticket.ended && ticket.ended.at >= since)]),
  }
}
