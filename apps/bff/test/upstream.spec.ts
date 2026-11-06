import { afterEach, describe, expect, it } from 'vitest'
import { startMockSuperagent, type MockSuperagent } from '../src/mock/superagent.ts'
import { ConnectionMonitor, UpstreamClient, UpstreamError } from '../src/upstream/client.ts'

let mock: MockSuperagent | undefined
afterEach(async () => { await mock?.close(); mock = undefined })

const failureOf = async (call: Promise<unknown>) => {
  try { await call } catch (error) { return error as UpstreamError }
  throw new Error('expected the call to fail')
}

describe('UpstreamClient', () => {
  it('passes upstream’s same-origin check', async () => {
    mock = await startMockSuperagent()
    const state = await new UpstreamClient(mock.url).state()
    expect(state.setup.accounts?.agent).toBe('acme-agent')
  })
  it('is refused without the marker header, as upstream refuses it', async () => {
    mock = await startMockSuperagent()
    const bare = await fetch(`${mock.url}/orchestrator/api/state`)
    expect(bare.status).toBe(403)
    const stripped: typeof fetch = (input, init) => fetch(input, { ...init, headers: {} })
    const error = await failureOf(new UpstreamClient(mock.url, { fetch: stripped }).state())
    expect(error.kind).toBe('forbidden')
  })
  it('tells an unmounted superagent from a refused request', async () => {
    const empty404: typeof fetch = async () => new Response('', { status: 404 })
    expect((await failureOf(new UpstreamClient('http://127.0.0.1:1', { fetch: empty404 }).state())).kind).toBe('not-mounted')
    const userError: typeof fetch = async () => Response.json({ error: 'Ticket not found' }, { status: 404 })
    const refused = await failureOf(new UpstreamClient('http://127.0.0.1:1', { fetch: userError }).stop('nope'))
    expect([refused.kind, refused.status, refused.message]).toEqual(['rejected', 404, 'Ticket not found'])
  })
  it('reports an unreachable superagent', async () => {
    mock = await startMockSuperagent()
    const url = mock.url
    await mock.close()
    mock = undefined
    expect((await failureOf(new UpstreamClient(url, { timeoutMs: 1000 }).state())).kind).toBe('unreachable')
  })
})

describe('ConnectionMonitor', () => {
  it('announces changes, and treats a refused request as a working connection', () => {
    const monitor = new ConnectionMonitor('http://127.0.0.1:3082')
    const seen: string[] = []
    monitor.onChange(connection => seen.push(connection.upstream))
    monitor.fail(new UpstreamError('unreachable', 'down'))
    monitor.fail(new UpstreamError('unreachable', 'down'))
    monitor.fail(new UpstreamError('rejected', 'Ticket not found', 404))
    expect(seen).toEqual(['unreachable', 'ok'])
  })
})
