/** The health view: Sources, every problem, the last day's flow, and the operations the console ran. */
import type { AuditEntry, Connection, HealthView, SourceItem } from '@dsh-superagent-ui/contract'
import type { UpstreamClient } from '../upstream/client.ts'
import type { SourceStatus } from '../upstream/types.ts'
import { companionState } from './companion.ts'
import { setupText } from './reasons.ts'
import { problemItem, statusOf } from './shared.ts'

type Reads = Pick<UpstreamClient, 'state' | 'overview' | 'sources' | 'companionInfo'>

export async function buildHealth(upstream: Reads, connection: () => Connection, audit: () => AuditEntry[]): Promise<HealthView> {
  const [state, overview, sources, companion] = await Promise.all([upstream.state(), upstream.overview(), upstream.sources(), upstream.companionInfo()])
  const accounts = state.setup.accounts
  const { received, filtered, judged, accepted, evaluating, dropped } = overview.flow
  return {
    connection: connection(),
    status: statusOf(state, overview),
    sources: sources.map(sourceItem),
    problems: overview.problems.map(problemItem),
    flow: { received, filtered, judged, accepted, evaluating, dropped },
    ...accounts ? { accounts: { repository: accounts.repository, agent: accounts.agent, ...accounts.feishu ? { feishu: accounts.feishu.name } : {} } } : {},
    companion: companionState(companion),
    audit: audit(),
  }
}

export function sourceItem(source: SourceStatus): SourceItem {
  return {
    id: source.id,
    title: source.title.zh,
    state: source.state,
    parts: source.health.map(part => ({ name: part.name, state: part.state, detail: part.detail })),
    ...source.problem ? { problem: setupText(source.problem) } : {},
    received: source.stats.received,
    filtered: source.stats.filtered,
    ...source.stats.lastAt ? { lastAt: source.stats.lastAt } : {},
    dropped: source.dropped.map(item => ({ id: item.id, preview: item.preview, reason: item.dropped.reason, at: item.dropped.at,
      ...item.ticket ? { ticket: item.ticket.title } : {} })),
  }
}
