import { describe, expect, it } from 'vitest'
import type { LiveEvent } from '@dsh-superagent-ui/contract'
import { LiveHub, type Fingerprints } from '../src/live.ts'
import { ConnectionMonitor, UpstreamError } from '../src/upstream/client.ts'

const fp = (home: string, health: string): Fingerprints => ({ home, health, board: home, ticket: home, threads: home, thread: home, policy: home, calibration: home,
  prompts: home, settings: home, insights: home })

function hubWith(results: (Fingerprints | Error)[]) {
  const monitor = new ConnectionMonitor('http://127.0.0.1:3082')
  const probe = async () => {
    const next = results.shift()
    if (!next) throw new Error('no more probes')
    if (next instanceof Error) throw next
    return next
  }
  const hub = new LiveHub(probe, monitor, 60_000)
  const events: LiveEvent[] = []
  const unsubscribe = hub.subscribe(event => events.push(event))
  return { hub, events, unsubscribe }
}

describe('LiveHub', () => {
  it('invalidates only the views whose upstream reads changed', async () => {
    const { hub, events } = hubWith([
      fp('a', 'x'),
      fp('a', 'x'),
      fp('b', 'x'),
      fp('c', 'y'),
    ])
    await hub.tick()
    await hub.tick()
    await hub.tick()
    await hub.tick()
    expect(events).toEqual([
      { type: 'invalidate', views: ['home', 'board', 'ticket', 'threads', 'thread', 'policy', 'calibration', 'prompts', 'settings', 'insights'] },
      { type: 'invalidate', views: ['home', 'health', 'board', 'ticket', 'threads', 'thread', 'policy', 'calibration', 'prompts', 'settings', 'insights'] },
    ])
    hub.close()
  })
  it('announces when upstream goes away and comes back, without invalidating unchanged views', async () => {
    const { hub, events } = hubWith([
      fp('a', 'x'),
      new UpstreamError('unreachable', 'connection refused'),
      fp('a', 'x'),
    ])
    await hub.tick()
    await hub.tick()
    await hub.tick()
    expect(events.map(event => event.type === 'connection' ? event.connection.upstream : event.type)).toEqual(['unreachable', 'ok'])
    hub.close()
  })
  it('stops polling when the last console leaves', async () => {
    const { hub, unsubscribe } = hubWith([fp('a', 'x')])
    expect(hub.clients).toBe(1)
    unsubscribe()
    expect(hub.clients).toBe(0)
    hub.close()
  })
})
