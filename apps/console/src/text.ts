/** The console's words for upstream values, and time phrases. People see these, not the domain's internal codes. */
import type { PersonAction, SourceState, ThreadStage, TicketCard, TicketOutcome, TicketStageKey, TimelineEntry, UpstreamState } from '@dsh-superagent-ui/contract'
import { lang, locale, t } from './i18n'

export type PageName = 'home' | 'board' | 'lookup' | 'calibration' | 'recipes' | 'policy' | 'prompts' | 'health' | 'insights' | 'sources' | 'execution' | 'directories'
/** Page names, shared by the navigation and the command palette. */
export const PAGE: Record<PageName, string> = {
  home: t('Home', '首页'), board: t('Board', '看板'), lookup: t('Message path', '消息去向'), calibration: t('Calibration', '校准'),
  recipes: t('Recipes', '场景配方'), policy: t('Policy', '策略'), prompts: t('Prompts', '提示词'), health: t('Health', '健康'),
  insights: t('Insights', '洞察'), sources: t('Sources', '来源'), execution: t('Execution', '执行'), directories: t('Directories', '工作目录'),
}

export type Tone = 'warn' | 'danger' | 'ok' | 'accent' | 'infer' | 'muted'

export const PERSON: Record<PersonAction, { label: string; tone: Tone }> = {
  answer: { label: t('Awaiting your answer', '等你回答'), tone: 'warn' },
  review: { label: t('Awaiting your review', '等你评审'), tone: 'accent' },
  blocked: { label: t('Blocked', '受阻'), tone: 'danger' },
  failed: { label: t('Failed', '失败'), tone: 'danger' },
  delivery: { label: t('Message not delivered to worker', '消息没送到 worker'), tone: 'danger' },
}

export const SOURCE_STATE: Record<SourceState, { label: string; tone: Tone }> = {
  ready: { label: t('Working', '正常'), tone: 'ok' },
  starting: { label: t('Starting', '启动中'), tone: 'muted' },
  paused: { label: t('Paused', '已暂停'), tone: 'warn' },
  setup: { label: t('Needs setup', '等配置'), tone: 'warn' },
  error: { label: t('Error', '出错'), tone: 'danger' },
  off: { label: t('Off', '已关闭'), tone: 'muted' },
  missing: { label: t('Not installed', '未安装'), tone: 'danger' },
}

export const SOURCE_NAME: Record<string, string> = { github: 'GitHub', feishu: t('Feishu', '飞书') }

export const UPSTREAM: Record<Exclude<UpstreamState, 'ok'>, (url: string) => string> = {
  unreachable: url => t(`Can't reach dsh-superagent (${url}). Check that it is running: run scripts/dsh-superagent status in its directory.`,
    `连不上 dsh-superagent（${url}）。确认它在运行：在它的目录里执行 scripts/dsh-superagent status。`),
  'not-mounted': () => t('DSH is running, but dsh-superagent is not loaded, or is restarting. Wait a moment; if it stays like this, check the dsh-superagent log.',
    'DSH 在运行，但 dsh-superagent 没有加载，或者正在重启。稍等片刻；一直这样的话看 dsh-superagent 的日志。'),
  forbidden: url => t(`dsh-superagent refused the console's request. SUPERAGENT_URL must be the loopback address it listens on; it is now ${url}.`,
    `dsh-superagent 拒绝了控制台的请求。SUPERAGENT_URL 要写它监听的回环地址，现在是 ${url}。`),
  error: () => t('dsh-superagent returned an error. Check its log for the cause.', 'dsh-superagent 返回了错误。看它的日志找原因。'),
}

export const AUDIT_ACTION: Record<string, string> = {
  'directories.rescan': t('Recomputed directory sizes', '重新计算工作目录的大小'),
  'directories.reveal': t('Revealed a directory in Finder', '在访达中显示工作目录'),
  'source.account': t("Changed a source's account", '改了来源的账号'),
  'source.labels': t('Refreshed the group list', '刷新了群列表'),
  'setup.check': t('Checked the configuration again', '重新检查配置'),
  'ticket.stop': t('Stopped a Ticket', '停止 Ticket'),
  'ticket.retry': t('Retried a Ticket', '重试 Ticket'),
  'trigger.requeue': t('Re-evaluated a message', '重新评估消息'),
  'decision.dismiss': t('Dismissed an evaluation problem', '忽略评估问题'),
  'executor.pause': t('Paused or resumed processing', '暂停或恢复处理'),
}

export const DROP_REASON: Record<string, string> = {
  channelGone: t('The conversation no longer exists', '对话已不存在'),
  channelIgnored: t('The source no longer follows this conversation', '来源不再关注这个对话'),
}

/** "2 h 5 min" (or "2 小时 5 分") from a duration. */
export function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 1) return t('under 1 min', '不到 1 分钟')
  if (minutes < 60) return t(`${minutes} min`, `${minutes} 分`)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? t(`${hours} h ${minutes % 60} min`, `${hours} 小时 ${minutes % 60} 分`) : t(`${hours} h`, `${hours} 小时`)
  const days = Math.floor(hours / 24)
  return t(days === 1 ? '1 day' : `${days} days`, `${days} 天`)
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes, unit = -1
  do { value /= 1024; unit++ } while (value >= 1024 && unit < units.length - 1)
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export function clock(iso: string): string {
  const date = new Date(iso)
  const today = new Date().toDateString() === date.toDateString()
  return date.toLocaleString(locale, today ? { hour: '2-digit', minute: '2-digit' } : { month: lang === 'zh' ? 'numeric' : 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** "3 Tickets" in English, "3 个 Ticket" in Chinese. */
export function count(n: number, one: string, many: string, zh: string): string {
  return t(`${n} ${n === 1 ? one : many}`, `${n} ${zh}`)
}

export const STAGE: Record<Exclude<TicketStageKey, 'person'>, { label: string; tone: Tone }> = {
  queued: { label: t('Queued', '排队中'), tone: 'muted' },
  working: { label: t('Working', '执行中'), tone: 'ok' },
  idle: { label: t('Waiting for new messages', '等新消息'), tone: 'muted' },
  ended: { label: t('Ended', '已结束'), tone: 'muted' },
}
export const OUTCOME: Record<TicketOutcome, { label: string; tone: Tone }> = {
  completed: { label: t('Completed', '已完成'), tone: 'ok' },
  merged: { label: t('PR merged', 'PR 已合并'), tone: 'ok' },
  closed: { label: t('PR closed', 'PR 已关闭'), tone: 'muted' },
  dropped: { label: t('Nothing to do', '无需处理'), tone: 'muted' },
  stopped: { label: t('Stopped by a person', '被人停止'), tone: 'warn' },
}
/** The label and tone of a Ticket wherever it is shown. */
export function stageLabel(ticket: Pick<TicketCard, 'stage' | 'action' | 'outcome'>): { label: string; tone: Tone } {
  if (ticket.stage === 'person' && ticket.action) return PERSON[ticket.action]
  if (ticket.stage === 'ended' && ticket.outcome) return OUTCOME[ticket.outcome]
  return ticket.stage === 'person' ? { label: t('Needs you', '需要你'), tone: 'warn' } : STAGE[ticket.stage]
}

export const THREAD_STAGE: Record<ThreadStage, { label: string; tone: Tone }> = {
  error: { label: t('Read error', '读取出错'), tone: 'danger' },
  evaluating: { label: t('Evaluating', '评估中'), tone: 'accent' },
  queued: { label: t('Awaiting evaluation', '等评估'), tone: 'accent' },
  subscribed: { label: t('Followed by a Ticket', '有 Ticket 在关注'), tone: 'ok' },
  dormant: { label: t('Ticket ended', 'Ticket 已结束'), tone: 'muted' },
  unsubscribed: { label: t('No Ticket', '没有 Ticket'), tone: 'muted' },
}

export const TIMELINE_KIND: Record<TimelineEntry['kind'], string> = {
  request: t('Request', '请求'), decision: t('Decision', '判断'), assignment: t('Run', '执行'), report: t('Report', '报告'),
  message: t('Message', '消息'), note: t('Note', '备注'), policy: t('Policy', '策略'), end: t('End', '结束'),
}
