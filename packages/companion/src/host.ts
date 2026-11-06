/**
 * The parts of DSH and dsh-superagent the companion uses, written out by hand like the BFF's mirror of the management API:
 * DSH 0.2.1 (`@deepseek-ai/dsh-host-webserver`, `@deepseek-ai/dsh-session-persistence`, `@deepseek-ai/dsh-session`,
 * `@deepseek-ai/dsh-api-session-controller`, `@deepseek-ai/dsh-agent-default-model`) and dsh-superagent at the commit
 * `upstream/` pins. Check them when either is upgraded.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import type { ModelSelection } from './api.ts'

/** The cordis context a plugin's `apply` receives, with the services it injects. */
export interface Context {
  /** Runs `work` now and its returned disposer when the plugin stops. */
  effect(work: () => () => void | Promise<void>, label?: string): void
  readonly logger: { info(format: string, ...args: unknown[]): void; warn(format: string, ...args: unknown[]): void }
  readonly webServer: WebServer
  readonly sessionPersistence: SessionPersistence
  readonly orchestrator: Orchestrator
  readonly sessionController: SessionController
  readonly agentDefaultModel: AgentDefaultModel
}

export interface WebServer {
  /** The configured bind address; dsh-superagent itself refuses anything but `127.0.0.1`. */
  readonly host: string
  readonly port: number
  /** Claims a path; `prefix` matches the path and everything under it. Returns the disposer. */
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
}

export interface SessionPersistence {
  /** A stored Session's header and size, or undefined when there is none. */
  stat(id: string): Promise<{ eventCount?: number } | undefined>
  /** `read` observes without taking ownership, so it works while dsh-superagent's Session writes. */
  open(id: string, access: 'read'): Promise<SessionReader>
  /** Writes what live Sessions appended; a reader only sees what has been written. */
  flush(): Promise<void>
}
export interface SessionReader {
  read(offset?: number, length?: number): Promise<{ events: readonly SessionEvent[] }>
  close(): Promise<void>
}
/** One record of a Session's event log (`SessionEvent` in `@deepseek-ai/dsh-session`); `data` depends on `type`. */
export interface SessionEvent { type: string; seq: number; time: number; data: unknown }

/** dsh-superagent's Runtime, which it provides as the `orchestrator` service; Source plugins see it as a `SourceHost`. */
export interface Orchestrator {
  readonly ready: Promise<void>
  /** The main Session's id. */
  readonly masterId: string
  /** The Store; its SQLite connection is read here only, never written (upstream `src/app/store.ts`). */
  readonly store: { readonly db: DatabaseSync }
}

export interface SessionController {
  /**
   * What DSH's Web UI calls when a person picks a Session's model. It applies from the Session's next model call, refuses with
   * an error when the Session or the model is not available, and starts saving the selection as the profile's default too.
   */
  selectModel(request: { sessionId: string } & ModelSelection): Promise<{ selected: ModelSelection }>
}

/** The profile's default model, which new Sessions start on. */
export interface AgentDefaultModel {
  currentSelection(): ModelSelection
  /** Saves commit in the order they were made; rejects when the profile cannot be written. */
  saveSelection(selection: ModelSelection): Promise<void>
}
