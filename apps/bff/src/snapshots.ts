/**
 * Hourly samples of what upstream only reports as "now": how many Tickets wait for a person, queue for a worker, or run.
 * Upstream keeps no such history, so the BFF records it while it runs, for the insights page's trends.
 */
import type { DatabaseSync } from 'node:sqlite'

export interface Snapshot { at: string; waiting: number; queued: number; running: number }

export class Snapshots {
  readonly #db: DatabaseSync
  constructor(db: DatabaseSync) {
    this.#db = db
  }
  record(snapshot: Snapshot): void {
    this.#db.prepare('INSERT OR REPLACE INTO snapshots (at, waiting, queued, running) VALUES (?, ?, ?, ?)').run(snapshot.at, snapshot.waiting, snapshot.queued, snapshot.running)
  }
  since(at: string): Snapshot[] {
    return this.#db.prepare('SELECT at, waiting, queued, running FROM snapshots WHERE at >= ? ORDER BY at').all(at) as unknown as Snapshot[]
  }
}

/** Samples are keyed by the hour, so recording twice in one hour keeps the later sample. */
export const hourOf = (time = Date.now()) => new Date(Math.floor(time / 3_600_000) * 3_600_000).toISOString()
