/** Projections both views share: the status line, problems in plain language, and Tickets that wait for a person. */
import type { PersonItem, ProblemItem, StatusSummary } from '@dsh-superagent-ui/contract'
import type { OverviewProblem, OverviewView, StateView, TicketRow } from '../upstream/types.ts'
import { reasonText, setupText } from './reasons.ts'

export function statusOf(state: StateView, overview: OverviewView): StatusSummary {
  const accounts = state.setup.accounts
  return {
    paused: state.paused,
    running: overview.executor.running,
    queued: overview.executor.queued,
    idle: overview.executor.idle,
    maxWorkers: overview.executor.maxWorkers,
    policyVersion: overview.policyVersion.slice(0, 7),
    ...accounts ? { repository: accounts.repository, agent: accounts.agent } : {},
  }
}

const PLACES: Record<string, string> = { deployment: '部署', github: 'GitHub', feishu: '飞书' }
export const placeName = (place: string) => PLACES[place] ?? place

/** Kinds shown as the home page's next step instead of in its problem list. */
export const NEXT_STEP_KINDS: ReadonlySet<string> = new Set(['setup', 'no-source', 'no-allowed'])

export function problemItem(problem: OverviewProblem): ProblemItem {
  switch (problem.kind) {
    case 'setup':
      return { id: `setup:${problem.place}`, kind: problem.kind, tone: 'danger', title: `配置没完成：${placeName(problem.place)}`, detail: setupText(problem), actions: [] }
    case 'no-source':
      return { id: 'no-source', kind: problem.kind, tone: 'danger', title: '没有在运行的来源', detail: 'GitHub 和飞书来源都没在运行，它收不到任何消息。', actions: [] }
    case 'no-allowed':
      return { id: 'no-allowed', kind: problem.kind, tone: 'danger', title: '名单是空的', detail: '没有人能让它干活。先把你自己的 GitHub 或飞书账号加进策略里的名单。', actions: [] }
    case 'source-error':
      return { id: `source-error:${problem.source.id}:${problem.source.health.name}`, kind: problem.kind, tone: 'danger',
        title: `来源出错：${problem.source.title.zh}`, detail: problem.source.health.detail, actions: [] }
    case 'executor-paused':
      return { id: 'executor-paused', kind: problem.kind, tone: 'warn', title: '处理已暂停',
        detail: '来源继续记录消息；不评估、不派新活、不发消息。正在运行的 worker 不受影响。', actions: [{ kind: 'resume' }] }
    case 'runtime-error':
      return { id: `runtime-error:${problem.name}`, kind: problem.kind, tone: 'danger', title: `运行出错：${problem.name}`, detail: problem.detail, actions: [] }
    case 'eval-overdue':
      return { id: `eval-overdue:${problem.thread.key}`, kind: problem.kind, tone: 'warn', title: '评估超时',
        detail: `「${problem.thread.title}」的评估超过了时限，会自动再试。`,
        actions: problem.thread.url ? [{ kind: 'link', href: problem.thread.url, label: '打开原线程' }] : [] }
    case 'eval-unavailable':
      return { id: `eval-unavailable:${problem.decisionId}`, kind: problem.kind, tone: 'warn', title: '评估没完成',
        detail: `「${problem.thread.title}」：${reasonText(problem.reason)}。这条消息还没有结论。`,
        actions: [{ kind: 'requeue', triggerId: problem.triggerId }, { kind: 'dismiss', decisionId: problem.decisionId },
          ...problem.thread.url ? [{ kind: 'link' as const, href: problem.thread.url, label: '打开原线程' }] : []] }
    case 'outgoing': {
      const { outgoing } = problem
      return { id: `outgoing:${outgoing.id}`, kind: problem.kind, tone: 'danger', title: '回复发不出去',
        detail: `「${outgoing.text}」已连续失败 ${outgoing.attempts} 次${outgoing.error ? `：${outgoing.error}` : ''}。同一对话里后面的回复在排队。`, actions: [] }
    }
    default: {
      const unknown = problem as { kind: string }
      return { id: `unknown:${unknown.kind}`, kind: unknown.kind, tone: 'warn', title: unknown.kind, detail: '控制台还不认识这类问题。', actions: [] }
    }
  }
}

const PERSON_ACTIONS = new Set(['answer', 'review', 'blocked', 'failed', 'delivery'])
const PULL = /\/pull\/\d+(?:[/?#]|$)/
const PULL_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/
/**
 * Where a person goes for a Ticket that waits for them. Upstream's link is the conversation the agent replies in, which is
 * right for a question; a review happens on the pull request: the newest one the Ticket follows, or else the one its report
 * names, since a Ticket from Feishu replies in Feishu but delivers on GitHub.
 */
export function personLink(action: string | undefined, threads: { source: string; title: string; url?: string }[], summary: string,
  reply: { url: string; label: string } | undefined): { url: string; label: string } | undefined {
  if (action !== 'review') return reply
  const pull = [...threads].reverse().find(thread => thread.source === 'github' && PULL.test(thread.url ?? ''))
  if (pull?.url) return { url: pull.url, label: pull.title }
  const named = summary.match(PULL_URL)?.[0]
  return named ? { url: named, label: `PR #${named.split('/').pop()}` } : reply
}
export function personItem(row: TicketRow): PersonItem | undefined {
  if (row.stage !== 'person' || !row.action || !PERSON_ACTIONS.has(row.action)) return undefined
  const link = personLink(row.action, row.threads, row.summary, row.reply ? { url: row.reply.url, label: row.reply.label.zh } : undefined)
  return {
    id: row.id,
    title: row.title,
    action: row.action as PersonItem['action'],
    ...row.attention ? { question: row.attention.question } : {},
    ...row.note ? { note: row.note } : {},
    summary: row.summary,
    strength: row.strength,
    waitingSince: row.updatedAt,
    threads: row.threads.map(({ key, source, title, url }) => ({ key, source, title, ...url ? { url } : {} })),
    ...link ? { reply: link } : {},
    actions: row.actions,
  }
}
