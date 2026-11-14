/**
 * What a Policy draft changes, and which open Tickets it bears on, worked out in the page so the save bar can say it before
 * anything is saved. The Ticket effects follow upstream's `policyEffects`: a rule a Ticket was accepted under changed or no
 * longer applies, its requester may no longer start work, or proactive work is no longer accepted. Upstream notifies those
 * Tickets; it never cancels them.
 */
import type { AcceptMode, Admission, AdmissionCell, PolicyDraft, PolicyView } from '@dsh-superagent-ui/contract'
import { t } from './i18n'

export const MODE_LABEL: Record<AcceptMode, string> = { off: t('Off', '关闭'), observe: t('Observe', '观察'), auto: t('Auto', '自动') }
export const ADMISSION_LABEL: Record<Admission, string> = { explicit: t('Explicit request', '明确请求'), inferred: t('Inferred candidate', '推断候选'), ignore: t('Ignore', '忽略') }
export const CELL_LABEL: Record<AdmissionCell, string> = {
  listedUnaddressed: t('On the list · not @ it', '名单内 · 没 @ 它'),
  unlistedAddressed: t('Not on the list · @ it', '名单外 · @ 了它'),
  unlistedUnaddressed: t('Not on the list · not @ it', '名单外 · 没 @ 它'),
}
const names = (items: string[]) => items.join(t(', ', '、'))

export function draftOf(view: PolicyView): PolicyDraft {
  return {
    mode: view.mode,
    rules: view.rules.map(rule => ({ ...rule })),
    sources: Object.fromEntries(view.sources.map(source => [source.id, {
      allowed: source.allowed.map(entry => ({ ...entry })),
      ...source.bots ? { bots: source.bots.map(entry => ({ ...entry })) } : {},
      admission: Object.fromEntries(source.rows.map(row => [row.id, Object.fromEntries((Object.keys(row.cells) as AdmissionCell[])
        .map(cell => [cell, row.cells[cell].value]))])),
    }])),
  }
}

const label = (entry: { id: string; name?: string }) => entry.name || entry.id

export function changes(view: PolicyView, draft: PolicyDraft): string[] {
  const out: string[] = []
  if (view.mode !== draft.mode) out.push(t(`Proactive work: ${MODE_LABEL[view.mode]} → ${MODE_LABEL[draft.mode]}`, `主动接单：${MODE_LABEL[view.mode]} → ${MODE_LABEL[draft.mode]}`))
  for (const rule of draft.rules) {
    const old = view.rules.find(item => item.id === rule.id)
    if (!old) { out.push(t(`New rule "${rule.name || 'Untitled'}"`, `新增规则「${rule.name || '未命名'}」`)); continue }
    if (old.name !== rule.name) out.push(t(`Rule "${old.name}" renamed to "${rule.name}"`, `规则「${old.name}」改名为「${rule.name}」`))
    if (old.instruction !== rule.instruction) out.push(t(`Changed the instruction of rule "${rule.name}"`, `改了规则「${rule.name}」的说明`))
    if (old.enabled !== rule.enabled) out.push(rule.enabled ? t(`Enabled rule "${rule.name}"`, `启用规则「${rule.name}」`) : t(`Disabled rule "${rule.name}"`, `停用规则「${rule.name}」`))
  }
  for (const rule of view.rules) if (!draft.rules.some(item => item.id === rule.id)) out.push(t(`Deleted rule "${rule.name}"`, `删除规则「${rule.name}」`))
  for (const source of view.sources) {
    const part = draft.sources[source.id]
    if (!part) continue
    const diff = (before: { id: string; name?: string }[], after: { id: string; name?: string }[], what: [string, string]) => {
      const added = after.filter(entry => !before.some(item => item.id === entry.id)).map(label)
      const removed = before.filter(entry => !after.some(item => item.id === entry.id)).map(label)
      if (added.length) out.push(t(`Added ${names(added)} to the ${source.title} ${what[0]}`, `${source.title} 的${what[1]}加入 ${names(added)}`))
      if (removed.length) out.push(t(`Removed ${names(removed)} from the ${source.title} ${what[0]}`, `${source.title} 的${what[1]}移除 ${names(removed)}`))
    }
    diff(source.allowed, part.allowed, ['allow list', '名单'])
    if (source.bots && part.bots) diff(source.bots, part.bots, ['bot list', ' bot 列表'])
    for (const row of source.rows) for (const cell of Object.keys(row.cells) as AdmissionCell[]) {
      const next = part.admission[row.id]?.[cell]
      if (next && next !== row.cells[cell].value) out.push(`${source.title} · ${row.label} · ${CELL_LABEL[cell]}${t(': ', '：')}${ADMISSION_LABEL[row.cells[cell].value]} → ${ADMISSION_LABEL[next]}`)
    }
  }
  return out
}

export interface Affected { id: string; title: string; why: string }
export function affected(view: PolicyView, draft: PolicyDraft): Affected[] {
  const touched = new Map<string, string>()
  for (const rule of view.rules) {
    const next = draft.rules.find(item => item.id === rule.id)
    if (!next || (rule.enabled && !next.enabled)) touched.set(rule.id, t(`the rule it relies on, "${rule.name}", no longer applies`, `它依据的规则「${rule.name}」不再生效`))
    else if (next.instruction !== rule.instruction) touched.set(rule.id, t(`the rule it relies on, "${rule.name}", changed`, `它依据的规则「${rule.name}」改了`))
  }
  return view.tickets.flatMap(ticket => {
    const why: string[] = ticket.rules.flatMap(rule => touched.has(rule) ? [touched.get(rule)!] : [])
    const before = view.sources.find(source => source.id === ticket.source)?.allowed ?? []
    const after = draft.sources[ticket.source]?.allowed ?? before
    if (ticket.sender && before.some(entry => entry.id === ticket.sender) && !after.some(entry => entry.id === ticket.sender)) why.push(t(`its requester ${ticket.sender} is no longer on the allow list`, `发起人 ${ticket.sender} 不在名单里了`))
    if (ticket.strength === 'inferred' && view.mode === 'auto' && draft.mode !== 'auto') why.push(t('proactive work is no longer accepted', '不再接受主动工作'))
    return why.length ? [{ id: ticket.id, title: ticket.title, why: why.join(t('; ', '；')) }] : []
  })
}
