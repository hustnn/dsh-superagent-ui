/**
 * Calibration labels: the operator's verdict on each proactive judgement. dsh-superagent records what it would accept;
 * only the console records whether the operator agreed, so rule statistics survive however long observation lasts.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { CalibrationLabel } from '@dsh-superagent-ui/contract'

export interface Label {
  decisionId: string
  label: CalibrationLabel
  note?: string
  at: string
  /** The judgement when labelled: its outcome and the rules it matched. */
  outcome: string
  rules: string[]
}

export class Labels {
  readonly #db: DatabaseSync
  constructor(db: DatabaseSync) {
    this.#db = db
  }

  set(label: Omit<Label, 'at'> & { at?: string }): void {
    this.#db.prepare(`INSERT INTO labels (decision_id, label, note, at, outcome, rules) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(decision_id) DO UPDATE SET label = excluded.label, note = excluded.note, at = excluded.at, outcome = excluded.outcome, rules = excluded.rules`)
      .run(label.decisionId, label.label, label.note ?? null, label.at ?? new Date().toISOString(), label.outcome, JSON.stringify(label.rules))
  }

  clear(decisionId: string): void {
    this.#db.prepare('DELETE FROM labels WHERE decision_id = ?').run(decisionId)
  }

  all(): Label[] {
    const rows = this.#db.prepare('SELECT decision_id, label, note, at, outcome, rules FROM labels ORDER BY at DESC').all() as unknown as
      { decision_id: string; label: CalibrationLabel; note: string | null; at: string; outcome: string; rules: string }[]
    return rows.map(row => ({ decisionId: row.decision_id, label: row.label, ...row.note ? { note: row.note } : {}, at: row.at, outcome: row.outcome,
      rules: JSON.parse(row.rules) as string[] }))
  }
}
