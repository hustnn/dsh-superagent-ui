/**
 * Calibration: the way out of observe mode. Upstream records every proactive judgement (would accept, accepted in auto
 * mode, or turned down after an assessment) with how each enabled rule was judged. The operator labels them; per rule, the
 * share they agreed with and how often the rule matches tell whether it can run on its own, and what that will cost.
 */
import type { CalibrationItem, CalibrationView, Connection, RuleStats } from '@dsh-superagent-ui/contract'
import type { Label, Labels } from '../labels.ts'
import type { UpstreamClient } from '../upstream/client.ts'
import type { DecisionView, Rule } from '../upstream/types.ts'
import { reasonText } from './reasons.ts'

const DAY = 86_400_000
/** How far back judgements are read, and over how many days a rule's rate is measured. */
export const WINDOW_DAYS = 14
export const RATE_DAYS = 7
/** A rule is ready once this many labelled judgements agree at this rate; below the lower rate it needs work. */
export const READY = { labelled: 10, rate: 0.85 }
export const NEEDS_WORK_RATE = 0.7
export const TOO_FEW = 5

export type Judgement = DecisionView & { outcome: CalibrationItem['outcome'] }
/** A judgement worth calibrating: proactive, and assessed against the rules. */
export function calibrated(decision: DecisionView): decision is Judgement {
  return decision.outcome === 'wouldAccept' || (decision.outcome === 'accept' && decision.strength === 'inferred')
    || (decision.outcome === 'ignore' && decision.rules.length > 0)
}

/** Proactive judgements of the last `WINDOW_DAYS`, newest first, reading upstream's pages until they are older. */
export async function judgements(upstream: Pick<UpstreamClient, 'decisions'>, now = Date.now()): Promise<Judgement[]> {
  const since = new Date(now - WINDOW_DAYS * DAY).toISOString()
  const found: DecisionView[] = []
  let offset: number | null = 0
  for (let page = 0; page < 5 && offset !== null; page++) {
    const list = await upstream.decisions('ignore,accept', offset, 200)
    found.push(...list.items)
    offset = list.items.length && list.items.at(-1)!.at >= since ? list.next_offset : null
  }
  return found.filter((decision): decision is Judgement => decision.at >= since && calibrated(decision))
}

export function item(decision: Judgement, label?: Label): CalibrationItem {
  return {
    decisionId: decision.id, at: decision.at, outcome: decision.outcome, thread: decision.thread,
    ...decision.threadTitle ? { threadTitle: decision.threadTitle } : {}, ...decision.triggerIds[0] ? { triggerId: decision.triggerIds[0] } : {},
    preview: decision.preview, reason: reasonText(decision.reason),
    ...decision.ticketId ? { ticket: { id: decision.ticketId, title: decision.ticketTitle ?? decision.ticketId } } : {},
    rules: decision.rules,
    ...label ? { label: { value: label.label, at: label.at, ...label.note ? { note: label.note } : {} } } : {},
  }
}

export function ruleStats(rules: Rule[], labels: Label[], decisions: DecisionView[], now = Date.now()): RuleStats[] {
  const since = new Date(now - RATE_DAYS * DAY).toISOString()
  return rules.map(rule => {
    const mine = labels.filter(label => label.outcome !== 'ignore' && label.rules.includes(rule.id))
    const agreed = mine.filter(label => label.label === 'right').length
    const matches = decisions.filter(decision => decision.at >= since && decision.outcome !== 'ignore'
      && decision.rules.some(judged => judged.id === rule.id && judged.matched)).length
    const rate = mine.length ? agreed / mine.length : 0
    const verdict: RuleStats['verdict'] = !rule.enabled ? 'disabled' : mine.length < TOO_FEW ? 'too-few'
      : rate < NEEDS_WORK_RATE ? 'needs-work' : mine.length >= READY.labelled && rate >= READY.rate ? 'ready' : 'watching'
    return { id: rule.id, name: rule.name, enabled: rule.enabled, labelled: mine.length, agreed, perDay: Math.round(matches / RATE_DAYS * 10) / 10, verdict }
  })
}

type Reads = Pick<UpstreamClient, 'decisions' | 'settings'>
export async function buildCalibration(upstream: Reads, labels: Labels, connection: () => Connection): Promise<CalibrationView> {
  const [settings, decisions] = await Promise.all([upstream.settings(), judgements(upstream)])
  const all = labels.all()
  const byDecision = new Map(all.map(label => [label.decisionId, label]))
  const pending = decisions.filter(decision => !byDecision.has(decision.id)).slice(0, 50).map(decision => item(decision))
  const labelled = decisions.filter(decision => byDecision.has(decision.id))
    .sort((a, b) => byDecision.get(b.id)!.at.localeCompare(byDecision.get(a.id)!.at)).slice(0, 20)
    .map(decision => item(decision, byDecision.get(decision.id)))
  return {
    connection: connection(),
    mode: settings.blocks.eval.value.mode,
    rules: ruleStats(settings.blocks.policy.value.rules, all, decisions),
    pending, labelled,
    missed: all.filter(label => label.outcome === 'ignore' && label.label === 'wrong').length,
  }
}

/** For the home page: how many judgements wait, and which rules look ready. */
export async function calibrationSummary(upstream: Reads, labels: Labels): Promise<{ mode: string; pending: number; ready: string[] }> {
  const [settings, decisions] = await Promise.all([upstream.settings(), judgements(upstream)])
  const all = labels.all()
  const labelled = new Set(all.map(label => label.decisionId))
  return {
    mode: settings.blocks.eval.value.mode,
    pending: decisions.filter(decision => !labelled.has(decision.id)).length,
    ready: ruleStats(settings.blocks.policy.value.rules, all, decisions).filter(rule => rule.verdict === 'ready').map(rule => rule.name),
  }
}
