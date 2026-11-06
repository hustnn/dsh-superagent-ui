/**
 * The console's own database: what the console knows that dsh-superagent does not. One SQLite file in the data directory,
 * migrated by `PRAGMA user_version`; the BFF never writes dsh-superagent's database.
 */
import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS: string[] = [
  // 1: the audit log of non-read operations.
  `CREATE TABLE IF NOT EXISTS audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     principal TEXT NOT NULL,
     tier TEXT NOT NULL,
     action TEXT NOT NULL,
     target TEXT NOT NULL,
     outcome TEXT NOT NULL,
     detail TEXT
   );`,
  // 2: the operator's verdicts on proactive judgements, with what the judgement was when labelled.
  `CREATE TABLE IF NOT EXISTS labels (
     decision_id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     note TEXT,
     at TEXT NOT NULL,
     outcome TEXT NOT NULL,
     rules TEXT NOT NULL
   );`,
  // 3: hourly samples of how many Tickets wait for a person, queue, or run.
  `CREATE TABLE IF NOT EXISTS snapshots (
     at TEXT PRIMARY KEY,
     waiting INTEGER NOT NULL,
     queued INTEGER NOT NULL,
     running INTEGER NOT NULL
   );`,
]

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (let next = version; next < MIGRATIONS.length; next++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[next]!)
      db.exec(`PRAGMA user_version = ${next + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  return db
}
