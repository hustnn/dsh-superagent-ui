import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { issueSession, loadSecrets, SESSION_MAX_AGE_S, tokenMatches, validSession } from '../src/security/session.ts'
import { trusted } from '../src/security/trust.ts'

const headers = (values: Record<string, string>) => (name: string) => values[name]
const options = { port: 3090, origins: ['http://127.0.0.1:5173'] }

describe('trusted', () => {
  it('accepts the BFF on loopback, with or without its own Origin', () => {
    expect(trusted(headers({ host: '127.0.0.1:3090' }), options)).toEqual({ ok: true })
    expect(trusted(headers({ host: 'localhost:3090', origin: 'http://localhost:3090' }), options)).toEqual({ ok: true })
  })
  it('accepts the configured dev origin', () => {
    expect(trusted(headers({ host: '127.0.0.1:3090', origin: 'http://127.0.0.1:5173' }), options)).toEqual({ ok: true })
  })
  it('refuses another Host, as a DNS-rebinding page would send', () => {
    expect(trusted(headers({ host: 'evil.example:3090' }), options)).toEqual({ ok: false, reason: 'host' })
    expect(trusted(headers({ host: '127.0.0.1:3082' }), options)).toEqual({ ok: false, reason: 'host' })
  })
  it('refuses a foreign Origin and cross-site fetches', () => {
    expect(trusted(headers({ host: '127.0.0.1:3090', origin: 'https://evil.example' }), options)).toEqual({ ok: false, reason: 'origin' })
    expect(trusted(headers({ host: '127.0.0.1:3090', 'sec-fetch-site': 'cross-site' }), options)).toEqual({ ok: false, reason: 'cross-site' })
  })
})

describe('sessions', () => {
  const key = 'k'.repeat(43)
  it('accepts a session it issued until it expires', () => {
    const now = 1_800_000_000_000
    const value = issueSession(key, now)
    expect(validSession(key, value, now + 1000)).toBe(true)
    expect(validSession(key, value, now + SESSION_MAX_AGE_S * 1000 + 1)).toBe(false)
  })
  it('refuses tampered, foreign and malformed values', () => {
    const value = issueSession(key)
    expect(validSession(key, value.replace(/v1\.\d/, 'v1.9'))).toBe(false)
    expect(validSession('x'.repeat(43), value)).toBe(false)
    expect(validSession(key, 'v1.1.short')).toBe(false)
    expect(validSession(key, undefined)).toBe(false)
  })
  it('compares tokens exactly', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true)
    expect(tokenMatches('abc', 'abd')).toBe(false)
    expect(tokenMatches('abc', 42)).toBe(false)
  })
  it('keeps the token and key in an owner-only file and reuses them', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sa-console-')), 'data')
    const first = loadSecrets(dir)
    expect(statSync(join(dir, 'secret.json')).mode & 0o777).toBe(0o600)
    expect(loadSecrets(dir)).toEqual(first)
  })
})
