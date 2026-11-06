import { afterEach, describe, expect, it } from 'vitest'
import type { HealthView, HomeView } from '@dsh-superagent-ui/contract'
import { seedWorld } from '../src/mock/superagent.ts'
import { harness, PORT } from './support.ts'

let h: Awaited<ReturnType<typeof harness>>
afterEach(async () => { await h?.close() })

describe('the door', () => {
  it('refuses a request whose Host is not the BFF, even with a valid session', async () => {
    h = await harness()
    const response = await h.call('/api/home', { headers: { host: `rebound.example:${PORT}` } })
    expect(response.status).toBe(403)
  })
  it('asks for a session without the cookie', async () => {
    h = await harness()
    const response = await h.call('/api/home', { session: false })
    expect(response.status).toBe(401)
    expect(((await response.json()) as { error: { kind: string } }).error.kind).toBe('unauthenticated')
  })
  it('trades the launch token for an HttpOnly, SameSite=Strict cookie', async () => {
    h = await harness()
    const refused = await h.call('/api/session', { method: 'POST', session: false, body: { token: 'wrong' } })
    expect(refused.status).toBe(401)
    const accepted = await h.call('/api/session', { method: 'POST', session: false, body: { token: h.secrets.token } })
    expect(accepted.status).toBe(200)
    const cookie = accepted.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^sa_console=v1\./)
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/SameSite=Strict/)
  })
  it('refuses a mutation without the console header, before reaching upstream', async () => {
    h = await harness()
    const response = await h.call('/api/tickets/tk_142/stop', { method: 'POST' })
    expect(response.status).toBe(403)
    expect(h.mock.world.tickets.find(t => t.id === 'tk_142')?.state).toBe('open')
    expect(h.audit.recent()).toEqual([])
  })
})

describe('views', () => {
  it('home lists what waits for a person, longest wait first, and the problems', async () => {
    h = await harness()
    const home = await (await h.call('/api/home')).json() as HomeView
    expect(home.connection.upstream).toBe('ok')
    expect(home.person.map(item => [item.id, item.action])).toEqual([['tk_142', 'answer'], ['tk_318', 'review'], ['tk_139', 'failed']])
    expect(home.person[0]?.question).toMatch(/30s 提到 60s/)
    expect(home.person[0]?.reply?.url).toMatch(/issues\/142$/)
    expect(home.status).toMatchObject({ running: 3, queued: 1, idle: 2, maxWorkers: 3, paused: false, repository: 'acme/harness-app' })
    // Nothing basic is missing, so the next step is to review the proactive judgements observe mode recorded.
    expect(home.next?.kind).toBe('calibrate')
    expect(home.problems.map(p => p.kind)).toEqual(['source-error', 'outgoing', 'eval-unavailable'])
  })
  it('home makes setup the next step instead of a problem', async () => {
    const world = seedWorld()
    world.setupProblem = { place: 'github', code: 'githubAccount', values: {}, detail: 'The agent account cannot push to acme/harness-app' }
    h = await harness({ world })
    const home = await (await h.call('/api/home')).json() as HomeView
    expect(home.next).toEqual({ kind: 'setup', place: 'github', detail: 'The agent account cannot push to acme/harness-app' })
    expect(home.problems.some(p => p.kind === 'setup')).toBe(false)
  })
  it('home asks for a first request until a Ticket exists', async () => {
    const world = seedWorld()
    world.tickets = []
    h = await harness({ world })
    const home = await (await h.call('/api/home')).json() as HomeView
    expect(home.next).toEqual({ kind: 'first-request', repository: 'acme/harness-app', agent: 'acme-agent', bot: 'Harness 助手' })
  })
  it('health shows sources, all problems, and the audit log', async () => {
    h = await harness()
    await h.post('/api/executor/pause', { paused: true })
    const health = await (await h.call('/api/health')).json() as HealthView
    expect(health.sources.map(s => [s.id, s.state])).toEqual([['github', 'ready'], ['feishu', 'error']])
    expect(health.problems.map(p => p.kind)).toContain('executor-paused')
    expect(health.audit[0]).toMatchObject({ action: 'executor.pause', tier: 'high', outcome: 'ok' })
  })
})

describe('operations', () => {
  it('every operation that changes something has a tier above read', async () => {
    h = await harness()
    // Previews are POSTs that change nothing.
    const writes = h.routes.filter(route => route.method !== 'GET' && !route.path.endsWith('/preview'))
    expect(writes.length).toBeGreaterThan(0)
    for (const route of writes) expect(route.tier, route.path).not.toBe('read')
  })
  it('stops a ticket upstream and audits it as a high-risk operation', async () => {
    h = await harness()
    const response = await h.post('/api/tickets/tk_142/stop')
    expect(response.status).toBe(200)
    expect(h.mock.world.tickets.find(t => t.id === 'tk_142')?.ended?.outcome).toBe('stopped')
    expect(h.audit.recent()[0]).toMatchObject({ principal: 'local-browser', tier: 'high', action: 'ticket.stop', target: 'tk_142', outcome: 'ok' })
  })
  it('passes upstream refusals through and audits them as errors', async () => {
    h = await harness()
    const response = await h.post('/api/tickets/tk_142/retry')
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: { kind: string; message: string } }).error).toMatchObject({ kind: 'bad-request', message: 'This ticket has nothing to retry' })
    expect(h.audit.recent()[0]).toMatchObject({ action: 'ticket.retry', outcome: 'error' })
  })
  it('checks the pause body', async () => {
    h = await harness()
    expect((await h.post('/api/executor/pause', { paused: 'yes' })).status).toBe(400)
    expect(h.mock.world.paused).toBe(false)
  })
  it('lets the access mode deny a tier, and audits the denial', async () => {
    h = await harness({ access: { name: 'local', authorize: tier => tier === 'high' ? { ok: false, reason: 'High-risk operations need a fresh passkey' } : { ok: true } } })
    const response = await h.post('/api/tickets/tk_142/stop')
    expect(response.status).toBe(403)
    expect(h.mock.world.tickets.find(t => t.id === 'tk_142')?.state).toBe('open')
    expect(h.audit.recent()[0]).toMatchObject({ action: 'ticket.stop', outcome: 'denied' })
    expect((await h.post('/api/tickets/tk_139/retry')).status).toBe(200)
  })
  it('answers 503 with the upstream state when dsh-superagent is gone', async () => {
    h = await harness()
    await h.mock.close()
    const response = await h.call('/api/home')
    expect(response.status).toBe(503)
    expect(((await response.json()) as { error: { upstream: string } }).error.upstream).toBe('unreachable')
    expect(h.monitor.current.upstream).toBe('unreachable')
  })
})
