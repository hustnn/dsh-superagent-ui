/**
 * Ticket workbench: where the work came from, why the agent may do it, and what happened, in one place. Upstream's panel
 * spreads these over its Trigger, Eval and Execution tabs; here they are one timeline beside the Mandate and the threads.
 */
import { useRef, useState } from 'react'
import type { TicketView } from '@dsh-superagent-ui/contract'
import { call } from '../api'
import { TuneDialog } from '../components/tune'
import { Said, Transcript } from '../components/worker'
import { ConnectionBanner, Pill, SourceChip, useAction, useNow, useUi } from '../components/ui'
import { useLive, useLiveData } from '../live'
import { href, navigate } from '../route'
import { t } from '../i18n'
import { clock, duration, stageLabel, TIMELINE_KIND } from '../text'
import { RETRIED, STOPPED, stopRequest } from './Home'

export function Ticket({ id }: { id: string }) {
  const { data, error, reload } = useLiveData(['ticket'], id, () => call('GET /api/tickets/:id', { params: { id } }))
  const { connection } = useLive()
  return <>
    <div><button className="link" onClick={() => history.length > 1 ? history.back() : navigate(href.board())}>← {t('Back', '返回')}</button></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error && error.kind !== 'not-found' ? { error } : {}} />
    {error?.kind === 'not-found' && <div className="card empty"><h2>{t('No such Ticket', '没有这个 Ticket')}</h2><p>{t('It may come from another dsh-superagent, or the link is wrong.', '它可能来自另一个 dsh-superagent，或者链接写错了。')}</p></div>}
    {data && <Workbench ticket={data} reload={reload} />}
    {!data && !error && <div className="card empty">{t('Loading…', '正在读取…')}</div>}
  </>
}

function Workbench({ ticket, reload }: { ticket: TicketView; reload: () => Promise<void> }) {
  const now = useNow()
  const { confirm } = useUi()
  const { busy, run } = useAction(reload)
  const stage = stageLabel(ticket)
  const origin = ticket.threads.find(thread => thread.role === 'origin') ?? ticket.threads[0]
  const [tuning, setTuning] = useState(false)
  const [tab, setTab] = useState<Tab>('timeline')

  const stop = async () => {
    const ok = await confirm(stopRequest(ticket.title))
    if (ok) await run('stop', () => call('POST /api/tickets/:id/stop', { params: { id: ticket.id } }), STOPPED())
  }
  const retry = () => run('retry', () => call('POST /api/tickets/:id/retry', { params: { id: ticket.id } }), RETRIED())
  // DSH Web only opens with its own token, which the console does not hold; the worker's steps are on this page instead.
  const tabs = useRef<HTMLElement>(null)
  const openWorker = () => { setTab('worker'); tabs.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  return <>
    <div className="card pad">
      <div className="tk-head">
        <div className="grow">
          <h1>{ticket.title}</h1>
          <div className="chips">
            <Pill tone={stage.tone}>{stage.label}{ticket.waitingSince ? ` · ${t('waiting', '已等')} ${duration(now - Date.parse(ticket.waitingSince))}` : ''}</Pill>
            {origin && <SourceChip thread={origin} />}
            <Pill tone={ticket.strength === 'inferred' ? 'infer' : 'muted'} dot={false}>{ticket.strength === 'inferred' ? t('Proactive', '主动接单') : t('Explicit request', '明确请求')}</Pill>
            <span className="chip">{t(`Started by ${ticket.why.actor}`, `${ticket.why.actor} 发起`)} · {clock(ticket.createdAt)}</span>
          </div>
        </div>
        <div className="acts">
          {ticket.reply && !ticket.actions.retry && <a className="btn primary" href={ticket.reply.url} target="_blank" rel="noopener noreferrer">
            {ticket.action === 'review' ? t('Review', '去评审') : ticket.action === 'answer' ? t('Answer', '去回答') : t('Open conversation', '打开对话')} ↗</a>}
          {ticket.actions.retry && <button className="btn primary" disabled={busy === 'retry'} onClick={() => void retry()}>{t('Retry', '重试')}</button>}
          {ticket.execution.sessionId && <button className="btn" onClick={openWorker}>{t('View worker', '查看 worker')}</button>}
          {ticket.actions.stop && <button className="btn ghost danger" disabled={busy === 'stop'} onClick={() => void stop()}>{t('Stop', '停止')}</button>}
        </div>
      </div>
      {ticket.question && <div className="callout warn"><div className="lbl">{t('It asks', '它在问')}{ticket.reply ? t(` (originally in "${ticket.reply.label}")`, `（原文在「${ticket.reply.label}」）`) : ''}</div>{ticket.question}</div>}
      {ticket.note && <div className={`callout ${ticket.note.error ? 'danger' : 'warn'}`}><div className="lbl">{ticket.action === 'failed' ? t('Why it failed', '失败原因') : ticket.action === 'delivery' ? t('Message not delivered to worker', '消息没送到 worker') : t('Why it is blocked', '受阻原因')}</div>{ticket.note.text}
        {ticket.actions.retry && <div className="sub small">{t('Retrying starts a new dispatch with the same Session, directory and branch.', '重试会开一个新的派工，沿用同一个 Session、目录和分支。')}</div>}</div>}
      {ticket.action === 'review' && <div className="callout accent"><div className="lbl">{t('It delivered', '它交付了')}</div><div className="pre">{ticket.summary}</div></div>}
      {ticket.stage === 'ended' && ticket.ended && <div className="callout muted"><div className="lbl">{stage.label} · {clock(ticket.ended.at)}</div>
        {ticket.ended.reason ?? (ticket.ended.by === 'human' ? t('Ended by a person.', '由人结束。') : t('Ended by the worker.', '由 worker 结束。'))}{t(' A new message in its threads resumes it under the same mandate (unless a person stopped it).', '在它的线程上有人再发消息，会在同样的授权下恢复（被人停止的除外）。')}</div>}
    </div>

    <div className="tk-grid">
      <section ref={tabs} className="card pad tk-main" aria-label={TABS[tab]}>
        <div className="seg tk-tabs" role="tablist">{(Object.keys(TABS) as Tab[]).map(key => <button key={key} role="tab" aria-selected={tab === key}
          className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{TABS[key]}{key === 'said' && ticket.said?.length ? ` ${ticket.said.length}` : ''}</button>)}</div>
        {tab === 'worker' && <Transcript ticketId={ticket.id} working={ticket.stage === 'working'} />}
        {tab === 'said' && <Said said={ticket.said} />}
        {tab === 'timeline' && <ol className="tl">{ticket.timeline.map((entry, i) => <li key={i} className={`tl-i ${entry.tone ?? ''}`}>
          <span className="tm mono">{clock(entry.at)}</span>
          <span className="kind">{TIMELINE_KIND[entry.kind]}</span>
          <div className="tx">
            <div>{entry.title}{entry.triggerId && entry.thread && <> · <a href={href.thread(entry.thread, entry.triggerId)}>{t('Trace', '看去向')}</a></>}</div>
            {entry.detail && <Detail text={entry.detail} />}
          </div>
        </li>)}</ol>}
      </section>
      <div className="side">
        <section className="card pad">
          <h2 className="sec-h">{t('Why it may do this', '为什么它能做')}</h2>
          <p className="sub">{ticket.why.sentence}</p>
          <dl className="kv"><dt>{t('Scope', '范围')}</dt><dd>{ticket.why.scope}</dd><dt>{t('Policy', '策略')}</dt><dd className="mono">{ticket.why.policyVersion}</dd>
            {ticket.why.rules.length > 0 && <><dt>{t('Rules', '规则')}</dt><dd>{ticket.why.rules.join(t(', ', '、'))}</dd></>}</dl>
        </section>
        <section className="card pad">
          <h2 className="sec-h">{t('Threads it follows', '它在关注')}</h2>
          {ticket.threads.length ? <ul className="plain">{ticket.threads.map(thread => <li key={thread.key}>
            <a href={href.thread(thread.key)}>{thread.title}</a> <span className="muted">· {{ origin: t('where it started', '起点'), follows: t('new messages come here', '新消息会送到这里'), context: t('context only', '仅作参考') }[thread.role]}</span>
          </li>)}</ul> : <p className="sub">{t('It follows no threads.', '没有在关注的线程。')}</p>}
          <p className="muted small">{t("New messages in these threads go straight to this Ticket, without needing to @ it again. Unsubscribe on a thread's page.", '这些线程上的新消息会直接送到这个 Ticket，不需要再 @ 它。退订在线程页里操作。')}</p>
        </section>
        <section className="card pad">
          <h2 className="sec-h">{t('Execution', '执行')}</h2>
          <dl className="kv">
            <dt>worker</dt><dd className="mono">{ticket.execution.sessionId ?? t('not started', '还没启动')}</dd>
            {ticket.execution.directory && <><dt>{t('Directory', '目录')}</dt><dd className="mono"><a href={href.directories(ticket.id)}>{ticket.execution.directory}</a></dd></>}
            <dt>{t('Dispatches', '派工')}</dt><dd>{t(`${ticket.execution.assignments}`, `${ticket.execution.assignments} 次`)}{ticket.execution.running ? t(', running', '，正在运行') : ''}</dd>
          </dl>
          {ticket.execution.environment.length > 0 && <details className="env"><summary>{t(`${ticket.execution.environment.length} execution variables`, `执行变量 ${ticket.execution.environment.length} 个`)}</summary>
            <dl className="kv">{ticket.execution.environment.map(variable => <div key={variable.key} className="kv-row">
              <dt className="mono" title={variable.description}>{variable.key}</dt><dd className="mono">{variable.value}</dd></div>)}</dl></details>}
        </section>
        <section className="card pad">
          <h2 className="sec-h">{t('This went wrong?', '这次表现不对？')}</h2>
          <p className="sub">{t('Mark the problem and edit the prompt section responsible for it directly, or tighten admission in the policy.', '标出问题，直接改负责它的那一段提示词，或者去策略里收紧准入。')}</p>
          <button className="btn sm" onClick={() => setTuning(true)}>{t('Mark the problem', '标出问题')}</button>
        </section>
      </div>
    </div>
    {tuning && <TuneDialog ticketId={ticket.id} title={ticket.title} onClose={() => setTuning(false)} />}
  </>
}

/** A timeline line's detail; a long one, such as a worker's report, is folded until asked for. */
function Detail({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 240 || text.split('\n').length > 4
  return <>
    <div className={`sd pre${long && !open ? ' clamp' : ''}`}>{text}</div>
    {long && <button className="btn sm ghost" onClick={() => setOpen(!open)}>{open ? t('Collapse', '收起') : t('Expand', '展开')}</button>}
  </>
}

type Tab = 'timeline' | 'worker' | 'said'
const TABS: Record<Tab, string> = { timeline: t('History', '经过'), worker: t('What the worker is doing', 'worker 在做什么'), said: t('What it said', '它说了什么') }
