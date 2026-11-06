import { afterEach, describe, expect, it } from 'vitest'
import type { ExecutionView, HealthView, InsightsView, MainModelSwitch, TicketView, TranscriptItem, TranscriptView } from '@dsh-superagent-ui/contract'
import { seedWorld } from '../src/mock/superagent.ts'
import { toolLabel } from '../src/views/companion.ts'
import { harness } from './support.ts'

let h: Awaited<ReturnType<typeof harness>>
afterEach(async () => { await h?.close() })
const json = async <T>(response: Response) => { expect(response.status).toBe(200); return await response.json() as T }
const without = () => { const world = seedWorld(); world.companion.installed = false; return world }

describe('transcript', () => {
  it('shows what a finished worker did: the Assignment, its tools with exits, and what it said', async () => {
    h = await harness()
    const view = await json<TranscriptView>(await h.call('/api/tickets/tk_318/transcript'))
    expect(view).toMatchObject({ companion: { installed: true }, sessionId: 'worker-tk_318', exists: true, running: false, more: false })
    expect(view.items.map(item => item.kind)).toEqual(['turn', 'input', 'thinking', 'tool', 'tool', 'tool', 'say', 'turn'])
    expect(view.items[1]).toMatchObject({ kind: 'input', label: '派工', text: '飞书：撤回的消息不再触发新请求\n@acme-agent 飞书：撤回的消息不再触发新请求' })
    const tools = view.items.filter((item): item is Extract<TranscriptItem, { kind: 'tool' }> => item.kind === 'tool')
    expect(tools.map(tool => [tool.name, tool.label, tool.ok, tool.exit])).toEqual([
      ['edit', 'src/sources/feishu.ts', true, undefined], ['bash', 'Run the tests', true, '0'], ['bash', 'Open the pull request', true, '0']])
    expect(view.items.at(-1)).toMatchObject({ kind: 'turn', text: '第 1 轮结束' })

    expect(view).toMatchObject({ models: ['deepseek · deepseek-v4-pro'], model: 'deepseek · deepseek-v4-pro' })
  })
  it('shows a running worker’s call that has no result yet', async () => {
    h = await harness()
    const view = await json<TranscriptView>(await h.call('/api/tickets/tk_151/transcript'))
    expect(view.running).toBe(true)
    expect(view.items.at(-1)).toMatchObject({ kind: 'tool', label: 'Run the integration tests (3 min)', ok: null })
  })
  it('pages back from a sequence number', async () => {
    h = await harness()
    const latest = await json<TranscriptView>(await h.call('/api/tickets/tk_318/transcript'))
    const before = latest.items[3]!.seq
    const earlier = await json<TranscriptView>(await h.call(`/api/tickets/tk_318/transcript?before=${before}`))
    expect(earlier.items.map(item => item.seq)).toEqual(latest.items.slice(0, 3).map(item => item.seq))
  })
  it('has nothing to show for a queued Ticket, which has no Session yet', async () => {
    h = await harness()
    expect(await json<TranscriptView>(await h.call('/api/tickets/tk_155/transcript'))).toMatchObject({ exists: false, items: [] })
  })
  it('says the companion is missing instead of failing', async () => {
    h = await harness({ world: without() })
    expect(await json<TranscriptView>(await h.call('/api/tickets/tk_318/transcript'))).toMatchObject({ companion: { installed: false }, exists: false, items: [] })
    expect((await json<TicketView>(await h.call('/api/tickets/tk_318'))).said).toBeNull()
    expect((await json<HealthView>(await h.call('/api/health'))).companion).toEqual({ installed: false })
    expect((await json<InsightsView>(await h.call('/api/insights'))).speech).toBeNull()
    expect(h.monitor.current.upstream).toBe('ok')
    expect((await json<TranscriptView>(await h.call('/api/tickets/tk_318/transcript'))).models).toBeNull()
    expect((await json<ExecutionView>(await h.call('/api/execution'))).mainModel).toBeNull()
  })
})

describe('models in use', () => {
  it('shows the model the main Session actually calls, which can differ from its setting', async () => {
    h = await harness()
    expect((await json<ExecutionView>(await h.call('/api/execution'))).mainModel).toBe('deepseek · deepseek-v4')
  })
  it('still shows the steps, without models, when the companion is too old to report them', async () => {
    const world = seedWorld()
    world.companion.legacy = true
    h = await harness({ world })
    const transcript = await json<TranscriptView>(await h.call('/api/tickets/tk_318/transcript'))
    expect(transcript.items.length).toBeGreaterThan(0)
    expect(transcript.models).toBeNull()
    expect((await json<ExecutionView>(await h.call('/api/execution'))).mainModel).toBeNull()
  })
})

describe('switching the running main Session', () => {
  const FLASH = { provider: 'deepseek', model: 'deepseek-v4-flash' }
  const execution = async () => await json<ExecutionView>(await h.call('/api/execution'))
  const saveModel = async (model: typeof FLASH | null) => {
    const { eval: { timeoutSeconds, revision } } = await execution()
    return await json<{ revision: number; mainModel?: MainModelSwitch }>(await h.post('/api/eval', { timeoutSeconds, model, revision }, 'PUT'))
  }

  it('switches when the model setting changes, from the next call on', async () => {
    h = await harness()
    expect(await execution()).toMatchObject({ canSwitchMainModel: true, mainModel: 'deepseek · deepseek-v4', mainModelNext: null })
    expect((await saveModel(FLASH)).mainModel).toEqual({ result: 'switched', model: 'deepseek · deepseek-v4-flash' })
    expect(await execution()).toMatchObject({ eval: { model: FLASH }, mainModel: 'deepseek · deepseek-v4', mainModelNext: 'deepseek · deepseek-v4-flash' })
    // The profile's default stays: only the main Session moved.
    expect(h.mock.world.companion.defaultModel).toEqual({ provider: 'deepseek', model: 'deepseek-v4' })
  })
  it('leaves the main Session alone when the model setting did not change', async () => {
    h = await harness()
    const { eval: { revision } } = await execution()
    expect((await json<{ mainModel?: MainModelSwitch }>(await h.post('/api/eval', { timeoutSeconds: 200, model: null, revision }, 'PUT'))).mainModel).toBeUndefined()
    expect((await execution()).mainModelNext).toBeNull()
  })
  it('goes back to the profile default when the setting is cleared', async () => {
    h = await harness()
    await saveModel(FLASH)
    expect((await saveModel(null)).mainModel).toEqual({ result: 'switched', model: 'deepseek · deepseek-v4' })
  })
  it('applies a saved setting the main Session does not follow yet', async () => {
    const world = seedWorld()
    world.settings.eval.model = FLASH
    h = await harness({ world })
    expect(await execution()).toMatchObject({ eval: { model: FLASH }, mainModel: 'deepseek · deepseek-v4', mainModelNext: null })
    expect(await json<MainModelSwitch>(await h.post('/api/eval/main-model', {}))).toEqual({ result: 'switched', model: 'deepseek · deepseek-v4-flash' })
    expect((await execution()).mainModelNext).toBe('deepseek · deepseek-v4-flash')
  })
  it('saves the setting and says so when the companion cannot switch', async () => {
    const older = seedWorld()
    older.companion.legacy = true
    for (const world of [without(), older]) {
      h = await harness({ world })
      expect((await execution()).canSwitchMainModel).toBe(false)
      expect((await saveModel(FLASH)).mainModel).toEqual({ result: 'unsupported' })
      expect((await execution()).eval.model).toEqual(FLASH)
      await h.close()
    }
  })
  it('saves the setting and reports DSH’s refusal', async () => {
    const world = seedWorld()
    world.companion.models = []
    h = await harness({ world })
    expect((await saveModel(FLASH)).mainModel).toEqual({ result: 'failed', error: 'Select an available model before sending a message.' })
    expect((await execution()).eval.model).toEqual(FLASH)
    expect(h.monitor.current.upstream).toBe('ok')
  })
})

describe('what the agent said', () => {
  it('lists a Ticket’s messages, including one still waiting to go out', async () => {
    h = await harness()
    const view = await json<TicketView>(await h.call('/api/tickets/tk_142'))
    expect(view.said?.map(message => [message.kind, message.status])).toEqual([['acknowledgement', 'sent'], ['reply', 'sent'], ['reply', 'sent']])
    const pending = await json<TicketView>(await h.call('/api/tickets/tk_161'))
    expect(pending.said).toEqual([{ kind: 'acknowledgement', status: 'pending', source: 'feishu', text: '收到，我来升级 lark-cli 到 1.9。' }])
  })
  it('counts messages per Ticket over the insights period, and names the one that said the most', async () => {
    h = await harness()
    const { speech } = await json<InsightsView>(await h.call('/api/insights'))
    expect(speech).toMatchObject({ pending: 1, dropped: 1, perTicket: { max: 3, top: { id: 'tk_142', title: '修复 e2e 测试偶发超时', count: 3 } } })
    expect(speech!.messages.acknowledgement).toBe(speech!.tickets)
    expect((await json<HealthView>(await h.call('/api/health'))).companion).toEqual({ installed: true, version: '0.3.0' })
  })
})

describe('tool labels', () => {
  it('names what a call touched, even from cut arguments', () => {
    expect(toolLabel('{"command":"git status","description":"Inspect the worktree"}')).toBe('Inspect the worktree')
    expect(toolLabel('{"file_path":"/repo/README.md","content":"# a very long fi…')).toBe('/repo/README.md')
    expect(toolLabel('{"command":"git log --oneline -5\\ngit status"}')).toBe('git log --oneline -5')
    expect(toolLabel('{"trigger_id":"t1","text":"On it: adding an intro"}')).toBe('On it: adding an intro')
    expect(toolLabel('{"name":"dsh-superagent-github"}')).toBe('dsh-superagent-github')
    expect(toolLabel('not json')).toBe('')
  })
})
