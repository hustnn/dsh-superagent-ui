/**
 * The Policy as the operator edits it: who may ask (allowed lists, bot lists, the admission table), what the agent may do
 * on its own (rules and the accept mode), and the history of saves. Saving merges the console's draft into the stored
 * blocks, so fields the console does not show, such as a Feishu sync target, are kept as they are.
 */
import type { AcceptMode, Admission, AdmissionCell, AdmissionRow, Connection, MandateFacts, PolicyDraft, PolicyHistoryItem, PolicyView,
  SourcePolicyView } from '@dsh-superagent-ui/contract'
import type { UpstreamClient } from '../upstream/client.ts'
import type { HistoryView, PolicyConfig, SettingsChange, SettingsView, SourcePolicy, TicketPageView } from '../upstream/types.ts'
import { sourceName } from './tickets.ts'

/** `ADMISSION_OPTIONS` and `ADMISSION_DEFAULTS` in upstream `src/admission.ts`. */
export const ADMISSION_OPTIONS: Record<AdmissionCell, readonly Admission[]> = {
  listedUnaddressed: ['inferred', 'ignore'], unlistedAddressed: ['explicit', 'inferred', 'ignore'], unlistedUnaddressed: ['inferred', 'ignore'],
}
export const ADMISSION_DEFAULTS: Record<AdmissionCell, Admission> = { listedUnaddressed: 'inferred', unlistedAddressed: 'ignore', unlistedUnaddressed: 'ignore' }
const CELLS = Object.keys(ADMISSION_DEFAULTS) as AdmissionCell[]

const zh = (text: string | { zh: string }) => typeof text === 'string' ? text : text.zh

function sourcePolicy(source: SettingsView['sources'][number], part: SourcePolicy | undefined): SourcePolicyView | undefined {
  const policy = source.policy
  if (!policy) return undefined
  const stored = part ?? { allowed: [], admission: {} }
  const hasBots = policy.fields.some(field => field.key === 'bots')
  const rows: AdmissionRow[] = (policy.rows ?? []).map(row => ({
    id: row.id, label: zh(row.label), note: zh(row.note),
    cells: Object.fromEntries(CELLS.map(cell => [cell, { available: row.cells[cell], value: stored.admission[row.id]?.[cell] ?? ADMISSION_DEFAULTS[cell],
      options: ADMISSION_OPTIONS[cell] }])) as AdmissionRow['cells'],
  }))
  const syncError = policy.sync?.health?.state === 'error' ? policy.sync.health.detail : undefined
  return {
    id: source.id, title: zh(source.title), explicit: zh(policy.explicit), allowed: stored.allowed,
    ...hasBots ? { bots: stored.bots ?? [] } : {},
    ...policy.sync ? { sync: { label: zh(policy.sync.label), ready: policy.sync.ready, ...syncError ? { error: syncError } : {} } } : {},
    rows,
  }
}

/** What each open Ticket's Mandate rests on, read from its page: the sender, the rules it matched, how strong it is. */
export function mandateFacts(page: TicketPageView): MandateFacts {
  const sender = page.basis.facts.find(fact => fact.name === 'sender')
  return {
    id: page.id, title: page.title, strength: page.mandate.strength, source: page.mandate.actor.source,
    ...sender && sender.name === 'sender' ? { sender: sender.value } : {},
    rules: page.basis.facts.flatMap(fact => fact.name === 'rules' ? fact.value.map(rule => rule.id) : []),
  }
}

const MODE: Record<AcceptMode, string> = { off: '关闭', observe: '观察', auto: '自动' }
const FIELDS: Record<string, string> = { allowed: '名单', bots: 'bot 列表', chats: '监听的群', syncChat: '同步名单的群' }
/** One saved change in a sentence (`change.<code>` in upstream's panel). */
export function changeText(change: SettingsChange): string {
  const source = change.source ? sourceName(change.source) : ''
  // A field named in Latin letters ("bot 列表") reads better with a space after "的".
  const named = change.field ? FIELDS[change.field] ?? change.field : ''
  const field = /^[A-Za-z]/.test(named) ? ` ${named}` : named
  // Upstream names a changed chat by its listen mode ("all"), not the chat, so those rows are counted instead of named.
  const listenModes = change.field === 'chats' && change.items?.every(item => item === 'all' || item === 'mentions')
  const items = listenModes ? `${change.items!.length} 个` : change.items?.join('、') ?? ''
  switch (change.code) {
    case 'ruleAdded': return `新增规则「${change.name}」`
    case 'ruleRenamed': return `规则「${change.from}」改名为「${change.to}」`
    case 'ruleInstruction': return `改了规则「${change.name}」的说明`
    case 'ruleEnabled': return `启用规则「${change.name}」`
    case 'ruleDisabled': return `停用规则「${change.name}」`
    case 'ruleRemoved': return `删除规则「${change.name}」`
    case 'sourceEnabled': return `启用来源 ${source}`
    case 'sourceDisabled': return `停用来源 ${source}`
    case 'sourceField': return `改了 ${source} 的${field}`
    case 'sourceRowsAdded': return `${source} 的${field}加入 ${items}`
    case 'sourceRowsRemoved': return `${source} 的${field}移除 ${items}`
    case 'sourceRowsChanged': return `${source} 的${field}改了 ${items}`
    case 'sourceAdmission': return `改了 ${source} 的准入表`
    case 'mode': return `主动接单从「${MODE[change.from as AcceptMode] ?? change.from}」改为「${MODE[change.to as AcceptMode] ?? change.to}」`
    case 'timeout': return `评估时限从 ${change.from} 秒改为 ${change.to} 秒`
    case 'evalModel': return '换了主 Session 的模型'
    case 'executorModel': return '换了 worker 模型'
    case 'maxWorkers': return `并发从 ${change.from} 改为 ${change.to}`
    case 'paused': return '暂停处理'
    case 'resumed': return '恢复处理'
    case 'executionDirectory': return '改了 Ticket 目录的位置'
    case 'prepareCommand': return '改了 prepare 命令'
    case 'blockedCommands': return '改了禁用命令'
    default: return change.code
  }
}

export function historyItems(history: HistoryView, limit = 10): PolicyHistoryItem[] {
  return history.items.slice(0, limit).map(item => ({
    revision: item.revision, savedAt: item.savedAt, origin: item.source, policyChanged: item.policyChanged,
    changes: item.changes ? item.changes.map(changeText) : [item.revision === 1 ? '第一次保存设置' : '上一个版本没有记录，没法逐项比较'],
    notified: item.notified,
  }))
}

type Reads = Pick<UpstreamClient, 'settings' | 'policyHistory' | 'tickets' | 'ticket'>
export async function buildPolicy(upstream: Reads, connection: () => Connection): Promise<PolicyView> {
  const [settings, history, open] = await Promise.all([upstream.settings(), upstream.policyHistory(), upstream.tickets('open', 1000)])
  // The impact preview needs each open Ticket's Mandate basis, which only its page carries.
  const pages = await Promise.all(open.items.map(row => upstream.ticket(row.id).catch(() => undefined)))
  const policy = settings.blocks.policy.value
  return {
    connection: connection(),
    policyVersion: settings.policyVersion.slice(0, 7),
    mode: settings.blocks.eval.value.mode,
    revisions: { policy: settings.blocks.policy.revision, eval: settings.blocks.eval.revision },
    rules: policy.rules,
    sources: settings.sources.flatMap(source => { const view = sourcePolicy(source, policy.sources[source.id]); return view ? [view] : [] }),
    tickets: pages.flatMap(page => page ? [mandateFacts(page)] : []),
    history: historyItems(history),
  }
}

export class DraftError extends Error {}
const RULE_ID = /^[a-zA-Z0-9_-]{1,80}$/

/** Applies the draft to the stored Policy. Admission cells the draft leaves as they were stay untouched, so an unchanged draft changes nothing. */
export function mergePolicy(stored: PolicyConfig, draft: PolicyDraft): PolicyConfig {
  const ids = new Set<string>()
  for (const rule of draft.rules) {
    if (!RULE_ID.test(rule.id)) throw new DraftError(`规则 id「${rule.id}」只能用字母、数字、- 和 _`)
    if (ids.has(rule.id)) throw new DraftError(`规则 id「${rule.id}」重复了`)
    ids.add(rule.id)
    if (!rule.name.trim()) throw new DraftError('每条规则都要有名字')
    if (!rule.instruction.trim()) throw new DraftError(`规则「${rule.name}」还没有说明`)
  }
  const sources: Record<string, SourcePolicy> = { ...stored.sources }
  for (const [id, part] of Object.entries(draft.sources)) {
    const previous = stored.sources[id] ?? { allowed: [], admission: {} }
    const admission = structuredClone(previous.admission ?? {})
    for (const [row, cells] of Object.entries(part.admission)) {
      for (const cell of CELLS) {
        const value = cells[cell]
        if (value === undefined) continue
        if (!ADMISSION_OPTIONS[cell].includes(value)) throw new DraftError(`准入表里「${row}」这一格不能设为 ${value}`)
        if (value === (previous.admission?.[row]?.[cell] ?? ADMISSION_DEFAULTS[cell])) continue
        admission[row] = { ...admission[row], [cell]: value }
      }
    }
    sources[id] = { ...previous, allowed: part.allowed, admission, ...part.bots ? { bots: part.bots } : {} }
  }
  return { rules: draft.rules.map(rule => ({ ...rule, name: rule.name.trim(), instruction: rule.instruction.trim() })), sources }
}
