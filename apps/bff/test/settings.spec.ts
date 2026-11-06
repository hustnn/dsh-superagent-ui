import { afterEach, describe, expect, it } from 'vitest'
import type { ExecutionView, HomeView, InsightsView, PromptPreview, PromptsView, RecipesView, SourcesView } from '@dsh-superagent-ui/contract'
import { seedWorld } from '../src/mock/superagent.ts'
import { hourOf } from '../src/snapshots.ts'
import { harness } from './support.ts'

let h: Awaited<ReturnType<typeof harness>>
afterEach(async () => { await h?.close() })
const json = async <T>(response: Response) => { expect(response.status).toBe(200); return await response.json() as T }

describe('prompts', () => {
  it('lists team sections, skills and built-in parts, and flags an override whose default changed', async () => {
    h = await harness()
    const view = await json<PromptsView>(await h.call('/api/prompts'))
    expect(view.revision).toBe(12)
    expect(view.parts.filter(part => part.kind === 'team').map(part => part.title)).toEqual(['沟通规范', 'Ticket 范围', '交付要求'])
    expect(view.parts.find(part => part.key === 'skill/identities')?.kind).toBe('skill')
    const worker = view.parts.find(part => part.key === 'runtime/worker')!
    expect(worker.defaultChanged?.previous).toMatch(/checks have started/)
    expect(worker.builtIn?.text).toMatch(/required checks passed/)
    expect(view.parts.find(part => part.key === 'runtime/environment')?.builtIn?.placeholders).toEqual(['{variables}'])
    expect(view.history[0]).toMatchObject({ revision: 12, changed: ['沟通规范'] })
    expect(view.sessions.find(session => session.sessionId === 'worker-tk_133')?.revision).toBe(11)
  })
  it('saves on top of the revision read, audited as high-risk, and refuses a stale one', async () => {
    h = await harness()
    const view = await json<PromptsView>(await h.call('/api/prompts'))
    const config = { ...view.config, scope: `${view.config.scope}\nNever rewrite a module the request did not name.` }
    expect(await json<{ revision: number }>(await h.post('/api/prompts', { config, baseRevision: view.revision }, 'PUT'))).toEqual({ revision: 13 })
    expect(h.audit.recent()[0]).toMatchObject({ action: 'prompts.save', tier: 'high', target: 'r13', outcome: 'ok' })
    const stale = await h.post('/api/prompts', { config, baseRevision: view.revision }, 'PUT')
    expect(stale.status).toBe(409)
    expect((await json<PromptsView>(await h.call('/api/prompts?revision=12'))).revision).toBe(12)
  })
  it('previews each role’s assembled prompt, marking the team’s overrides', async () => {
    h = await harness()
    const view = await json<PromptsView>(await h.call('/api/prompts'))
    const preview = await json<PromptPreview>(await h.post('/api/prompts/preview', view.config))
    expect(preview.roles.worker.find(part => part.name === 'runtime/worker')).toMatchObject({ title: 'worker 的角色', overridden: true })
    expect(preview.roles.worker.some(part => part.title === '沟通规范' && part.kind === 'team')).toBe(true)
    expect(preview.roles.orchestrator.some(part => part.name === 'runtime/admission')).toBe(true)
    expect(preview.roles.worker.some(part => part.name === 'runtime/admission')).toBe(false)
  })
})

describe('sources', () => {
  it('shows what each Source receives and saves a switch without touching account fields', async () => {
    h = await harness()
    const view = await json<SourcesView>(await h.call('/api/sources'))
    const github = view.sources.find(source => source.id === 'github')!
    expect(github.github).toMatchObject({ repository: 'acme/harness-app', observeIssues: true, observeComments: false })
    expect(github.facts).toContainEqual({ label: 'agent 账号', value: 'acme-agent' })
    await json(await h.post('/api/sources/github', { enabled: true, github: { observeComments: true }, revision: github.revision }, 'PUT'))
    expect(h.mock.world.settings.github).toMatchObject({ observeComments: true, cli: '/Users/operator/.local/bin/gh-agent' })
    expect(h.audit.recent()[0]).toMatchObject({ action: 'source.save', tier: 'high', target: 'github' })
  })
  it('refuses a chat id Feishu would refuse', async () => {
    h = await harness()
    const view = await json<SourcesView>(await h.call('/api/sources'))
    const feishu = view.sources.find(source => source.id === 'feishu')!
    const response = await h.post('/api/sources/feishu', { enabled: true, feishu: { chats: [{ chatId: 'not-a-chat', listen: 'all' }] }, revision: feishu.revision }, 'PUT')
    expect(response.status).toBe(400)
  })
})

describe('what upstream offers beyond the forms', () => {
  it('shows each Source’s account fields and the chats the Feishu bot has joined', async () => {
    h = await harness()
    const view = await json<SourcesView>(await h.call('/api/sources'))
    expect(view.setupPending).toBe(false)
    expect(view.sources.find(source => source.id === 'github')?.account).toEqual({ repository: 'acme/harness-app', cli: '/Users/operator/.local/bin/gh-agent' })
    const feishu = view.sources.find(source => source.id === 'feishu')!
    expect(feishu.account).toEqual({ cli: '/Users/operator/.local/bin/lark-bot' })
    expect(feishu.joined?.map(chat => chat.name)).toEqual(['harness-dev', 'harness-release', 'harness-users'])
  })
  it('refreshes the chat list on request, and says when a Source has none', async () => {
    h = await harness()
    expect(await json<{ added: string[] }>(await h.post('/api/sources/feishu/labels'))).toEqual({ added: ['harness-ops'] })
    expect(h.audit.recent()[0]).toMatchObject({ action: 'source.labels', tier: 'low', target: 'feishu', outcome: 'ok' })
    expect((await h.post('/api/sources/github/labels')).status).toBe(400)
  })
  it('saves an account through setup’s check, as a local-only operation that restarts dsh-superagent', async () => {
    h = await harness()
    const view = await json<SourcesView>(await h.call('/api/sources'))
    const github = view.sources.find(source => source.id === 'github')!
    const saved = await json<{ restarting: boolean }>(await h.post('/api/sources/github/account', { repository: 'acme/widgets', cli: '/opt/bin/gh-agent', revision: github.revision }, 'PUT'))
    expect(saved.restarting).toBe(true)
    expect(h.mock.world.settings.github).toMatchObject({ repository: 'acme/widgets', cli: '/opt/bin/gh-agent', observeIssues: true })
    expect(h.audit.recent()[0]).toMatchObject({ action: 'source.account', tier: 'local-only', target: 'github', outcome: 'ok' })
  })
  it('refuses a malformed account before upstream, and words a failed check without saving anything', async () => {
    h = await harness()
    const feishu = (await json<SourcesView>(await h.call('/api/sources'))).sources.find(source => source.id === 'feishu')!
    expect((await h.post('/api/sources/feishu/account', { cli: 'bin/lark-bot', revision: feishu.revision }, 'PUT')).status).toBe(400)
    const failed = await h.post('/api/sources/feishu/account', { cli: '/opt/missing/lark-bot', revision: feishu.revision }, 'PUT')
    expect(failed.status).toBe(400)
    expect((await failed.json() as { error: { message: string } }).error.message).toBe('账号检查没通过，什么都没保存：机器人的 lark-cli 不可用。\n/opt/missing/lark-bot is not an executable file')
    expect(h.mock.world.settings.feishu.cli).toBe('/Users/operator/.local/bin/lark-bot')
  })
  it('runs setup’s check again only while setup has something to fix, and words the problem in Chinese', async () => {
    const world = seedWorld()
    world.setupProblem = { place: 'github', code: 'agentCliSignedOut', values: {}, detail: 'The agent GitHub CLI cannot read its account.' }
    h = await harness({ world })
    expect((await json<HomeView>(await h.call('/api/home'))).next).toEqual({ kind: 'setup', place: 'github', detail: '智能体的 GitHub CLI 读不到它的账号。' })
    expect((await json<SourcesView>(await h.call('/api/sources'))).setupPending).toBe(true)
    expect(await json(await h.post('/api/setup/check'))).toEqual({ restarting: true })
    expect(h.audit.recent()[0]).toMatchObject({ action: 'setup.check', tier: 'high', outcome: 'ok' })
    expect((await h.post('/api/setup/check')).status).toBe(400)
  })
  it('shows the plugin’s machine limits', async () => {
    h = await harness()
    expect((await json<ExecutionView>(await h.call('/api/execution'))).machine).toEqual({ stateDir: '/Users/operator/.dsh/state/superagent',
      promptMaxChars: 100000, admissionContextMaxPages: 10, admissionContextTimeoutMs: 15000 })
  })
})

describe('execution', () => {
  it('saves the executor as a local-only operation and the eval timeout as high', async () => {
    h = await harness()
    const view = await json<ExecutionView>(await h.call('/api/execution'))
    expect(view.variables.map(variable => variable.key)).toContain('DSH_SUPERAGENT_DIR')
    expect(view.models?.default).toEqual({ provider: 'deepseek', model: 'deepseek-v4' })
    await json(await h.post('/api/execution', { executor: { ...view.executor, maxWorkers: 4 }, revision: view.executor.revision }, 'PUT'))
    expect(h.audit.recent()[0]).toMatchObject({ action: 'executor.save', tier: 'local-only', outcome: 'ok' })
    expect(h.mock.world.maxWorkers).toBe(4)
    await json(await h.post('/api/eval', { timeoutSeconds: 180, model: null, revision: view.eval.revision }, 'PUT'))
    expect(h.mock.world.settings.eval).toMatchObject({ timeoutSeconds: 180, mode: 'observe' })
    const bad = await h.post('/api/execution', { executor: { ...view.executor, directory: 'relative/path' }, revision: view.executor.revision + 1 }, 'PUT')
    expect(bad.status).toBe(400)
  })
})

describe('insights', () => {
  it('reports waits, outcomes, who was turned away, and capacity', async () => {
    h = await harness()
    h.snapshots.record({ at: hourOf(Date.now() - 3_600_000), waiting: 2, queued: 3, running: 3 })
    const view = await json<InsightsView>(await h.call('/api/insights'))
    expect(view.waiting.count).toBe(3)
    expect(view.waiting.longestMs).toBeGreaterThan(view.waiting.medianMs!)
    expect(view.outcomes.all).toEqual({ merged: 1, dropped: 1 })
    expect(view.demand.map(item => [item.title, item.count])).toEqual([['harness-users 群', 3], ['README 的安装步骤看不懂', 1]])
    expect(view.capacity).toMatchObject({ maxWorkers: 3, peakQueued: 3 })
    expect(view.calibration.mode).toBe('observe')
  })
})

describe('recipes', () => {
  it('says which recipes are already in place', async () => {
    h = await harness()
    const view = await json<RecipesView>(await h.call('/api/recipes'))
    const byId = Object.fromEntries(view.recipes.map(recipe => [recipe.id, recipe]))
    expect(byId['identities']?.applied).toBe(true)
    expect(byId['deps']?.applied).toBe(false)
    expect(byId['silent-fix']?.chats?.map(chat => chat.name)).toEqual(['harness-dev', 'harness-users'])
  })
  it('previews, applies across blocks, and then has nothing left to do', async () => {
    h = await harness()
    const before = await json<{ changes: string[] }>(await h.post('/api/recipes/silent-fix/preview', { chat: 'oc_harness_dev' }))
    expect(before.changes).toEqual([
      '飞书群「harness-dev」改为接收全部消息',
      '「harness-dev」里名单内的人没 @ 它的消息作为推断候选',
      '「harness-dev」里名单外的人没 @ 它的消息作为推断候选',
      '新增规则「静默复现修复」并启用',
      '沟通规范加一句：命中“静默复现修复”时不发确认，只在有结果时回复一次',
    ])
    await json(await h.post('/api/recipes/silent-fix/apply', { chat: 'oc_harness_dev' }))
    expect(h.mock.world.settings.feishu.chats.find(chat => chat.chatId === 'oc_harness_dev')?.listen).toBe('all')
    expect(h.mock.world.settings.policy.rules.some(rule => rule.id === 'silent-fix' && rule.enabled)).toBe(true)
    expect(h.mock.world.prompts.versions.at(-1)?.config.communication).toMatch(/silent-fix rule/)
    expect(h.audit.recent()[0]).toMatchObject({ action: 'recipe.apply', tier: 'high', target: 'silent-fix' })
    expect((await json<{ changes: string[] }>(await h.post('/api/recipes/silent-fix/preview', { chat: 'oc_harness_dev' }))).changes).toEqual([])
  })
  it('asks for a chat when the recipe needs one', async () => {
    h = await harness()
    expect((await h.post('/api/recipes/support-chat/preview', {})).status).toBe(400)
  })
})
