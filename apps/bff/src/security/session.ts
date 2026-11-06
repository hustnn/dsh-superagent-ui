/**
 * Who may use the console in the local access mode: whoever holds the launch token.
 *
 * The BFF prints a URL with the token; the console trades it once for a signed session cookie (`POST /api/session`). The
 * token and the signing key live in the data directory with owner-only permissions, so a restart (including `node
 * --watch` in development) keeps both valid. Anyone who can read that file already controls the operator's account.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const COOKIE = 'sa_console'
export const SESSION_MAX_AGE_S = 7 * 24 * 3600

export interface Secrets { token: string; key: string }

export function loadSecrets(dataDir: string): Secrets {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const file = join(dataDir, 'secret.json')
  if (existsSync(file)) {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<Secrets>
    if (typeof value.token === 'string' && typeof value.key === 'string') return { token: value.token, key: value.key }
  }
  const secrets = { token: randomBytes(24).toString('base64url'), key: randomBytes(32).toString('base64url') }
  writeFileSync(file, JSON.stringify(secrets, null, 2) + '\n', { mode: 0o600 })
  chmodSync(file, 0o600)
  return secrets
}

const digest = (value: string) => createHash('sha256').update(value).digest()
/** Compares the token in constant time; hashing first makes the lengths equal. */
export function tokenMatches(expected: string, given: unknown): boolean {
  return typeof given === 'string' && timingSafeEqual(digest(expected), digest(given))
}

const sign = (key: string, payload: string) => createHmac('sha256', key).update(payload).digest('base64url')
/** A session value: `v1.<issued at, ms>.<signature>`. Stateless, so the BFF keeps no session table. */
export function issueSession(key: string, now = Date.now()): string {
  const payload = `v1.${now}`
  return `${payload}.${sign(key, payload)}`
}
export function validSession(key: string, value: string | undefined, now = Date.now()): boolean {
  if (!value) return false
  const match = /^(v1\.(\d{1,15}))\.([A-Za-z0-9_-]{43})$/.exec(value)
  if (!match) return false
  const [, payload, issued, signature] = match as unknown as [string, string, string, string]
  const expected = Buffer.from(sign(key, payload)), given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false
  const age = now - Number(issued)
  return age >= 0 && age <= SESSION_MAX_AGE_S * 1000
}
