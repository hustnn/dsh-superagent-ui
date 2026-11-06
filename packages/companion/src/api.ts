/**
 * The companion's HTTP API, which the console's BFF calls on the DSH web server that serves dsh-superagent. It follows
 * upstream's management API: loopback Host, a request header, and no foreign Origin. Types and constants only.
 */
export const PLUGIN_NAME = '@dsh-superagent-ui/companion'
export const API_PATH = '/superagent-ui/api/'
export const REQUEST_HEADER = 'x-superagent-ui-request'

/** `GET info`: tells the BFF the companion is installed, and what it can do. */
export interface CompanionInfo { name: typeof PLUGIN_NAME; version: string; capabilities: Capability[] }
export type Capability = 'transcript' | 'outbox' | 'main-model'

/**
 * One readable step of a Session, projected from DSH's event log. Times are epoch milliseconds; `seq` is the event's
 * sequence number, which pages count back from. Long texts are cut and end with `…`.
 */
export type TranscriptEntry =
  /** Work handed to the Session: dsh-superagent delivers Assignments and new messages as user messages. */
  | { kind: 'input'; seq: number; at: number; text: string }
  /** The model's reasoning. */
  | { kind: 'thinking'; seq: number; at: number; text: string }
  /** What the model wrote outside tool calls; `interrupted` when its turn was cut off. */
  | { kind: 'say'; seq: number; at: number; text: string; interrupted?: true }
  /** A tool call with its result, once it has one, and the job that ran it, such as a shell command's exit. */
  | { kind: 'tool'; seq: number; at: number; callId: string; name: string; args: string; result?: ToolResult; job?: ToolJob }
  /** A turn's start, or its end with DSH's reason (`completed`, `interrupted`, …). */
  | { kind: 'turn'; seq: number; at: number; turn: number; end?: string }
export interface ToolResult { text: string; error?: string; at: number }
export interface ToolJob { status: string; detail?: string; ms?: number }

/** `GET transcript/<session id>?before=<seq>&limit=<n>`: the latest entries before `before`, oldest first. */
export interface Transcript {
  sessionId: string
  /** False when DSH has no stored Session of that id, such as a Ticket whose worker has not started. */
  exists: boolean
  entries: TranscriptEntry[]
  /** Whether entries older than the first one exist; ask again with `before` set to its `seq`. */
  more: boolean
  /** Whether a turn is still running, so more is coming. */
  running: boolean
  /** Every model the Session called, in the order first used, and the one its latest call used. Since 0.2.0. */
  models: ModelRef[]
  model?: ModelRef
  /** A model selected for the Session that it has not called yet: its next call uses this one. Since 0.3.0. */
  next?: ModelRef
}
/** A model route as DSH records it on each model call (`source` of an assistant message). */
export interface ModelRef { provider: string; model: string }

/** A model to run a Session on. */
export interface ModelSelection extends ModelRef { reasoningEffort?: string }
/**
 * `POST main-session/model`: switches the running main Session to `model`, or to the profile's default model when null, from
 * its next model call. Nothing else changes: not other Sessions, not the profile's default. Since 0.3.0.
 */
export interface MainModelRequest { model: ModelSelection | null }
export interface MainModelResult { sessionId: string; model: ModelSelection }

/** A message dsh-superagent queued for a Channel, as its outbox records it (upstream `Receipt`). Receipts carry no time. */
export interface OutboxReceipt {
  id: string
  kind: 'acknowledgement' | 'reply' | 'notice'
  status: 'pending' | 'sent' | 'dropped'
  source: string
  thread: string
  ticketId?: string
  text: string
  dropped?: { at: string; reason: string }
}
/** `GET outbox?ticket=<id>`: one Ticket's messages, in the order they were queued. */
export interface OutboxList { receipts: OutboxReceipt[] }
/** Message counts by kind and status. */
export interface OutboxCounts { acknowledgement: number; reply: number; notice: number; pending: number; dropped: number }
/** `GET outbox/summary`: counts for every Ticket that has messages, and for messages that belong to none. */
export interface OutboxSummary { tickets: Record<string, OutboxCounts>; unticketed: OutboxCounts }
