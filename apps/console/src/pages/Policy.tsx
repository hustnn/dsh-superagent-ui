/**
 * Policy: who may make the agent work, and what it may do on its own. Edits collect in a draft; the save bar says what will
 * change and which open Tickets it bears on before anything is saved, and every save becomes a new Policy version.
 */
import { useEffect, useMemo, useState } from 'react'
import type { AcceptMode, Admission, AdmissionCell, Allowed, CalibrationView, PolicyDraft, PolicyView, Rule, SourcePolicyView } from '@dsh-superagent-ui/contract'
import { ApiError, call } from '../api'
import { ConnectionBanner, Pill, useAction, useUi } from '../components/ui'
import { affected, ADMISSION_LABEL, CELL_LABEL, changes, draftOf, MODE_LABEL } from '../impact'
import { useLive, useLiveData } from '../live'
import { href } from '../route'
import { clock } from '../text'

const MODE_HINT: Record<AcceptMode, string> = {
  off: '只处理明确请求。没 @ 它的消息、bot 消息、名单外的人的追问，都不会成为候选。',
  observe: '候选会被评估；命中规则也只记录为“本会接单”，不执行。新部署从这里开始，在校准页复核这些判断。',
  auto: '命中启用规则的候选会直接接单。',
}
const ORIGIN = { panel: '控制台或面板', tool: '主 Session（应你的要求）', sync: '名单同步' } as const
const CELLS: AdmissionCell[] = ['listedUnaddressed', 'unlistedAddressed', 'unlistedUnaddressed']

export function Policy() {
  const { data, error, reload } = useLiveData(['policy'], 'policy', () => call('GET /api/policy'))
  const calibration = useLiveData(['calibration'], 'calibration', () => call('GET /api/calibration'))
  const { connection } = useLive()
  return <>
    <div className="head"><div><h1>策略</h1><p>谁能让它干活，它能主动做什么。每次保存生成一个新的策略版本，所有授权都记着它依据的版本。{data && <> 当前 <span className="mono">{data.policyVersion}</span>。</>}</p></div></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data ? <Editor view={data} stats={calibration.data} reload={reload} /> : !error && <div className="card empty">正在读取…</div>}
  </>
}

function Editor({ view, stats, reload }: { view: PolicyView; stats?: CalibrationView; reload: () => Promise<void> }) {
  const [base, setBase] = useState(view)
  const [draft, setDraft] = useState<PolicyDraft>(() => draftOf(view))
  const listed = useMemo(() => changes(base, draft), [base, draft])
  const dirty = listed.length > 0
  // A newer view replaces the draft only while nothing is being edited; otherwise the save will meet a conflict and say so.
  useEffect(() => { if (!dirty) { setBase(view); setDraft(draftOf(view)) } }, [view]) // eslint-disable-line react-hooks/exhaustive-deps
  const stale = dirty && (view.revisions.policy !== base.revisions.policy || view.revisions.eval !== base.revisions.eval)

  const setPart = (id: string, update: (part: PolicyDraft['sources'][string]) => PolicyDraft['sources'][string]) =>
    setDraft(current => ({ ...current, sources: { ...current.sources, [id]: update(current.sources[id]!) } }))
  const setRule = (id: string, update: Partial<Rule>) => setDraft(current => ({ ...current, rules: current.rules.map(rule => rule.id === id ? { ...rule, ...update } : rule) }))

  return <>
    <section className="card pad">
      <div className="sec-t"><h2>主动接单</h2></div>
      <div className="seg" role="radiogroup" aria-label="主动接单模式">{(['off', 'observe', 'auto'] as const).map(mode =>
        <button key={mode} role="radio" aria-checked={draft.mode === mode} className={draft.mode === mode ? 'on' : ''} onClick={() => setDraft({ ...draft, mode })}>{MODE_LABEL[mode]}</button>)}</div>
      <p className="sub small gap-top">{MODE_HINT[draft.mode]} 明确请求在任何模式下都照常处理。</p>
      {draft.mode === 'auto' && base.mode !== 'auto' && <p className="small gap-top"><a href={href.calibration()}>先看校准页</a>：每条规则的判断和你一致多少，切换后每天大概多出几个 Ticket。</p>}
    </section>

    {base.sources.map(source => <SourceCard key={source.id} source={source} part={draft.sources[source.id]!} reload={reload}
      onChange={update => setPart(source.id, update)} />)}

    <section className="card pad">
      <div className="sec-t"><h2>主动规则</h2><button className="btn sm" onClick={() => setDraft({ ...draft, rules: [...draft.rules,
        { id: `rule-${Date.now().toString(36)}`, name: '', enabled: false, instruction: '' }] })}>新建规则</button></div>
      <p className="muted small">每条规则描述一类它可以主动去做的事。评估时每条启用的规则都会被判断一次；主动接单至少要命中一条。</p>
      <div className="rules">{draft.rules.map(rule => <RuleRow key={rule.id} rule={rule} isNew={!base.rules.some(item => item.id === rule.id)}
        stat={stats?.rules.find(item => item.id === rule.id)} onChange={update => setRule(rule.id, update)}
        onRemove={() => setDraft({ ...draft, rules: draft.rules.filter(item => item.id !== rule.id) })} />)}</div>
    </section>

    <History view={view} />

    {dirty && <SaveBar base={base} draft={draft} listed={listed} stale={stale} onDiscard={() => { setBase(view); setDraft(draftOf(view)) }}
      onSaved={async () => { await reload() }} />}
  </>
}

function SourceCard({ source, part, onChange, reload }: { source: SourcePolicyView; part: PolicyDraft['sources'][string];
  onChange: (update: (part: PolicyDraft['sources'][string]) => PolicyDraft['sources'][string]) => void; reload: () => Promise<void> }) {
  const { busy, run } = useAction(reload)
  const cell = (row: string, which: AdmissionCell) => part.admission[row]?.[which]
  const cycle = (row: string, which: AdmissionCell, options: readonly Admission[]) => onChange(current => {
    const value = current.admission[row]?.[which] ?? options[0]!
    const next = options[(options.indexOf(value) + 1) % options.length]!
    return { ...current, admission: { ...current.admission, [row]: { ...current.admission[row], [which]: next } } }
  })
  return <section className="card pad">
    <div className="sec-t"><h2>{source.title}</h2>
      {source.sync && <button className="btn sm" disabled={!source.sync.ready || busy === 'sync'}
        onClick={() => void run('sync', () => call('POST /api/policy/sync/:id', { params: { id: source.id } }), '已同步名单')}>{source.sync.label}</button>}</div>
    <p className="muted small">明确请求：{source.explicit}</p>
    <div className="grid2 gap-top">
      <ListEditor title="名单" hint={source.sync?.ready ? '这个名单按群成员同步；手动加的人会在下次同步时被覆盖。' : '名单里的人 @ 它，就是明确请求。'}
        placeholder={source.id === 'feishu' ? '飞书用户的 open_id，例如 ou_xxx' : 'GitHub 登录名'} entries={part.allowed}
        onChange={allowed => onChange(current => ({ ...current, allowed }))} />
      {part.bots && <ListEditor title="bot 列表" hint="列表里的 bot 只能产生推断候选：不能直接下单，也不能叫停 Ticket。" placeholder={source.id === 'github' ? '例如 dependabot[bot]' : 'cli_xxx 或 ou_xxx'}
        entries={part.bots} onChange={bots => onChange(current => ({ ...current, bots }))} />}
      {source.sync?.error && <p className="err small">名单同步出错：{source.sync.error}</p>}
    </div>
    {source.rows.length > 0 && <div className="gap-top">
      <h3 className="small-h">准入表</h3>
      <div className="tbl-w"><table className="tbl matrix">
        <thead><tr><th>接收范围</th>{CELLS.map(which => <th key={which}>{CELL_LABEL[which]}</th>)}</tr></thead>
        <tbody>{source.rows.map(row => <tr key={row.id}>
          <td><div>{row.label}</div><div className="muted small">{row.note}</div></td>
          {CELLS.map(which => {
            const spec = row.cells[which]
            if (!spec.available) return <td key={which}><span className="cell na" title={which === 'unlistedAddressed' ? '这个范围不接收 @ 它的消息' : '这个范围只接收 @ 它的消息；要用这一格，先在来源里打开“全部消息”'}>—</span></td>
            const value = cell(row.id, which) ?? spec.value
            return <td key={which}><button className={`cell ${value}${value !== spec.value ? ' changed' : ''}`} onClick={() => cycle(row.id, which, spec.options)}
              title={`点一下换成下一个：${spec.options.map(option => ADMISSION_LABEL[option]).join(' → ')}`}>{ADMISSION_LABEL[value]}</button></td>
          })}
        </tr>)}</tbody>
      </table></div>
      <p className="muted small">名单内的人 @ 它永远是明确请求，所以没有单独一列。“推断候选”要经过评估和主动规则，并受主动接单模式约束。</p>
    </div>}
  </section>
}

function ListEditor({ title, hint, placeholder, entries, onChange }: { title: string; hint: string; placeholder: string; entries: Allowed[]; onChange: (entries: Allowed[]) => void }) {
  const [value, setValue] = useState('')
  const add = () => {
    const id = value.trim()
    if (id && !entries.some(entry => entry.id === id)) onChange([...entries, { id }])
    setValue('')
  }
  return <div>
    <h3 className="small-h">{title} <span className="muted mono">{entries.length}</span></h3>
    <div className="chips">{entries.map(entry => <span key={entry.id} className="chip">{entry.name ? <>{entry.name} <span className="muted">{entry.id}</span></> : entry.id}
      <button className="x" aria-label={`移除 ${entry.name || entry.id}`} onClick={() => onChange(entries.filter(item => item.id !== entry.id))}>×</button></span>)}
      {!entries.length && <span className="muted small">空</span>}</div>
    <form className="add-row" onSubmit={event => { event.preventDefault(); add() }}>
      <input value={value} onChange={event => setValue(event.target.value)} placeholder={placeholder} aria-label={`加入${title}`} />
      <button className="btn sm" type="submit">加入</button>
    </form>
    <p className="muted small">{hint}</p>
  </div>
}

const VERDICT = { ready: ['ok', '已达放手标准'], 'needs-work': ['danger', '误判偏多'], 'too-few': ['muted', '样本太少'], watching: ['muted', '继续观察'], disabled: ['muted', '已停用'] } as const
function RuleRow({ rule, isNew, stat, onChange, onRemove }: { rule: Rule; isNew: boolean; stat?: CalibrationView['rules'][number]; onChange: (update: Partial<Rule>) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(isNew)
  return <div className="rule">
    <div className="rule-h">
      <button className={`switch${rule.enabled ? ' on' : ''}`} role="switch" aria-checked={rule.enabled} aria-label={`启用 ${rule.name || '新规则'}`} onClick={() => onChange({ enabled: !rule.enabled })} />
      <input className="rule-name" value={rule.name} placeholder="规则名，例如 静默复现修复" onChange={event => onChange({ name: event.target.value })} aria-label="规则名" />
      {stat && stat.labelled > 0 && <Pill tone={VERDICT[stat.verdict][0]} dot={false}>{stat.agreed}/{stat.labelled} 一致 · {VERDICT[stat.verdict][1]}</Pill>}
      <span className="grow" />
      <button className="link" onClick={() => setOpen(!open)}>{open ? '收起' : '编辑说明'}</button>
      <button className="link danger" onClick={onRemove}>删除</button>
    </div>
    {open ? <textarea className="ed" value={rule.instruction} onChange={event => onChange({ instruction: event.target.value })} rows={3}
      placeholder="什么情况下它可以主动去做、做到哪一步、要不要先问人。例如：有人在群里报告可复现的缺陷时，先在后台复现；确认问题并找到简单修复才回复。" aria-label="规则说明" />
      : <p className="sub small rule-ins">{rule.instruction || '还没有说明'}</p>}
  </div>
}

function History({ view }: { view: PolicyView }) {
  if (!view.history.length) return null
  return <section className="card pad">
    <div className="sec-t"><h2>最近的修改</h2></div>
    <ol className="hist">{view.history.map(item => <li key={item.revision}>
      <div className="hist-h"><span className="mono">r{item.revision}</span><span className="muted">{clock(item.savedAt)} · {ORIGIN[item.origin]}</span>
        {item.policyChanged && <Pill tone="accent" dot={false}>新策略版本</Pill>}</div>
      <ul className="plain">{item.changes.map((change, i) => <li key={i}>{change}</li>)}</ul>
      {item.notified.length > 0 && <div className="muted small">通知了 {item.notified.map((ticket, i) => <span key={ticket.id}>{i ? '、' : ''}<a href={href.ticket(ticket.id)}>{ticket.title}</a></span>)}</div>}
    </li>)}</ol>
  </section>
}

function SaveBar({ base, draft, listed, stale, onDiscard, onSaved }: { base: PolicyView; draft: PolicyDraft; listed: string[]; stale: boolean; onDiscard: () => void; onSaved: () => Promise<void> }) {
  const { confirm, toast } = useUi()
  const [saving, setSaving] = useState(false)
  const hit = affected(base, draft)
  const save = async () => {
    const ok = await confirm({ title: '保存策略？', action: '保存',
      body: <>
        <p>会生成新的策略版本。进行中的 Ticket 不会被取消；受影响的会收到一条策略变更通知，由它们的 worker 决定怎么继续。</p>
        <ul className="plain gap-top">{listed.map((change, i) => <li key={i}>{change}</li>)}</ul>
        {hit.length > 0 && <><p className="gap-top">受影响的进行中 Ticket：</p><ul className="plain">{hit.map(ticket => <li key={ticket.id}>「{ticket.title}」：{ticket.why}</li>)}</ul></>}
      </> })
    if (!ok) return
    setSaving(true)
    try {
      const saved = await call('PUT /api/policy', { body: { draft, revisions: base.revisions } })
      toast(`已保存，策略版本 ${saved.policyVersion}`)
      onDiscard()
      await onSaved()
    } catch (error) {
      toast(error instanceof ApiError ? error.message : String(error))
    } finally { setSaving(false) }
  }
  return <div className="savebar" role="region" aria-label="未保存的修改">
    <div className="txt">
      <b>{listed.length} 处修改</b>：{listed.slice(0, 2).join('；')}{listed.length > 2 ? ` 等` : ''}
      {hit.length > 0 && <div className="small">会通知 {hit.length} 个进行中的 Ticket</div>}
      {stale && <div className="small warn-text">设置在别处被改过，保存会失败。放弃修改即可载入最新的。</div>}
    </div>
    <button className="btn ghost" onClick={onDiscard}>放弃</button>
    <button className="btn primary" disabled={saving} onClick={() => void save()}>保存</button>
  </div>
}
