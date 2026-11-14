/**
 * "This went wrong?": turns one concrete mistake into one edit. Pick what went wrong, see which prompt revision the worker
 * actually ran under, and add a line to the section that governs it, or go to the policy for work it should not have taken.
 */
import { useEffect, useState } from 'react'
import type { PromptsView } from '@dsh-superagent-ui/contract'
import { ApiError, call } from '../api'
import { t } from '../i18n'
import { href, navigate } from '../route'
import { useUi } from './ui'

type Section = 'communication' | 'scope' | 'delivery'
const TITLES: Record<Section, string> = { communication: t('Communication', '沟通规范'), scope: t('Ticket scope', 'Ticket 范围'), delivery: t('Delivery requirements', '交付要求') }
const governedBy = (section: Section) => t(`Governed by "${TITLES[section]}"`, `由「${TITLES[section]}」决定`)
const PROBLEMS: { id: Section | 'accept' | 'other'; label: string; hint: string; suggestion?: string }[] = [
  { id: 'communication', label: t('Talked too much, or spoke when it should not have', '话太多，或不该说的时候说了'), hint: governedBy('communication'), suggestion: 'Do not post progress updates in chat; post only the acknowledgement and the result.' },
  { id: 'scope', label: t('Went beyond what was asked', '做得超出了请求的范围'), hint: governedBy('scope'), suggestion: 'When the fix touches more than one module, stop and ask before changing the second one.' },
  { id: 'delivery', label: t('Delivery fell short: missing tests or screenshots, unclear description', '交付不达标：缺测试、缺截图、描述不清'), hint: governedBy('delivery'), suggestion: 'Every bug fix includes a test that fails before the change.' },
  { id: 'accept', label: t('It should never have taken this work', '这个活根本不该接'), hint: t("Governed by the policy's allow lists, admission table and rules", '由策略里的名单、准入表和规则决定') },
  { id: 'other', label: t('Something else', '别的问题'), hint: t('See every section on the Prompts page', '去提示词页看全部段落') },
]

export function TuneDialog({ ticketId, title, onClose }: { ticketId: string; title: string; onClose: () => void }) {
  const { toast } = useUi()
  const [section, setSection] = useState<Section | null>(null)
  const [line, setLine] = useState('')
  const [prompts, setPrompts] = useState<PromptsView | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  useEffect(() => { call('GET /api/prompts', { query: {} }).then(setPrompts, () => {}) }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const used = prompts?.sessions.find(session => session.sessionId === `worker-${ticketId}`)?.revision

  const choose = (id: (typeof PROBLEMS)[number]['id']) => {
    if (id === 'accept') { onClose(); navigate(href.policy()); return }
    if (id === 'other') { onClose(); navigate(href.prompts()); return }
    setSection(id)
    setLine(PROBLEMS.find(item => item.id === id)?.suggestion ?? '')
  }
  const save = async () => {
    if (!prompts || !section || !line.trim()) return
    setSaving(true)
    try {
      const current = prompts.config[section]
      const config = { ...prompts.config, [section]: current ? `${current.trimEnd()}\n${line.trim()}` : line.trim() }
      const saved = await call('PUT /api/prompts', { body: { config, baseRevision: prompts.current } })
      toast(t(`Saved as r${saved.revision}; every Session reads it on its next request`, `已保存为 r${saved.revision}；所有 Session 下一次请求就会读到`))
      onClose()
    } catch (error) { toast(error instanceof ApiError ? error.message : String(error)) } finally { setSaving(false) }
  }

  return <div className="layer" onClick={onClose}>
    <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="tune-title" onClick={event => event.stopPropagation()}>
      <h2 id="tune-title">{section ? t(`Add a line to "${TITLES[section]}"`, `给「${TITLES[section]}」加一句`) : t('What went wrong this time?', '这次哪里不对？')}</h2>
      <p className="sub small">{t(`The worker for "${title}" `, `「${title}」的 worker `)}{used !== undefined ? <>{t('last used prompt', '最近一次用的是提示词')} <span className="mono">r{used}</span></> : t('used an unknown prompt revision', '用的提示词版本未知')}
        {prompts ? <>{t('; the current one is', '，现在是')} <span className="mono">r{prompts.current}</span></> : ''}{t('.', '。')}</p>
      {!section ? <div className="choice">{PROBLEMS.map(item => <button key={item.id} onClick={() => choose(item.id)}><b>{item.label}</b><span>{item.hint}</span></button>)}</div> : <>
        <details><summary className="small">{t(`What "${TITLES[section]}" says now`, `「${TITLES[section]}」现在的内容`)}</summary><pre className="code">{prompts?.config[section] || t('(empty)', '（空）')}</pre></details>
        <textarea className="ed" rows={3} value={line} onChange={event => setLine(event.target.value)} aria-label={t('The line to add', '要加的一句')} />
        <p className="muted small">{t('This line goes at the end of the section; for bigger changes, use the Prompts page.', '提示词用英文写。这句会加在这一段的末尾；想改得更多，去提示词页。')}</p>
      </>}
      <div className="acts">
        {section && <button className="btn ghost" onClick={() => { onClose(); navigate(href.prompts(section)) }}>{t('Open on the Prompts page', '在提示词页打开')}</button>}
        <button className="btn ghost" onClick={onClose}>{t('Cancel', '取消')}</button>
        {section && <button className="btn primary" disabled={saving || !line.trim() || !prompts} onClick={() => void save()}>{t('Save as', '保存为')} r{(prompts?.current ?? 0) + 1}</button>}
      </div>
    </div>
  </div>
}
