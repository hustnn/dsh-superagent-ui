/**
 * "这次表现不对？": turns one concrete mistake into one edit. Pick what went wrong, see which prompt revision the worker
 * actually ran under, and add a line to the section that governs it, or go to the policy for work it should not have taken.
 */
import { useEffect, useState } from 'react'
import type { PromptsView } from '@dsh-superagent-ui/contract'
import { ApiError, call } from '../api'
import { href, navigate } from '../route'
import { useUi } from './ui'

type Section = 'communication' | 'scope' | 'delivery'
const PROBLEMS: { id: Section | 'accept' | 'other'; label: string; hint: string; suggestion?: string }[] = [
  { id: 'communication', label: '话太多，或不该说的时候说了', hint: '由「沟通规范」决定', suggestion: 'Do not post progress updates in chat; post only the acknowledgement and the result.' },
  { id: 'scope', label: '做得超出了请求的范围', hint: '由「Ticket 范围」决定', suggestion: 'When the fix touches more than one module, stop and ask before changing the second one.' },
  { id: 'delivery', label: '交付不达标：缺测试、缺截图、描述不清', hint: '由「交付要求」决定', suggestion: 'Every bug fix includes a test that fails before the change.' },
  { id: 'accept', label: '这个活根本不该接', hint: '由策略里的名单、准入表和规则决定' },
  { id: 'other', label: '别的问题', hint: '去提示词页看全部段落' },
]
const TITLES: Record<Section, string> = { communication: '沟通规范', scope: 'Ticket 范围', delivery: '交付要求' }

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
      toast(`已保存为 r${saved.revision}；所有 Session 下一次请求就会读到`)
      onClose()
    } catch (error) { toast(error instanceof ApiError ? error.message : String(error)) } finally { setSaving(false) }
  }

  return <div className="layer" onClick={onClose}>
    <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="tune-title" onClick={event => event.stopPropagation()}>
      <h2 id="tune-title">{section ? `给「${TITLES[section]}」加一句` : '这次哪里不对？'}</h2>
      <p className="sub small">「{title}」的 worker {used !== undefined ? <>最近一次用的是提示词 <span className="mono">r{used}</span></> : '用的提示词版本未知'}
        {prompts ? <>，现在是 <span className="mono">r{prompts.current}</span></> : ''}。</p>
      {!section ? <div className="choice">{PROBLEMS.map(item => <button key={item.id} onClick={() => choose(item.id)}><b>{item.label}</b><span>{item.hint}</span></button>)}</div> : <>
        <details><summary className="small">「{TITLES[section]}」现在的内容</summary><pre className="code">{prompts?.config[section] || '（空）'}</pre></details>
        <textarea className="ed" rows={3} value={line} onChange={event => setLine(event.target.value)} aria-label="要加的一句" />
        <p className="muted small">提示词用英文写。这句会加在这一段的末尾；想改得更多，去提示词页。</p>
      </>}
      <div className="acts">
        {section && <button className="btn ghost" onClick={() => { onClose(); navigate(href.prompts(section)) }}>在提示词页打开</button>}
        <button className="btn ghost" onClick={onClose}>取消</button>
        {section && <button className="btn primary" disabled={saving || !line.trim() || !prompts} onClick={() => void save()}>保存为 r{(prompts?.current ?? 0) + 1}</button>}
      </div>
    </div>
  </div>
}
