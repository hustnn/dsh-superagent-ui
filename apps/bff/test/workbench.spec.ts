import { afterEach, describe, expect, it } from 'vitest'
import type { BoardView, HomeView, SearchView, ThreadListView, ThreadView, TicketView } from '@dsh-superagent-ui/contract'
import { personLink } from '../src/views/shared.ts'
import { messagePath } from '../src/views/threads.ts'
import { whySentence } from '../src/views/tickets.ts'
import type { TriggerView } from '../src/upstream/types.ts'
import { harness } from './support.ts'

let h: Awaited<ReturnType<typeof harness>>
afterEach(async () => { await h?.close() })
const json = async <T>(response: Response) => { expect(response.status).toBe(200); return await response.json() as T }

describe('board', () => {
  it('puts every open Ticket in its stage, longest wait first where people wait', async () => {
    h = await harness()
    const board = await json<BoardView>(await h.call('/api/board'))
    const ids = (column: keyof BoardView['columns']) => board.columns[column].map(card => card.id)
    expect(ids('person')).toEqual(['tk_142', 'tk_318', 'tk_139'])
    expect(ids('queued')).toEqual(['tk_155'])
    expect(ids('working').sort()).toEqual(['tk_151', 'tk_161', 'tk_163'])
    expect(ids('idle').sort()).toEqual(['tk_133', 'tk_147'])
    expect(board.columns.ended.map(card => card.outcome)).toEqual(['merged', 'dropped'])
    expect(board.endedTotal).toBe(2)
    expect(board.columns.person[0]).toMatchObject({ action: 'answer', thread: { key: 'github:issue/142' } })
  })
})

describe('ticket workbench', () => {
  it('says why it may do the work, which threads it watches, and what happened in order', async () => {
    h = await harness()
    const ticket = await json<TicketView>(await h.call('/api/tickets/tk_142'))
    expect(ticket.why.sentence).toBe('alice 在 GitHub 名单内，并直接 @ 了它，所以是明确请求。按策略 p7c1e93 接单。')
    expect(ticket.threads.map(thread => [thread.key, thread.role])).toEqual([['github:issue/142', 'origin'], ['github:issue/139', 'context']])
    expect(ticket.question).toMatch(/60s/)
    expect(ticket.reply?.url).toMatch(/issues\/142$/)
    expect(ticket.timeline.slice(0, 2).map(entry => entry.kind)).toEqual(['request', 'decision'])
    expect(ticket.timeline.find(entry => entry.kind === 'message')).toMatchObject({ title: '一条自动消息', tone: 'muted', triggerId: 'trg_ci_142' })
    const times = ticket.timeline.map(entry => entry.at)
    expect([...times].sort()).toEqual(times)
    expect(ticket.execution).toMatchObject({ sessionId: 'worker-tk_142', assignments: 1 })
    expect(ticket.execution.environment.map(variable => variable.key)).toContain('DSH_SUPERAGENT_DIR')
  })
  it('answers 404 for an unknown Ticket', async () => {
    h = await harness()
    const response = await h.call('/api/tickets/nope')
    expect(response.status).toBe(404)
  })
})

describe('where a person goes', () => {
  const feishu = { url: 'https://applink.feishu.cn/client/chat/open?openChatId=oc_1', label: '飞书消息' }
  it('sends a review to the pull request even when the request came from Feishu', async () => {
    h = await harness()
    const home = await (await h.call('/api/home')).json() as HomeView
    expect(home.person.find(item => item.id === 'tk_318')?.reply?.url).toBe('https://github.com/acme/harness-app/pull/318')
    const ticket = await (await h.call('/api/tickets/tk_318')).json() as TicketView
    expect(ticket.reply).toEqual({ url: 'https://github.com/acme/harness-app/pull/318', label: '撤回的消息不再触发新请求' })
    // A question is answered where it was asked.
    expect(home.person.find(item => item.id === 'tk_142')?.reply?.url).toBe('https://github.com/acme/harness-app/issues/142')
  })
  it('falls back to the pull request the report names, then to the conversation', () => {
    const origin = [{ source: 'feishu', title: '请求', url: feishu.url }]
    expect(personLink('review', origin, 'PR #2 已就绪：https://github.com/acme/app/pull/2，等你评审', feishu)).toEqual({ url: 'https://github.com/acme/app/pull/2', label: 'PR #2' })
    expect(personLink('review', origin, '改好了', feishu)).toBe(feishu)
    expect(personLink('review', [...origin, { source: 'github', title: '#7 issue', url: 'https://github.com/acme/app/issues/7' }], '改好了', feishu)).toBe(feishu)
    expect(personLink('answer', [{ source: 'github', title: '#2', url: 'https://github.com/acme/app/pull/2' }], '', feishu)).toBe(feishu)
  })
})

describe('message paths', () => {
  it('explains a message ignored because its sender is not on the list, and offers to evaluate it again', async () => {
    h = await harness()
    const thread = await json<ThreadView>(await h.call(`/api/thread?key=${encodeURIComponent('github:issue/170')}`))
    const [message] = thread.messages
    expect(message?.path.verdict).toEqual({ tone: 'muted', label: '忽略' })
    expect(message?.path.steps.at(-1)).toEqual({ tone: 'stop', title: '评估后忽略', detail: '发送者不在这个来源的名单里' })
    expect(message?.path.requeue).toBe(true)
  })
  it('shows a follow-up going straight to its Ticket’s worker, without an Eval', async () => {
    h = await harness()
    const thread = await json<ThreadView>(await h.call(`/api/thread?key=${encodeURIComponent('github:issue/151')}`))
    const bob = thread.messages.find(message => message.actor === 'bob')
    expect(bob?.path.verdict.label).toBe('送到了 Ticket')
    expect(bob?.path.steps[1]).toMatchObject({ tone: 'route', title: '送到了「给 /api/upload 加上重试」', ticketId: 'tk_151' })
    expect(bob?.path.steps[1]?.detail).toMatch(/不经过评估/)
    expect(thread.unsubscribe).toBe(true)
  })
  it('finds a message by its link, with its thread and Ticket', async () => {
    h = await harness()
    const url = 'https://github.com/acme/harness-app/issues/151#issuecomment-2210'
    const result = await json<SearchView>(await h.call(`/api/search?q=${encodeURIComponent(url)}`))
    expect(result.messages.map(message => message.id)).toContain('trg_bob_151')
    expect(result.threads.map(thread => thread.key)).toEqual(['github:issue/151'])
    expect(result.tickets.map(ticket => ticket.id)).toEqual(['tk_151'])
  })
  it('finds a message its Source filtered, with the Source’s reason', async () => {
    h = await harness()
    const result = await json<SearchView>(await h.call(`/api/search?q=${encodeURIComponent('会议室')}`))
    expect(result.messages[0]?.path.verdict).toEqual({ tone: 'danger', label: '被过滤' })
    expect(result.messages[0]?.path.steps[1]?.detail).toBe('群不在监听的群里')
  })
  it('lists threads by filter', async () => {
    h = await harness()
    const subscribed = await json<ThreadListView>(await h.call('/api/threads?filter=subscribed'))
    expect(subscribed.items.every(thread => thread.stage === 'subscribed')).toBe(true)
    const all = await json<ThreadListView>(await h.call('/api/threads?filter=all'))
    expect(all.total).toBeGreaterThan(subscribed.total)
    expect((await h.call('/api/thread')).status).toBe(400)
  })
  it('wording covers each outcome', () => {
    const base: Omit<TriggerView, 'text'> = { id: 't', source: 'feishu', actor: { source: 'feishu', id: 'ou_1' }, human: true, at: '', preview: '',
      threads: ['feishu:a'], actions: { requeue: false }, disposition: { queued: false, evaluating: false, delivered: false, fanout: [], handbacks: [] } }
    const path = (disposition: Partial<TriggerView['disposition']>) => messagePath({ ...base, disposition: { ...base.disposition, ...disposition } }, id => id)
    expect(path({ evaluating: true }).verdict.label).toBe('评估中')
    expect(path({ queued: true }).verdict.label).toBe('等评估')
    expect(path({ decision: { id: 'd', outcome: 'wouldAccept', reason: [{ code: 'observed', values: { text: '命中规则' } }] } }).steps.at(-1)?.detail).toBe('观察模式：本会接单（命中规则）')
    expect(path({ decision: { id: 'd', outcome: 'unavailable', reason: [{ code: 'timeout' }] } }).verdict).toEqual({ tone: 'warn', label: '评估没完成' })
  })
})

describe('why sentences', () => {
  const mandate = (strength: 'explicit' | 'inferred') => ({ strength, policyVersion: 'abcdef123', actor: { source: 'feishu', id: 'ou_x', name: { zh: '林夏', en: 'Lin' } }, scope: 's' })
  it('words an admission-table cell and a matched rule', () => {
    expect(whySentence({ mandate: mandate('inferred'), basis: { legacy: false, facts: [
      { name: 'admission', value: 'unlistedUnaddressed' }, { name: 'observation' }, { name: 'mode', value: 'auto' }, { name: 'rules', value: [{ id: 'r1', name: '静默复现修复' }] }] } }))
      .toBe('林夏不在名单内，也没有 @ 它，准入表这一格允许，所以是推断候选，经评估后接单，当时是自动接单模式，命中规则 「静默复现修复」。按策略 abcdef1 接单。')
  })
  it('words a listed bot', () => {
    expect(whySentence({ mandate: mandate('inferred'), basis: { legacy: false, facts: [{ name: 'bot' }] } })).toMatch(/^林夏 是 飞书 bot 列表里的机器人/)
  })
})

describe('unsubscribe', () => {
  it('drops every subscription on a thread, as a high-risk audited operation', async () => {
    h = await harness()
    const response = await h.post('/api/thread/unsubscribe', { key: 'github:issue/139' })
    expect(await json<{ removed: boolean }>(response)).toEqual({ removed: true })
    expect(h.audit.recent()[0]).toMatchObject({ action: 'thread.unsubscribe', tier: 'high', target: 'github:issue/139', outcome: 'ok' })
    const ticket = await json<TicketView>(await h.call('/api/tickets/tk_142'))
    expect(ticket.threads.map(thread => thread.key)).toEqual(['github:issue/142'])
    expect((await h.post('/api/thread/unsubscribe', {})).status).toBe(400)
  })
})
