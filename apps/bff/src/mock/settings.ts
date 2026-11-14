/**
 * The mock's settings, Policy history and proactive judgements, in upstream's shapes. Saves check the block's revision and
 * answer 409 when it moved, as upstream does; each save adds a history entry and, when it touches authorization, a new
 * Policy version.
 */
import { createHash } from 'node:crypto'
import type { AcceptMode, AdmissionRowView, DecisionView, EvalConfig, ExecutorConfig, HistoryView, PolicyConfig, SettingsChange, SettingsView } from '../upstream/types.ts'
import type { Snapshot } from '../snapshots.ts'
import { REPO } from './fixtures.ts'

/** The version every mock Ticket was accepted under. */
export const MANDATE_VERSION = 'p7c1e93a2b4d'

export interface MockSettings {
  policy: PolicyConfig
  eval: EvalConfig
  executor: ExecutorConfig
  github: { repository: string; observeIssues: boolean; observePulls: boolean; observeComments: boolean; observeCi: boolean; cli: string; pollSeconds: number }
  feishu: { chats: { chatId: string; name: string; listen: 'mentions' | 'all' }[]; otherChats: 'mentions' | 'none'; directMessages: boolean; cli: string }
  /** Every chat the Feishu bot has joined, by id: upstream keeps them as the Source's labels. */
  joined: Record<string, string>
  revisions: Record<string, number>
  history: HistoryView['items']
  current: number
}

const RULES = [
  { id: 'silent', name: 'Silent reproduce-and-fix', enabled: true, instruction: 'When someone in a group reports a reproducible defect, reproduce it in the background first; reply only after confirming it and finding a simple fix, otherwise stay quiet.' },
  { id: 'triage', name: 'New issue triage', enabled: true, instruction: 'When a new issue lacks reproduction details, add the triage label and ask exactly one concrete question.' },
  { id: 'deps', name: 'Dependency upgrade follow-up', enabled: true, instruction: "When a dependency bot's PR fails its checks, fix the failure and push to the same branch." },
]

export function seedSettings(now: number): MockSettings {
  const day = (days: number) => new Date(now - days * 86_400_000).toISOString()
  return {
    policy: {
      rules: RULES.map(rule => ({ ...rule })),
      sources: {
        github: { allowed: [{ id: 'alice' }, { id: 'carol' }], admission: { issues: { unlistedUnaddressed: 'inferred' } }, bots: [{ id: 'dependabot[bot]' }] },
        feishu: { allowed: [{ id: 'ou_dana', name: 'Dana' }, { id: 'ou_leo', name: 'Leo' }, { id: 'ou_lin', name: 'Lin' }],
          admission: { oc_harness_users: { unlistedUnaddressed: 'inferred' } }, bots: [], syncChat: 'oc_harness_dev' },
      },
    },
    eval: { mode: 'observe', timeoutSeconds: 120, model: null },
    executor: { model: null, maxWorkers: 3, directory: '',
      prepare: 'git -C ~/src/harness-app fetch origin\ngit -C ~/src/harness-app worktree add "$DSH_SUPERAGENT_DIR" -b "agent/$DSH_SUPERAGENT_NAME" origin/main', blockedCommands: ['sudo', 'ssh'] },
    github: { repository: REPO, observeIssues: true, observePulls: false, observeComments: false, observeCi: false, cli: '/Users/operator/.local/bin/gh-agent', pollSeconds: 60 } as MockSettings['github'],
    feishu: { chats: [{ chatId: 'oc_harness_dev', name: 'harness-dev', listen: 'mentions' }, { chatId: 'oc_harness_users', name: 'harness-users', listen: 'all' }],
      otherChats: 'mentions', directMessages: true, cli: '/Users/operator/.local/bin/lark-bot' },
    joined: { oc_harness_dev: 'harness-dev', oc_harness_users: 'harness-users', oc_harness_release: 'harness-release' },
    revisions: { policy: 3, eval: 1, executor: 1, 'source:github': 1, 'source:feishu': 1 },
    current: 5,
    history: [
      { revision: 5, savedAt: day(1), source: 'panel', block: 'policy', policyVersion: MANDATE_VERSION, policyChanged: true, notified: [],
        changes: [{ code: 'ruleAdded', name: 'Dependency upgrade follow-up' }, { code: 'sourceRowsAdded', source: 'github', field: 'bots', items: ['dependabot[bot]'], part: true }] },
      { revision: 4, savedAt: day(3), source: 'sync', block: 'policy', policyVersion: 'p51d0aa9c3e7', policyChanged: true, notified: [],
        changes: [{ code: 'sourceRowsAdded', source: 'feishu', field: 'allowed', items: ['Lin'], part: true }] },
      { revision: 3, savedAt: day(5), source: 'tool', block: 'eval', policyVersion: 'p0be44f2d918', policyChanged: true, notified: [],
        changes: [{ code: 'mode', from: 'off', to: 'observe' }] },
    ],
  }
}

/** Upstream's `policyVersion`: a hash of the rules, the accept mode and the Sources' Policy parts. */
export const versionOf = (settings: MockSettings) =>
  'p' + createHash('sha256').update(JSON.stringify({ rules: settings.policy.rules, mode: settings.eval.mode, sources: settings.policy.sources })).digest('hex').slice(0, 11)

/** Upstream's bilingual text: `{ zh, en }`. */
const both = (en: string, zh = en) => ({ zh, en })
const ALL = both('All', '全部'), MENTIONS = both('@ only', '仅 @'), RECEIVED = both('Received', '接收'), IGNORED = both('Ignored', '不接收')
function githubRows(config: MockSettings['github']): AdmissionRowView[] {
  const row = (id: string, label: [string, string], observed: boolean) => ({ id, label: both(...label), note: observed ? ALL : MENTIONS,
    cells: { listedUnaddressed: observed, unlistedAddressed: true, unlistedUnaddressed: observed } })
  return [row('issues', ['New Issues', '新 Issue'], config.observeIssues), row('pulls', ['New PRs', '新 PR'], config.observePulls), row('comments', ['Comments', '评论'], config.observeComments),
    { id: 'ci', label: both('CI on the default branch', '默认分支的 CI'), note: config.observeCi ? RECEIVED : IGNORED, cells: { listedUnaddressed: false, unlistedAddressed: false, unlistedUnaddressed: config.observeCi } }]
}
function feishuRows(config: MockSettings['feishu']): AdmissionRowView[] {
  return [
    ...config.chats.map(chat => ({ id: chat.chatId, label: chat.name, note: chat.listen === 'all' ? both('All messages', '全部消息') : MENTIONS,
      cells: { listedUnaddressed: chat.listen === 'all', unlistedAddressed: true, unlistedUnaddressed: chat.listen === 'all' } })),
    { id: 'other', label: both('Other groups', '其他群'), note: config.otherChats === 'mentions' ? MENTIONS : IGNORED,
      cells: { listedUnaddressed: false, unlistedAddressed: config.otherChats === 'mentions', unlistedUnaddressed: false } },
    { id: 'direct', label: both('Direct messages', '私聊'), note: config.directMessages ? RECEIVED : IGNORED,
      cells: { listedUnaddressed: false, unlistedAddressed: config.directMessages, unlistedUnaddressed: false } },
  ]
}

export function settingsView(settings: MockSettings, version: string): SettingsView {
  const rows = { type: 'rows' }
  return {
    policyVersion: version,
    blocks: {
      policy: { value: settings.policy, revision: settings.revisions.policy! },
      eval: { value: settings.eval, revision: settings.revisions.eval! },
      executor: { value: settings.executor, revision: settings.revisions.executor! },
    },
    sources: [
      { id: 'github', kind: 'github', title: both('GitHub'), installed: true, value: { enabled: true, config: settings.github }, revision: settings.revisions['source:github']!, fields: [], labels: {},
        policy: { fields: [{ key: 'allowed', ...rows, label: both('Allow list', '名单') }, { key: 'bots', ...rows, label: both('Bot list', 'bot 列表') }],
          explicit: both('An account on the list @ the agent account in an Issue or comment.', '名单里的账号在 Issue 或评论里 @ 智能体的账号。'), rows: githubRows(settings.github) } },
      { id: 'feishu', kind: 'feishu', title: both('Feishu', '飞书'), installed: true, value: { enabled: true, config: settings.feishu }, revision: settings.revisions['source:feishu']!, fields: [], labels: { ...settings.joined },
        policy: { fields: [{ key: 'allowed', ...rows, label: both('Allow list', '名单') }, { key: 'syncChat', type: 'choose', label: both('Allow-list sync group', '同步名单的群') }, { key: 'bots', ...rows, label: both('Bot list', 'bot 列表') }],
          explicit: both('Someone on the list who @ the bot or messages it directly is always an explicit request; nothing to configure.', '名单内的人 @ 机器人或私聊机器人，总是明确的请求，不需要配置。'), rows: feishuRows(settings.feishu),
          sync: { label: both('Sync now', '立即同步'), ready: !!settings.policy.sources.feishu?.syncChat, health: { state: 'ready', detail: 'Synced 23 members' } } } },
    ],
    environment: { root: '~/.dsh/state/superagent/work', variables: [
      { owner: 'executor', enabled: true, variables: [{ key: 'DSH_SUPERAGENT_DIR', description: both("The Ticket's directory", 'Ticket 的目录') }, { key: 'DSH_SUPERAGENT_NAME', description: both("The Ticket's short name, also the last part of the branch name", 'Ticket 的短名，也是分支名的最后一段') },
        { key: 'DSH_SUPERAGENT_TICKET', description: both("The Ticket's id", 'Ticket 的 id') }, { key: 'DSH_SUPERAGENT_BLOCKED_COMMANDS', description: both('Commands workers may not run', '不让 worker 运行的命令') }] },
      { owner: 'github', enabled: true, variables: [{ key: 'DSH_SUPERAGENT_GITHUB_REPOSITORY', description: both('The watched repository, owner/name', '监听的仓库，owner/name') },
        { key: 'DSH_SUPERAGENT_GITHUB_ACCOUNT', description: both('The agent account', 'agent 账号') }, { key: 'DSH_SUPERAGENT_GITHUB_NUMBER', description: both('Number of the Issue or PR the Ticket started from', 'Ticket 起点的 Issue 或 PR 编号') },
        { key: 'DSH_SUPERAGENT_GITHUB_PR_HEAD', description: both('Its head, when the Ticket started from a PR', '起点是 PR 时它的 head') }] },
      { owner: 'feishu', enabled: true, variables: [{ key: 'DSH_SUPERAGENT_FEISHU_CHAT', description: both('The group the Ticket started in', 'Ticket 起点所在的群') }] },
    ] },
  }
}

/** Upstream's `settingsChanges`, for the parts the mock lets the console change. */
function changesOf(before: MockSettings, after: Pick<MockSettings, 'policy' | 'eval'>): SettingsChange[] {
  const changes: SettingsChange[] = []
  for (const rule of after.policy.rules) {
    const old = before.policy.rules.find(item => item.id === rule.id)
    if (!old) { changes.push({ code: 'ruleAdded', name: rule.name }); continue }
    if (old.name !== rule.name) changes.push({ code: 'ruleRenamed', from: old.name, to: rule.name })
    if (old.instruction !== rule.instruction) changes.push({ code: 'ruleInstruction', name: rule.name })
    if (old.enabled !== rule.enabled) changes.push({ code: rule.enabled ? 'ruleEnabled' : 'ruleDisabled', name: rule.name })
  }
  for (const rule of before.policy.rules) if (!after.policy.rules.some(item => item.id === rule.id)) changes.push({ code: 'ruleRemoved', name: rule.name })
  for (const id of Object.keys(after.policy.sources)) {
    const a = before.policy.sources[id], b = after.policy.sources[id]
    for (const field of ['allowed', 'bots'] as const) {
      const names = (list: unknown) => new Map(((list as { id: string; name?: string }[] | undefined) ?? []).map(entry => [entry.id, entry.name || entry.id]))
      const from = names(a?.[field]), to = names(b?.[field])
      const added = [...to.keys()].filter(key => !from.has(key)).map(key => to.get(key)!), removed = [...from.keys()].filter(key => !to.has(key)).map(key => from.get(key)!)
      if (added.length) changes.push({ code: 'sourceRowsAdded', source: id, field, items: added, part: true })
      if (removed.length) changes.push({ code: 'sourceRowsRemoved', source: id, field, items: removed, part: true })
    }
    if (JSON.stringify(a?.admission ?? {}) !== JSON.stringify(b?.admission ?? {})) changes.push({ code: 'sourceAdmission', source: id, part: true })
  }
  if (before.eval.mode !== after.eval.mode) changes.push({ code: 'mode', from: before.eval.mode, to: after.eval.mode })
  return changes
}

export class SaveRefused extends Error {
  readonly status: number
  /** More of the refusal's body, such as a failed account check's `setup` problem. */
  readonly extra: Record<string, unknown>
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) { super(message); this.status = status; this.extra = extra }
}

/**
 * Setup's account check on a Source save (`checkAccounts` upstream): a CLI whose path names `missing` is not there. A
 * failed check saves nothing; a passing account change restarts dsh-superagent.
 */
function checkAccount(id: 'github' | 'feishu', config: Record<string, unknown>): void {
  const cli = String(config.cli ?? '')
  if (!cli.includes('missing')) return
  const code = id === 'github' ? 'agentCliMissing' : 'feishuCliFailed'
  const detail = id === 'github' ? 'The agent GitHub CLI was not found.' : 'The bot lark-cli does not work.'
  throw new SaveRefused(400, `${detail}\n${cli} is not an executable file`, { setup: { place: id, code, values: { output: `${cli} is not an executable file` }, detail } })
}

/** `PUT settings/:block` for the blocks the console saves. */
export function saveBlock(settings: MockSettings, block: string, body: unknown, source: 'panel' | 'sync' = 'panel'): { revision: number; restarting: boolean } {
  const { value, revision } = (body ?? {}) as { value?: unknown; revision?: unknown }
  if (revision !== settings.revisions[block]) throw new SaveRefused(409, 'Settings changed. Reload before saving.')
  if (block === 'executor' || block.startsWith('source:')) return saveOther(settings, block, value, source)
  if (block !== 'policy' && block !== 'eval') throw new SaveRefused(400, `The mock does not save ${block}`)
  const next = { policy: settings.policy, eval: settings.eval }
  if (block === 'policy') {
    const policy = value as PolicyConfig
    if (!Array.isArray(policy?.rules) || typeof policy.sources !== 'object') throw new SaveRefused(400, 'Invalid settings: rules, sources')
    next.policy = policy
  } else {
    const mode = (value as { mode?: AcceptMode } | null)?.mode
    if (!mode || !['off', 'observe', 'auto'].includes(mode)) throw new SaveRefused(400, 'Invalid settings: mode')
    next.eval = { ...settings.eval, ...(value as EvalConfig) }
  }
  const beforeVersion = versionOf(settings)
  const changes = changesOf(settings, next)
  settings.policy = next.policy
  settings.eval = next.eval
  settings.revisions[block] = settings.revisions[block]! + 1
  settings.current += 1
  const version = versionOf(settings)
  settings.history.unshift({ revision: settings.current, savedAt: new Date().toISOString(), source, block, policyVersion: version,
    policyChanged: version !== beforeVersion, notified: [], changes })
  return { revision: settings.revisions[block]!, restarting: false }
}

/** Saves the executor block or a Source's block, with their history entries. */
function saveOther(settings: MockSettings, block: string, value: unknown, source: 'panel' | 'sync'): { revision: number; restarting: boolean } {
  const changes: SettingsChange[] = []
  let restarting = false
  if (block === 'executor') {
    const next = value as ExecutorConfig
    if (!Number.isInteger(next?.maxWorkers) || next.maxWorkers < 1) throw new SaveRefused(400, 'Invalid settings: maxWorkers')
    const before = settings.executor
    if (before.maxWorkers !== next.maxWorkers) changes.push({ code: 'maxWorkers', from: before.maxWorkers, to: next.maxWorkers })
    if (before.prepare !== next.prepare) changes.push({ code: 'prepareCommand' })
    if (before.directory !== next.directory) changes.push({ code: 'executionDirectory', from: before.directory, to: next.directory })
    if (JSON.stringify(before.blockedCommands) !== JSON.stringify(next.blockedCommands)) changes.push({ code: 'blockedCommands' })
    if (JSON.stringify(before.model) !== JSON.stringify(next.model)) changes.push({ code: 'executorModel' })
    settings.executor = { ...before, ...next }
  } else {
    const id = block.slice('source:'.length) as 'github' | 'feishu'
    const next = value as { enabled?: boolean; config?: Record<string, unknown> }
    if (typeof next?.enabled !== 'boolean' || typeof next.config !== 'object') throw new SaveRefused(400, 'Invalid settings: enabled, config')
    const before = settings[id] as unknown as Record<string, unknown>
    const accounts = ['repository', 'cli'].filter(field => field in next.config! && next.config![field] !== before[field])
    if (accounts.length) { checkAccount(id, next.config); restarting = true }
    for (const field of Object.keys(next.config)) if (JSON.stringify(before[field]) !== JSON.stringify(next.config[field]))
      changes.push(Array.isArray(next.config[field]) ? { code: 'sourceRowsChanged', source: id, field } : { code: 'sourceField', source: id, field })
    Object.assign(settings[id], next.config)
  }
  settings.revisions[block] = (settings.revisions[block] ?? 0) + 1
  settings.current += 1
  settings.history.unshift({ revision: settings.current, savedAt: new Date().toISOString(), source, block, policyVersion: versionOf(settings), policyChanged: false, notified: [], changes })
  return { revision: settings.revisions[block]!, restarting }
}

/** `POST policy-sync/feishu`: the chat gained a member since the last sync. */
export function syncFeishu(settings: MockSettings): { policy: unknown } {
  const part = settings.policy.sources.feishu!
  if (part.allowed.some(entry => entry.id === 'ou_wendy')) return { policy: part }
  const policy = structuredClone(settings.policy)
  policy.sources.feishu!.allowed = [...part.allowed, { id: 'ou_wendy', name: 'Wendy' }]
  saveBlock(settings, 'policy', { value: policy, revision: settings.revisions.policy }, 'sync')
  return { policy: settings.policy.sources.feishu }
}

/** Proactive judgements of the last two weeks, newest first: what each rule would have accepted, and what was turned down. */
export function seedDecisions(now: number): DecisionView[] {
  const at = (hours: number) => new Date(now - hours * 3_600_000).toISOString()
  const judged = (hit: string | null, why: string) => RULES.map(rule => ({ id: rule.id, name: rule.name, matched: rule.id === hit,
    reason: rule.id === hit ? why : rule.id === 'silent' ? 'Not a reproducible defect report' : rule.id === 'triage' ? 'Not a new issue' : 'Unrelated to dependencies' }))
  const make = (id: string, hours: number, thread: string, threadTitle: string, preview: string, hit: string | null, why: string): DecisionView => ({
    id, kind: 'ignore', outcome: hit ? 'wouldAccept' : 'ignore', strength: 'inferred', at: at(hours), triggerIds: [`trg_${id}`], thread, threadTitle, preview,
    reason: hit ? [{ code: 'observed', values: { text: why } }] : [{ code: 'noRuleMatched' }], rules: judged(hit, why),
  })
  const users = 'feishu:oc_harness_users'
  const list: DecisionView[] = [
    make('dec_eaddr', 1.6, `${users}/t_eaddr`, "dsh web won't start after upgrading", "dsh web won't start since upgrading to 0.2.1: EADDRINUSE, even on another port", 'silent', 'Describes a reproducible startup failure with the version and error'),
    { ...make('dec_322', 1.2, 'github:pull/322', 'Bump vitest from 4.1.8 to 4.1.9', 'Bump vitest from 4.1.8 to 4.1.9 · checks failed: 2 tests timed out', 'deps', "A dependency bot's PR failed its checks") },
    make('dec_160', 3, 'github:issue/160', 'Feature request: dark mode for the terminal', 'Feature request: dark mode for the built-in terminal', 'triage', 'A new issue without reproduction details'),
    make('dec_d4', 20, 'feishu:oc_harness_dev/t_timeout', 'Should the e2e timeout be configurable?', 'Should we make the e2e timeout configurable? What do you all think?', 'silent', 'The discussion mentions a timeout problem'),
    make('dec_d5', 26, `${users}/t_proxy`, 'Proxy setup on the office network', 'Does anyone know how to set up a proxy for dsh on the office network?', null, ''),
    make('dec_161', 30, 'github:issue/161', 'Crash when the workspace path contains spaces', 'Crash when the workspace path contains spaces (full stack trace attached)', 'triage', 'A new issue with a stack trace; good to triage first'),
  ]
  const silent = ["The session list sometimes doesn't refresh; fine after a restart, 0.2.1", 'The input box freezes after pasting a long log; reproduces every time', 'Plugin settings are lost after switching profiles', 'dsh web jumps while scrolling in Safari; Chrome is fine',
    "On Windows, node --watch doesn't pick up file changes", 'Earlier messages render out of place after switching models']
  silent.forEach((text, i) => list.push(make(`dec_s${i}`, 40 + i * 22, `${users}/t_s${i}`, text.slice(0, 40), text, 'silent', 'A reproducible defect, with a version or steps')))
  const triage = ['Docs: typo in README', 'Question: how to set a proxy?', 'Add support for Ruby LSP', 'Error when opening a large file', 'Make the sidebar resizable',
    'Feature: export session as markdown', 'Settings page is blank', 'Crash on startup after upgrade', 'Support GitLab as a source']
  triage.forEach((text, i) => list.push(make(`dec_t${i}`, 34 + i * 30, `github:issue/${180 + i}`, text, text, 'triage', 'A new issue without reproduction details')))
  // People not on the list who asked and were turned away by the gate.
  const away = (id: string, hours: number, thread: string, title: string, preview: string): DecisionView =>
    ({ id, kind: 'ignore', outcome: 'ignore', strength: 'explicit', at: at(hours), triggerIds: [`trg_${id}`], thread, threadTitle: title, preview, reason: [{ code: 'senderNotMember' }], rules: [] })
  list.push(away('dec_170', 0.9, 'github:issue/170', "Can't follow the README install steps", "@acme-agent could you look at the README install steps? Step 3 doesn't work"))
  ;['@Harness Bot can you look at this error', '@Harness Bot all my plugins are gone after upgrading', '@Harness Bot how do I switch models?'].forEach((text, i) =>
    list.push(away(`dec_away_${i}`, 5 + i * 30, `${users}/t_away`, 'harness-users group', text)))
  return list.sort((a, b) => b.at.localeCompare(a.at))
}

/** A week of hourly samples for the mock's own database, so the insights trend has something to show. */
export function mockSnapshots(now: number): Snapshot[] {
  // A team's working week: work arrives in the day, waits for people into the evening, and queues at the busiest hours.
  const waitingByHour = [1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 2, 3, 3, 2, 2, 2, 1, 1, 1]
  return Array.from({ length: 7 * 24 }, (_, i) => {
    const hour = Math.floor(now / 3_600_000) * 3_600_000 - (7 * 24 - i) * 3_600_000
    const date = new Date(hour), h = date.getHours(), weekday = date.getDay() !== 0 && date.getDay() !== 6
    return { at: date.toISOString(), waiting: weekday ? waitingByHour[h]! : Math.min(1, waitingByHour[h]!),
      queued: weekday && (h === 11 || h === 15) ? 1 + (date.getDate() % 2) : 0, running: weekday && h >= 10 && h < 20 ? 3 : h >= 10 && h < 20 ? 1 : 0 }
  })
}

/** Labels from earlier weeks, for the mock's own database only, so calibration shows a rule that is ready and one that is not. */
export const MOCK_LABELS = [
  ...Array.from({ length: 10 }, (_, i) => ({ decisionId: `dec_old_s${i}`, label: i === 3 ? 'wrong' as const : 'right' as const, outcome: 'wouldAccept', rules: ['silent'],
    at: new Date(Date.now() - (20 + i) * 86_400_000).toISOString() })),
  ...Array.from({ length: 8 }, (_, i) => ({ decisionId: `dec_old_t${i}`, label: i < 4 ? 'right' as const : i < 7 ? 'wrong' as const : 'scope' as const,
    outcome: 'wouldAccept', rules: ['triage'], at: new Date(Date.now() - (16 + i) * 86_400_000).toISOString() })),
  { decisionId: 'dec_old_d0', label: 'right' as const, outcome: 'wouldAccept', rules: ['deps'], at: new Date(Date.now() - 18 * 86_400_000).toISOString() },
]
