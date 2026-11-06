/**
 * The mock's threads, messages and Ticket details, in upstream's shapes. Each Ticket's request is a message on its first
 * thread, accepted into it; a few more messages show the other paths a message can take: straight to a Ticket's worker,
 * ignored for a sender not on the list, recorded as "would accept" in observe mode, an unfinished Eval, and one a Source
 * filtered before it reached any thread.
 */
import type { ActorView, DecisionView, InputView, Reason, TicketPageView, TicketRow, ThreadSummaryView, TriggerView } from '../upstream/types.ts'
import { REPO } from './fixtures.ts'

const ago = (now: number, minutes: number) => new Date(now - minutes * 60_000).toISOString()
const person = (source: 'github' | 'feishu', id: string, name?: string): ActorView => ({ source, id, ...name ? { name: { zh: name, en: name } } : {} })

/** Who asked for each Ticket, and how. */
export const REQUESTS: Record<string, { by: ActorView; text: string }> = {
  tk_142: { by: person('github', 'alice', 'alice'), text: '@acme-agent 帮忙看下这个 flaky，e2e 最近老是超时' },
  tk_318: { by: person('feishu', 'ou_zhouzhou', '周舟'), text: '@Harness 助手 撤回的消息还会被当成新请求，修一下' },
  tk_139: { by: person('github', 'carol', 'carol'), text: '@acme-agent 帮忙复现一下这个泄漏' },
  tk_151: { by: person('github', 'alice', 'alice'), text: '@acme-agent 上传接口加个重试，最多 3 次' },
  tk_161: { by: person('feishu', 'ou_zhouzhou', '周舟'), text: '@Harness 助手 lark-cli 出 1.9 了，升一下' },
  tk_163: { by: person('github', 'carol', 'carol'), text: '@acme-agent 中文路径的工作区打不开' },
  tk_155: { by: person('feishu', 'ou_lilei', '李雷'), text: '@Harness 助手 README 的部署说明补一下' },
  tk_133: { by: person('github', 'alice', 'alice'), text: '@acme-agent CI 缓存好像失效了，每次都全量安装' },
  tk_147: { by: person('github', 'carol', 'carol'), text: '@acme-agent 文档站这个链接 404' },
  tk_120: { by: person('github', 'alice', 'alice'), text: '@acme-agent 把 zod 升到 4.4' },
  tk_128: { by: person('feishu', 'ou_lilei', '李雷'), text: '@Harness 助手 dsh web 偶尔白屏' },
}

export interface MockThread {
  key: string
  source: string
  title: string
  url?: string
  createdAt: string
  subscriptions: string[]
  context: string[]
  evaluating: boolean
  pending: number
  triggers: TriggerView[]
}

type Disposition = TriggerView['disposition']
const disposition = (value: Partial<Disposition> = {}): Disposition => ({ queued: false, evaluating: false, delivered: false, fanout: [], handbacks: [], ...value })
function trigger(id: string, thread: string, actor: ActorView, human: boolean, at: string, text: string, value: Partial<Disposition>, url?: string, requeue = false): TriggerView {
  return { id, source: actor.source, actor, human, at, text, preview: text.slice(0, 160), ...url ? { url } : {}, threads: [thread], actions: { requeue }, disposition: disposition(value) }
}
const decided = (id: string, outcome: NonNullable<Disposition['decision']>['outcome'], reason: Reason[], ticketId?: string): Partial<Disposition> =>
  ({ decision: { id, outcome, reason, ...ticketId ? { ticketId } : {} } })

export function seedThreads(now: number, tickets: TicketRow[]): MockThread[] {
  const threads = new Map<string, MockThread>()
  const ensure = (key: string, source: string, title: string, url: string | undefined, createdAt: string) => {
    let thread = threads.get(key)
    if (!thread) {
      thread = { key, source, title, ...url ? { url } : {}, createdAt, subscriptions: [], context: [], evaluating: false, pending: 0, triggers: [] }
      threads.set(key, thread)
    }
    return thread
  }
  for (const ticket of tickets) {
    ticket.threads.forEach((ref, index) => {
      const thread = ensure(ref.key, ref.source, ref.title, ref.url, ticket.createdAt)
      thread.subscriptions.push(ticket.id)
      // #139 is the one thread a Ticket reads for context only: tk_142 follows it for the related leak.
      if (index > 0 && ticket.id === 'tk_142') thread.context.push(ticket.id)
    })
    const request = REQUESTS[ticket.id]
    const origin = ticket.threads[0]
    if (request && origin) {
      threads.get(origin.key)!.triggers.push(trigger(`trg_${ticket.id}`, origin.key, request.by, true, ticket.createdAt, request.text,
        decided(`dec_${ticket.id}`, 'accept', [{ code: 'explicitRouted' }], ticket.id),
        origin.source === 'github' ? `${origin.url}#issuecomment-${ticket.id.slice(3)}01` : undefined))
    }
  }
  const at = (minutes: number) => ago(now, minutes)
  const gh = (path: string) => `https://github.com/${REPO}/${path}`
  const more: [string, TriggerView][] = [
    ['github:issue/142', trigger('trg_ci_142', 'github:issue/142', { source: 'github', id: '' }, false, at(140), 'e2e (ubuntu-latest) 失败：3 个测试超时', { fanout: ['tk_142'] })],
    ['github:issue/151', trigger('trg_bob_151', 'github:issue/151', person('github', 'bob'), true, at(5), '@acme-agent 顺便把超时日志也打出来', { fanout: ['tk_151'], delivered: true }, gh('issues/151#issuecomment-2210'))],
  ]
  for (const [key, value] of more) threads.get(key)?.triggers.push(value)

  const extra = (key: string, source: string, title: string, url: string | undefined, value: TriggerView, patch: Partial<MockThread> = {}) => {
    const thread = ensure(key, source, title, url, value.at)
    thread.triggers.push(value)
    Object.assign(thread, patch)
  }
  extra('github:issue/170', 'github', 'README 的安装步骤看不懂', gh('issues/170'),
    trigger('trg_bob_170', 'github:issue/170', person('github', 'bob'), true, at(50), '@acme-agent 能帮忙看下 README 的安装步骤吗？第三步跑不通',
      decided('dec_170', 'ignore', [{ code: 'senderNotMember' }]), gh('issues/170#issuecomment-2190'), true))
  extra('feishu:oc_harness_users/t_eaddr', 'feishu', '升级后 dsh web 起不来', 'https://applink.feishu.cn/client/chat/open?openChatId=oc_harness_users',
    trigger('trg_eaddr', 'feishu:oc_harness_users/t_eaddr', person('feishu', 'ou_bob', 'bob'), true, at(95), '升级到 0.2.1 之后 dsh web 起不来了，报 EADDRINUSE，换端口也一样',
      decided('dec_eaddr', 'wouldAccept', [{ code: 'observed', values: { text: '描述了可复现的启动失败，带版本号和报错，命中「静默复现修复」' } }])))
  extra('github:pull/322', 'github', 'Bump vitest from 4.1.8 to 4.1.9', gh('pull/322'),
    trigger('trg_322', 'github:pull/322', { source: 'github', id: 'dependabot[bot]', name: { zh: 'dependabot[bot]', en: 'dependabot[bot]' } }, false, at(70),
      'Bump vitest from 4.1.8 to 4.1.9 · 检查失败：2 个测试超时', decided('dec_322', 'wouldAccept', [{ code: 'observed', values: { text: '依赖机器人的 PR 检查失败，命中「依赖升级跟进」' } }]), gh('pull/322')))
  extra('github:issue/158', 'github', 'Windows 下路径大小写', gh('issues/158'),
    trigger('trg_158', 'github:issue/158', person('github', 'carol', 'carol'), true, at(30), '@acme-agent Windows 下路径大小写不一致，导致同一个文件被打开两次',
      decided('dec_158', 'unavailable', [{ code: 'timeout' }]), gh('issues/158#issuecomment-2201'), true))
  return [...threads.values()]
}

/** A message a Source filtered before it reached any thread; only search finds it. */
export function filteredTrigger(now: number): TriggerView & { filtered: Reason } {
  const value = trigger('trg_filtered_1', 'feishu:oc_random/t_room', person('feishu', 'ou_hanmeimei', '韩梅梅'), true, ago(now, 200),
    '@Harness 助手 帮我订一下下周的会议室', { filtered: { code: 'chat_not_allowed' } })
  return { ...value, filtered: { code: 'chat_not_allowed' } }
}

export function threadSummary(thread: MockThread, tickets: TicketRow[]): ThreadSummaryView {
  const rows = thread.subscriptions.map(id => tickets.find(ticket => ticket.id === id)).filter((row): row is TicketRow => !!row)
  const latest = thread.triggers.at(-1)
  const open = rows.some(row => row.state === 'open')
  return {
    key: thread.key, source: thread.source, title: thread.title,
    stage: thread.evaluating ? 'evaluating' : thread.pending ? 'queued' : open ? 'subscribed' : rows.length ? 'dormant' : 'unsubscribed',
    ...latest ? { latest: { actor: latest.actor, human: latest.human, at: latest.at, preview: latest.preview } } : {},
    lastAt: latest?.at ?? thread.createdAt, createdAt: thread.createdAt, subscriptions: thread.subscriptions.length,
    tickets: rows.map(row => ({ id: row.id, title: row.title, state: row.state })), pending: thread.pending,
    ...thread.url ? { url: thread.url } : {}, facts: {},
  }
}

/** Builds `GET tickets/:id` for a mock Ticket from its row, its request and its threads. */
export function ticketPage(row: TicketRow, threads: MockThread[], policyVersion: string): TicketPageView {
  const request = REQUESTS[row.id] ?? { by: person('github', 'alice', 'alice'), text: row.title }
  const origin = row.threads[0]
  const decision: DecisionView = {
    id: `dec_${row.id}`, kind: 'accept', outcome: 'accept', reason: [{ code: 'explicitRouted' }], at: row.createdAt, strength: 'explicit',
    ticketId: row.id, triggerIds: [`trg_${row.id}`], thread: origin?.key ?? '', rules: [], preview: request.text, ...origin ? { threadTitle: origin.title } : {},
  }
  const started = new Date(Date.parse(row.createdAt) + 60_000).toISOString()
  const report = (): TicketPageView['assignments'][number]['report'] => {
    if (row.stage === 'ended') return { state: row.ended?.outcome === 'dropped' ? 'dropped' : 'ready', summary: row.summary, at: row.updatedAt }
    if (row.stage === 'person') return { state: row.action === 'review' ? 'ready' : row.action === 'failed' ? 'failed' : row.action === 'blocked' ? 'blocked' : 'progress', summary: row.summary, at: row.updatedAt }
    if (row.stage === 'idle') return { state: 'waiting', summary: row.summary, at: row.updatedAt }
    return row.summary ? { state: 'progress', summary: row.summary, at: row.updatedAt } : undefined
  }
  const queued = row.stage === 'working' && row.action === 'queued'
  const reported = report()
  const assignment: TicketPageView['assignments'][number] = {
    id: `asg_${row.id}_1`, state: queued ? 'pending' : row.stage === 'ended' ? 'ended' : 'running', createdAt: row.createdAt,
    ...queued ? {} : { startedAt: started, ref: `worker-${row.id}` },
    ...row.stage === 'ended' ? { endedAt: row.updatedAt } : {},
    ...reported ? { report: reported } : {},
  }
  const inputs: InputView[] = threads.flatMap(thread => thread.triggers
    .filter(item => item.id !== `trg_${row.id}` && item.disposition.fanout.includes(row.id))
    .map((item): InputView => ({ id: `in_${item.id}`, kind: 'trigger', triggerId: item.id, at: item.at, delivered: true, ...item.human ? { human: true as const } : {},
      ...thread.context.includes(row.id) ? { context: true as const } : {},
      trigger: { id: item.id, actor: item.actor, human: item.human, preview: item.preview, thread: thread.key } })))
  if (row.id === 'tk_161') inputs.push({ id: 'in_note_161', kind: 'note', at: row.updatedAt, delivered: true, text: '飞书 bot 的 token 过期由运维处理，不用在这个 Ticket 里修。' })
  inputs.sort((a, b) => b.at.localeCompare(a.at))
  const subscribed = threads.filter(thread => thread.subscriptions.includes(row.id))
  const { threads: _rows, assignments: _a, inputs: _i, ...rest } = row
  return {
    ...rest,
    mandate: { strength: 'explicit', policyVersion, actor: request.by, scope: row.title },
    basis: { facts: [{ name: 'sender', value: request.by.id }, { name: 'addressed', value: 'mention' }], legacy: false },
    paused: false,
    channels: origin?.url ? [{ source: origin.source, url: origin.url, label: { zh: origin.title, en: origin.title } }] : [],
    decision,
    assignments: [assignment],
    inputs,
    threads: subscribed.map(thread => ({ ...threadSummary(thread, []), ...thread.context.includes(row.id) ? { context: true as const } : {} })),
    environment: [
      { key: 'DSH_SUPERAGENT_DIR', value: `~/.dsh/state/superagent/work/${row.id}`, description: { zh: 'Ticket 的目录', en: "The Ticket's directory" }, owner: 'executor' },
      { key: 'DSH_SUPERAGENT_NAME', value: row.id, description: { zh: 'Ticket 的短名，也是分支名的最后一段', en: "The Ticket's short name" }, owner: 'executor' },
      { key: 'DSH_SUPERAGENT_GITHUB_REPOSITORY', value: REPO, description: { zh: '监听的仓库', en: 'The watched repository' }, owner: 'github' },
    ],
  }
}
