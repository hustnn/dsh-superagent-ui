/** The home view: the next step, if any, then what waits for the operator, longest wait first. */
import type { Connection, HomeView, NextStep, PersonItem } from '@dsh-superagent-ui/contract'
import type { UpstreamClient } from '../upstream/client.ts'
import type { OverviewProblem, OverviewView, StateView } from '../upstream/types.ts'
import { setupText } from './reasons.ts'
import { NEXT_STEP_KINDS, personItem, problemItem, statusOf } from './shared.ts'

type Reads = Pick<UpstreamClient, 'state' | 'overview' | 'tickets'>

/** `calibration` reports proactive judgements waiting for review, which become the next step once nothing more basic is missing. */
export async function buildHome(upstream: Reads, connection: () => Connection,
  calibration?: () => Promise<{ mode: string; pending: number; ready: string[] }>): Promise<HomeView> {
  const [state, overview] = await Promise.all([upstream.state(), upstream.overview()])
  const person = overview.person.map(personItem).filter((item): item is PersonItem => !!item)
    .sort((a, b) => a.waitingSince.localeCompare(b.waitingSince))
  let next = nextStep(state, overview) ?? await firstRequest(upstream, state, person.length)
  if (!next && calibration) {
    const summary = await calibration().catch(() => undefined)
    if (summary && summary.mode !== 'off' && summary.pending > 0) next = { kind: 'calibrate', pending: summary.pending, ready: summary.ready }
  }
  return {
    connection: connection(),
    status: statusOf(state, overview),
    next,
    person,
    problems: overview.problems.filter(problem => !NEXT_STEP_KINDS.has(problem.kind)).map(problemItem),
  }
}

/** Setup comes first, then a Source to listen on, then someone allowed to ask. */
export function nextStep(state: StateView, overview: OverviewView): NextStep | null {
  const setup = state.setup.problem
    ?? overview.problems.find((problem): problem is Extract<OverviewProblem, { kind: 'setup' }> => problem.kind === 'setup')
  if (setup) return { kind: 'setup', place: setup.place, detail: setupText(setup) }
  if (overview.problems.some(problem => problem.kind === 'no-source')) return { kind: 'no-source' }
  if (overview.problems.some(problem => problem.kind === 'no-allowed')) return { kind: 'no-allowed' }
  return null
}

/** Until the first Ticket exists, the next step is to make one. */
async function firstRequest(upstream: Reads, state: StateView, waiting: number): Promise<NextStep | null> {
  if (waiting) return null
  const [open, ended] = await Promise.all([upstream.tickets('open', 1), upstream.tickets('ended', 1)])
  if (open.total || ended.total) return null
  const accounts = state.setup.accounts
  return { kind: 'first-request', ...accounts ? { repository: accounts.repository, agent: accounts.agent, ...accounts.feishu ? { bot: accounts.feishu.name } : {} } : {} }
}
