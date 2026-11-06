/** The console's words for upstream values, and time phrases. People see these, not the domain's internal codes. */
import type { PersonAction, SourceState, ThreadStage, TicketCard, TicketOutcome, TicketStageKey, TimelineEntry, UpstreamState } from '@dsh-superagent-ui/contract'

export type Tone = 'warn' | 'danger' | 'ok' | 'accent' | 'infer' | 'muted'

export const PERSON: Record<PersonAction, { label: string; tone: Tone }> = {
  answer: { label: '等你回答', tone: 'warn' },
  review: { label: '等你评审', tone: 'accent' },
  blocked: { label: '受阻', tone: 'danger' },
  failed: { label: '失败', tone: 'danger' },
  delivery: { label: '消息没送到 worker', tone: 'danger' },
}

export const SOURCE_STATE: Record<SourceState, { label: string; tone: Tone }> = {
  ready: { label: '正常', tone: 'ok' },
  starting: { label: '启动中', tone: 'muted' },
  paused: { label: '已暂停', tone: 'warn' },
  setup: { label: '等配置', tone: 'warn' },
  error: { label: '出错', tone: 'danger' },
  off: { label: '已关闭', tone: 'muted' },
  missing: { label: '未安装', tone: 'danger' },
}

export const SOURCE_NAME: Record<string, string> = { github: 'GitHub', feishu: '飞书' }

export const UPSTREAM: Record<Exclude<UpstreamState, 'ok'>, (url: string) => string> = {
  unreachable: url => `连不上 dsh-superagent（${url}）。确认它在运行：在它的目录里执行 scripts/dsh-superagent status。`,
  'not-mounted': () => 'DSH 在运行，但 dsh-superagent 没有加载，或者正在重启。稍等片刻；一直这样的话看 dsh-superagent 的日志。',
  forbidden: url => `dsh-superagent 拒绝了控制台的请求。SUPERAGENT_URL 要写它监听的回环地址，现在是 ${url}。`,
  error: () => 'dsh-superagent 返回了错误。看它的日志找原因。',
}

export const AUDIT_ACTION: Record<string, string> = {
  'directories.rescan': '重新计算工作目录的大小',
  'directories.reveal': '在访达中显示工作目录',
  'source.account': '改了来源的账号',
  'source.labels': '刷新了群列表',
  'setup.check': '重新检查配置',
  'ticket.stop': '停止 Ticket',
  'ticket.retry': '重试 Ticket',
  'trigger.requeue': '重新评估消息',
  'decision.dismiss': '忽略评估问题',
  'executor.pause': '暂停或恢复处理',
}

export const DROP_REASON: Record<string, string> = {
  channelGone: '对话已不存在',
  channelIgnored: '来源不再关注这个对话',
}

/** "2 小时 5 分" from a duration. */
export function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 1) return '不到 1 分钟'
  if (minutes < 60) return `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours} 小时 ${minutes % 60} 分` : `${hours} 小时`
  return `${Math.floor(hours / 24)} 天`
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
  return date.toLocaleString('zh-CN', today ? { hour: '2-digit', minute: '2-digit' } : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const STAGE: Record<Exclude<TicketStageKey, 'person'>, { label: string; tone: Tone }> = {
  queued: { label: '排队中', tone: 'muted' },
  working: { label: '执行中', tone: 'ok' },
  idle: { label: '等新消息', tone: 'muted' },
  ended: { label: '已结束', tone: 'muted' },
}
export const OUTCOME: Record<TicketOutcome, { label: string; tone: Tone }> = {
  completed: { label: '已完成', tone: 'ok' },
  merged: { label: 'PR 已合并', tone: 'ok' },
  closed: { label: 'PR 已关闭', tone: 'muted' },
  dropped: { label: '无需处理', tone: 'muted' },
  stopped: { label: '被人停止', tone: 'warn' },
}
/** The label and tone of a Ticket wherever it is shown. */
export function stageLabel(ticket: Pick<TicketCard, 'stage' | 'action' | 'outcome'>): { label: string; tone: Tone } {
  if (ticket.stage === 'person' && ticket.action) return PERSON[ticket.action]
  if (ticket.stage === 'ended' && ticket.outcome) return OUTCOME[ticket.outcome]
  return ticket.stage === 'person' ? { label: '需要你', tone: 'warn' } : STAGE[ticket.stage]
}

export const THREAD_STAGE: Record<ThreadStage, { label: string; tone: Tone }> = {
  error: { label: '读取出错', tone: 'danger' },
  evaluating: { label: '评估中', tone: 'accent' },
  queued: { label: '等评估', tone: 'accent' },
  subscribed: { label: '有 Ticket 在关注', tone: 'ok' },
  dormant: { label: 'Ticket 已结束', tone: 'muted' },
  unsubscribed: { label: '没有 Ticket', tone: 'muted' },
}

export const TIMELINE_KIND: Record<TimelineEntry['kind'], string> = {
  request: '请求', decision: '判断', assignment: '执行', report: '报告', message: '消息', note: '备注', policy: '策略', end: '结束',
}
