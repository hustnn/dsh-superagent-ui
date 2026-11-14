/**
 * Threads and the path of each message: the answer to "why didn't the agent reply to me". Upstream records where every
 * Trigger went (its disposition and the Decision that consumed it); this turns that record into steps a person can follow.
 */
import type { Connection, MessagePath, MessageRow, SearchView, ThreadFilter, ThreadListView, ThreadRow, ThreadView } from '@dsh-superagent-ui/contract'
import type { UpstreamClient } from '../upstream/client.ts'
import type { SearchView as UpstreamSearch, ThreadSummaryView, TriggerView } from '../upstream/types.ts'
import { t } from '../i18n.ts'
import { reasonOf, reasonText } from './reasons.ts'
import { actorName, sourceName, ticketCard } from './tickets.ts'

export function threadRow(thread: ThreadSummaryView): ThreadRow {
  return {
    key: thread.key, source: thread.source, title: thread.title, ...thread.url ? { url: thread.url } : {},
    stage: thread.stage, lastAt: thread.lastAt,
    tickets: thread.tickets.map(ticket => ({ id: ticket.id, title: ticket.title, open: ticket.state === 'open' })),
    ...thread.latest ? { latest: { actor: actorName(thread.latest.actor), preview: thread.latest.preview, at: thread.latest.at } } : {},
    pending: thread.pending,
  }
}

/** Where a message went, in the order it happened. `titles` names the Tickets it reached. */
export function messagePath(trigger: Omit<TriggerView, 'text'> & { filtered?: unknown }, titles: (id: string) => string): MessagePath {
  const { disposition: d } = trigger
  const steps: MessagePath['steps'] = [{ tone: 'pass', title: t(`Received by ${sourceName(trigger.source)}`, `${sourceName(trigger.source)} 收到`), detail: trigger.human ? t('Sent by a person', '人发的消息') : t('Automated: a bot, CI or a notification', '自动消息：bot、CI 或通知') }]
  const filtered = d.filtered ?? (trigger.filtered && typeof trigger.filtered === 'object' ? trigger.filtered as TriggerView['disposition']['filtered'] : undefined)
  if (filtered) {
    steps.push({ tone: 'stop', title: t('The source filtered it out', '来源把它过滤了'), detail: reasonOf(filtered) })
    return { steps, verdict: { tone: 'danger', label: t('Filtered', '被过滤') }, requeue: trigger.actions.requeue }
  }
  const handedBack = new Set(d.handbacks.map(item => item.ticketId))
  for (const id of d.fanout) {
    steps.push({ tone: 'route', title: t(`Delivered to "${titles(id)}"`, `送到了「${titles(id)}」`), detail: handedBack.has(id) ? undefined : d.delivered
      ? t("A person's follow-up in their own Ticket's thread, decided by its worker without evaluation", '这是人对自己 Ticket 线程的追问，由它的 worker 决定，不经过评估') : t('As context for this Ticket', '作为这个 Ticket 的上下文'), ticketId: id })
  }
  for (const back of d.handbacks) steps.push({ tone: 'info', title: t(`"${back.title}" handed it back for evaluation`, `「${back.title}」把它交回评估`), detail: back.reason, ticketId: back.ticketId })
  let verdict: MessagePath['verdict'] = d.fanout.length ? { tone: 'accent', label: t('Delivered to a Ticket', '送到了 Ticket') } : { tone: 'muted', label: t('Only recorded', '只做了记录') }
  if (d.evaluating) {
    steps.push({ tone: 'wait', title: t('Being evaluated', '正在评估') })
    verdict = { tone: 'muted', label: t('Evaluating', '评估中') }
  } else if (d.queued) {
    steps.push({ tone: 'wait', title: t('Queued for evaluation', '排队等评估'), detail: t('A thread is evaluated one batch at a time; it goes once the previous batch finishes', '同一线程一次只评估一批，前一批结束就轮到它') })
    verdict = { tone: 'muted', label: t('Awaiting evaluation', '等评估') }
  }
  const decision = d.decision
  if (decision) {
    const why = reasonText(decision.reason)
    const ticket = decision.ticketId ? { ticketId: decision.ticketId } : {}
    switch (decision.outcome) {
      case 'accept':
      case 'reopen':
        steps.push({ tone: 'pass', title: decision.outcome === 'accept' ? t(`Accepted: "${titles(decision.ticketId ?? '')}"`, `接单：「${titles(decision.ticketId ?? '')}」`) : t('Reopened the Ticket', '重新打开 Ticket'), detail: why, ...ticket })
        verdict = { tone: 'ok', label: t('Accepted', '接单') }
        break
      case 'wouldAccept':
        steps.push({ tone: 'info', title: t('Would have accepted, but observe mode is on', '本会接单，但现在是观察模式'), detail: why })
        verdict = { tone: 'infer', label: t('Would accept (observe)', '本会接单（观察）') }
        break
      case 'ignore':
        steps.push({ tone: 'stop', title: t('Ignored after evaluation', '评估后忽略'), detail: why })
        verdict = { tone: 'muted', label: t('Ignored', '忽略') }
        break
      case 'stop':
        steps.push({ tone: 'stop', title: t('Stopped the Ticket', '停止了 Ticket'), detail: why, ...ticket })
        verdict = { tone: 'warn', label: t('Stopped', '停止') }
        break
      case 'unavailable':
        steps.push({ tone: 'stop', title: t('Evaluation unavailable', '评估没完成'), detail: why })
        verdict = { tone: 'warn', label: t('Evaluation unavailable', '评估没完成') }
        break
    }
  }
  return { steps, verdict, requeue: trigger.actions.requeue }
}

export function messageRow(trigger: Omit<TriggerView, 'text'> & { text?: string; threadTitle?: string; filtered?: unknown }, titles: (id: string) => string): MessageRow {
  return {
    id: trigger.id, actor: actorName(trigger.actor), human: trigger.human, at: trigger.at, text: trigger.text ?? trigger.preview,
    ...trigger.url ? { url: trigger.url } : {}, thread: trigger.threads[0] ?? '', ...trigger.threadTitle ? { threadTitle: trigger.threadTitle } : {},
    path: messagePath(trigger, titles),
  }
}

export async function buildThreads(upstream: Pick<UpstreamClient, 'threads'>, filter: ThreadFilter, connection: () => Connection): Promise<ThreadListView> {
  const list = await upstream.threads(filter, 50)
  return { connection: connection(), filter, items: list.items.map(threadRow), total: list.total }
}

export async function buildThread(upstream: Pick<UpstreamClient, 'thread'>, key: string, around: string | undefined, connection: () => Connection): Promise<ThreadView> {
  const detail = await upstream.thread(key, around)
  const titles = new Map(detail.tickets.map(ticket => [ticket.id, ticket.title]))
  const title = (id: string) => titles.get(id) ?? id
  const ticketCards = detail.tickets.map(ticket => ({
    ...ticketCard({ ...ticket, summary: ticket.summary ?? '', strength: ticket.strength ?? 'explicit', updatedAt: ticket.updatedAt ?? detail.lastAt,
      stage: ticket.stage ?? (ticket.state === 'open' ? 'working' : 'ended'), actions: ticket.actions ?? { retry: false, stop: false } } as Parameters<typeof ticketCard>[0]),
    context: detail.context.includes(ticket.id),
  }))
  return {
    ...threadRow(detail), connection: connection(), ...detail.url ? { url: detail.url } : {},
    ticketCards,
    messages: detail.timeline.map(trigger => messageRow(trigger, title)),
    earlier: detail.earlier !== null,
    unsubscribe: detail.subscriptions > 0,
  }
}

export async function buildSearch(upstream: Pick<UpstreamClient, 'search'>, query: string): Promise<SearchView> {
  const q = query.trim()
  if (!q) return { query: q, tickets: [], threads: [], messages: [] }
  const result: UpstreamSearch = await upstream.search(q)
  const titles = new Map(result.tickets.map(ticket => [ticket.id, ticket.title]))
  return {
    query: q,
    tickets: result.tickets.map(ticket => ticketCard(ticket)),
    threads: result.threads.map(threadRow),
    messages: result.items.map(item => messageRow(item, id => titles.get(id) ?? id)),
  }
}
