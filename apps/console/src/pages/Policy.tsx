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
import { t } from '../i18n'
import { clock, PAGE } from '../text'

const MODE_HINT: Record<AcceptMode, string> = {
  off: t("Only explicit requests are handled. Messages that don't @ it, bot messages, and follow-ups from people not on the list never become candidates.", '只处理明确请求。没 @ 它的消息、bot 消息、名单外的人的追问，都不会成为候选。'),
  observe: t('Candidates are evaluated, but a rule match is only recorded as "would have accepted", not acted on. New deployments start here; review these judgments on the Calibration page.', '候选会被评估；命中规则也只记录为“本会接单”，不执行。新部署从这里开始，在校准页复核这些判断。'),
  auto: t('Candidates that match an enabled rule are accepted directly.', '命中启用规则的候选会直接接单。'),
}
const ORIGIN = { panel: t('Console or panel', '控制台或面板'), tool: t('Main Session (at your request)', '主 Session（应你的要求）'), sync: t('Allow-list sync', '名单同步') } as const
const CELLS: AdmissionCell[] = ['listedUnaddressed', 'unlistedAddressed', 'unlistedUnaddressed']

export function Policy() {
  const { data, error, reload } = useLiveData(['policy'], 'policy', () => call('GET /api/policy'))
  const calibration = useLiveData(['calibration'], 'calibration', () => call('GET /api/calibration'))
  const { connection } = useLive()
  return <>
    <div className="head"><div><h1>{PAGE.policy}</h1><p>{t('Who can give it work, and what it may do on its own. Each save creates a new policy version, and every mandate records the version it relies on.', '谁能让它干活，它能主动做什么。每次保存生成一个新的策略版本，所有授权都记着它依据的版本。')}{data && <>{t(' Current: ', ' 当前 ')}<span className="mono">{data.policyVersion}</span>{t('.', '。')}</>}</p></div></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data ? <Editor view={data} stats={calibration.data} reload={reload} /> : !error && <div className="card empty">{t('Loading…', '正在读取…')}</div>}
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
      <div className="sec-t"><h2>{t('Proactive work', '主动接单')}</h2></div>
      <div className="seg" role="radiogroup" aria-label={t('Proactive mode', '主动接单模式')}>{(['off', 'observe', 'auto'] as const).map(mode =>
        <button key={mode} role="radio" aria-checked={draft.mode === mode} className={draft.mode === mode ? 'on' : ''} onClick={() => setDraft({ ...draft, mode })}>{MODE_LABEL[mode]}</button>)}</div>
      <p className="sub small gap-top">{MODE_HINT[draft.mode]}{t(' Explicit requests are handled as usual in every mode.', ' 明确请求在任何模式下都照常处理。')}</p>
      {draft.mode === 'auto' && base.mode !== 'auto' && <p className="small gap-top"><a href={href.calibration()}>{t('Check Calibration first', '先看校准页')}</a>{t(': how much each rule agrees with you, and roughly how many more Tickets a day switching would add.', '：每条规则的判断和你一致多少，切换后每天大概多出几个 Ticket。')}</p>}
    </section>

    {base.sources.map(source => <SourceCard key={source.id} source={source} part={draft.sources[source.id]!} reload={reload}
      onChange={update => setPart(source.id, update)} />)}

    <section className="card pad">
      <div className="sec-t"><h2>{t('Proactive rules', '主动规则')}</h2><button className="btn sm" onClick={() => setDraft({ ...draft, rules: [...draft.rules,
        { id: `rule-${Date.now().toString(36)}`, name: '', enabled: false, instruction: '' }] })}>{t('New rule', '新建规则')}</button></div>
      <p className="muted small">{t('Each rule describes a kind of work it may take on by itself. Evaluation checks every enabled rule once; proactive work needs at least one match.', '每条规则描述一类它可以主动去做的事。评估时每条启用的规则都会被判断一次；主动接单至少要命中一条。')}</p>
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
        onClick={() => void run('sync', () => call('POST /api/policy/sync/:id', { params: { id: source.id } }), t('Allow list synced', '已同步名单'))}>{source.sync.label}</button>}</div>
    <p className="muted small">{t('Explicit request: ', '明确请求：')}{source.explicit}</p>
    <div className="grid2 gap-top">
      <ListEditor title={t('Allow list', '名单')} hint={source.sync?.ready ? t('This list syncs from group members; people added by hand are overwritten at the next sync.', '这个名单按群成员同步；手动加的人会在下次同步时被覆盖。') : t('When someone on the list @ it, that is an explicit request.', '名单里的人 @ 它，就是明确请求。')}
        placeholder={source.id === 'feishu' ? t("A Feishu user's open_id, such as ou_xxx", '飞书用户的 open_id，例如 ou_xxx') : t('GitHub login', 'GitHub 登录名')} entries={part.allowed}
        onChange={allowed => onChange(current => ({ ...current, allowed }))} />
      {part.bots && <ListEditor title={t('Bot list', 'bot 列表')} hint={t('Bots on this list can only produce inferred candidates: they cannot place work directly or stop a Ticket.', '列表里的 bot 只能产生推断候选：不能直接下单，也不能叫停 Ticket。')} placeholder={source.id === 'github' ? t('such as dependabot[bot]', '例如 dependabot[bot]') : t('cli_xxx or ou_xxx', 'cli_xxx 或 ou_xxx')}
        entries={part.bots} onChange={bots => onChange(current => ({ ...current, bots }))} />}
      {source.sync?.error && <p className="err small">{t('Allow-list sync failed: ', '名单同步出错：')}{source.sync.error}</p>}
    </div>
    {source.rows.length > 0 && <div className="gap-top">
      <h3 className="small-h">{t('Admission table', '准入表')}</h3>
      <div className="tbl-w"><table className="tbl matrix">
        <thead><tr><th>{t('Intake', '接收范围')}</th>{CELLS.map(which => <th key={which}>{CELL_LABEL[which]}</th>)}</tr></thead>
        <tbody>{source.rows.map(row => <tr key={row.id}>
          <td><div>{row.label}</div><div className="muted small">{row.note}</div></td>
          {CELLS.map(which => {
            const spec = row.cells[which]
            if (!spec.available) return <td key={which}><span className="cell na" title={which === 'unlistedAddressed' ? t("This intake doesn't receive messages that @ it", '这个范围不接收 @ 它的消息') : t('This intake only receives messages that @ it; to use this cell, turn on "All messages" under Sources first', '这个范围只接收 @ 它的消息；要用这一格，先在来源里打开“全部消息”')}>—</span></td>
            const value = cell(row.id, which) ?? spec.value
            return <td key={which}><button className={`cell ${value}${value !== spec.value ? ' changed' : ''}`} onClick={() => cycle(row.id, which, spec.options)}
              title={t(`Click for the next one: ${spec.options.map(option => ADMISSION_LABEL[option]).join(' → ')}`, `点一下换成下一个：${spec.options.map(option => ADMISSION_LABEL[option]).join(' → ')}`)}>{ADMISSION_LABEL[value]}</button></td>
          })}
        </tr>)}</tbody>
      </table></div>
      <p className="muted small">{t('Someone on the list who @ it is always an explicit request, so that has no column. "Inferred candidates" go through evaluation and proactive rules, and follow the proactive mode.', '名单内的人 @ 它永远是明确请求，所以没有单独一列。“推断候选”要经过评估和主动规则，并受主动接单模式约束。')}</p>
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
      <button className="x" aria-label={t(`Remove ${entry.name || entry.id}`, `移除 ${entry.name || entry.id}`)} onClick={() => onChange(entries.filter(item => item.id !== entry.id))}>×</button></span>)}
      {!entries.length && <span className="muted small">{t('Empty', '空')}</span>}</div>
    <form className="add-row" onSubmit={event => { event.preventDefault(); add() }}>
      <input value={value} onChange={event => setValue(event.target.value)} placeholder={placeholder} aria-label={t(`Add to ${title}`, `加入${title}`)} />
      <button className="btn sm" type="submit">{t('Add', '加入')}</button>
    </form>
    <p className="muted small">{hint}</p>
  </div>
}

const VERDICT = { ready: ['ok', t('Ready to let go', '已达放手标准')], 'needs-work': ['danger', t('Too many misjudgments', '误判偏多')], 'too-few': ['muted', t('Too few samples', '样本太少')],
  watching: ['muted', t('Keep watching', '继续观察')], disabled: ['muted', t('Disabled', '已停用')] } as const
function RuleRow({ rule, isNew, stat, onChange, onRemove }: { rule: Rule; isNew: boolean; stat?: CalibrationView['rules'][number]; onChange: (update: Partial<Rule>) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(isNew)
  return <div className="rule">
    <div className="rule-h">
      <button className={`switch${rule.enabled ? ' on' : ''}`} role="switch" aria-checked={rule.enabled} aria-label={t(`Enable ${rule.name || 'new rule'}`, `启用 ${rule.name || '新规则'}`)} onClick={() => onChange({ enabled: !rule.enabled })} />
      <input className="rule-name" value={rule.name} placeholder={t('Rule name, such as Silent reproduce-and-fix', '规则名，例如 静默复现修复')} onChange={event => onChange({ name: event.target.value })} aria-label={t('Rule name', '规则名')} />
      {stat && stat.labelled > 0 && <Pill tone={VERDICT[stat.verdict][0]} dot={false}>{stat.agreed}/{stat.labelled} {t('agreed', '一致')} · {VERDICT[stat.verdict][1]}</Pill>}
      <span className="grow" />
      <button className="link" onClick={() => setOpen(!open)}>{open ? t('Collapse', '收起') : t('Edit instruction', '编辑说明')}</button>
      <button className="link danger" onClick={onRemove}>{t('Delete', '删除')}</button>
    </div>
    {open ? <textarea className="ed" value={rule.instruction} onChange={event => onChange({ instruction: event.target.value })} rows={3}
      placeholder={t('When it may act on its own, how far to go, and whether to ask first. For example: when someone in the group reports a reproducible bug, reproduce it in the background, and reply only after confirming it and finding a simple fix.', '什么情况下它可以主动去做、做到哪一步、要不要先问人。例如：有人在群里报告可复现的缺陷时，先在后台复现；确认问题并找到简单修复才回复。')} aria-label={t('Rule instruction', '规则说明')} />
      : <p className="sub small rule-ins">{rule.instruction || t('No instruction yet', '还没有说明')}</p>}
  </div>
}

function History({ view }: { view: PolicyView }) {
  if (!view.history.length) return null
  return <section className="card pad">
    <div className="sec-t"><h2>{t('Recent changes', '最近的修改')}</h2></div>
    <ol className="hist">{view.history.map(item => <li key={item.revision}>
      <div className="hist-h"><span className="mono">r{item.revision}</span><span className="muted">{clock(item.savedAt)} · {ORIGIN[item.origin]}</span>
        {item.policyChanged && <Pill tone="accent" dot={false}>{t('New policy version', '新策略版本')}</Pill>}</div>
      <ul className="plain">{item.changes.map((change, i) => <li key={i}>{change}</li>)}</ul>
      {item.notified.length > 0 && <div className="muted small">{t('Notified ', '通知了 ')}{item.notified.map((ticket, i) => <span key={ticket.id}>{i ? t(', ', '、') : ''}<a href={href.ticket(ticket.id)}>{ticket.title}</a></span>)}</div>}
    </li>)}</ol>
  </section>
}

function SaveBar({ base, draft, listed, stale, onDiscard, onSaved }: { base: PolicyView; draft: PolicyDraft; listed: string[]; stale: boolean; onDiscard: () => void; onSaved: () => Promise<void> }) {
  const { confirm, toast } = useUi()
  const [saving, setSaving] = useState(false)
  const hit = affected(base, draft)
  const save = async () => {
    const ok = await confirm({ title: t('Save the policy?', '保存策略？'), action: t('Save', '保存'),
      body: <>
        <p>{t('This creates a new policy version. Open Tickets are not cancelled; affected ones get a policy-change notice, and their workers decide how to go on.', '会生成新的策略版本。进行中的 Ticket 不会被取消；受影响的会收到一条策略变更通知，由它们的 worker 决定怎么继续。')}</p>
        <ul className="plain gap-top">{listed.map((change, i) => <li key={i}>{change}</li>)}</ul>
        {hit.length > 0 && <><p className="gap-top">{t('Open Tickets affected:', '受影响的进行中 Ticket：')}</p><ul className="plain">{hit.map(ticket => <li key={ticket.id}>{t(`"${ticket.title}": ${ticket.why}`, `「${ticket.title}」：${ticket.why}`)}</li>)}</ul></>}
      </> })
    if (!ok) return
    setSaving(true)
    try {
      const saved = await call('PUT /api/policy', { body: { draft, revisions: base.revisions } })
      toast(t(`Saved; policy version ${saved.policyVersion}`, `已保存，策略版本 ${saved.policyVersion}`))
      onDiscard()
      await onSaved()
    } catch (error) {
      toast(error instanceof ApiError ? error.message : String(error))
    } finally { setSaving(false) }
  }
  return <div className="savebar" role="region" aria-label={t('Unsaved changes', '未保存的修改')}>
    <div className="txt">
      <b>{t(`${listed.length} change${listed.length === 1 ? '' : 's'}`, `${listed.length} 处修改`)}</b>{t(': ', '：')}{listed.slice(0, 2).join(t('; ', '；'))}{listed.length > 2 ? t(' and more', ' 等') : ''}
      {hit.length > 0 && <div className="small">{t(`Notifies ${hit.length} open Ticket${hit.length === 1 ? '' : 's'}`, `会通知 ${hit.length} 个进行中的 Ticket`)}</div>}
      {stale && <div className="small warn-text">{t('The settings were changed elsewhere, so saving will fail. Discard your changes to load the latest.', '设置在别处被改过，保存会失败。放弃修改即可载入最新的。')}</div>}
    </div>
    <button className="btn ghost" onClick={onDiscard}>{t('Discard', '放弃')}</button>
    <button className="btn primary" disabled={saving} onClick={() => void save()}>{t('Save', '保存')}</button>
  </div>
}
