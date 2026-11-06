/**
 * Prompts: what the team writes in words, the most direct way to tune how the agent talks, when it stops and what it delivers.
 * The console edits upstream's prompt configuration as read and saves it on top of the revision it read.
 */
import type { Connection, PromptPart, PromptPreview, PromptsView } from '@dsh-superagent-ui/contract'
import type { UpstreamClient } from '../upstream/client.ts'
import type { PromptPreview as UpstreamPreview, PromptsView as UpstreamPrompts } from '../upstream/types.ts'

const TEAM: Record<string, { title: string; description: string }> = {
  communication: { title: '沟通规范', description: '什么时候发消息、消息怎么写、怎么处理评审、哪些普通账号其实是评审机器人。' },
  scope: { title: 'Ticket 范围', description: '一个 Ticket 做到哪一步，什么时候带着草稿和一个问题停下。' },
  delivery: { title: '交付要求', description: 'PR 里要附什么证据、自动合并的条件、提交用谁的身份。' },
}
/** The built-in parts by key (`PART_KEYS` in upstream `src/app/prompts.ts`). */
const PARTS: Record<string, { title: string; description: string }> = {
  'runtime/shared': { title: '共享说明', description: '两个角色都读的基本说明。' },
  'runtime/orchestrator': { title: '主 Session 的角色', description: '主 Session 只路由、不干活。' },
  'runtime/worker': { title: 'worker 的角色', description: 'worker 读原始来源、判断范围、实现并验证。' },
  'runtime/subscriptions': { title: '订阅', description: '线程上的新消息怎么送到 Ticket。' },
  'runtime/replies': { title: '回复', description: '回复走哪个对话、什么时候发。' },
  'runtime/dispatch': { title: '派工', description: '主 Session 怎么接单、挂到已有 Ticket、停止或忽略。' },
  'runtime/work': { title: '工作方式', description: 'worker 怎么确认、汇报、提问和交付。' },
  'runtime/admission': { title: '主动评估', description: '主 Session 怎么按规则评估主动候选。' },
  'runtime/handoff/orchestrator': { title: '交接（主 Session）', description: '主 Session 交给人的时候说什么。' },
  'runtime/handoff/worker': { title: '交接（worker）', description: 'worker 交给人的时候说什么。' },
  'runtime/environment': { title: '执行环境（模板）', description: '执行变量那一段的模板。' },
  'runtime/policy': { title: '策略（模板）', description: '每次请求重新生成的策略那一段，有启用规则时的模板。' },
  'runtime/policy/none': { title: '策略（模板，无规则）', description: '没有启用规则时的模板。' },
  'skill/feishu': { title: '飞书 skill', description: '怎么读写飞书消息和话题。' },
  'skill/github': { title: 'GitHub skill', description: '怎么读写 Issue、PR、评审和 CI。' },
}
const ORIGIN: Record<string, string> = { panel: '控制台或面板', tool: '主 Session', sync: '同步', migration: '升级' }

/** A changed name in history (`changed` in upstream's prompt history), as people call it. */
export function partTitle(key: string): string {
  if (TEAM[key]) return TEAM[key].title
  if (key.startsWith('skill/') && !PARTS[key]) return `skill ${key.slice('skill/'.length)}`
  if (key === 'legacy') return '旧版格式，无法逐项比较'
  return PARTS[key]?.title ?? key
}

export function promptParts(view: UpstreamPrompts): PromptPart[] {
  const changed = new Map(view.defaultChanged.map(change => [change.part, change]))
  const config = view.current.config
  const team = view.sections.map((key): PromptPart => ({ key, kind: 'team', ...TEAM[key] ?? { title: key, description: '' }, roles: ['orchestrator', 'worker'],
    teamDefault: (view.defaults as unknown as Record<string, string>)[key] ?? '' }))
  const skills = Object.keys(config.skills).sort().map((name): PromptPart => ({ key: `skill/${name}`, kind: 'skill', title: name,
    description: '团队写的知识，agent 需要时会读。', roles: ['orchestrator', 'worker'] }))
  const parts = view.parts.map((part): PromptPart => {
    const change = changed.get(part.key)
    return { key: part.key, kind: 'part', ...PARTS[part.key] ?? { title: part.key, description: '' }, roles: part.roles,
      builtIn: { text: part.text, base: part.base, placeholders: part.placeholders ?? [] },
      ...change ? { defaultChanged: { ...change.previous !== undefined ? { previous: change.previous } : {}, ...change.removed ? { removed: true } : {} } } : {} }
  })
  // Overrides of parts this version no longer has are listed so they can be dropped.
  const gone = view.defaultChanged.filter(change => change.removed).map((change): PromptPart => ({ key: change.part, kind: 'part', title: change.part,
    description: '这个内置段落在新版本里已经不存在，保存时会去掉这里的覆盖。', roles: [], defaultChanged: { removed: true } }))
  return [...team, ...skills, ...parts, ...gone]
}

export async function buildPrompts(upstream: Pick<UpstreamClient, 'prompts'>, revision: number | undefined, connection: () => Connection): Promise<PromptsView> {
  const view = await upstream.prompts(revision)
  return {
    connection: connection(),
    revision: view.current.revision, current: view.revision, savedAt: view.current.savedAt, origin: ORIGIN[view.current.source] ?? view.current.source,
    config: view.current.config,
    parts: promptParts(view),
    sessions: view.sessions,
    history: view.revisions.map(item => ({ revision: item.revision, savedAt: item.savedAt, origin: ORIGIN[item.source] ?? item.source, changed: item.changed.map(partTitle) })),
  }
}

export function previewView(preview: UpstreamPreview, overrides: Record<string, unknown> = {}): PromptPreview {
  const role = (parts: UpstreamPreview['parts']['worker']) => parts.map(part => ({
    name: part.name, title: part.kind === 'team' ? partTitle(part.name) : partTitle(part.key ?? part.name), kind: part.kind,
    overridden: part.kind === 'fixed' && !!part.key && part.key in overrides, text: part.text,
  }))
  return { roles: { orchestrator: role(preview.parts.orchestrator), worker: role(preview.parts.worker) },
    note: 'worker 还会读 DSH 自带的编码提示词和仓库里的 AGENTS.md。提示词只改变 agent 被告知的内容，不改变它被允许做的事：工具权限、准入和账号限制都还在。' }
}
