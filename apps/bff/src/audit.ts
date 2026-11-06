/** The audit log: every non-read operation the console asked for, with who, what, and how it went. */
import type { DatabaseSync } from 'node:sqlite'
import type { AuditEntry } from '@dsh-superagent-ui/contract'

export class AuditLog {
  readonly #db: DatabaseSync
  constructor(db: DatabaseSync) {
    this.#db = db
  }

  record(entry: Omit<AuditEntry, 'id' | 'at'> & { at?: string }): void {
    this.#db.prepare('INSERT INTO audit (at, principal, tier, action, target, outcome, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(entry.at ?? new Date().toISOString(), entry.principal, entry.tier, entry.action, entry.target, entry.outcome, entry.detail ?? null)
  }

  recent(limit = 20): AuditEntry[] {
    const rows = this.#db.prepare('SELECT id, at, principal, tier, action, target, outcome, detail FROM audit ORDER BY id DESC LIMIT ?')
      .all(limit) as unknown as (Omit<AuditEntry, 'detail'> & { detail: string | null })[]
    return rows.map(({ detail, ...row }) => ({ ...row, ...detail === null ? {} : { detail } }))
  }
}
