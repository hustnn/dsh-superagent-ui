/**
 * Tickets as the operator reads them: cards on the board, and one Ticket's workbench, whose history merges what upstream
 * keeps in separate places (the request, the Decision, Assignments and their Reports, Inputs, the end) into one timeline.
 */
import type { BoardView, Connection, PersonAction, SaidMessage, TicketCard, TicketStageKey, TicketThread, TicketView, TimelineEntry } from '@dsh-superagent-ui/contract'
import type { UpstreamClient } from '../upstream/client.ts'
import type { ActorView, BasisFact, InputView, ReportState, TicketPageView, TicketRow } from '../upstream/types.ts'
import { reasonOf, reasonText } from './reasons.ts'
import { personLink, statusOf } from './shared.ts'

type Summary = Pick<TicketRow, 'id' | 'title' | 'stage' | 'action' | 'ended' | 'summary' | 'attention' | 'note' | 'strength' | 'updatedAt'>
  & { threads?: TicketRow['threads'] }

const PERSON_ACTIONS = new Set(['answer', 'review', 'blocked', 'failed', 'delivery'])
export function stageOf(row: Pick<TicketRow, 'stage' | 'action'>): TicketStageKey {
  if (row.stage === 'working') return row.action === 'queued' ? 'queued' : 'working'
  return row.stage
}

export function ticketCard(row: Summary): TicketCard {
  const thread = row.threads?.[0]
  return {
    id: row.id,
    title: row.title,
    stage: stageOf(row),
    ...row.stage === 'person' && row.action && PERSON_ACTIONS.has(row.action) ? { action: row.action as PersonAction } : {},
    ...row.ended ? { outcome: row.ended.outcome } : {},
    summary: row.summary,
    ...row.attention ? { question: row.attention.question } : {},
    ...row.note ? { note: row.note } : {},
    strength: row.strength,
    ...thread ? { thread: { key: thread.key, source: thread.source, title: thread.title, ...thread.url ? { url: thread.url } : {} } } : {},
    updatedAt: row.updatedAt,
  }
}

const ENDED_SHOWN = 20
type BoardReads = Pick<UpstreamClient, 'state' | 'overview' | 'tickets'>
export async function buildBoard(upstream: BoardReads, connection: () => Connection): Promise<BoardView> {
  const [state, overview, open, ended] = await Promise.all([upstream.state(), upstream.overview(), upstream.tickets('open', 1000),
    upstream.tickets('ended', ENDED_SHOWN)])
  const columns: BoardView['columns'] = { queued: [], working: [], person: [], idle: [], ended: [] }
  // Waiting columns put the longest wait first; the others put what changed last first.
  for (const row of open.items) columns[stageOf(row)].push(ticketCard(row))
  for (const column of ['queued', 'person'] as const) columns[column].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  for (const column of ['working', 'idle'] as const) columns[column].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  columns.ended = ended.items.map(ticketCard)
  return { connection: connection(), status: statusOf(state, overview), columns, endedTotal: ended.total }
}

export const actorName = (actor: ActorView) => actor.name?.zh || actor.id || '自动消息'
const SOURCES: Record<string, string> = { github: 'GitHub', feishu: '飞书' }
export const sourceName = (source: string) => SOURCES[source] ?? source

const CELLS = {
  listedUnaddressed: '在名单内，但没有 @ 它',
  unlistedAddressed: '不在名单内，但 @ 了它',
  unlistedUnaddressed: '不在名单内，也没有 @ 它',
} as const

/** The Mandate in one sentence: who asked, how the gate admitted it, and under which Policy version and rules. */
export function whySentence(page: Pick<TicketPageView, 'mandate' | 'basis'>): string {
  const facts = page.basis.facts
  const fact = <N extends BasisFact['name']>(name: N) => facts.find((item): item is Extract<BasisFact, { name: N }> => item.name === name)
  const who = actorName(page.mandate.actor)
  const where = sourceName(page.mandate.actor.source)
  const parts: string[] = []
  const admission = fact('admission'), addressed = fact('addressed')
  if (fact('bot')) parts.push(`${who} 是 ${where} bot 列表里的机器人，只能产生推断候选`)
  else if (fact('followup')) parts.push(`${who} 在已有 Ticket 的线程上追问`)
  else if (admission) parts.push(`${who}${CELLS[admission.value]}，准入表这一格允许`)
  else if (addressed) parts.push(`${who} 在 ${where} 名单内，并${addressed.value === 'direct' ? '私聊' : '直接 @ '}了它`)
  else parts.push(`${who} 发起`)
  parts.push(page.mandate.strength === 'explicit' ? '所以是明确请求' : '所以是推断候选，经评估后接单')
  if (fact('mode')?.value === 'auto') parts.push('当时是自动接单模式')
  const rules = fact('rules')?.value.map(rule => `「${rule.name}」`).join('')
  if (rules) parts.push(`命中规则 ${rules}`)
  return `${parts.join('，')}。按策略 ${page.mandate.policyVersion.slice(0, 7)} 接单。`
}

const REPORT: Record<ReportState, { title: string; tone?: TimelineEntry['tone'] }> = {
  progress: { title: '进展' },
  waiting: { title: '等新消息', tone: 'muted' },
  ready: { title: '交付就绪', tone: 'ok' },
  blocked: { title: '受阻', tone: 'danger' },
  failed: { title: '失败', tone: 'danger' },
  dropped: { title: '无需处理', tone: 'muted' },
}
export const OUTCOME: Record<string, string> = { completed: '已完成', merged: 'PR 已合并', closed: 'PR 已关闭', dropped: '无需处理', stopped: '被人停止' }

function inputEntry(input: InputView): TimelineEntry {
  switch (input.kind) {
    case 'trigger': {
      const trigger = input.trigger
      // Automated notices (CI, a Source's own events) carry no sender id.
      const who = trigger?.actor.id ? `${actorName(trigger.actor)} 的消息` : trigger ? '一条自动消息' : '一条消息'
      const handback = trigger?.handback
      return {
        at: input.at, kind: 'message',
        title: handback ? `${who}被交回评估` : input.context ? `${who}（参考线程）` : who,
        detail: [trigger?.preview, handback && `理由：${handback.reason}`, !input.delivered && '还没送到 worker'].filter(Boolean).join(' · '),
        ...!input.delivered ? { tone: 'warn' as const } : !(trigger?.human ?? input.human) ? { tone: 'muted' as const } : {},
        triggerId: input.triggerId, ...trigger ? { thread: trigger.thread } : {},
      }
    }
    case 'policy-changed': {
      const rules = input.effect?.rules?.map(rule => `「${rule.name}」${rule.change === 'disabled' ? '已停用' : '改了'}`).join('，')
      const parts = [rules, input.effect?.proactive === false && '不再接受主动工作', input.effect?.requesterAllowed === false && '发起人已不在名单']
      return { at: input.at, kind: 'policy', title: `策略变更 ${input.from.slice(0, 7)} → ${input.to.slice(0, 7)}`, detail: parts.filter(Boolean).join('；') || '这次变更与它有关', tone: 'warn' }
    }
    case 'reopen': return { at: input.at, kind: 'decision', title: '重新打开' }
    case 'resumed': return { at: input.at, kind: 'message', title: '有人的消息让它恢复工作', triggerId: input.triggerId }
    case 'note': return { at: input.at, kind: 'note', title: '主 Session 转来一条参考信息', detail: input.text }
    case 'text': return { at: input.at, kind: 'note', title: '补充说明', detail: input.text }
  }
}

/** Upstream's records for one Ticket as one chronological list. */
export function timelineOf(page: TicketPageView): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  const decision = page.decision
  if (decision) {
    entries.push({ at: decision.at, kind: 'request', title: `${actorName(page.mandate.actor)} 发来请求`, detail: decision.preview,
      thread: decision.thread, ...decision.triggerIds[0] ? { triggerId: decision.triggerIds[0] } : {} })
    const matched = decision.rules.filter(rule => rule.matched).map(rule => `「${rule.name}」`).join('')
    entries.push({ at: decision.at, kind: 'decision', title: decision.kind === 'reopen' ? '重新打开' : '接单',
      detail: [reasonText(decision.reason), matched && `命中规则 ${matched}`, `范围：${page.mandate.scope}`].filter(Boolean).join(' · ') })
  }
  page.assignments.forEach((assignment, index) => {
    const n = index + 1
    entries.push({ at: assignment.createdAt, kind: 'assignment', title: `派工 ${n}`, tone: 'muted' })
    if (assignment.startedAt) entries.push({ at: assignment.startedAt, kind: 'assignment', title: `派工 ${n}：worker 开始干活` })
    if (assignment.report) {
      const report = REPORT[assignment.report.state]
      entries.push({ at: assignment.report.at, kind: 'report', title: report.title, detail: assignment.report.summary, ...report.tone ? { tone: report.tone } : {} })
    }
    if (assignment.endedAt) entries.push({ at: assignment.endedAt, kind: 'assignment', title: `派工 ${n} 结束`,
      ...assignment.endedReason ? { detail: reasonOf(assignment.endedReason) } : {}, tone: 'muted' })
  })
  for (const input of page.inputs) entries.push(inputEntry(input))
  if (page.ended) entries.push({ at: page.ended.at, kind: 'end', title: `结束：${OUTCOME[page.ended.outcome] ?? page.ended.outcome}`,
    ...page.ended.reason ? { detail: page.ended.reason } : {}, tone: page.ended.outcome === 'stopped' ? 'warn' : 'ok' })
  // Stable sort keeps request before decision, and an assignment's events in order, when they share a timestamp.
  return entries.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.at.localeCompare(b.entry.at) || a.index - b.index).map(item => item.entry)
}

export function ticketView(page: TicketPageView, connection: Connection, said: SaidMessage[] | null = null): TicketView {
  const card = ticketCard({ ...page, threads: [] })
  const origin = page.decision?.thread
  const threads: TicketThread[] = page.threads.map(thread => ({ key: thread.key, source: thread.source, title: thread.title,
    ...thread.url ? { url: thread.url } : {}, role: thread.context ? 'context' : thread.key === origin ? 'origin' : 'follows' }))
  threads.sort((a, b) => (a.role === 'origin' ? 0 : a.role === 'follows' ? 1 : 2) - (b.role === 'origin' ? 0 : b.role === 'follows' ? 1 : 2))
  const channel = page.channels[0]
  const link = personLink(card.action, page.threads, page.summary, channel ? { url: channel.url, label: channel.label.zh } : undefined)
  const latest = page.assignments.at(-1)
  return {
    connection,
    id: page.id, title: page.title, stage: card.stage, ...card.action ? { action: card.action } : {},
    ...page.ended ? { outcome: page.ended.outcome, ended: { at: page.ended.at, by: page.ended.by, ...page.ended.reason ? { reason: page.ended.reason } : {} } } : {},
    ...card.stage === 'person' ? { waitingSince: page.updatedAt } : {},
    createdAt: page.createdAt, updatedAt: page.updatedAt,
    ...page.attention ? { question: page.attention.question } : {},
    ...page.note ? { note: page.note } : {},
    summary: page.summary, strength: page.strength,
    why: { sentence: whySentence(page), actor: actorName(page.mandate.actor), scope: page.mandate.scope,
      policyVersion: page.mandate.policyVersion.slice(0, 7), rules: page.basis.facts.flatMap(fact => fact.name === 'rules' ? fact.value.map(rule => rule.name) : []) },
    threads,
    ...link && card.stage === 'person' ? { reply: link } : {},
    execution: {
      ...page.sessionId ? { sessionId: page.sessionId } : {},
      ...page.directory ? { directory: page.directory } : {},
      assignments: page.assignments.length,
      running: latest?.state === 'running' && card.stage === 'working',
      environment: page.environment.map(variable => ({ key: variable.key, value: variable.value, description: variable.description.zh })),
    },
    timeline: timelineOf(page),
    said,
    actions: page.actions,
  }
}
