/**
 * Where the agent listens and how it works: each Source's receiving settings and account fields, and the executor's capacity,
 * directory, prepare command and models. An account change goes through setup's check and restarts dsh-superagent, so it
 * has a route of its own.
 */
import type { Connection, ExecutionView, ExecutorSettings, FeishuSettings, GithubSettings, MainModelSwitch, ModelChoice, SourceAccountSave, SourceSave, SourceSettings, SourcesView } from '@dsh-superagent-ui/contract'
import type { UpstreamClient } from '../upstream/client.ts'
import type { ExecutorConfig, SettingsView, SourceStatus, StateView } from '../upstream/types.ts'
import { local, t } from '../i18n.ts'
import { DraftError } from './policy.ts'
import { modelLabel } from './companion.ts'
import { setupText } from './reasons.ts'

const zh = local
const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback

function github(config: Record<string, unknown>): GithubSettings {
  return { repository: String(config.repository ?? ''), observeIssues: bool(config.observeIssues, false), observePulls: bool(config.observePulls, false),
    observeComments: bool(config.observeComments, false), observeCi: bool(config.observeCi, false), pollSeconds: typeof config.pollSeconds === 'number' ? config.pollSeconds : 60 }
}
function feishu(config: Record<string, unknown>): FeishuSettings {
  const chats = Array.isArray(config.chats) ? config.chats as FeishuSettings['chats'] : []
  return { chats, directMessages: bool(config.directMessages, true), otherChats: config.otherChats === 'mentions' ? 'mentions' : 'none' }
}

type Reads = Pick<UpstreamClient, 'settings' | 'sources' | 'state'>
export async function buildSources(upstream: Reads, connection: () => Connection): Promise<SourcesView> {
  const [settings, status, state] = await Promise.all([upstream.settings(), upstream.sources(), upstream.state()])
  return { connection: connection(), sources: settings.sources.map(source => sourceSettings(source, status, state)),
    setupPending: !!(state.setup.problem || state.setup.feishuProblem) }
}

function sourceSettings(source: SettingsView['sources'][number], status: SourceStatus[], state: StateView): SourceSettings {
  const live = status.find(item => item.id === source.id)
  const accounts = state.setup.accounts
  const facts = source.kind === 'github' ? [{ label: t('Repository', '仓库'), value: accounts?.repository ?? String(source.value.config.repository ?? '') }, ...accounts ? [{ label: t('Agent account', 'agent 账号'), value: accounts.agent }] : []]
    : source.kind === 'feishu' && accounts?.feishu ? [{ label: t('Bot', '机器人'), value: accounts.feishu.name }, { label: t('Brand', '品牌'), value: accounts.feishu.brand === 'lark' ? 'Lark' : t('Feishu', '飞书') }] : []
  return {
    id: source.id, title: zh(source.title), enabled: source.value.enabled, revision: source.revision,
    ...live ? { state: live.state, ...live.problem ? { problem: setupText(live.problem) } : {} } : {},
    facts: facts.filter(fact => fact.value),
    account: { ...source.kind === 'github' ? { repository: String(source.value.config.repository ?? '') } : {}, cli: String(source.value.config.cli ?? '') },
    ...source.kind === 'feishu' ? { joined: Object.entries(source.labels ?? {}).map(([chatId, name]) => ({ chatId, name })).sort((a, b) => a.name.localeCompare(b.name)) } : {},
    ...source.kind === 'github' ? { github: github(source.value.config) } : {},
    ...source.kind === 'feishu' ? { feishu: feishu(source.value.config) } : {},
  }
}

const CHAT = /^oc_[a-zA-Z0-9]+$/
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
/**
 * The stored config with new account fields. The checks are the ones upstream's schema makes first (a command name or an
 * absolute path, `owner/name`); whether the CLI works and may push is setup's check, which runs on save.
 */
export function mergeAccount(kind: string, stored: Record<string, unknown>, save: SourceAccountSave): Record<string, unknown> {
  const cli = save.cli.trim()
  if (!cli) throw new DraftError(kind === 'github' ? t("Fill in the agent's GitHub CLI", '填上 agent 的 GitHub CLI') : t("Fill in the bot's lark-cli", '填上机器人的 lark-cli'))
  if (cli.includes('/') && !cli.startsWith('/')) throw new DraftError(t('The CLI must be a command name or an absolute path, such as /Users/me/.local/bin/gh-agent', 'CLI 要写命令名或绝对路径，例如 /Users/me/.local/bin/gh-agent'))
  if (kind !== 'github') return { ...stored, cli }
  const repository = (save.repository ?? '').trim()
  if (!REPOSITORY.test(repository)) throw new DraftError(t('Write the repository as owner/name', '仓库要写成 owner/name'))
  return { ...stored, repository, cli }
}
/** The stored config with the console's fields changed and everything else, accounts included, as it was. */
export function mergeSource(kind: string, stored: Record<string, unknown>, save: SourceSave): Record<string, unknown> {
  if (kind === 'github' && save.github) {
    const { observeIssues, observePulls, observeComments, observeCi, pollSeconds } = save.github
    if (pollSeconds !== undefined && (!Number.isInteger(pollSeconds) || pollSeconds < 60 || pollSeconds > 3600)) throw new DraftError(t('The poll interval must be between 60 and 3600 seconds', '轮询间隔要在 60 到 3600 秒之间'))
    return { ...stored, ...observeIssues === undefined ? {} : { observeIssues }, ...observePulls === undefined ? {} : { observePulls },
      ...observeComments === undefined ? {} : { observeComments }, ...observeCi === undefined ? {} : { observeCi }, ...pollSeconds === undefined ? {} : { pollSeconds } }
  }
  if (kind === 'feishu' && save.feishu) {
    const { chats, directMessages, otherChats } = save.feishu
    if (chats) {
      const ids = new Set<string>()
      for (const chat of chats) {
        if (!CHAT.test(chat.chatId)) throw new DraftError(t(`Group id "${chat.chatId}" should start with oc_`, `群 id「${chat.chatId}」应该是 oc_ 开头`))
        if (ids.has(chat.chatId)) throw new DraftError(t(`Group "${chat.name || chat.chatId}" is listed twice`, `群「${chat.name || chat.chatId}」重复了`))
        ids.add(chat.chatId)
      }
    }
    return { ...stored, ...chats ? { chats: chats.map(chat => ({ chatId: chat.chatId, ...chat.name ? { name: chat.name } : {}, listen: chat.listen })) } : {},
      ...directMessages === undefined ? {} : { directMessages }, ...otherChats === undefined ? {} : { otherChats } }
  }
  return stored
}

const model = (value: ExecutorConfig['model']): ModelChoice | null => value ? { provider: value.provider, model: value.model, ...value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {} } : null

export async function buildExecution(upstream: Pick<UpstreamClient, 'settings' | 'models' | 'state' | 'transcript' | 'companionInfo'>, connection: () => Connection): Promise<ExecutionView> {
  const [settings, catalog, state, companion] = await Promise.all([upstream.settings(), upstream.models().catch(() => null), upstream.state().catch(() => null), upstream.companionInfo().catch(() => null)])
  // The main Session keeps its model until it is switched; its own log says which one it uses.
  const main = state?.masterId ? await upstream.transcript(state.masterId, undefined, 1).catch(() => null) : null
  const executor = settings.blocks.executor.value
  const evaluation = settings.blocks.eval.value
  return {
    connection: connection(),
    executor: { maxWorkers: executor.maxWorkers, directory: executor.directory, prepare: executor.prepare, blockedCommands: executor.blockedCommands,
      model: model(executor.model), revision: settings.blocks.executor.revision, root: settings.environment?.root ?? '' },
    eval: { timeoutSeconds: evaluation.timeoutSeconds, model: model(evaluation.model), revision: settings.blocks.eval.revision },
    models: catalog ? { default: catalog.default, groups: catalog.groups.map(group => ({ id: group.id, name: group.name, models: group.models.map(item => ({ id: item.id, name: item.name })) })) } : null,
    variables: (settings.environment?.variables ?? []).filter(group => group.enabled).flatMap(group => group.variables.map(variable => ({ key: variable.key, description: zh(variable.description), owner: group.owner }))),
    mainModel: main?.model ? modelLabel(main.model) : null,
    mainModelNext: main?.next ? modelLabel(main.next) : null,
    canSwitchMainModel: !!companion?.capabilities.includes('main-model'),
    machine: state?.setup.machine ?? null,
  }
}

/**
 * Switches the running main Session to `model`, or to the profile's default model when null. Upstream only sets the model of a
 * new main Session, so saving its setting does not reach this one. A failure is reported, not thrown: the setting is saved by
 * then, and the companion is optional.
 */
export async function switchMainModel(upstream: Pick<UpstreamClient, 'companionInfo' | 'switchMainModel'>, model: ModelChoice | null): Promise<MainModelSwitch> {
  try {
    const companion = await upstream.companionInfo()
    if (!companion?.capabilities.includes('main-model')) return { result: 'unsupported' }
    const switched = await upstream.switchMainModel(model)
    return switched ? { result: 'switched', model: modelLabel(switched.model) } : { result: 'unsupported' }
  } catch (error) { return { result: 'failed', error: error instanceof Error ? error.message : String(error) } }
}

const COMMAND = /^[A-Za-z0-9._-]+$/
export function checkExecutor(value: ExecutorSettings): ExecutorSettings {
  if (!Number.isInteger(value.maxWorkers) || value.maxWorkers < 1) throw new DraftError(t('Concurrency must be a positive whole number', '并发要是正整数'))
  if (value.directory && !value.directory.startsWith('/')) throw new DraftError(t('The directory must be an absolute path; leave it empty to use work under the state directory', '目录要写绝对路径，留空则用状态目录下的 work'))
  for (const command of value.blockedCommands) if (!COMMAND.test(command) || command === '.' || command === '..') throw new DraftError(t(`"${command}" is not a command name`, `「${command}」不是命令名`))
  if (value.model && (!value.model.provider || !value.model.model)) throw new DraftError(t('Pick both a provider and a model, or leave it empty for the default', '模型要同时选 provider 和模型，或者留空用默认'))
  return value
}
