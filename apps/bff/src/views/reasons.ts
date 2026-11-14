/**
 * Reason codes in plain words, English or Chinese. The core's codes (`REASONS` in upstream `src/core/reasons.ts`) and the Sources' filter
 * codes, worded as upstream's own panel words them (`reason.*` in upstream `src/client/locales.ts` at 8c32a9d).
 */
import { list, t } from '../i18n.ts'
import type { Reason, SetupProblem } from '../upstream/types.ts'

const REASONS: Record<string, [string, string]> = {
  said: ['{text}', '{text}'],
  not_human: ['Automated message', '自动消息'],
  not_a_member: ['Sender is not on this source\'s list', '发送者不在这个来源的名单里'],
  no_mention: ['Does not address the agent, and this source does not receive the rest', '没有点名智能体，且这个来源不接收其余消息'],
  admission_ignored: ['Admission set to ignore', '准入设为忽略'],
  chat_not_allowed: ['Chat is not a listened chat', '群不在监听的群里'],
  direct_messages_not_allowed: ['Direct messages are off', '私聊未开放'],
  observation_only: ['Observe-only chat (legacy filter)', '仅观察的群（旧版过滤）'],
  untracked_source: ['Thread not subscribed', '线程未被订阅'],
  issue_assigned: ['Issue has an assignee', 'Issue 已有负责人'],
  issue_closed: ['Issue is closed', 'Issue 已关闭'],
  issue_has_pull_request: ['Issue has a linked PR', 'Issue 已有关联 PR'],
  issue_unclaimed_less_than_day: ['Issue unclaimed for less than a day', 'Issue 无人认领未满一天'],
  issue_unclaimed_less_than_wait: ['Issue unclaimed for less than the wait', 'Issue 无人认领未满等待时长'],
  issue_awaiting_eligibility: ['Waiting for Issue eligibility', '等待 Issue 满足资格'],
  issue_sender_or_admission_disabled: ['Issue sender not on the list, or proactive work is off', 'Issue 发起人不在名单或主动接单已关闭'],
  task_ended: ['Ticket ended', '工单已结束'],
  task_paused: ['Ticket paused', '工单已暂停'],
  subscription_inactive: ['Subscription inactive', '订阅未生效'],
  subscription_removed: ['Subscription removed', '订阅已移除'],
  source_disabled: ['Source disabled', '来源已停用'],
  source_not_installed: ['Source plugin not loaded', '来源插件未加载'],
  timeout: ['Evaluation timed out without a decision', '评估超时未决定'],
  policyChanged: ['Policy changed during the evaluation', '评估期间策略已变更'],
  noAdmissible: ['No admissible Trigger', '没有可准入的触发'],
  startedTicket: ['Already started Ticket {ticket}', '已经开过工单 {ticket}'],
  acceptedBefore: ['Trigger {trigger} was accepted before', '触发 {trigger} 之前已接单'],
  routed: ['Routed to Ticket {ticket}', '已转给工单 {ticket}'],
  explicitRouted: ['Explicit request from someone on the list, accepted by the main Session', '名单里的人明确请求，由主 Session 接单'],
  humanStop: ['Someone asked to stop', '有人要求停止'],
  legacyImport: ['Imported from a legacy Ticket record', '从旧版工单记录导入'],
  forwarded: ['Fanned out to the thread\'s Tickets', '已扇出给该线程的工单'],
  senderNotMember: ['Sender is not on this source\'s list', '发送者不在这个来源的名单里'],
  retried: ['Retried by a person', '人工重试'],
  hostRestarted: ['dsh-superagent restarted', 'dsh-superagent 重启'],
  stopUnknown: ['The Ticket to stop is unknown or ended', '要停止的工单不存在或已结束'],
  stopNotExplicit: ['Stopping needs an explicit request from someone on the list', '停止需要名单里的人明确要求'],
  directionUnsettled: ['Intent or target not settled, or a product or design decision is still open', '实现意图或目标未确定，或还要产品或设计决定'],
  noRuleMatched: ['No enabled admission rule matched', '没有启用的准入规则匹配'],
  ignoredFromCard: ['Ignored from its card, without a rule assessment', '仅凭候选卡片忽略，未经规则研判'],
  observed: ['Observe mode: would accept ({text})', '观察模式：本会接单（{text}）'],
  channelGone: ['The conversation can no longer receive messages', '对话已无法接收消息'],
  channelIgnored: ['The source no longer listens to this conversation', '来源已不再监听这个对话'],
  revoked: ['Mandate no longer valid', '授权已失效'],
}

export function reasonOf(reason: Reason | string): string {
  const { code, values } = typeof reason === 'string' ? { code: reason, values: undefined } : reason
  const pair = REASONS[code]
  const template = pair ? t(...pair) : code
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values?.[name] ?? match)
}

/** Setup problems as upstream's panel words them (`setup.*` in upstream `src/client/locales.ts`). */
const SETUP: Record<string, [string, string]> = {
  repositoryUnset: ['The GitHub source names no repository.', 'GitHub 来源没有设置监听的仓库。'],
  foreignFile: ['{file} was not written by dsh-superagent; move it, or choose another state directory.', '{file} 不是 dsh-superagent 写入的文件；移走它，或换一个状态目录。'],
  gitTooOld: ['git does not read the github.com credential configuration dsh-superagent writes; it needs git 2.32 or later.', 'git 没有读取 dsh-superagent 为 github.com 写的凭据配置；需要 git 2.32 或更新版本。'],
  environmentFailed: ['Preparing the agent environment failed.', '准备智能体的运行环境失败。'],
  agentCliUnset: ['The agent\'s GitHub CLI is not set.', '没有设置智能体的 GitHub CLI。'],
  agentCliMissing: ['The agent\'s GitHub CLI was not found.', '找不到智能体的 GitHub CLI。'],
  agentCliSignedOut: ['The agent\'s GitHub CLI cannot read its account.', '智能体的 GitHub CLI 读不到它的账号。'],
  agentCliNoAccount: ['The agent\'s GitHub CLI did not report a GitHub account.', '智能体的 GitHub CLI 没有报告 GitHub 账号。'],
  repositoryUnreadable: ['@{account} cannot read {repository}.', '@{account} 读不到 {repository}。'],
  repositoryUnreported: ['The agent\'s GitHub CLI did not return {repository}.', '智能体的 GitHub CLI 没有返回 {repository}。'],
  repositoryReadOnly: ['@{account} cannot push to {repository}.', '@{account} 没有 {repository} 的推送权限。'],
  feishuCliFailed: ['The bot\'s lark-cli does not work.', '机器人的 lark-cli 不可用。'],
  feishuNoApp: ['auth status of the bot\'s lark-cli did not report the app.', '机器人的 lark-cli 的 auth status 没有报告应用。'],
  feishuBotNotReady: ['The bot identity of app {app} is {status}; configure the app secret with lark-cli.', '应用 {app} 的机器人身份状态是 {status}；用 lark-cli 配置应用密钥。'],
  feishuUserIdentity: ['The bot\'s lark-cli allows user identities (strict mode {mode}); give the bot its own configuration in strict mode bot.', '机器人的 lark-cli 允许用户身份（strict mode 为 {mode}）；给机器人一份 strict mode 为 bot 的单独配置。'],
  feishuNoBot: ['The Feishu bot API did not return the bot\'s open_id.', '飞书机器人接口没有返回机器人的 open_id。'],
}
/** A setup problem in words, with the CLI's own output on the next line when it gave one; upstream's English for a code this does not know. */
export function setupText(problem: Pick<SetupProblem, 'code' | 'values' | 'detail'>): string {
  const pair = SETUP[problem.code]
  if (!pair) return problem.detail
  const template = t(...pair)
  const sentence = template.replace(/\{(\w+)\}/g, (match, name: string) => problem.values?.[name] ?? match)
  return problem.values?.output ? `${sentence}\n${problem.values.output}` : sentence
}

export function reasonText(reasons: readonly Reason[] | Reason | undefined): string {
  const items = reasons === undefined ? [] : Array.isArray(reasons) ? reasons : [reasons as Reason]
  return list(items.map(reasonOf).filter(Boolean)) || t('No reason given', '没有给出原因')
}
