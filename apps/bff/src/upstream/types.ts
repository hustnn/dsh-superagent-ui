/**
 * The parts of dsh-superagent's management API (`/orchestrator/api`) that the BFF reads.
 *
 * Mirrored by hand from upstream/dsh-superagent-prototype at commit 8c32a9d: `src/app/api.ts`, `src/app/http.ts`
 * (`stateView`), `src/app/views/{overview,records,sources,tickets}.ts`, `src/core/{stage,model,reasons}.ts`,
 * `src/setup.ts` and `src/sources/host.ts`. Only the fields the console uses are listed. When the submodule moves,
 * re-read those files and update this one; the mock in `src/mock` answers with these same shapes.
 */

export interface Localized { zh: string; en: string }
export type Text = string | Localized

export interface Health {
  state: 'starting' | 'ready' | 'paused' | 'error'
  detail: string
  at?: string
  code?: string
  values?: Record<string, string>
}

export interface SetupProblem {
  place: 'deployment' | 'github' | 'feishu'
  code: string
  values: Record<string, string>
  detail: string
}

/** `GET state` */
export interface StateView {
  setup: {
    /** The plugin's machine configuration; the limits change in DSH's plugin manager, `stateDir` only in the profile. */
    machine: { stateDir: string; promptMaxChars?: number; admissionContextMaxPages?: number; admissionContextTimeoutMs?: number }
    problem: SetupProblem | null
    feishuProblem: SetupProblem | null
    accounts: {
      repository: string
      agent: string
      feishu: { appId: string; brand: string; botId: string; name: string } | null
    } | null
  }
  load: { running: number; queued: number; maxWorkers: number }
  masterId: string
  paused: boolean
  health: Record<string, Health>
}

export interface Reason { code: string; values?: Record<string, string>; triggerId?: string }

export interface ThreadFact { label?: Text; value: Text; problem?: true }
export interface ThreadFactsView {
  key: string
  source: string
  title: string
  url?: string
  facts: Record<string, ThreadFact>
}
export interface ChannelRef { source: string; thread: string; address: Record<string, string> }

export type TicketOutcome = 'completed' | 'merged' | 'closed' | 'dropped' | 'stopped'
/** `ticketRow` in `views/tickets.ts`: `ticketSummary` with its Threads and, while it waits for a person, the reply link. */
export interface TicketRow {
  id: string
  title: string
  state: 'open' | 'ended'
  stage: 'person' | 'working' | 'idle' | 'ended'
  action?: 'delivery' | 'answer' | 'review' | 'blocked' | 'failed' | 'queued'
  note?: { text: string; error: boolean }
  actions: { retry: boolean; stop: boolean }
  strength: 'explicit' | 'inferred'
  ended?: { at: string; by: 'executor' | 'human'; outcome: TicketOutcome; reason?: string }
  attention?: { id: string; question: string; triggerId?: string }
  assignments: number
  inputs: number
  undelivered: number
  deliveryError?: string
  sessionId: string
  directory?: string
  summary: string
  createdAt: string
  updatedAt: string
  threads: ThreadFactsView[]
  reply?: { source: string; url: string; label: Localized }
}
/** `GET tickets` */
export interface TicketListView { items: TicketRow[]; total: number; next_offset: number | null }

/** `threadSummary`, reduced to what problems need. */
export interface ThreadSummary { key: string; source: string; title: string; stage: string; url?: string }

/** One entry of `overview().problems`. */
export type OverviewProblem =
  | ({ kind: 'setup' } & SetupProblem)
  | { kind: 'no-source' }
  | { kind: 'no-allowed' }
  | { kind: 'source-error'; source: { id: string; title: Localized; health: { name: string } & Health } }
  | { kind: 'executor-paused' }
  | { kind: 'runtime-error'; name: string; detail: string }
  | { kind: 'eval-overdue'; thread: ThreadSummary }
  | { kind: 'eval-unavailable'; decisionId: string; thread: ThreadSummary; reason: Reason[]; triggerId: string }
  | { kind: 'outgoing'; outgoing: { id: string; channel: ChannelRef; text: string; attempts: number; error?: string } }

/** `GET overview` */
export interface OverviewView {
  problems: OverviewProblem[]
  person: TicketRow[]
  executor: { running: number; queued: number; maxWorkers: number; idle: number }
  flow: { received: number; filtered: number; triggers: number; judged: number; accepted: number; evaluating: number; dropped: number }
  policyVersion: string
}

export type SourceState = 'missing' | 'off' | 'error' | 'setup' | 'starting' | 'paused' | 'ready'
/** One entry of `GET sources`. */
export interface SourceStatus {
  id: string
  title: Localized
  installed: boolean
  enabled: boolean
  state: SourceState
  health: ({ name: string } & Health)[]
  problem?: SetupProblem
  stats: { received: number; filtered: number; lastAt: string }
  filtered: { id: string; at: string; preview: string }[]
  dropped: {
    id: string
    kind: string
    channel: ChannelRef
    preview: string
    dropped: { at: string; reason: string }
    ticket?: { id: string; title: string }
    thread?: string
  }[]
}

/** Filters `GET tickets` accepts (`TICKET_FILTERS` in `src/app/api.ts`). */
export type TicketFilter = 'open' | 'person' | 'working' | 'idle' | 'ended'

/* ---- M1: tickets, threads, messages, search ---- */

/** `ActorView` in `views/records.ts`: a sender with the name the Policy or the Source gives it. */
export interface ActorView { source: string; id: string; name?: Localized }

export type DecisionOutcome = 'ignore' | 'accept' | 'reopen' | 'stop' | 'unavailable' | 'wouldAccept'
/** `decisionView` */
export interface DecisionView {
  id: string
  kind: 'ignore' | 'accept' | 'reopen' | 'stop' | 'unavailable'
  outcome: DecisionOutcome
  reason: Reason[]
  at: string
  strength: 'explicit' | 'inferred'
  ticketId?: string
  triggerIds: string[]
  thread: string
  rules: { id: string; name: string; matched: boolean; reason: string }[]
  threadTitle?: string
  preview: string
  ticketTitle?: string
}

/** `threadSummary` in full. */
export interface ThreadSummaryView {
  key: string
  source: string
  title: string
  stage: 'error' | 'evaluating' | 'queued' | 'subscribed' | 'dormant' | 'unsubscribed'
  latest?: { actor: ActorView; human: boolean; at: string; preview: string }
  lastAt: string
  createdAt: string
  subscriptions: number
  tickets: { id: string; title: string; state: 'open' | 'ended' | 'unknown' }[]
  pending: number
  pollError?: string
  url?: string
  facts: Record<string, ThreadFact>
}
/** `GET threads` */
export interface ThreadListView { items: ThreadSummaryView[]; total: number; next_offset: number | null }

/** `triggerView`: one message with where it went. */
export interface TriggerView {
  id: string
  source: string
  actor: ActorView
  human: boolean
  at: string
  text: string
  preview: string
  url?: string
  threads: string[]
  actions: { requeue: boolean }
  disposition: {
    queued: boolean
    evaluating: boolean
    delivered: boolean
    filtered?: Reason
    fanout: string[]
    handbacks: { ticketId: string; reason: string; at: string; title: string }[]
    decision?: { id: string; outcome: DecisionOutcome; reason: Reason[]; ticketId?: string }
  }
}
/** `GET threads/:key` */
export interface ThreadDetailView extends ThreadSummaryView {
  context: string[]
  correlated: { key: string; title: string }[]
  tickets: (ThreadSummaryView['tickets'][number] & Partial<TicketRow>)[]
  decisions: DecisionView[]
  timeline: TriggerView[]
  earlier: string | null
}

/** `GET search` */
export interface SearchView {
  tickets: Omit<TicketRow, 'threads' | 'reply'>[]
  items: (Omit<TriggerView, 'text'> & { threadTitle?: string; filtered?: Reason | '' })[]
  threads: ThreadSummaryView[]
}

/** `basisFacts` in `views/tickets.ts`: how the gate admitted the Trigger a Mandate came from, in reading order. */
export type BasisFact =
  | { name: 'addressed'; value: 'mention' | 'direct' } | { name: 'followup' }
  | { name: 'admission'; value: 'listedUnaddressed' | 'unlistedAddressed' | 'unlistedUnaddressed' } | { name: 'observation' }
  | { name: 'mode'; value: 'off' | 'observe' | 'auto' } | { name: 'rules'; value: { id: string; name: string }[] }
  | { name: 'sender'; value: string } | { name: 'legacyAuthority'; value: string } | { name: 'bot' }

export type ReportState = 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'dropped'
export interface AssignmentView {
  id: string
  state: 'pending' | 'running' | 'ended'
  createdAt: string
  startedAt?: string
  endedAt?: string
  endedReason?: string
  report?: { state: ReportState; summary: string; at: string }
  ref?: string
  turnEndedAt?: string
}
type InputBase = { id: string; at: string; delivered: boolean }
export type InputView = InputBase & (
  | { kind: 'trigger'; triggerId: string; human?: true; context?: true; note?: string
      trigger?: { id: string; actor: ActorView; human: boolean; preview: string; thread: string; handback?: { reason: string; at: string } } }
  | { kind: 'policy-changed'; from: string; to: string; effect?: { rules?: { name: string; change: 'changed' | 'disabled' }[]; proactive?: false; requesterAllowed?: false } }
  | { kind: 'reopen'; decisionId: string }
  | { kind: 'resumed'; triggerId: string }
  | { kind: 'text' | 'note'; text: string })

/** `GET tickets/:id`: `ticketDetail` with the execution environment. */
/** It spreads the Ticket's summary, then replaces the summary's counts of Assignments and Inputs with the lists. */
export interface TicketPageView extends Omit<TicketRow, 'threads' | 'assignments' | 'inputs'> {
  mandate: { strength: 'explicit' | 'inferred'; policyVersion: string; actor: ActorView; scope: string }
  basis: { facts: BasisFact[]; legacy: boolean }
  paused: boolean
  channels: { source: string; url: string; label: Localized }[]
  decision?: DecisionView
  assignments: AssignmentView[]
  /** Newest first. */
  inputs: InputView[]
  threads: (ThreadSummaryView & { context?: true })[]
  environment: { key: string; value: string; description: Localized; owner: string }[]
}

/* ---- M2a: settings, policy, history, decisions ---- */

export type AcceptMode = 'off' | 'observe' | 'auto'
export type Admission = 'explicit' | 'inferred' | 'ignore'
export type AdmissionCell = 'listedUnaddressed' | 'unlistedAddressed' | 'unlistedUnaddressed'
export interface Rule { id: string; name: string; enabled: boolean; instruction: string }
export interface Allowed { id: string; name?: string }
/** A Source's part of the Policy (`SourcePolicySchema` plus the kind's own fields, such as `bots` and `syncChat`). */
export interface SourcePolicy { allowed: Allowed[]; admission: Record<string, Partial<Record<AdmissionCell, Admission>>>; bots?: Allowed[]; [field: string]: unknown }
export interface PolicyConfig { rules: Rule[]; sources: Record<string, SourcePolicy> }
export interface EvalConfig { mode: AcceptMode; timeoutSeconds: number; model: { provider: string; model: string; reasoningEffort?: string } | null }
/** `AdmissionRowView` in `src/sources/kind.ts`: one receiving scope of a Source's admission table under its current config. */
export interface AdmissionRowView { id: string; label: Localized | string; note: Localized; cells: Record<AdmissionCell, boolean> }

/** `settingsView` in `views/settings.ts`, reduced to what the console reads. */
export interface SettingsView {
  policyVersion: string
  blocks: {
    policy: { value: PolicyConfig; revision: number }
    eval: { value: EvalConfig; revision: number }
    executor: { value: ExecutorConfig; revision: number }
  }
  environment?: EnvironmentView
  sources: {
    id: string
    kind: string
    title: Localized
    installed: boolean
    value: { enabled: boolean; config: Record<string, unknown> }
    revision: number
    fields: { key: string; type: string; label: Localized }[]
    /** Display names the Source resolved for its row keys: for Feishu, every chat the bot has joined. */
    labels?: Record<string, string>
    policy?: {
      fields: { key: string; type: string; label: Localized }[]
      explicit: Localized
      rows?: AdmissionRowView[]
      sync?: { label: Localized; ready: boolean; health?: Health }
    }
  }[]
}

/** `SettingsChange` in `src/app/settings-history.ts`. */
export interface SettingsChange {
  code: string; items?: string[]; from?: string | number | boolean; to?: string | number | boolean; name?: string; source?: string; field?: string; part?: true
}
/** `GET policy/history` */
export interface HistoryView {
  current: number
  policyVersion: string
  items: { revision: number; savedAt: string; source: 'panel' | 'tool' | 'sync'; block: string; policyVersion: string; policyChanged: boolean
    notified: { id: string; title: string }[]; changes: SettingsChange[] | null }[]
}
/** `GET decisions` */
export interface DecisionListView { items: DecisionView[]; next_offset: number | null }

/* ---- M2b/M2c: prompts, models, execution environment ---- */

/** `PromptConfigSchema` in upstream `src/app/prompts.ts`. */
export interface PromptConfig {
  communication: string
  scope: string
  delivery: string
  skills: Record<string, string>
  overrides?: Record<string, { text: string; base?: string }>
}
/** `GET prompts` (`promptsView` in `src/app/http.ts`). */
export interface PromptsView {
  current: { revision: number; previousRevision: number | null; savedAt: string; source: string; config: PromptConfig }
  defaults: PromptConfig
  sections: string[]
  builtin: string[]
  parts: { key: string; roles: ('orchestrator' | 'worker')[]; text: string; placeholders?: string[]; base: string }[]
  defaultChanged: { part: string; base?: string; previous?: string; removed?: true }[]
  /** The current revision, and the revision each live Session last used. */
  revision: number
  sessions: { sessionId: string; revision: number }[]
  revisions: { revision: number; previousRevision: number | null; savedAt: string; source: string; changed: string[] }[]
  next_offset: number | null
}
export interface PromptPartText { name: string; kind: 'fixed' | 'team' | 'generated'; key?: string; heading?: string; text: string }
/** `POST prompts/preview` */
export interface PromptPreview {
  orchestrator: string
  worker: string
  parts: { orchestrator: PromptPartText[]; worker: PromptPartText[] }
  skills: Record<string, string>
  scope: string
}
/** `GET models`: DSH's `ModelCatalog`. */
export interface ModelCatalog {
  default: { provider: string; model: string; reasoningEffort?: string }
  routableProviders: string[]
  groups: { id: string; name: string; models: { id: string; name: string; description?: string }[] }[]
  failures: { id: string; name: string; message: string }[]
}
export interface ExecutorConfig {
  model: { provider: string; model: string; reasoningEffort?: string } | null
  maxWorkers: number
  directory: string
  prepare: string
  blockedCommands: string[]
}
/** `settingsView().environment`: the Ticket directory root and the variables each owner declares. */
export interface EnvironmentView { root: string; variables: { owner: string; enabled: boolean; variables: { key: string; description: Localized }[] }[] }
