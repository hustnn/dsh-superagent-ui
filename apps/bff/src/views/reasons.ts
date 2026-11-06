/**
 * Reason codes in plain Chinese. The core's codes (`REASONS` in upstream `src/core/reasons.ts`) and the Sources' filter
 * codes, worded as upstream's own panel words them (`reason.*` in upstream `src/client/locales.ts` at 8c32a9d).
 */
import type { Reason, SetupProblem } from '../upstream/types.ts'

const REASONS: Record<string, string> = {
  said: '{text}',
  not_human: '自动消息',
  not_a_member: '发送者不在这个来源的名单里',
  no_mention: '没有点名智能体，且这个来源不接收其余消息',
  admission_ignored: '准入设为忽略',
  chat_not_allowed: '群不在监听的群里',
  direct_messages_not_allowed: '私聊未开放',
  observation_only: '仅观察的群（旧版过滤）',
  untracked_source: '线程未被订阅',
  issue_assigned: 'Issue 已有负责人',
  issue_closed: 'Issue 已关闭',
  issue_has_pull_request: 'Issue 已有关联 PR',
  issue_unclaimed_less_than_day: 'Issue 无人认领未满一天',
  issue_unclaimed_less_than_wait: 'Issue 无人认领未满等待时长',
  issue_awaiting_eligibility: '等待 Issue 满足资格',
  issue_sender_or_admission_disabled: 'Issue 发起人不在名单或主动接单已关闭',
  task_ended: '工单已结束',
  task_paused: '工单已暂停',
  subscription_inactive: '订阅未生效',
  subscription_removed: '订阅已移除',
  source_disabled: '来源已停用',
  source_not_installed: '来源插件未加载',
  timeout: '评估超时未决定',
  policyChanged: '评估期间策略已变更',
  noAdmissible: '没有可准入的触发',
  startedTicket: '已经开过工单 {ticket}',
  acceptedBefore: '触发 {trigger} 之前已接单',
  routed: '已转给工单 {ticket}',
  explicitRouted: '名单里的人明确请求，由主 Session 接单',
  humanStop: '有人要求停止',
  legacyImport: '从旧版工单记录导入',
  forwarded: '已扇出给该线程的工单',
  senderNotMember: '发送者不在这个来源的名单里',
  retried: '人工重试',
  hostRestarted: 'dsh-superagent 重启',
  stopUnknown: '要停止的工单不存在或已结束',
  stopNotExplicit: '停止需要名单里的人明确要求',
  directionUnsettled: '实现意图或目标未确定，或还要产品或设计决定',
  noRuleMatched: '没有启用的准入规则匹配',
  ignoredFromCard: '仅凭候选卡片忽略，未经规则研判',
  observed: '观察模式：本会接单（{text}）',
  channelGone: '对话已无法接收消息',
  channelIgnored: '来源已不再监听这个对话',
  revoked: '授权已失效',
}

export function reasonOf(reason: Reason | string): string {
  const { code, values } = typeof reason === 'string' ? { code: reason, values: undefined } : reason
  const template = REASONS[code] ?? code
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values?.[name] ?? match)
}

/** Setup problems as upstream's panel words them (`setup.*` in upstream `src/client/locales.ts`). */
const SETUP: Record<string, string> = {
  repositoryUnset: 'GitHub 来源没有设置监听的仓库。',
  foreignFile: '{file} 不是 dsh-superagent 写入的文件；移走它，或换一个状态目录。',
  gitTooOld: 'git 没有读取 dsh-superagent 为 github.com 写的凭据配置；需要 git 2.32 或更新版本。',
  environmentFailed: '准备智能体的运行环境失败。',
  agentCliUnset: '没有设置智能体的 GitHub CLI。',
  agentCliMissing: '找不到智能体的 GitHub CLI。',
  agentCliSignedOut: '智能体的 GitHub CLI 读不到它的账号。',
  agentCliNoAccount: '智能体的 GitHub CLI 没有报告 GitHub 账号。',
  repositoryUnreadable: '@{account} 读不到 {repository}。',
  repositoryUnreported: '智能体的 GitHub CLI 没有返回 {repository}。',
  repositoryReadOnly: '@{account} 没有 {repository} 的推送权限。',
  feishuCliFailed: '机器人的 lark-cli 不可用。',
  feishuNoApp: '机器人的 lark-cli 的 auth status 没有报告应用。',
  feishuBotNotReady: '应用 {app} 的机器人身份状态是 {status}；用 lark-cli 配置应用密钥。',
  feishuUserIdentity: '机器人的 lark-cli 允许用户身份（strict mode 为 {mode}）；给机器人一份 strict mode 为 bot 的单独配置。',
  feishuNoBot: '飞书机器人接口没有返回机器人的 open_id。',
}
/** A setup problem in Chinese, with the CLI's own output on the next line when it gave one; upstream's English for a code this does not know. */
export function setupText(problem: Pick<SetupProblem, 'code' | 'values' | 'detail'>): string {
  const template = SETUP[problem.code]
  if (!template) return problem.detail
  const sentence = template.replace(/\{(\w+)\}/g, (match, name: string) => problem.values?.[name] ?? match)
  return problem.values?.output ? `${sentence}\n${problem.values.output}` : sentence
}

export function reasonText(reasons: readonly Reason[] | Reason | undefined): string {
  const list = reasons === undefined ? [] : Array.isArray(reasons) ? reasons : [reasons as Reason]
  return list.map(reasonOf).filter(Boolean).join('；') || '没有给出原因'
}
