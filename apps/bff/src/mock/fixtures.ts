/**
 * Example records for the mock dsh-superagent, in upstream's own shapes (`src/upstream/types.ts`). The repository, people
 * and chats are invented; times are relative to when the mock starts.
 */
import type { OverviewProblem, SourceStatus, TicketRow, ThreadFactsView } from '../upstream/types.ts'

export const REPO = 'acme/harness-app'
const gh = (path: string) => `https://github.com/${REPO}/${path}`
const ago = (now: number, minutes: number) => new Date(now - minutes * 60_000).toISOString()

const issue = (n: number, title: string): ThreadFactsView => ({ key: `github:issue/${n}`, source: 'github', title, url: gh(`issues/${n}`), facts: { number: { value: `#${n}` } } })
const pull = (n: number, title: string): ThreadFactsView => ({ key: `github:pull/${n}`, source: 'github', title, url: gh(`pull/${n}`), facts: { number: { value: `PR #${n}` } } })
const topic = (id: string, title: string): ThreadFactsView => ({ key: `feishu:oc_harness_dev/${id}`, source: 'feishu', title, url: `https://applink.feishu.cn/client/chat/open?openChatId=oc_harness_dev&topic=${id}`, facts: { chat: { value: 'harness-dev' } } })

interface TicketSeed {
  id: string; title: string; stage: TicketRow['stage']; action?: TicketRow['action']; minutes: number; summary: string
  threads: ThreadFactsView[]; attention?: string; note?: TicketRow['note']; retry?: boolean; outcome?: NonNullable<TicketRow['ended']>['outcome']
}
function ticket(now: number, seed: TicketSeed): TicketRow {
  const ended = seed.stage === 'ended'
  const first = seed.threads[0]
  return {
    id: seed.id, title: seed.title, state: ended ? 'ended' : 'open', stage: seed.stage, ...seed.action ? { action: seed.action } : {},
    ...seed.note ? { note: seed.note } : {},
    actions: { retry: !!seed.retry, stop: !ended }, strength: 'explicit',
    ...ended ? { ended: { at: ago(now, seed.minutes), by: seed.outcome === 'stopped' ? 'human' as const : 'executor' as const, outcome: seed.outcome ?? 'completed' } } : {},
    ...seed.attention ? { attention: { id: `att_${seed.id}`, question: seed.attention } } : {},
    assignments: 1, inputs: 2, undelivered: 0, sessionId: seed.stage === 'working' && seed.action === 'queued' ? '' : `worker-${seed.id}`,
    directory: seed.id, summary: seed.summary, createdAt: ago(now, seed.minutes + 30), updatedAt: ago(now, seed.minutes),
    threads: seed.threads,
    ...seed.stage === 'person' && first?.url ? { reply: { source: first.source, url: first.url, label: { zh: first.title, en: first.title } } } : {},
  }
}

export function seedTickets(now: number): TicketRow[] {
  return [
    ticket(now, { id: 'tk_142', title: 'Fix flaky e2e timeouts', stage: 'person', action: 'answer', minutes: 125, threads: [issue(142, 'Flaky e2e timeouts'), issue(139, '#139 memory leak')],
      summary: 'Reproduced locally: 3 timeouts in 20 runs; waiting for you to pick a direction.',
      attention: 'Reproduced locally: 3 timeouts in 20 runs, and the cause looks like /api/upload slowing down now and then. May I raise the e2e timeout from 30s to 60s first, or would you rather I chase the slow request?' }),
    ticket(now, { id: 'tk_318', title: 'Feishu: recalled messages no longer start new requests', stage: 'person', action: 'review', minutes: 45, threads: [topic('t_recall', 'Recalled messages still count as new requests'), pull(318, 'Recalled messages no longer start new requests')],
      summary: 'PR #318 is ready: a recall event now invalidates its Trigger, with reproduction steps and tests; CI is green.' }),
    ticket(now, { id: 'tk_139', title: 'Reproduce the #139 memory leak', stage: 'person', action: 'failed', minutes: 25, threads: [issue(139, '#139 memory leak')], retry: true,
      summary: 'prepare command exited 128', note: { text: "prepare command exited 128: fatal: 'agent/memleak-139' is already checked out in another worktree", error: true } }),
    ticket(now, { id: 'tk_151', title: 'Add retries to /api/upload', stage: 'working', minutes: 6, threads: [issue(151, 'Uploads fail now and then')], summary: 'Running integration tests (3-minute background job)' }),
    ticket(now, { id: 'tk_161', title: 'Upgrade lark-cli to 1.9', stage: 'working', minutes: 12, threads: [topic('t_lark', 'lark-cli 1.9 is out')], summary: 'Updated the call arguments; verifying event consumption locally' }),
    ticket(now, { id: 'tk_163', title: 'Fix opening paths with non-ASCII names', stage: 'working', minutes: 3, threads: [issue(163, 'Paths with non-ASCII names fail to open')], summary: 'Traced it to path encoding; writing tests' }),
    ticket(now, { id: 'tk_155', title: 'Expand the README deployment notes', stage: 'working', action: 'queued', minutes: 2, threads: [topic('t_readme', 'Please expand the README deployment notes')], summary: '' }),
    ticket(now, { id: 'tk_133', title: 'Investigate the broken CI cache', stage: 'idle', minutes: 180, threads: [issue(133, 'CI cache broken'), pull(301, 'Fix the CI cache key')], summary: 'Fix pushed; waiting for review' }),
    ticket(now, { id: 'tk_147', title: 'Broken link on the docs site', stage: 'idle', minutes: 900, threads: [issue(147, 'Docs site 404')], summary: 'Replied that it is fixed; waiting for the reporter to confirm' }),
    ticket(now, { id: 'tk_120', title: 'Upgrade zod to 4.4', stage: 'ended', outcome: 'merged', minutes: 1500, threads: [pull(298, 'Upgrade zod')], summary: 'PR merged' }),
    ticket(now, { id: 'tk_128', title: 'dsh web sometimes shows a blank page', stage: 'ended', outcome: 'dropped', minutes: 1600, threads: [topic('t_blank', 'dsh web sometimes shows a blank page')], summary: "Couldn't reproduce in 10 tries on each of three browsers" }),
  ]
}

export function seedProblems(): OverviewProblem[] {
  return [
    { kind: 'source-error', source: { id: 'feishu', title: { zh: '飞书', en: 'Feishu' }, health: { name: 'feishu-events', state: 'error', detail: 'Event consumer disconnected 3 times in a row' } } },
    { kind: 'outgoing', outgoing: { id: 'rcpt_77', channel: { source: 'feishu', thread: 'feishu:oc_harness_dev/t_lark', address: {} }, text: 'On it: upgrading lark-cli to 1.9.', attempts: 3, error: 'lark-cli exited 1: token expired' } },
    { kind: 'eval-unavailable', decisionId: 'dec_158', triggerId: 'trg_158', reason: [{ code: 'timeout' }],
      thread: { key: 'github:issue/158', source: 'github', title: 'Path case on Windows', stage: 'unsubscribed', url: gh('issues/158') } },
  ]
}

export function seedSources(now: number): SourceStatus[] {
  return [
    { id: 'github', title: { zh: 'GitHub', en: 'GitHub' }, installed: true, enabled: true, state: 'ready',
      health: [{ name: 'github', state: 'ready', detail: 'Polled 18 seconds ago' }],
      stats: { received: 132, filtered: 41, lastAt: ago(now, 1) }, filtered: [],
      dropped: [{ id: 'rcpt_60', kind: 'result', channel: { source: 'github', thread: 'github:issue/149', address: {} }, preview: 'The labels are sorted out.',
        dropped: { at: ago(now, 300), reason: 'channelGone' }, ticket: { id: 'tk_149', title: '#149 label cleanup' } }] },
    { id: 'feishu', title: { zh: '飞书', en: 'Feishu' }, installed: true, enabled: true, state: 'error',
      health: [{ name: 'feishu-events', state: 'error', detail: 'Event consumer disconnected 3 times in a row' }, { name: 'feishu-topics', state: 'ready', detail: 'Polling 4 subscribed topics' }],
      stats: { received: 58, filtered: 12, lastAt: ago(now, 4) }, filtered: [], dropped: [] },
  ]
}
