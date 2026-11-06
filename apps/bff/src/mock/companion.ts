/**
 * The companion plugin for the mock: Session logs and an outbox built from the mock's Tickets, served by the companion's own
 * request handling, so development and tests run the real projection of DSH events.
 */
import { DatabaseSync } from 'node:sqlite'
import type { ModelSelection } from '@dsh-superagent-ui/companion/api'
import type { SessionEvent } from '@dsh-superagent-ui/companion/host'
import type { TicketRow } from '../upstream/types.ts'

export interface MockCompanion {
  /** Set to false to see the console without the companion. */
  installed: boolean
  /** Answer as 0.1.0 did, before transcripts named their models. */
  legacy?: boolean
  logs: Map<string, SessionEvent[]>
  db: DatabaseSync
  /** The profile's default model, and the models DSH accepts for a Session. */
  defaultModel: ModelSelection
  models: string[]
}

/** The routes DSH records on each model call: workers on the configured worker model, the main Session on the default. */
const WORKER_MODEL = { kind: 'model', provider: 'deepseek', model: 'deepseek-v4-pro' }
const MAIN_MODEL = { kind: 'model', provider: 'deepseek', model: 'deepseek-v4' }
const MAIN_SESSION = 'orchestrator'

/** What each mock worker did, in the shape DSH stores it: tool calls with their results, and what it said. */
const STEPS: Record<string, { thinking: string; tools: [name: string, args: Record<string, string>, result: string, exit?: number][]; say: string }> = {
  tk_142: { thinking: 'Reproduce the timeout first, then look at which request is slow.', say: '本地复现 20 次超时 3 次，需要你决定方向。',
    tools: [['bash', { command: 'pnpm e2e --repeat 20', description: 'Run the e2e suite 20 times' }, '20 runs, 3 failed: upload.spec.ts timed out after 30000ms', 1],
      ['read', { file_path: 'src/api/upload.ts' }, 'export async function upload(file: File) { … }']] },
  tk_318: { thinking: 'A recall event should invalidate the Trigger it created.', say: 'PR #318 已就绪。',
    tools: [['edit', { file_path: 'src/sources/feishu.ts' }, 'Applied 1 edit'], ['bash', { command: 'pnpm test', description: 'Run the tests' }, '212 passed', 0],
      ['bash', { command: 'gh pr create --fill', description: 'Open the pull request' }, 'https://github.com/acme/harness-app/pull/318', 0]] },
  tk_151: { thinking: 'Wrap the upload in a retry with backoff, then run the integration tests.', say: '',
    tools: [['edit', { file_path: 'src/api/upload.ts' }, 'Applied 2 edits'], ['bash', { command: 'pnpm test:integration', description: 'Run the integration tests (3 min)' }, '']] },
  tk_161: { thinking: 'lark-cli 1.9 renamed the event flag; update the call sites.', say: '',
    tools: [['bash', { command: 'rg "event consume"', description: 'Find the event consumer calls' }, 'src/feishu/events.ts:42', 0]] },
}

export function seedCompanion(tickets: TicketRow[]): MockCompanion {
  const logs = new Map<string, SessionEvent[]>()
  for (const row of tickets) if (row.sessionId) logs.set(row.sessionId, workerLog(row))
  // The main Session started before the worker model was changed, so it still calls the profile default.
  logs.set(MAIN_SESSION, [{ type: 'session', seq: 0, time: Date.now() - 86_400_000, data: {} },
    { type: 'assistant/message', seq: 1, time: Date.now() - 3_600_000, data: { message: { role: 'assistant', content: [{ type: 'text', text: '已派工。' }], source: MAIN_MODEL } } }])
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE outbox (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const add = (id: string, row: TicketRow, kind: string, text: string, status = 'sent', extra: Record<string, unknown> = {}) => {
    const thread = row.threads[0]
    db.prepare('INSERT INTO outbox (id, value) VALUES (?, ?)').run(id, JSON.stringify({ id, kind, text, status, ticketId: row.id,
      channel: { source: thread?.source ?? 'github', thread: thread?.key ?? '', address: {} }, ...extra }))
  }
  for (const row of tickets) {
    if (row.stage === 'working' && row.action === 'queued') continue
    // The agent acknowledges every request it takes, and reports once a Ticket needs a person or ends.
    if (row.id === 'tk_161') add('rcpt_77', row, 'acknowledgement', '收到，我来升级 lark-cli 到 1.9。', 'pending')
    else add(`ack_${row.id}`, row, 'acknowledgement', `收到，我来看看：${row.title}`)
    if (row.stage === 'person' || row.stage === 'idle' || row.stage === 'ended') add(`rep_${row.id}`, row, 'reply', row.attention?.question ?? row.summary)
    if (row.id === 'tk_142') add('rep_tk_142_b', row, 'reply', '补充：慢的是 /api/upload 的第一次请求，冷启动大约 8 秒。')
    if (row.ended?.outcome === 'merged') add(`not_${row.id}`, row, 'notice', 'PR 已合并。')
    if (row.id === 'tk_128') add('not_tk_128', row, 'notice', '这个问题我先放下了：三种浏览器各试 10 次都没复现。', 'dropped',
      { dropped: { at: row.updatedAt, reason: 'channelGone' } })
  }
  return { installed: true, logs, db, defaultModel: { provider: MAIN_MODEL.provider, model: MAIN_MODEL.model }, models: ['deepseek-v4', 'deepseek-v4-flash', 'deepseek-v4-pro'] }
}

/** A worker's log: preset bookkeeping, the Assignment, one step of tool use, and an end unless it is still working. */
function workerLog(row: TicketRow): SessionEvent[] {
  const steps = STEPS[row.id] ?? { thinking: `Work on: ${row.title}`, tools: [], say: row.summary }
  let seq = 0, time = Date.parse(row.createdAt) + 60_000
  const event = (type: string, data: unknown): SessionEvent => ({ type, seq: seq++, time: time += 2_000, data })
  const assignment = JSON.stringify({ ticket_id: row.id, title: row.title, trigger: { text: `@acme-agent ${row.title}` } })
  const log = [event('session', {}), event('permission/preset', { preset: 'dsh-superagent-worker' }), event('turn/start', { turn: 1 }),
    event('user/message', { role: 'user', source: { kind: 'dsh-superagent', form: 'relay' }, content: [{ type: 'text', text: assignment }] }),
    event('user/message', { role: 'user', source: { kind: 'runtime-context', form: 'snapshot' }, content: [{ type: 'text', text: `Current working directory: ~/.dsh/state/superagent/work/${row.id}` }] }),
    event('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: steps.thinking }], source: WORKER_MODEL } })]
  steps.tools.forEach(([name, args, result, exit], index) => {
    const callId = `call_${row.id}_${index}`
    log.push(event('tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) }))
    // The last call of a working Ticket is still running: no result yet.
    if (row.stage === 'working' && index === steps.tools.length - 1) return
    if (exit !== undefined) log.push(event('job/settled', { toolCall: { callId }, status: 'completed', detail: `exit code: ${exit}`, startedAt: time, finishedAt: time + 1_500 }))
    log.push(event('tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: result }] } }))
  })
  if (row.stage === 'working') return log
  if (steps.say) log.push(event('assistant/message', { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: steps.say }], source: WORKER_MODEL } }))
  log.push(event('turn/end', { turn: 1, reason: { kind: 'completed' } }))
  return log
}

/** The services the companion's `answer` uses, over the mock's records. */
export function companionServices(companion: MockCompanion) {
  return {
    logger: console,
    orchestrator: { ready: Promise.resolve(), masterId: MAIN_SESSION, store: { db: companion.db } },
    // Like DSH: the selection lands in the Session's log, and the default follows it until the companion puts it back.
    sessionController: {
      selectModel: async ({ sessionId, ...selected }: { sessionId: string } & ModelSelection) => {
        const log = companion.logs.get(sessionId)
        if (!log) throw new Error(`session "${sessionId}" not found`)
        if (!companion.models.includes(selected.model)) throw new Error('Select an available model before sending a message.')
        log.push({ type: 'model/selection', seq: log.length, time: Date.now(), data: selected })
        companion.defaultModel = selected
        return { selected }
      },
    },
    agentDefaultModel: {
      currentSelection: () => ({ ...companion.defaultModel }),
      saveSelection: async (selection: ModelSelection) => { companion.defaultModel = selection },
    },
    sessionPersistence: {
      stat: async (id: string) => companion.logs.has(id) ? { eventCount: companion.logs.get(id)!.length } : undefined,
      open: async (id: string) => ({ read: async () => ({ events: companion.logs.get(id) ?? [] }), close: async () => {} }),
      flush: async () => {},
    },
  }
}
