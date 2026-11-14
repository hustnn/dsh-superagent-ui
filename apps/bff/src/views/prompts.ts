/**
 * Prompts: what the team writes in words, the most direct way to tune how the agent talks, when it stops and what it delivers.
 * The console edits upstream's prompt configuration as read and saves it on top of the revision it read.
 */
import type { Connection, PromptPart, PromptPreview, PromptsView } from '@dsh-superagent-ui/contract'
import type { UpstreamClient } from '../upstream/client.ts'
import type { PromptPreview as UpstreamPreview, PromptsView as UpstreamPrompts } from '../upstream/types.ts'
import { t } from '../i18n.ts'

type Named = { title: [string, string]; description: [string, string] }
const named = (item: Named | undefined, key: string) => item ? { title: t(...item.title), description: t(...item.description) } : { title: key, description: '' }

const TEAM: Record<string, Named> = {
  communication: { title: ['Communication', '沟通规范'], description: ['When to post, how to write messages, how to handle reviews, and which ordinary accounts are really review bots.', '什么时候发消息、消息怎么写、怎么处理评审、哪些普通账号其实是评审机器人。'] },
  scope: { title: ['Ticket scope', 'Ticket 范围'], description: ['How far one Ticket goes, and when to stop with a draft and one question.', '一个 Ticket 做到哪一步，什么时候带着草稿和一个问题停下。'] },
  delivery: { title: ['Delivery requirements', '交付要求'], description: ['What evidence a PR carries, when auto-merge applies, and whose identity commits use.', 'PR 里要附什么证据、自动合并的条件、提交用谁的身份。'] },
}
/** The built-in parts by key (`PART_KEYS` in upstream `src/app/prompts.ts`). */
const PARTS: Record<string, Named> = {
  'runtime/shared': { title: ['Shared instructions', '共享说明'], description: ['Basics both roles read.', '两个角色都读的基本说明。'] },
  'runtime/orchestrator': { title: ['The main Session\'s role', '主 Session 的角色'], description: ['The main Session only routes; it does not do the work.', '主 Session 只路由、不干活。'] },
  'runtime/worker': { title: ['The worker\'s role', 'worker 的角色'], description: ['The worker reads the original sources, judges the scope, implements and verifies.', 'worker 读原始来源、判断范围、实现并验证。'] },
  'runtime/subscriptions': { title: ['Subscriptions', '订阅'], description: ['How new messages in a thread reach a Ticket.', '线程上的新消息怎么送到 Ticket。'] },
  'runtime/replies': { title: ['Replies', '回复'], description: ['Which conversation replies go to, and when.', '回复走哪个对话、什么时候发。'] },
  'runtime/dispatch': { title: ['Dispatch', '派工'], description: ['How the main Session accepts work, attaches it to an existing Ticket, stops or ignores.', '主 Session 怎么接单、挂到已有 Ticket、停止或忽略。'] },
  'runtime/work': { title: ['How it works', '工作方式'], description: ['How the worker acknowledges, reports, asks and delivers.', 'worker 怎么确认、汇报、提问和交付。'] },
  'runtime/admission': { title: ['Proactive evaluation', '主动评估'], description: ['How the main Session evaluates proactive candidates against the rules.', '主 Session 怎么按规则评估主动候选。'] },
  'runtime/handoff/orchestrator': { title: ['Handoff (main Session)', '交接（主 Session）'], description: ['What the main Session says when handing over to a person.', '主 Session 交给人的时候说什么。'] },
  'runtime/handoff/worker': { title: ['Handoff (worker)', '交接（worker）'], description: ['What the worker says when handing over to a person.', 'worker 交给人的时候说什么。'] },
  'runtime/environment': { title: ['Execution environment (template)', '执行环境（模板）'], description: ['Template for the execution variables section.', '执行变量那一段的模板。'] },
  'runtime/policy': { title: ['Policy (template)', '策略（模板）'], description: ['Template for the policy section regenerated on every request, when rules are enabled.', '每次请求重新生成的策略那一段，有启用规则时的模板。'] },
  'runtime/policy/none': { title: ['Policy (template, no rules)', '策略（模板，无规则）'], description: ['Template when no rules are enabled.', '没有启用规则时的模板。'] },
  'skill/feishu': { title: ['Feishu skill', '飞书 skill'], description: ['How to read and write Feishu messages and threads.', '怎么读写飞书消息和话题。'] },
  'skill/github': { title: ['GitHub skill', 'GitHub skill'], description: ['How to read and write Issues, PRs, reviews and CI.', '怎么读写 Issue、PR、评审和 CI。'] },
}
const ORIGINS: Record<string, [string, string]> = { panel: ['the console or panel', '控制台或面板'], tool: ['the main Session', '主 Session'], sync: ['a sync', '同步'], migration: ['an upgrade', '升级'] }
const origin = (source: string) => ORIGINS[source] ? t(...ORIGINS[source]) : source

/** A changed name in history (`changed` in upstream's prompt history), as people call it. */
export function partTitle(key: string): string {
  if (TEAM[key]) return t(...TEAM[key].title)
  if (key.startsWith('skill/') && !PARTS[key]) return `skill ${key.slice('skill/'.length)}`
  if (key === 'legacy') return t("Old format; can't be compared item by item", '旧版格式，无法逐项比较')
  return PARTS[key] ? t(...PARTS[key].title) : key
}

export function promptParts(view: UpstreamPrompts): PromptPart[] {
  const changed = new Map(view.defaultChanged.map(change => [change.part, change]))
  const config = view.current.config
  const team = view.sections.map((key): PromptPart => ({ key, kind: 'team', ...named(TEAM[key], key), roles: ['orchestrator', 'worker'],
    teamDefault: (view.defaults as unknown as Record<string, string>)[key] ?? '' }))
  const skills = Object.keys(config.skills).sort().map((name): PromptPart => ({ key: `skill/${name}`, kind: 'skill', title: name,
    description: t('Knowledge the team wrote; the agent reads it when needed.', '团队写的知识，agent 需要时会读。'), roles: ['orchestrator', 'worker'] }))
  const parts = view.parts.map((part): PromptPart => {
    const change = changed.get(part.key)
    return { key: part.key, kind: 'part', ...named(PARTS[part.key], part.key), roles: part.roles,
      builtIn: { text: part.text, base: part.base, placeholders: part.placeholders ?? [] },
      ...change ? { defaultChanged: { ...change.previous !== undefined ? { previous: change.previous } : {}, ...change.removed ? { removed: true } : {} } } : {} }
  })
  // Overrides of parts this version no longer has are listed so they can be dropped.
  const gone = view.defaultChanged.filter(change => change.removed).map((change): PromptPart => ({ key: change.part, kind: 'part', title: change.part,
    description: t('This built-in section no longer exists in the new version; saving removes the override here.', '这个内置段落在新版本里已经不存在，保存时会去掉这里的覆盖。'), roles: [], defaultChanged: { removed: true } }))
  return [...team, ...skills, ...parts, ...gone]
}

export async function buildPrompts(upstream: Pick<UpstreamClient, 'prompts'>, revision: number | undefined, connection: () => Connection): Promise<PromptsView> {
  const view = await upstream.prompts(revision)
  return {
    connection: connection(),
    revision: view.current.revision, current: view.revision, savedAt: view.current.savedAt, origin: origin(view.current.source),
    config: view.current.config,
    parts: promptParts(view),
    sessions: view.sessions,
    history: view.revisions.map(item => ({ revision: item.revision, savedAt: item.savedAt, origin: origin(item.source), changed: item.changed.map(partTitle) })),
  }
}

export function previewView(preview: UpstreamPreview, overrides: Record<string, unknown> = {}): PromptPreview {
  const role = (parts: UpstreamPreview['parts']['worker']) => parts.map(part => ({
    name: part.name, title: part.kind === 'team' ? partTitle(part.name) : partTitle(part.key ?? part.name), kind: part.kind,
    overridden: part.kind === 'fixed' && !!part.key && part.key in overrides, text: part.text,
  }))
  return { roles: { orchestrator: role(preview.parts.orchestrator), worker: role(preview.parts.worker) },
    note: t("Workers also read DSH's own coding prompt and the repository's AGENTS.md. Prompts only change what the agent is told, not what it is allowed to do: tool permissions, admission and account limits still apply.", 'worker 还会读 DSH 自带的编码提示词和仓库里的 AGENTS.md。提示词只改变 agent 被告知的内容，不改变它被允许做的事：工具权限、准入和账号限制都还在。') }
}
