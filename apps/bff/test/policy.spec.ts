import { afterEach, describe, expect, it } from 'vitest'
import type { CalibrationView, HomeView, PolicyDraft, PolicyView } from '@dsh-superagent-ui/contract'
import { mergePolicy, DraftError, changeText, historyItems } from '../src/views/policy.ts'
import { ruleStats } from '../src/views/calibration.ts'
import type { PolicyConfig } from '../src/upstream/types.ts'
import { harness } from './support.ts'

let h: Awaited<ReturnType<typeof harness>>
afterEach(async () => { await h?.close() })
const json = async <T>(response: Response) => { expect(response.status).toBe(200); return await response.json() as T }

/** The draft the console starts from: the policy view as it is. */
function draftOf(view: PolicyView): PolicyDraft {
  return {
    mode: view.mode, rules: view.rules.map(rule => ({ ...rule })),
    sources: Object.fromEntries(view.sources.map(source => [source.id, { allowed: [...source.allowed], ...source.bots ? { bots: [...source.bots] } : {},
      admission: Object.fromEntries(source.rows.map(row => [row.id, Object.fromEntries(Object.entries(row.cells).map(([cell, value]) => [cell, value.value]))])) }])),
  }
}

describe('policy view', () => {
  it('shows each Source’s lists and admission table, with cells only where the Source receives such messages', async () => {
    h = await harness()
    const policy = await json<PolicyView>(await h.call('/api/policy'))
    expect(policy.mode).toBe('observe')
    const github = policy.sources.find(source => source.id === 'github')!
    expect(github.allowed.map(entry => entry.id)).toEqual(['alice', 'carol'])
    expect(github.bots?.map(entry => entry.id)).toEqual(['dependabot[bot]'])
    const issues = github.rows.find(row => row.id === 'issues')!
    expect(issues.cells.unlistedUnaddressed).toEqual({ available: true, value: 'inferred', options: ['inferred', 'ignore'] })
    expect(github.rows.find(row => row.id === 'pulls')!.cells.listedUnaddressed.available).toBe(false)
    expect(policy.sources.find(source => source.id === 'feishu')!.sync).toEqual({ label: '立即同步', ready: true })
    expect(policy.tickets.find(ticket => ticket.id === 'tk_142')).toMatchObject({ source: 'github', sender: 'alice', strength: 'explicit' })
    expect(policy.history[0]?.changes).toEqual(['新增规则「依赖升级跟进」', 'GitHub 的 bot 列表加入 dependabot[bot]'])
    expect(policy.history.map(item => item.origin)).toEqual(['panel', 'sync', 'tool'])
  })
})

describe('mergePolicy', () => {
  const stored: PolicyConfig = {
    rules: [{ id: 'r1', name: 'One', enabled: true, instruction: 'Do one thing.' }],
    sources: { github: { allowed: [{ id: 'alice' }], admission: { issues: { unlistedUnaddressed: 'inferred' } }, syncTarget: 'kept' } },
  }
  const draft = (patch: Partial<PolicyDraft['sources']['github']> = {}): PolicyDraft => ({ mode: 'observe', rules: stored.rules,
    sources: { github: { allowed: [{ id: 'alice' }], admission: { issues: { listedUnaddressed: 'inferred', unlistedAddressed: 'ignore', unlistedUnaddressed: 'inferred' } }, ...patch } } })
  it('changes nothing for an unchanged draft, though the draft spells out default cells', () => {
    expect(mergePolicy(stored, draft())).toEqual(stored)
  })
  it('writes only the cells that changed, and keeps fields it does not know', () => {
    const merged = mergePolicy(stored, draft({ admission: { issues: { unlistedAddressed: 'explicit' } } }))
    expect(merged.sources.github!.admission).toEqual({ issues: { unlistedUnaddressed: 'inferred', unlistedAddressed: 'explicit' } })
    expect(merged.sources.github!.syncTarget).toBe('kept')
  })
  it('refuses a rule id upstream would refuse, and a cell value the cell does not offer', () => {
    expect(() => mergePolicy(stored, { ...draft(), rules: [{ id: 'bad id', name: 'x', enabled: true, instruction: 'y' }] })).toThrow(DraftError)
    expect(() => mergePolicy(stored, draft({ admission: { issues: { listedUnaddressed: 'explicit' } } }))).toThrow(DraftError)
  })
})

describe('policy history', () => {
  it('counts added chats, which upstream names by their listen mode, and names the first save', () => {
    expect(changeText({ code: 'sourceRowsAdded', source: 'feishu', field: 'chats', items: ['all'] })).toBe('飞书 的监听的群加入 1 个')
    expect(changeText({ code: 'sourceRowsAdded', source: 'feishu', field: 'allowed', items: ['hustnn'] })).toBe('飞书 的名单加入 hustnn')
    const items = historyItems({ items: [
      { revision: 2, savedAt: '', source: 'panel', policyChanged: false, changes: null },
      { revision: 1, savedAt: '', source: 'panel', policyChanged: false, changes: null },
    ] } as never)
    expect(items.map(item => item.changes)).toEqual([['上一个版本没有记录，没法逐项比较'], ['第一次保存设置']])
  })
})

describe('saving the policy', () => {
  it('saves only what changed, as a new Policy version, audited as high-risk', async () => {
    h = await harness()
    const before = await json<PolicyView>(await h.call('/api/policy'))
    const draft = draftOf(before)
    draft.rules = draft.rules.map(rule => rule.id === 'triage' ? { ...rule, enabled: false } : rule)
    draft.sources.github!.allowed.push({ id: 'bob' })
    const saved = await json<{ policyVersion: string; revisions: { policy: number; eval: number } }>(await h.post('/api/policy', { draft, revisions: before.revisions }, 'PUT'))
    expect(saved.policyVersion).not.toBe(before.policyVersion)
    expect(saved.revisions).toEqual({ policy: before.revisions.policy + 1, eval: before.revisions.eval })
    expect(h.audit.recent()[0]).toMatchObject({ action: 'policy.save', tier: 'high', target: 'policy', outcome: 'ok' })
    const after = await json<PolicyView>(await h.call('/api/policy'))
    expect(after.history[0]?.changes).toEqual(['停用规则「新 issue 分诊」', 'GitHub 的名单加入 bob'])
  })
  it('switches the accept mode through the eval block', async () => {
    h = await harness()
    const before = await json<PolicyView>(await h.call('/api/policy'))
    await json(await h.post('/api/policy', { draft: { ...draftOf(before), mode: 'auto' }, revisions: before.revisions }, 'PUT'))
    expect(h.mock.world.settings.eval.mode).toBe('auto')
    expect(h.audit.recent()[0]?.target).toBe('eval')
  })
  it('refuses a save based on a revision someone else replaced', async () => {
    h = await harness()
    const before = await json<PolicyView>(await h.call('/api/policy'))
    await h.post('/api/policy/sync/feishu')
    const draft = draftOf(before)
    draft.sources.github!.allowed.push({ id: 'bob' })
    const response = await h.post('/api/policy', { draft, revisions: before.revisions }, 'PUT')
    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: { kind: string } }).error.kind).toBe('conflict')
  })
  it('does not save an unchanged draft', async () => {
    h = await harness()
    const before = await json<PolicyView>(await h.call('/api/policy'))
    await json(await h.post('/api/policy', { draft: draftOf(before), revisions: before.revisions }, 'PUT'))
    expect(h.mock.world.settings.revisions.policy).toBe(before.revisions.policy)
    expect(h.audit.recent()[0]?.target).toBe('unchanged')
  })
})

describe('calibration', () => {
  it('lists judgements to review and moves one to the labelled list once labelled', async () => {
    h = await harness()
    const first = await json<CalibrationView>(await h.call('/api/calibration'))
    expect(first.mode).toBe('observe')
    expect(first.pending[0]).toMatchObject({ decisionId: 'dec_322', outcome: 'wouldAccept' })
    expect(first.pending.every((item, i, all) => i === 0 || all[i - 1]!.at >= item.at)).toBe(true)
    await json(await h.post('/api/calibration/dec_322', { label: 'right' }))
    const second = await json<CalibrationView>(await h.call('/api/calibration'))
    expect(second.pending.some(item => item.decisionId === 'dec_322')).toBe(false)
    expect(second.labelled[0]).toMatchObject({ decisionId: 'dec_322', label: { value: 'right' } })
    expect(second.rules.find(rule => rule.id === 'deps')).toMatchObject({ labelled: 1, agreed: 1 })
    await json(await h.post('/api/calibration/dec_322', { label: null }))
    expect((await json<CalibrationView>(await h.call('/api/calibration'))).labelled).toEqual([])
    expect((await h.post('/api/calibration/nope', { label: 'right' })).status).toBe(404)
  })
  it('counts a turned-down judgement the operator says should have been accepted as missed', async () => {
    h = await harness()
    await json(await h.post('/api/calibration/dec_d5', { label: 'wrong' }))
    expect((await json<CalibrationView>(await h.call('/api/calibration'))).missed).toBe(1)
  })
  it('home asks to review judgements once nothing more basic is missing', async () => {
    h = await harness()
    const home = await json<HomeView>(await h.call('/api/home'))
    expect(home.next).toMatchObject({ kind: 'calibrate', ready: [] })
    expect(home.next?.kind === 'calibrate' && home.next.pending).toBeGreaterThan(10)
  })
})

describe('rule verdicts', () => {
  const rules = [{ id: 'a', name: 'A', enabled: true, instruction: '.' }, { id: 'b', name: 'B', enabled: true, instruction: '.' },
    { id: 'c', name: 'C', enabled: false, instruction: '.' }, { id: 'd', name: 'D', enabled: true, instruction: '.' }]
  const labels = (rule: string, right: number, wrong: number) => Array.from({ length: right + wrong }, (_, i) =>
    ({ decisionId: `${rule}${i}`, label: i < right ? 'right' as const : 'wrong' as const, at: '2026-10-01T00:00:00Z', outcome: 'wouldAccept', rules: [rule] }))
  it('calls a rule ready, needing work, too new to judge, or disabled', () => {
    const stats = ruleStats(rules, [...labels('a', 9, 1), ...labels('b', 3, 3), ...labels('d', 2, 0)], [])
    expect(stats.map(rule => rule.verdict)).toEqual(['ready', 'needs-work', 'disabled', 'too-few'])
  })
})
