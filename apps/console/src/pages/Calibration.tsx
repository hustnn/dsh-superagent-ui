/**
 * Calibration: the way from observe mode to letting the agent work on its own. Review what it would have accepted; per rule,
 * how often you agreed and how often it matches say whether the rule can run alone and what that will add each day.
 */
import { useEffect, useState } from 'react'
import type { CalibrationItem, CalibrationLabel, CalibrationView, PolicyView, RuleStats } from '@dsh-superagent-ui/contract'
import { ApiError, call } from '../api'
import { ConnectionBanner, Pill, useUi } from '../components/ui'
import { affected, draftOf } from '../impact'
import { useLive, useLiveData } from '../live'
import { href } from '../route'
import { clock, type Tone } from '../text'

const VERDICT: Record<RuleStats['verdict'], [Tone, string]> = {
  ready: ['ok', '已达放手标准'],
  'needs-work': ['danger', '误判偏多，建议改写说明或停用'],
  'too-few': ['muted', '样本太少，继续标注'],
  watching: ['muted', '继续观察'],
  disabled: ['muted', '已停用'],
}
const OUTCOME: Record<CalibrationItem['outcome'], [Tone, string]> = { wouldAccept: ['infer', '本会接单'], accept: ['ok', '已主动接单'], ignore: ['muted', '评估后没接'] }
const LABELS: Record<CalibrationItem['outcome'], [CalibrationLabel, string][]> = {
  wouldAccept: [['right', '判断正确'], ['wrong', '不该接'], ['scope', '该接，但范围不对']],
  accept: [['right', '判断正确'], ['wrong', '不该接'], ['scope', '该接，但范围不对']],
  ignore: [['right', '判断正确'], ['wrong', '其实该接']],
}
const LABEL_TEXT: Record<CalibrationLabel, string> = { right: '判断正确', wrong: '判断错了', scope: '范围不对' }

export function Calibration() {
  const { data, error, reload } = useLiveData(['calibration'], 'calibration', () => call('GET /api/calibration'))
  const policy = useLiveData(['policy'], 'policy', () => call('GET /api/policy'))
  const { connection } = useLive()
  return <>
    <div className="head"><div><h1>校准</h1><p>在放手之前，先看它会怎么判断。你的标注只存在控制台里，用来算每条规则和你一致的程度。</p></div></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data ? <Body view={data} policy={policy.data} reload={async () => { await Promise.all([reload(), policy.reload()]) }} /> : !error && <div className="card empty">正在读取…</div>}
  </>
}

function Body({ view, policy, reload }: { view: CalibrationView; policy?: PolicyView; reload: () => Promise<void> }) {
  const { toast } = useUi()
  const [busy, setBusy] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const label = async (item: CalibrationItem, value: CalibrationLabel | null) => {
    setBusy(item.decisionId)
    try { await call('POST /api/calibration/:id', { params: { id: item.decisionId }, body: { label: value } }); await reload() }
    catch (error) { toast(error instanceof ApiError ? error.message : String(error)) }
    finally { setBusy(null) }
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const first = view.pending[0]
      if (!first || event.metaKey || event.ctrlKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement).tagName) || document.querySelector('.layer')) return
      const choice = LABELS[first.outcome][Number(event.key) - 1]
      if (choice) { event.preventDefault(); void label(first, choice[0]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const enabled = view.rules.filter(rule => rule.enabled)
  const perDay = Math.round(enabled.reduce((sum, rule) => sum + rule.perDay, 0) * 10) / 10

  return <>
    <div className={`callout ${view.mode === 'auto' ? 'accent' : view.mode === 'observe' ? 'warn' : 'muted'}`}>
      <div className="lbl">{view.mode === 'auto' ? '自动接单' : view.mode === 'observe' ? '观察模式' : '主动接单已关闭'}</div>
      {view.mode === 'auto' ? '命中启用规则的消息会直接接单。继续复核，看主动接的活做得对不对。'
        : view.mode === 'observe' ? '命中规则的消息只记录为“本会接单”，不执行。复核下面的判断，决定哪些规则可以放手。'
        : <>现在只处理明确请求，不会产生新的主动判断。要开始观察，去<a href={href.policy()}>策略页</a>把主动接单改成“观察”。</>}
    </div>

    <div className="grid3">{view.rules.map(rule => <div key={rule.id} className="stat">
      <div className="l">{rule.name}</div>
      <div className="n mono">{rule.labelled ? `${rule.agreed}/${rule.labelled}` : '—'}</div>
      <div className="l">判断一致 · 每天命中约 {rule.perDay} 次</div>
      <div className="l"><Pill tone={VERDICT[rule.verdict][0]} dot={false}>{VERDICT[rule.verdict][1]}</Pill></div>
    </div>)}</div>

    <section>
      <div className="sec-t"><h2>待复核 <span className="muted mono">{view.pending.length}</span></h2>
        {view.pending.length > 0 && <span className="muted small">数字键 <span className="kbd">1</span> <span className="kbd">2</span> <span className="kbd">3</span> 标注第一条</span>}</div>
      {view.pending.length ? <div className="msgs">{view.pending.map((item, i) => <Judgement key={item.decisionId} item={item} first={i === 0} busy={busy === item.decisionId}
        onLabel={value => void label(item, value)} />)}</div>
        : <div className="card empty"><h2>都复核完了</h2><p>新的判断会出现在这里。</p></div>}
      {view.missed > 0 && <p className="muted small gap-top">另有 {view.missed} 条评估后没接、你认为该接的消息：可能缺一条规则，或者某条规则的说明太窄。</p>}
    </section>

    {view.labelled.length > 0 && <section>
      <div className="sec-t"><h2 className="muted">最近标注的</h2></div>
      <div className="card rows">{view.labelled.map(item => <div key={item.decisionId} className="row static">
        <div><Pill tone={item.label?.value === 'right' ? 'ok' : 'danger'} dot={false}>{item.label ? LABEL_TEXT[item.label.value] : ''}</Pill></div>
        <div className="body"><div className="ask">{item.preview}</div></div>
        <div className="acts"><button className="btn sm ghost" disabled={busy === item.decisionId} onClick={() => void label(item, null)}>撤销</button></div>
      </div>)}</div>
    </section>}

    {view.mode !== 'off' && policy && <section className="card pad switch-card">
      <div className="grow">
        <h2>{view.mode === 'auto' ? '已经在自动接单' : '准备好放手了吗'}</h2>
        <p className="sub small">{view.mode === 'auto' ? '随时可以切回观察模式；进行中的主动 Ticket 会收到通知，不会被取消。'
          : `按现在启用的规则，切到自动接单后每天大约多出 ${perDay} 个主动 Ticket。`}</p>
      </div>
      <button className="btn primary" onClick={() => setSwitching(true)}>{view.mode === 'auto' ? '切回观察' : '预览切换'}</button>
    </section>}
    {switching && policy && <SwitchDialog view={view} policy={policy} onClose={() => setSwitching(false)} onDone={reload} />}
  </>
}

function Judgement({ item, first, busy, onLabel }: { item: CalibrationItem; first: boolean; busy: boolean; onLabel: (value: CalibrationLabel) => void }) {
  const [tone, text] = OUTCOME[item.outcome]
  const hit = item.rules.filter(rule => rule.matched), miss = item.rules.filter(rule => !rule.matched)
  return <article className={`msg${first ? ' focus' : ''}`}>
    <header><Pill tone={tone}>{text}</Pill>
      {item.triggerId ? <a href={href.thread(item.thread, item.triggerId)}>{item.threadTitle ?? item.thread}</a> : <span>{item.threadTitle ?? item.thread}</span>}
      <span className="muted mono">{clock(item.at)}</span>
      {item.ticket && <a href={href.ticket(item.ticket.id)} className="muted">Ticket「{item.ticket.title}」</a>}</header>
    <p className="text">{item.preview}</p>
    <div className="judg">
      {hit.map(rule => <div key={rule.id}><b>命中「{rule.name}」</b>：{rule.reason}</div>)}
      {!hit.length && <div><b>没有命中规则</b>：{item.reason}</div>}
      {miss.map(rule => <div key={rule.id} className="muted">未命中「{rule.name}」：{rule.reason}</div>)}
    </div>
    <footer>{LABELS[item.outcome].map(([value, label], i) => <button key={value} className="btn sm" disabled={busy} onClick={() => onLabel(value)}>
      {label}{first && <span className="kbd">{i + 1}</span>}</button>)}
      {item.triggerId && <a className="btn sm ghost" href={href.thread(item.thread, item.triggerId)}>看上下文</a>}</footer>
  </article>
}

function SwitchDialog({ view, policy, onClose, onDone }: { view: CalibrationView; policy: PolicyView; onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useUi()
  const toAuto = view.mode !== 'auto'
  // Rules the operator's labels say are not ready start unticked; the rest of the enabled ones stay on.
  const [keep, setKeep] = useState(() => new Set(view.rules.filter(rule => rule.enabled && rule.verdict !== 'needs-work').map(rule => rule.id)))
  const [saving, setSaving] = useState(false)
  const draft = { ...draftOf(policy), mode: toAuto ? 'auto' as const : 'observe' as const,
    rules: policy.rules.map(rule => toAuto && rule.enabled ? { ...rule, enabled: keep.has(rule.id) } : rule) }
  const perDay = Math.round(view.rules.filter(rule => toAuto ? keep.has(rule.id) : false).reduce((sum, rule) => sum + rule.perDay, 0) * 10) / 10
  const hit = affected(policy, draft)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const save = async () => {
    setSaving(true)
    try {
      const saved = await call('PUT /api/policy', { body: { draft, revisions: policy.revisions } })
      toast(`${toAuto ? '已切到自动接单' : '已切回观察模式'}，策略版本 ${saved.policyVersion}`)
      onClose()
      await onDone()
    } catch (error) { toast(error instanceof ApiError ? error.message : String(error)) } finally { setSaving(false) }
  }
  return <div className="layer" onClick={onClose}>
    <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="switch-title" onClick={event => event.stopPropagation()}>
      <h2 id="switch-title">{toAuto ? '切换到自动接单' : '切回观察模式'}</h2>
      {toAuto ? <>
        <p className="sub">切换后，命中下面勾选规则的消息会直接接单。没勾选的规则会被停用。</p>
        <div className="checks">{view.rules.filter(rule => rule.enabled).map(rule => <label key={rule.id} className="check">
          <input type="checkbox" checked={keep.has(rule.id)} onChange={event => {
            const next = new Set(keep)
            if (event.target.checked) next.add(rule.id); else next.delete(rule.id)
            setKeep(next)
          }} />
          <span>{rule.name}</span><span className="muted small">{rule.labelled ? `${rule.agreed}/${rule.labelled} 一致` : '还没标注'} · 每天约 {rule.perDay} 次</span>
          <Pill tone={VERDICT[rule.verdict][0]} dot={false}>{VERDICT[rule.verdict][1]}</Pill>
        </label>)}</div>
        <p className="sub">按过去 7 天，每天大约多出 <b>{perDay}</b> 个主动 Ticket。明确请求不受影响；随时可以切回观察。</p>
      </> : <p className="sub">切回后，命中规则的消息只记录为“本会接单”。{hit.length ? `进行中的 ${hit.length} 个主动 Ticket 会收到通知，不会被取消。` : ''}</p>}
      <div className="acts">
        <button className="btn ghost" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={saving || (toAuto && !keep.size)} onClick={() => void save()}>{toAuto ? '切换并保存' : '切回观察'}</button>
      </div>
    </div>
  </div>
}
