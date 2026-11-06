/**
 * The console BFF's HTTP API, as the web console sees it.
 *
 * The browser never talks to dsh-superagent directly: the BFF reads the upstream management API and answers with these
 * view models, shaped for one screen each. Keeping the browser on this contract, not on upstream records, is what lets a
 * phone use the same API later with no change to dsh-superagent.
 */

/** How risky an operation is. Every BFF route declares one; remote access modes decide per tier (docs/architecture.md). */
export type RiskTier = 'read' | 'low' | 'high' | 'local-only'

/** Whether the BFF can reach dsh-superagent, and if not, why. */
export type UpstreamState = 'ok' | 'unreachable' | 'not-mounted' | 'forbidden' | 'error'
export interface Connection {
  upstream: UpstreamState
  /** The management API base the BFF talks to, such as `http://127.0.0.1:3082`. */
  url: string
  /** English detail of the last failure, for the operator's terminal and logs. */
  detail?: string
  checkedAt: string
}

export interface Meta {
  /** Only `local` exists today; remote modes come with M4. */
  accessMode: 'local'
  /** True when the BFF talks to its built-in mock instead of a real dsh-superagent. */
  mock: boolean
  version: string
}

/** One line that answers "is it running and how busy is it". */
export interface StatusSummary {
  paused: boolean
  running: number
  queued: number
  idle: number
  maxWorkers: number
  /** Short form of the upstream Policy version hash. */
  policyVersion: string
  repository?: string
  agent?: string
}

/** What a Ticket that waits for a person needs from them. Mirrors upstream `person` stage actions. */
export type PersonAction = 'answer' | 'review' | 'blocked' | 'failed' | 'delivery'

export interface ThreadRef {
  key: string
  source: string
  title: string
  url?: string
}

export interface PersonItem {
  id: string
  title: string
  action: PersonAction
  /** The question the worker asked, for `answer`. */
  question?: string
  /** One line on why it waits: the failure, the undelivered input, or the latest report. */
  note?: { text: string; error: boolean }
  summary: string
  strength: 'explicit' | 'inferred'
  /** When the Ticket last changed, which is when it started waiting for the person in all but rare cases. */
  waitingSince: string
  threads: ThreadRef[]
  /** Where the person answers: the conversation the agent asked in. */
  reply?: { url: string; label: string }
  actions: { retry: boolean; stop: boolean }
}

export type ProblemAction =
  | { kind: 'requeue'; triggerId: string }
  | { kind: 'dismiss'; decisionId: string }
  | { kind: 'resume' }
  | { kind: 'link'; href: string; label: string }

export interface ProblemItem {
  /** Stable while the problem lasts, so the console can keep focus on it across refreshes. */
  id: string
  kind: string
  tone: 'danger' | 'warn'
  title: string
  detail: string
  actions: ProblemAction[]
}

/** The single next step the operator should take, when there is one. */
export type NextStep =
  | { kind: 'setup'; place: string; detail: string }
  | { kind: 'no-source' }
  | { kind: 'no-allowed' }
  | { kind: 'first-request'; repository?: string; agent?: string; bot?: string }
  /** Proactive judgements wait for review; `ready` names rules whose judgements have agreed with the operator's enough. */
  | { kind: 'calibrate'; pending: number; ready: string[] }

export interface HomeView {
  connection: Connection
  status: StatusSummary
  next: NextStep | null
  /** Tickets that wait for a person, longest wait first. */
  person: PersonItem[]
  /** Problems the operator can act on, without those already shown as the next step. */
  problems: ProblemItem[]
}

export type SourceState = 'missing' | 'off' | 'error' | 'setup' | 'starting' | 'paused' | 'ready'
export interface SourceItem {
  id: string
  title: string
  state: SourceState
  parts: { name: string; state: string; detail: string }[]
  problem?: string
  received: number
  filtered: number
  lastAt?: string
  dropped: { id: string; preview: string; reason: string; at: string; ticket?: string }[]
}

export interface AuditEntry {
  id: number
  at: string
  principal: string
  tier: RiskTier
  action: string
  target: string
  outcome: 'ok' | 'error' | 'denied'
  detail?: string
}

export interface HealthView {
  connection: Connection
  status: StatusSummary
  sources: SourceItem[]
  problems: ProblemItem[]
  /** Upstream's counts for the last 24 hours. */
  flow: { received: number; filtered: number; judged: number; accepted: number; evaluating: number; dropped: number }
  accounts?: { repository?: string; agent?: string; feishu?: string }
  /** Whether the companion plugin runs beside dsh-superagent (M3). */
  companion: CompanionState
  audit: AuditEntry[]
}

/** Server-sent events on `GET /api/events`. */
export type LiveEvent =
  | { type: 'invalidate'; views: ViewName[] }
  | { type: 'connection'; connection: Connection }
/** What a live invalidation names. `ticket` and `thread` cover every open ticket and thread page. */
export type ViewName = 'home' | 'health' | 'board' | 'ticket' | 'threads' | 'thread' | 'policy' | 'calibration' | 'prompts' | 'settings' | 'insights'

/** Every failed request answers with this body. */
export interface ApiFailure {
  error: {
    kind: 'unauthenticated' | 'forbidden' | 'denied' | 'bad-request' | 'not-found' | 'conflict' | 'upstream'
    message: string
    upstream?: UpstreamState
  }
}

/** The routes, with their bodies and responses. */
export interface Api {
  'POST /api/session': { body: { token: string }; response: { ok: true } }
  'GET /api/meta': { response: Meta }
  'GET /api/home': { response: HomeView }
  'GET /api/health': { response: HealthView }
  'POST /api/tickets/:id/retry': { response: { ok: true } }
  'POST /api/tickets/:id/stop': { response: { ok: true } }
  'POST /api/triggers/:id/requeue': { response: { queued: boolean } }
  'POST /api/decisions/:id/dismiss': { response: { ok: true } }
  'POST /api/executor/pause': { body: { paused: boolean }; response: { paused: boolean } }
  'GET /api/board': { response: BoardView }
  'GET /api/tickets/:id': { response: TicketView }
  'GET /api/tickets/:id/transcript': { query: { before?: string }; response: TranscriptView }
  'GET /api/threads': { query: { filter: ThreadFilter }; response: ThreadListView }
  'GET /api/thread': { query: { key: string; around?: string }; response: ThreadView }
  'GET /api/search': { query: { q: string }; response: SearchView }
  'POST /api/thread/unsubscribe': { body: { key: string }; response: { removed: boolean } }
  'GET /api/policy': { response: PolicyView }
  'PUT /api/policy': { body: PolicySave; response: { policyVersion: string; revisions: PolicyRevisions } }
  'POST /api/policy/sync/:id': { response: { ok: true } }
  'GET /api/calibration': { response: CalibrationView }
  'POST /api/calibration/:id': { body: { label: CalibrationLabel | null; note?: string }; response: { ok: true } }
  'GET /api/prompts': { query: { revision?: string }; response: PromptsView }
  'PUT /api/prompts': { body: { config: PromptConfig; baseRevision: number }; response: { revision: number } }
  'POST /api/prompts/preview': { body: PromptConfig; response: PromptPreview }
  'GET /api/sources': { response: SourcesView }
  'PUT /api/sources/:id': { body: SourceSave; response: { revision: number; restarting: boolean } }
  'PUT /api/sources/:id/account': { body: SourceAccountSave; response: { revision: number; restarting: boolean } }
  'POST /api/sources/:id/labels': { response: { added: string[] } }
  'POST /api/setup/check': { response: { restarting: true } }
  'GET /api/execution': { response: ExecutionView }
  'PUT /api/execution': { body: { executor: ExecutorSettings; revision: number }; response: { revision: number } }
  'PUT /api/eval': { body: { timeoutSeconds: number; model: ModelChoice | null; revision: number }; response: { revision: number; mainModel?: MainModelSwitch } }
  'POST /api/eval/main-model': { response: MainModelSwitch }
  'GET /api/directories': { response: DirectoriesView }
  'POST /api/directories/rescan': { response: { ok: true } }
  'GET /api/directories/files': { query: { key: string; path?: string }; response: DirectoryFilesView }
  'POST /api/directories/reveal': { body: { key: string; path?: string }; response: { ok: true } }
  'GET /api/insights': { response: InsightsView }
  'GET /api/recipes': { response: RecipesView }
  'POST /api/recipes/:id/preview': { body: { chat?: string }; response: { changes: string[] } }
  'POST /api/recipes/:id/apply': { body: { chat?: string }; response: { changes: string[] } }
}

/* ---- M2b: prompts ---- */

/** Upstream's prompt configuration, round-tripped as read: team sections, team skills, and overrides of built-in parts. */
export interface PromptConfig {
  communication: string
  scope: string
  delivery: string
  skills: Record<string, string>
  overrides?: Record<string, { text: string; base?: string }>
}
export type PromptRole = 'orchestrator' | 'worker'
/** One editable piece of the prompts: a team section, a team skill, or a built-in part a team may override. */
export interface PromptPart {
  /** `communication`, `scope`, `delivery`, `skill/<name>`, or a built-in key such as `runtime/worker`. */
  key: string
  kind: 'team' | 'skill' | 'part'
  title: string
  description: string
  roles: PromptRole[]
  /** A team section's default text. */
  teamDefault?: string
  /** A built-in part's current text, the key an override records as its base, and the placeholders a template must keep. */
  builtIn?: { text: string; base: string; placeholders: string[] }
  /** The team overrode this part, and the built-in text changed since: `previous` is the text it was edited from when known. */
  defaultChanged?: { previous?: string; removed?: boolean }
}
export interface PromptsView {
  connection: Connection
  /** The revision shown, the latest one, and how the shown one was saved. */
  revision: number
  current: number
  savedAt: string
  origin: string
  config: PromptConfig
  parts: PromptPart[]
  /** The revision each live Session last used. */
  sessions: { sessionId: string; revision: number }[]
  history: { revision: number; savedAt: string; origin: string; changed: string[] }[]
}
export interface PromptPreview {
  roles: Record<PromptRole, { name: string; title: string; kind: 'fixed' | 'team' | 'generated'; overridden: boolean; text: string }[]>
  note: string
}

/* ---- M2c: sources, execution, insights, recipes ---- */

export interface GithubSettings { repository: string; observeIssues: boolean; observePulls: boolean; observeComments: boolean; observeCi: boolean; pollSeconds: number }
export interface FeishuSettings { chats: { chatId: string; name?: string; listen: 'mentions' | 'all' }[]; directMessages: boolean; otherChats: 'none' | 'mentions' }
export interface SourceSettings {
  id: string
  title: string
  enabled: boolean
  revision: number
  state?: SourceState
  problem?: string
  /** What setup verified, such as the repository and the agent account. */
  facts: { label: string; value: string }[]
  /** The account fields as saved: GitHub's repository and agent CLI, Feishu's bot CLI. Saving them runs setup's check and restarts dsh-superagent. */
  account: { repository?: string; cli: string }
  github?: GithubSettings
  feishu?: FeishuSettings
  /** Feishu: every chat the bot has joined, by name, so a chat can be picked instead of typed. */
  joined?: { chatId: string; name: string }[]
}
export interface SourcesView {
  connection: Connection
  sources: SourceSettings[]
  /** Setup has something to fix, so running its check again can help (upstream refuses it otherwise). */
  setupPending: boolean
}
export interface SourceAccountSave { repository?: string; cli: string; revision: number }
export interface SourceSave { enabled: boolean; github?: Partial<Omit<GithubSettings, 'repository'>>; feishu?: Partial<FeishuSettings>; revision: number }

export interface ModelChoice { provider: string; model: string; reasoningEffort?: string }
export interface ExecutorSettings { maxWorkers: number; directory: string; prepare: string; blockedCommands: string[]; model: ModelChoice | null }
export interface ExecutionView {
  connection: Connection
  executor: ExecutorSettings & { revision: number; root: string }
  eval: { timeoutSeconds: number; model: ModelChoice | null; revision: number }
  models: { default: ModelChoice; groups: { id: string; name: string; models: { id: string; name: string }[] }[] } | null
  variables: { key: string; description: string; owner: string }[]
  /**
   * The model the main Session's latest call used, as `provider · model`. A Session keeps its model until it is switched, so
   * this can differ from `eval.model`. Null when the companion cannot tell (missing, too old, or no call yet).
   */
  mainModel: string | null
  /** The model the main Session has been switched to and not called yet: its next call uses this one. */
  mainModelNext: string | null
  /** Whether the companion can switch the running main Session (0.3.0 and later). */
  canSwitchMainModel: boolean
  /** The plugin's machine configuration: read here, changed in DSH's plugin manager (the limits) or the profile (`stateDir`). */
  machine: { stateDir: string; promptMaxChars?: number; admissionContextMaxPages?: number; admissionContextTimeoutMs?: number } | null
}

/* ---- Ticket directories ---- */
export interface DirectoryItem {
  /** What `files` and `reveal` take: the Ticket's id, or the folder's name when no Ticket owns it. */
  key: string
  name: string
  path: string
  /** False when the Ticket names a directory that is not there: not prepared yet, or removed. */
  exists: boolean
  /** Bytes on disk; null until measured, or when it could not be. */
  size: number | null
  measuring: boolean
  measuredAt?: string
  /** The Ticket that owns it, with how many Threads that Ticket follows. Null for a folder no Ticket owns. */
  ticket: (Pick<TicketCard, 'id' | 'title' | 'stage' | 'action' | 'outcome' | 'updatedAt'> & { threads: number }) | null
}
export interface DirectoriesView {
  connection: Connection
  /** The execution root. */
  root: string
  /** The disk it is on, in bytes. */
  disk: { free: number; total: number } | null
  /** Bytes the measured directories take. */
  total: number
  /** Whether a measurement is still running, so the sizes will change. */
  measuring: boolean
  /** Whether this machine can show a path in Finder. */
  canReveal: boolean
  /** The largest first. */
  items: DirectoryItem[]
}
export interface DirectoryEntry {
  name: string
  kind: 'folder' | 'file' | 'link' | 'other'
  /** Bytes on disk; null for a folder not measured yet. */
  size: number | null
  modifiedAt: string
}
export interface DirectoryFilesView {
  connection: Connection
  key: string
  name: string
  /** The folder shown, as an absolute path. */
  path: string
  /** The folder shown, relative to the directory; empty for the directory itself. */
  relative: string
  ticket: DirectoryItem['ticket']
  size: number | null
  measuring: boolean
  /** The largest first, at most 500. */
  entries: DirectoryEntry[]
  /** How many entries of this folder are not listed. */
  omitted: number
  canReveal: boolean
}

/**
 * What became of the running main Session when its model was set: `switched` from its next model call, `unsupported` when the
 * companion is missing or older than 0.3.0, `failed` with the reason.
 */
export type MainModelSwitch = { result: 'switched'; model: string } | { result: 'unsupported' } | { result: 'failed'; error: string }

export interface InsightsView {
  connection: Connection
  /** Tickets that wait for a person now. */
  waiting: { count: number; longestMs: number | null; medianMs: number | null }
  /** Ended Tickets of the last `days` days by outcome, all and proactive only. */
  outcomes: { days: number; all: Partial<Record<TicketOutcome, number>>; proactive: Partial<Record<TicketOutcome, number>> }
  /** Threads where people not on the list asked the agent in the last seven days and were turned away. */
  demand: { thread: string; title: string; source: string; count: number; latestAt: string; example: string; triggerId?: string }[]
  capacity: { maxWorkers: number; running: number; queued: number; peakQueued: number | null }
  /** Hourly samples the BFF recorded over the last seven days. */
  trend: { at: string; waiting: number; queued: number; running: number }[]
  calibration: { mode: AcceptMode; pending: number; ready: string[] }
  /** What the agent said for the Tickets of the last `outcomes.days` days; null without the companion plugin. */
  speech: SpeechStats | null
}

export interface Recipe {
  id: string
  name: string
  description: string
  /** Recipes about one Feishu chat ask which. */
  needsChat: boolean
  chats?: { id: string; name: string }[]
  /** Already in place: for a chat recipe, the chats it is in place for. */
  applied: boolean | string[]
}
export interface RecipesView { connection: Connection; recipes: Recipe[] }

/* ---- M2a: policy and calibration ---- */

export type AcceptMode = 'off' | 'observe' | 'auto'
/** What a message becomes under an admission-table cell. */
export type Admission = 'explicit' | 'inferred' | 'ignore'
/** The cells of a receiving scope: whether the sender is on the list, and whether the message addresses the agent. */
export type AdmissionCell = 'listedUnaddressed' | 'unlistedAddressed' | 'unlistedUnaddressed'
export interface Rule { id: string; name: string; enabled: boolean; instruction: string }
export interface Allowed { id: string; name?: string }

export interface AdmissionRow {
  id: string
  label: string
  /** What the Source receives in this scope, such as "全部消息" or "仅 @". */
  note: string
  /** A cell exists only where the Source receives such messages; `value` is the stored choice or the default. */
  cells: Record<AdmissionCell, { available: boolean; value: Admission; options: readonly Admission[] }>
}

export interface SourcePolicyView {
  id: string
  title: string
  /** What counts as an explicit request on this Source. */
  explicit: string
  allowed: Allowed[]
  /** Bots whose messages may become inferred candidates; absent when the Source has no bot list. */
  bots?: Allowed[]
  /** Membership sync, such as a Feishu chat's members. */
  sync?: { label: string; ready: boolean; error?: string }
  rows: AdmissionRow[]
}

/** An open Ticket's Mandate facts, so a draft's impact can be shown before saving. */
export interface MandateFacts { id: string; title: string; strength: 'explicit' | 'inferred'; source: string; sender?: string; rules: string[] }

export interface PolicyHistoryItem {
  revision: number
  savedAt: string
  /** Who saved it: the console or upstream's panel, the main Session at a person's request, or a membership sync. */
  origin: 'panel' | 'tool' | 'sync'
  policyChanged: boolean
  changes: string[]
  notified: { id: string; title: string }[]
}

export interface PolicyRevisions { policy: number; eval: number }

export interface PolicyView {
  connection: Connection
  policyVersion: string
  mode: AcceptMode
  revisions: PolicyRevisions
  rules: Rule[]
  sources: SourcePolicyView[]
  tickets: MandateFacts[]
  history: PolicyHistoryItem[]
}

/** What the console edits; the BFF merges it into the stored blocks, keeping fields it does not know. */
export interface PolicyDraft {
  mode: AcceptMode
  rules: Rule[]
  sources: Record<string, { allowed: Allowed[]; bots?: Allowed[]; admission: Record<string, Partial<Record<AdmissionCell, Admission>>> }>
}
export interface PolicySave { draft: PolicyDraft; revisions: PolicyRevisions }

export type CalibrationLabel = 'right' | 'wrong' | 'scope'
export interface CalibrationItem {
  decisionId: string
  at: string
  /** `wouldAccept` in observe mode, `accept` for proactive work accepted in auto mode, `ignore` for an assessed candidate turned down. */
  outcome: 'wouldAccept' | 'accept' | 'ignore'
  thread: string
  threadTitle?: string
  triggerId?: string
  preview: string
  reason: string
  ticket?: { id: string; title: string }
  rules: { id: string; name: string; matched: boolean; reason: string }[]
  label?: { value: CalibrationLabel; at: string; note?: string }
}

export interface RuleStats {
  id: string
  name: string
  enabled: boolean
  /** Judgements that matched this rule and that the operator labelled. */
  labelled: number
  agreed: number
  /** Matches per day over the last seven days: what switching to auto would add. */
  perDay: number
  verdict: 'ready' | 'needs-work' | 'too-few' | 'watching' | 'disabled'
}

export interface CalibrationView {
  connection: Connection
  mode: AcceptMode
  rules: RuleStats[]
  pending: CalibrationItem[]
  labelled: CalibrationItem[]
  /** Assessed candidates turned down that the operator says should have been accepted. */
  missed: number
}

/* ---- M1: board, ticket workbench, threads, message paths, search ---- */

/** Where a Ticket is, in the words the console uses; `queued` is upstream's `working` waiting for a worker slot. */
export type TicketStageKey = 'queued' | 'working' | 'person' | 'idle' | 'ended'
export type TicketOutcome = 'completed' | 'merged' | 'closed' | 'dropped' | 'stopped'

export interface TicketCard {
  id: string
  title: string
  stage: TicketStageKey
  action?: PersonAction
  outcome?: TicketOutcome
  summary: string
  question?: string
  note?: { text: string; error: boolean }
  strength: 'explicit' | 'inferred'
  thread?: ThreadRef
  updatedAt: string
}

export interface BoardView {
  connection: Connection
  status: StatusSummary
  columns: Record<TicketStageKey, TicketCard[]>
  /** All ended Tickets; `columns.ended` shows the latest few. */
  endedTotal: number
}

/** One event in a Ticket's history, already in plain words. */
export interface TimelineEntry {
  at: string
  kind: 'request' | 'decision' | 'assignment' | 'report' | 'message' | 'note' | 'policy' | 'end'
  title: string
  detail?: string
  tone?: 'warn' | 'danger' | 'ok' | 'muted'
  /** A message's id and thread, to look up where it went. */
  triggerId?: string
  thread?: string
}

export interface TicketThread extends ThreadRef {
  /** `origin`: the request came from it; `follows`: messages there reach the Ticket; `context`: read for context only. */
  role: 'origin' | 'follows' | 'context'
}

export interface TicketView {
  connection: Connection
  id: string
  title: string
  stage: TicketStageKey
  action?: PersonAction
  outcome?: TicketOutcome
  ended?: { at: string; by: 'executor' | 'human'; reason?: string }
  waitingSince?: string
  createdAt: string
  updatedAt: string
  question?: string
  note?: { text: string; error: boolean }
  summary: string
  strength: 'explicit' | 'inferred'
  /** Why it may do this work: the Mandate in one sentence, and its parts. */
  why: { sentence: string; actor: string; scope: string; policyVersion: string; rules: string[] }
  threads: TicketThread[]
  reply?: { url: string; label: string }
  execution: {
    sessionId?: string
    directory?: string
    assignments: number
    running: boolean
    environment: { key: string; value: string; description: string }[]
  }
  /** Oldest first. */
  timeline: TimelineEntry[]
  /** What the agent said in this Ticket's conversations, oldest first; null without the companion plugin. */
  said: SaidMessage[] | null
  actions: { retry: boolean; stop: boolean }
}

export type ThreadFilter = 'subscribed' | 'evaluating' | 'recent' | 'all'
export type ThreadStage = 'error' | 'evaluating' | 'queued' | 'subscribed' | 'dormant' | 'unsubscribed'
export interface ThreadRow extends ThreadRef {
  stage: ThreadStage
  lastAt: string
  tickets: { id: string; title: string; open: boolean }[]
  latest?: { actor: string; preview: string; at: string }
  pending: number
}
export interface ThreadListView { connection: Connection; filter: ThreadFilter; items: ThreadRow[]; total: number }

/** Where one message went, step by step, ending in a verdict. */
export interface MessagePath {
  steps: { tone: 'pass' | 'stop' | 'route' | 'info' | 'wait'; title: string; detail?: string; ticketId?: string }[]
  verdict: { tone: 'ok' | 'warn' | 'danger' | 'accent' | 'infer' | 'muted'; label: string }
  /** A person may send it to Eval again. */
  requeue: boolean
}
export interface MessageRow {
  id: string
  actor: string
  human: boolean
  at: string
  text: string
  url?: string
  thread: string
  threadTitle?: string
  path: MessagePath
}

export interface ThreadView extends ThreadRow {
  connection: Connection
  url?: string
  /** Tickets on this thread; `context` ones only read it. */
  ticketCards: (TicketCard & { context: boolean })[]
  /** Oldest first. */
  messages: MessageRow[]
  /** There are older messages than these. */
  earlier: boolean
  /** Messages here reach at least one Ticket, and a person may stop that. */
  unsubscribe: boolean
}

export interface SearchView {
  query: string
  tickets: TicketCard[]
  threads: ThreadRow[]
  messages: MessageRow[]
}

/* ---- M3a: the companion plugin ---- */

/** Whether the companion plugin runs beside dsh-superagent; without it the transcript and message views are empty. */
export type CompanionState = { installed: true; version: string } | { installed: false }

/** One step of a worker Session, as the Ticket workbench shows it. Times are ISO strings; `seq` orders and pages them. */
export type TranscriptItem =
  /** Work handed to the worker: the Assignment, or a new message on a thread it follows. */
  | { kind: 'input'; seq: number; at: string; label: string; text: string }
  | { kind: 'thinking'; seq: number; at: string; text: string }
  | { kind: 'say'; seq: number; at: string; text: string; interrupted: boolean }
  /** `ok` is null while the call has no result yet. `label` says what it touched: a command's description, a file, a resource. */
  | { kind: 'tool'; seq: number; at: string; name: string; label: string; args: string; ok: boolean | null; result?: string; error?: string; exit?: string; ms?: number }
  | { kind: 'turn'; seq: number; at: string; text: string }
export interface TranscriptView {
  connection: Connection
  companion: CompanionState
  sessionId?: string
  /** False until the worker's Session exists, such as while the Ticket is queued. */
  exists: boolean
  /** A turn is in progress, so more is coming. */
  running: boolean
  /** Older items exist; ask again with `before` set to the first item's `seq`. */
  more: boolean
  /** Oldest first. */
  items: TranscriptItem[]
  /** Models the worker called, as `provider · model`, first used first; `model` is its latest call's. Null when the companion is too old to say. */
  models: string[] | null
  model?: string
}

/** A message dsh-superagent queued for a Ticket's conversation: sent, still waiting, or dropped. */
export interface SaidMessage {
  kind: 'acknowledgement' | 'reply' | 'notice'
  status: 'pending' | 'sent' | 'dropped'
  source: string
  text: string
  dropped?: { at: string; reason: string }
}
/** Message counts for the Tickets of a period. */
export interface SpeechStats {
  tickets: number
  messages: { acknowledgement: number; reply: number; notice: number }
  /** Per Ticket that said anything; `top` is the one that said the most. */
  perTicket: { median: number; max: number; top?: { id: string; title: string; count: number } }
  pending: number
  dropped: number
}
