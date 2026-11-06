/** Starts the BFF: secrets, audit log, upstream client (or the mock), live updates, and the HTTP server on loopback. */
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { AuditLog } from './audit.ts'
import { openDatabase } from './db.ts'
import { Labels } from './labels.ts'
import { hourOf, Snapshots } from './snapshots.ts'
import { consoleUrl, devOrigins, loadConfig } from './config.ts'
import { fingerprints, LiveHub } from './live.ts'
import { MOCK_LABELS, mockSnapshots } from './mock/settings.ts'
import { startMockSuperagent } from './mock/superagent.ts'
import { localAccess } from './security/access.ts'
import { loadSecrets } from './security/session.ts'
import { createApp } from './server.ts'
import { ConnectionMonitor, UpstreamClient } from './upstream/client.ts'

// node:sqlite is stable enough for an append-only audit table; keep its experimental notice out of the operator's terminal.
process.removeAllListeners('warning').on('warning', warning => {
  if (warning.name !== 'ExperimentalWarning' || !/SQLite/i.test(warning.message)) console.warn(warning)
})

const config = loadConfig()
const secrets = loadSecrets(config.dataDir)
// The mock gets its own database, so its audit entries and labels never mix with a real deployment's.
const db = openDatabase(join(config.dataDir, config.mock ? 'console-mock.db' : 'console.db'))
const audit = new AuditLog(db)
const labels = new Labels(db)
const snapshots = new Snapshots(db)
const mock = config.mock ? await startMockSuperagent({ port: config.mockPort, simulate: true }) : undefined
if (mock && !labels.all().length) for (const label of MOCK_LABELS) labels.set(label)
// The mock's week is regenerated on each start; samples are keyed by the hour, so this replaces the previous week's.
if (mock) for (const sample of mockSnapshots(Date.now())) snapshots.record(sample)
const upstreamUrl = mock?.url ?? config.upstreamUrl
const upstream = new UpstreamClient(upstreamUrl)
const monitor = new ConnectionMonitor(upstreamUrl)
const live = new LiveHub(() => fingerprints(upstream), monitor, config.pollMs)
const { app } = createApp({
  port: config.port, devOrigins: devOrigins(config), secrets, upstream, monitor, audit, labels, snapshots, access: localAccess, live,
  meta: { accessMode: 'local', mock: !!mock, version: '0.4.0' }, staticDir: config.staticDir,
})

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port }, () => {
  console.log(`\nSuperagent 控制台  ${consoleUrl(config, secrets.token)}`)
  console.log(`dsh-superagent    ${upstreamUrl}${mock ? '（内置 mock，示例数据）' : ''}`)
  console.log(`数据目录          ${config.dataDir}\n`)
})

// Upstream reports only the present, so the BFF samples it for the insights trend; samples are keyed by the hour.
const sample = async () => {
  try {
    const overview = await upstream.overview()
    snapshots.record({ at: hourOf(), waiting: overview.person.length, queued: overview.executor.queued, running: overview.executor.running })
  } catch { /* dsh-superagent is unreachable; the connection monitor reports it */ }
}
void sample()
const sampler = setInterval(() => void sample(), 15 * 60_000)

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  live.close()
  clearInterval(sampler)
  server.close()
  await mock?.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
