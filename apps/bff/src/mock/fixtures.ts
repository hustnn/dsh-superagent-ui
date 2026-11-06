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
    ticket(now, { id: 'tk_142', title: '修复 e2e 测试偶发超时', stage: 'person', action: 'answer', minutes: 125, threads: [issue(142, 'e2e 测试偶发超时'), issue(139, '#139 内存泄漏')],
      summary: '本地复现 20 次超时 3 次，等你决定方向。',
      attention: '本地复现 20 次超时 3 次，根因像是 /api/upload 偶发变慢。是否允许先把 e2e 超时从 30s 提到 60s？还是你更希望我去查慢的那个请求？' }),
    ticket(now, { id: 'tk_318', title: '飞书：撤回的消息不再触发新请求', stage: 'person', action: 'review', minutes: 45, threads: [topic('t_recall', '撤回的消息还会被当成新请求'), pull(318, '撤回的消息不再触发新请求')],
      summary: 'PR #318 已就绪：撤回事件会让对应 Trigger 失效，附重现步骤和测试，CI 全部通过。' }),
    ticket(now, { id: 'tk_139', title: '复现 #139 的内存泄漏', stage: 'person', action: 'failed', minutes: 25, threads: [issue(139, '#139 内存泄漏')], retry: true,
      summary: 'prepare 命令退出码 128', note: { text: 'prepare 命令退出码 128：fatal: “agent/memleak-139” 已被另一个 worktree 检出', error: true } }),
    ticket(now, { id: 'tk_151', title: '给 /api/upload 加上重试', stage: 'working', minutes: 6, threads: [issue(151, '上传接口偶发失败')], summary: '正在跑集成测试（后台任务 3 分钟）' }),
    ticket(now, { id: 'tk_161', title: '升级 lark-cli 到 1.9', stage: 'working', minutes: 12, threads: [topic('t_lark', 'lark-cli 出 1.9 了')], summary: '改完调用参数，正在本地验证事件消费' }),
    ticket(now, { id: 'tk_163', title: '修复中文路径打开失败', stage: 'working', minutes: 3, threads: [issue(163, '中文路径打开失败')], summary: '已定位到路径编码问题，正在写测试' }),
    ticket(now, { id: 'tk_155', title: '补充 README 的部署说明', stage: 'working', action: 'queued', minutes: 2, threads: [topic('t_readme', 'README 的部署说明补一下')], summary: '' }),
    ticket(now, { id: 'tk_133', title: '排查 CI 缓存失效', stage: 'idle', minutes: 180, threads: [issue(133, 'CI 缓存失效'), pull(301, '修复 CI 缓存键')], summary: '修复已推送，等评审意见' }),
    ticket(now, { id: 'tk_147', title: '文档站 404 链接', stage: 'idle', minutes: 900, threads: [issue(147, '文档站 404')], summary: '已回复修好了，等提问人确认' }),
    ticket(now, { id: 'tk_120', title: '升级 zod 到 4.4', stage: 'ended', outcome: 'merged', minutes: 1500, threads: [pull(298, '升级 zod')], summary: 'PR 已合并' }),
    ticket(now, { id: 'tk_128', title: 'dsh web 偶尔白屏', stage: 'ended', outcome: 'dropped', minutes: 1600, threads: [topic('t_blank', 'dsh web 偶尔白屏')], summary: '三种浏览器各试 10 次都无法复现' }),
  ]
}

export function seedProblems(): OverviewProblem[] {
  return [
    { kind: 'source-error', source: { id: 'feishu', title: { zh: '飞书', en: 'Feishu' }, health: { name: 'feishu-events', state: 'error', detail: 'Event consumer disconnected 3 times in a row' } } },
    { kind: 'outgoing', outgoing: { id: 'rcpt_77', channel: { source: 'feishu', thread: 'feishu:oc_harness_dev/t_lark', address: {} }, text: '收到，我来升级 lark-cli 到 1.9。', attempts: 3, error: 'lark-cli exited 1: token expired' } },
    { kind: 'eval-unavailable', decisionId: 'dec_158', triggerId: 'trg_158', reason: [{ code: 'timeout' }],
      thread: { key: 'github:issue/158', source: 'github', title: 'Windows 下路径大小写', stage: 'unsubscribed', url: gh('issues/158') } },
  ]
}

export function seedSources(now: number): SourceStatus[] {
  return [
    { id: 'github', title: { zh: 'GitHub', en: 'GitHub' }, installed: true, enabled: true, state: 'ready',
      health: [{ name: 'github', state: 'ready', detail: 'Polled 18 seconds ago' }],
      stats: { received: 132, filtered: 41, lastAt: ago(now, 1) }, filtered: [],
      dropped: [{ id: 'rcpt_60', kind: 'result', channel: { source: 'github', thread: 'github:issue/149', address: {} }, preview: '标签已经整理好了。',
        dropped: { at: ago(now, 300), reason: 'channelGone' }, ticket: { id: 'tk_149', title: '#149 标签整理' } }] },
    { id: 'feishu', title: { zh: '飞书', en: 'Feishu' }, installed: true, enabled: true, state: 'error',
      health: [{ name: 'feishu-events', state: 'error', detail: 'Event consumer disconnected 3 times in a row' }, { name: 'feishu-topics', state: 'ready', detail: 'Polling 4 subscribed topics' }],
      stats: { received: 58, filtered: 12, lastAt: ago(now, 4) }, filtered: [], dropped: [] },
  ]
}
