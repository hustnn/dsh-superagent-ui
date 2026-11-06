/**
 * Recipes: what a team wants the agent to do, set up across the blocks that make it happen. Upstream spreads one scenario
 * over a Source's receiving settings, the Policy's admission table, bot list and rules, and the team prompts; a recipe plans
 * all of it, says it in sentences before anything is saved, and leaves the accept mode alone, so proactive rules start out
 * only observed.
 */
import type { Connection, Recipe, RecipesView } from '@dsh-superagent-ui/contract'
import type { UpstreamClient } from '../upstream/client.ts'
import type { PolicyConfig, PromptConfig, PromptsView, Rule, SettingsView } from '../upstream/types.ts'
import { DraftError } from './policy.ts'

interface Context { settings: SettingsView; prompts: PromptsView }
export interface Plan {
  changes: string[]
  source?: { id: string; config: Record<string, unknown> }
  policy?: PolicyConfig
  prompts?: PromptConfig
}

/** A plan being built: each step records a sentence only when it actually changes something. */
class Planner {
  readonly changes: string[] = []
  readonly #context: Context
  #source: { id: string; config: Record<string, unknown> } | undefined
  #policy: PolicyConfig | undefined
  #prompts: PromptConfig | undefined
  constructor(context: Context) { this.#context = context }

  sourceConfig(id: string): Record<string, unknown> {
    if (this.#source?.id !== id) {
      const source = this.#context.settings.sources.find(item => item.id === id)
      if (!source) throw new DraftError(`没有配置来源 ${id}`)
      this.#source = { id, config: structuredClone(source.value.config) }
    }
    return this.#source.config
  }
  setSource(id: string, field: string, value: unknown, sentence: string): void {
    const config = this.sourceConfig(id)
    if (JSON.stringify(config[field]) === JSON.stringify(value)) return
    config[field] = value
    this.changes.push(sentence)
  }
  policy(): PolicyConfig { return this.#policy ??= structuredClone(this.#context.settings.blocks.policy.value) }
  admission(source: string, row: string, cell: 'listedUnaddressed' | 'unlistedAddressed' | 'unlistedUnaddressed', value: 'explicit' | 'inferred' | 'ignore', sentence: string): void {
    const part = this.policy().sources[source] ??= { allowed: [], admission: {} }
    if (part.admission[row]?.[cell] === value) return
    part.admission[row] = { ...part.admission[row], [cell]: value }
    this.changes.push(sentence)
  }
  bot(source: string, id: string): void {
    const part = this.policy().sources[source] ??= { allowed: [], admission: {} }
    if ((part.bots ?? []).some(bot => bot.id === id)) return
    part.bots = [...part.bots ?? [], { id }]
    this.changes.push(`把 ${id} 加进 bot 列表`)
  }
  rule(rule: Rule): void {
    const rules = this.policy().rules
    const existing = rules.find(item => item.id === rule.id)
    if (!existing) { rules.push(rule); this.changes.push(`新增规则「${rule.name}」并启用`); return }
    if (!existing.enabled) { existing.enabled = true; this.changes.push(`启用规则「${existing.name}」`) }
  }
  promptsConfig(): PromptConfig { return this.#prompts ??= structuredClone(this.#context.prompts.current.config) }
  appendTeam(section: 'communication' | 'scope' | 'delivery', line: string, sentence: string): void {
    const config = this.promptsConfig()
    if (config[section].includes(line)) return
    config[section] = config[section] ? `${config[section].trimEnd()}\n${line}` : line
    this.changes.push(sentence)
  }
  skill(name: string, text: string, sentence: string): void {
    const config = this.promptsConfig()
    if (config.skills[name] !== undefined) return
    config.skills = { ...config.skills, [name]: text }
    this.changes.push(sentence)
  }
  plan(): Plan {
    return { changes: this.changes, ...this.#source ? { source: this.#source } : {}, ...this.#policy ? { policy: this.#policy } : {}, ...this.#prompts ? { prompts: this.#prompts } : {} }
  }
}

interface Definition {
  id: string
  name: string
  description: string
  needsChat: boolean
  plan(planner: Planner, chat?: { id: string; name: string }): void
}

const DEFINITIONS: Definition[] = [
  { id: 'silent-fix', name: '静默复现修复', needsChat: true,
    description: '群里有人报问题时，它先在后台复现；确认问题、找到简单修复才发言，否则全程安静。',
    plan(p, chat) {
      const chats = (p.sourceConfig('feishu').chats as { chatId: string; name?: string; listen: string }[] | undefined) ?? []
      p.setSource('feishu', 'chats', chats.map(item => item.chatId === chat!.id ? { ...item, listen: 'all' } : item), `飞书群「${chat!.name}」改为接收全部消息`)
      p.admission('feishu', chat!.id, 'listedUnaddressed', 'inferred', `「${chat!.name}」里名单内的人没 @ 它的消息作为推断候选`)
      p.admission('feishu', chat!.id, 'unlistedUnaddressed', 'inferred', `「${chat!.name}」里名单外的人没 @ 它的消息作为推断候选`)
      p.rule({ id: 'silent-fix', name: '静默复现修复', enabled: true,
        instruction: 'When someone in a chat reports a defect that can be reproduced, reproduce it in the background first. Speak only once the problem is confirmed and a small fix is ready; otherwise say nothing.' })
      p.appendTeam('communication', 'Under the silent-fix rule, post no acknowledgement or progress; reply once, with the confirmed reproduction and the fix.', '沟通规范加一句：命中“静默复现修复”时不发确认，只在有结果时回复一次')
    } },
  { id: 'support-chat', name: '支持群', needsChat: true,
    description: '让某个群里任何人都能 @ 它提需求，适合专门的答疑或支持群。',
    plan(p, chat) {
      const chats = (p.sourceConfig('feishu').chats as { chatId: string }[] | undefined) ?? []
      if (!chats.some(item => item.chatId === chat!.id)) throw new DraftError(`先在来源里加上「${chat!.name}」`)
      p.admission('feishu', chat!.id, 'unlistedAddressed', 'explicit', `「${chat!.name}」里名单外的人 @ 它也算明确请求`)
    } },
  { id: 'deps', name: '依赖升级跟进', needsChat: false,
    description: '依赖机器人的 PR 检查失败时，它去修，推到同一个分支。',
    plan(p) {
      p.setSource('github', 'observePulls', true, 'GitHub 接收仓库里所有新 PR')
      p.bot('github', 'dependabot[bot]')
      p.rule({ id: 'deps-follow-up', name: '依赖升级跟进', enabled: true,
        instruction: 'When a dependency bot\'s pull request fails its checks, fix the failure and push to the same branch. Do not change versions the bot did not change.' })
    } },
  { id: 'triage', name: '新 issue 分诊', needsChat: false,
    description: '新 issue 缺少复现信息时，它补上标签，只问一个具体问题。',
    plan(p) {
      p.setSource('github', 'observeIssues', true, 'GitHub 接收仓库里所有新 Issue')
      p.admission('github', 'issues', 'unlistedUnaddressed', 'inferred', '新 Issue 里名单外的人没 @ 它的也作为推断候选')
      p.rule({ id: 'issue-triage', name: '新 issue 分诊', enabled: true,
        instruction: 'When a new issue lacks what is needed to reproduce it, add the triage label and ask exactly one concrete question. Do not start a fix.' })
    } },
  { id: 'identities', name: '跨平台身份', needsChat: false,
    description: '告诉它哪个飞书用户是哪个 GitHub 账号，同一个人在两边提起同一件事时它能认出来。',
    plan(p) {
      const members = p.policy().sources.feishu?.allowed ?? []
      const lines = members.length ? members.map(member => `- ${member.name || member.id} (${member.id}) is GitHub @<login>`) : ['- <飞书名字> (ou_xxx) is GitHub @<login>']
      p.skill('identities', ['---', 'name: identities', 'description: Which Feishu user is which GitHub account.', '---', ...lines].join('\n'),
        '新增团队 skill「identities」，按飞书名单列好，GitHub 账号留给你填')
    } },
]

const chatsOf = (settings: SettingsView) => {
  const feishu = settings.sources.find(source => source.kind === 'feishu')
  const chats = (feishu?.value.config.chats as { chatId: string; name?: string }[] | undefined) ?? []
  return chats.map(chat => ({ id: chat.chatId, name: chat.name || chat.chatId }))
}

export function planRecipe(id: string, context: Context, chatId?: string): Plan {
  const definition = DEFINITIONS.find(item => item.id === id)
  if (!definition) throw new DraftError(`没有配方 ${id}`)
  const chat = definition.needsChat ? chatsOf(context.settings).find(item => item.id === chatId) : undefined
  if (definition.needsChat && !chat) throw new DraftError('先选一个飞书群')
  const planner = new Planner(context)
  definition.plan(planner, chat)
  return planner.plan()
}

async function contextOf(upstream: Pick<UpstreamClient, 'settings' | 'prompts'>): Promise<Context> {
  const [settings, prompts] = await Promise.all([upstream.settings(), upstream.prompts()])
  return { settings, prompts }
}

export async function buildRecipes(upstream: Pick<UpstreamClient, 'settings' | 'prompts'>, connection: () => Connection): Promise<RecipesView> {
  const context = await contextOf(upstream)
  const chats = chatsOf(context.settings)
  const hasSource = (id: string) => context.settings.sources.some(source => source.id === id)
  const recipes = DEFINITIONS.filter(item => item.id === 'deps' || item.id === 'triage' ? hasSource('github') : hasSource('feishu')).map((definition): Recipe => {
    const applied = (chat?: string) => { try { return planRecipe(definition.id, context, chat).changes.length === 0 } catch { return false } }
    return { id: definition.id, name: definition.name, description: definition.description, needsChat: definition.needsChat,
      ...definition.needsChat ? { chats, applied: chats.filter(chat => applied(chat.id)).map(chat => chat.id) } : { applied: applied() } }
  })
  return { connection: connection(), recipes }
}

export async function previewRecipe(upstream: Pick<UpstreamClient, 'settings' | 'prompts'>, id: string, chat?: string): Promise<{ changes: string[] }> {
  return { changes: planRecipe(id, await contextOf(upstream), chat).changes }
}

/** Saves the plan block by block, each on the revision it was read at: the Source, then the Policy, then the prompts. */
export async function applyRecipe(upstream: Pick<UpstreamClient, 'settings' | 'prompts' | 'saveSettings' | 'savePrompts'>, id: string, chat?: string): Promise<{ changes: string[] }> {
  const context = await contextOf(upstream)
  const plan = planRecipe(id, context, chat)
  if (plan.source) {
    const source = context.settings.sources.find(item => item.id === plan.source!.id)!
    await upstream.saveSettings(`source:${source.id}`, { enabled: source.value.enabled, config: plan.source.config }, source.revision)
  }
  if (plan.policy) await upstream.saveSettings('policy', plan.policy, context.settings.blocks.policy.revision)
  if (plan.prompts) await upstream.savePrompts(plan.prompts, context.prompts.current.revision)
  return { changes: plan.changes }
}
