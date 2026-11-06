/** A BFF wired to a fresh mock dsh-superagent, with a request helper that looks like the local console. */
import { AuditLog } from '../src/audit.ts'
import { openDatabase } from '../src/db.ts'
import { Labels } from '../src/labels.ts'
import { Snapshots } from '../src/snapshots.ts'
import { fingerprints, LiveHub } from '../src/live.ts'
import { seedWorld, startMockSuperagent, type MockWorld } from '../src/mock/superagent.ts'
import { localAccess, type AccessMode } from '../src/security/access.ts'
import { COOKIE, issueSession } from '../src/security/session.ts'
import { createApp } from '../src/server.ts'
import { ConnectionMonitor, UpstreamClient } from '../src/upstream/client.ts'

export const PORT = 3090
export const DEV_ORIGIN = 'http://127.0.0.1:5173'

export async function harness(options: { access?: AccessMode; world?: MockWorld; reveal?: (path: string) => Promise<void> } = {}) {
  const mock = await startMockSuperagent({ world: options.world ?? seedWorld() })
  const upstream = new UpstreamClient(mock.url, { timeoutMs: 1000 })
  const monitor = new ConnectionMonitor(mock.url)
  const db = openDatabase(':memory:')
  const audit = new AuditLog(db)
  const labels = new Labels(db)
  const snapshots = new Snapshots(db)
  const live = new LiveHub(() => fingerprints(upstream), monitor, 60_000)
  const secrets = { token: 'launch-token-for-tests', key: 'k'.repeat(43) }
  const { app, routes } = createApp({
    port: PORT, devOrigins: [DEV_ORIGIN], secrets, upstream, monitor, audit, labels, snapshots, access: options.access ?? localAccess, live,
    meta: { accessMode: 'local', mock: true, version: 'test' },
    // Tests never open a Finder window.
    reveal: options.reveal ?? (async () => {}),
  })
  const cookie = `${COOKIE}=${issueSession(secrets.key)}`
  const call = (path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown; session?: boolean } = {}) =>
    app.request(path, {
      method: init.method ?? 'GET',
      headers: { host: `127.0.0.1:${PORT}`, ...init.session === false ? {} : { cookie }, ...init.headers },
      ...init.body === undefined ? {} : { body: JSON.stringify(init.body) },
    })
  /** A mutating call as the console makes it. */
  const post = (path: string, body?: unknown, method = 'POST') => call(path, { method, body, headers: { 'x-console-request': '1', 'content-type': 'application/json' } })
  let closed = false
  return {
    mock, upstream, monitor, audit, labels, snapshots, live, app, routes, secrets, call, post,
    /** Safe to call twice: an `afterEach` may run after a test that started no harness of its own. */
    async close() {
      if (closed) return
      closed = true
      live.close(); db.close(); await mock.close()
    },
  }
}
