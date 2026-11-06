/**
 * Insights: only numbers that change what you do next, each beside the action it calls for. Upstream reports only the
 * present; the week-long trends come from the samples the BFF records every hour while it runs.
 */
import { useMemo, useState } from 'react'
import type { InsightsView, SpeechStats, TicketOutcome } from '@dsh-superagent-ui/contract'
import { call } from '../api'
import { ConnectionBanner } from '../components/ui'
import { Missing } from '../components/worker'
import { useLive, useLiveData } from '../live'
import { href } from '../route'
import { clock, duration, OUTCOME, SOURCE_NAME } from '../text'

export function Insights() {
  const { data, error } = useLiveData(['insights'], 'insights', () => call('GET /api/insights'))
  const { connection } = useLive()
  return <>
    <div className="head"><div><h1>洞察</h1><p>只放会改变你下一步的数字，每个数字旁边就是对应的动作。</p></div></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data && <Body view={data} />}
  </>
}

const ORDER: TicketOutcome[] = ['merged', 'completed', 'closed', 'dropped', 'stopped']

function Body({ view }: { view: InsightsView }) {
  const total = ORDER.reduce((sum, outcome) => sum + (view.outcomes.all[outcome] ?? 0), 0)
  const proactive = ORDER.reduce((sum, outcome) => sum + (view.outcomes.proactive[outcome] ?? 0), 0)
  return <>
    <div className="grid3">
      <div className="stat"><div className="l">现在等你的事</div><div className="n">{view.waiting.count}</div>
        <div className="l">{view.waiting.longestMs !== null ? `最久的等了 ${duration(view.waiting.longestMs)}，中位 ${duration(view.waiting.medianMs ?? 0)}` : '没有在等你的'}</div>
        {view.waiting.count > 0 && <a className="small" href={href.home()}>去处理</a>}</div>
      <div className="stat"><div className="l">worker</div><div className="n mono">{view.capacity.running}/{view.capacity.maxWorkers}</div>
        <div className="l">{view.capacity.queued} 个在排队{view.capacity.peakQueued !== null ? `，过去 7 天最多同时排队 ${view.capacity.peakQueued} 个` : ''}</div>
        {(view.capacity.peakQueued ?? 0) >= 2 && <a className="small" href={href.execution()}>考虑提高并发</a>}</div>
      <div className="stat"><div className="l">主动工作</div><div className="n">{view.calibration.pending}</div>
        <div className="l">条判断等你复核{view.calibration.ready.length ? `；${view.calibration.ready.map(name => `「${name}」`).join('')}可以放手` : ''}</div>
        <a className="small" href={href.calibration()}>去校准</a></div>
    </div>

    <section className="card pad">
      <div className="sec-t"><h2>过去 7 天</h2><span className="muted small">控制台每小时记一次</span></div>
      {view.trend.length >= 2 ? <div className="grid2">
        <Sparkline title="等你的 Ticket" samples={view.trend} pick={sample => sample.waiting} />
        <Sparkline title="排队等 worker 的 Ticket" samples={view.trend} pick={sample => sample.queued} />
      </div> : <p className="muted small">控制台运行满两个小时后，这里会出现趋势。</p>}
    </section>

    <section className="card pad">
      <div className="sec-t"><h2>它接的活最后怎样了</h2><span className="muted small">近 {view.outcomes.days} 天结束的 {total} 个{proactive ? `，其中主动接的 ${proactive} 个` : ''}</span></div>
      {total ? <>
        <div className="bar" role="img" aria-label={ORDER.filter(outcome => view.outcomes.all[outcome]).map(outcome => `${OUTCOME[outcome].label} ${view.outcomes.all[outcome]}`).join('，')}>
          {ORDER.filter(outcome => view.outcomes.all[outcome]).map(outcome => <span key={outcome} className={`seg-${outcome}`} style={{ flexGrow: view.outcomes.all[outcome] }} />)}</div>
        <div className="legend">{ORDER.filter(outcome => view.outcomes.all[outcome]).map(outcome => <span key={outcome}><i className={`seg-${outcome}`} />{OUTCOME[outcome].label} {view.outcomes.all[outcome]}
          {view.outcomes.proactive[outcome] ? <span className="muted">（主动 {view.outcomes.proactive[outcome]}）</span> : null}</span>)}</div>
        {(view.outcomes.all.stopped ?? 0) > 0 && <p className="sub small gap-top">被人停止的 Ticket 往往是范围超出了请求，看看<a href={href.prompts('scope')}>Ticket 范围</a>要不要收紧。</p>}
      </> : <p className="muted small">这段时间还没有结束的 Ticket。</p>}
    </section>

    <section className="card pad">
      <div className="sec-t"><h2>被拦下的请求</h2><span className="muted small">近 7 天，名单外的人找它，被准入挡回</span></div>
      {view.demand.length ? <div className="rows">{view.demand.map(item => <div key={item.thread} className="row static flush">
        <div><span className="chip"><b>{SOURCE_NAME[item.source] ?? item.source}</b>{item.count} 次</span></div>
        <div className="body"><div className="ttl">{item.title}</div><div className="ask">最近：{item.example} · {clock(item.latestAt)}</div></div>
        <div className="acts"><a className="btn sm ghost" href={href.thread(item.thread, item.triggerId)}>看去向</a><a className="btn sm" href={href.policy()}>加入名单或改准入</a></div>
      </div>)}</div> : <p className="muted small">没有。有人想用它但用不了时会出现在这里。</p>}
    </section>

    <section className="card pad">
      <div className="sec-t"><h2>它对外说了多少话</h2><span className="muted small">近 {view.outcomes.days} 天的 Ticket，按 Ticket 算</span></div>
      {!view.speech ? <Missing what="它在对话里说了多少话、每个 Ticket 说了几句" />
        : !view.speech.tickets ? <p className="muted small">这段时间的 Ticket 还没说过话。</p> : <Speech speech={view.speech} />}
    </section>
  </>
}

/** Messages per Ticket: the agent's noise is what the operator answers for, so the Ticket that said the most is one click away. */
function Speech({ speech }: { speech: SpeechStats }) {
  const { messages, perTicket } = speech
  const total = messages.acknowledgement + messages.reply + messages.notice
  return <>
    <div className="grid3">
      <div className="stat"><div className="l">一共</div><div className="n">{total}</div><div className="l">{speech.tickets} 个 Ticket：确认 {messages.acknowledgement}、回复 {messages.reply}、通知 {messages.notice}</div></div>
      <div className="stat"><div className="l">每个 Ticket</div><div className="n">{perTicket.median}</div><div className="l">条（中位数），最多 {perTicket.max} 条</div>
        {perTicket.top && <a className="small" href={href.ticket(perTicket.top.id)}>{perTicket.top.title}</a>}</div>
      <div className="stat"><div className="l">没发出去</div><div className="n">{speech.pending + speech.dropped}</div><div className="l">{speech.pending} 条还在排队，{speech.dropped} 条已丢弃</div>
        {speech.pending + speech.dropped > 0 && <a className="small" href={href.health()}>看原因</a>}</div>
    </div>
    {perTicket.median > 4 && <p className="sub small gap-top">每个 Ticket 说的话偏多。看看<a href={href.prompts('communication')}>沟通规范</a>：确认和进度能不能合并成一条。</p>}
  </>
}

/** One measure over the week: a 2px line on a recessive baseline, with a crosshair and tooltip on hover, and a per-day table. */
function Sparkline({ title, samples, pick }: { title: string; samples: InsightsView['trend']; pick: (sample: InsightsView['trend'][number]) => number }) {
  const [hover, setHover] = useState<number | null>(null)
  const width = 600, height = 96, top = 8, bottom = 18
  const values = samples.map(pick)
  const max = Math.max(1, ...values)
  const x = (i: number) => (i / (samples.length - 1)) * width
  const y = (value: number) => top + (1 - value / max) * (height - top - bottom)
  const path = values.map((value, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(value).toFixed(1)}`).join('')
  const days = useMemo(() => {
    const byDay = new Map<string, number>()
    samples.forEach((sample, i) => { const day = sample.at.slice(5, 10); byDay.set(day, Math.max(byDay.get(day) ?? 0, values[i]!)) })
    return [...byDay.entries()]
  }, [samples]) // eslint-disable-line react-hooks/exhaustive-deps
  const now = values.at(-1) ?? 0, peak = Math.max(...values)
  const at = hover === null ? null : samples[hover]!
  return <figure className="spark">
    <figcaption><span>{title}</span><span className="muted small">现在 {now} · 最多 {peak}</span></figcaption>
    <div className="spark-plot" onMouseLeave={() => setHover(null)} onMouseMove={event => {
      const box = event.currentTarget.getBoundingClientRect()
      setHover(Math.max(0, Math.min(samples.length - 1, Math.round(((event.clientX - box.left) / box.width) * (samples.length - 1)))))
    }}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${title}：过去 7 天最多 ${peak}，现在 ${now}`}>
        <line className="spark-base" x1={0} x2={width} y1={height - bottom} y2={height - bottom} />
        <path className="spark-line" d={path} vectorEffect="non-scaling-stroke" />
        {hover !== null && <line className="spark-cross" x1={x(hover)} x2={x(hover)} y1={top} y2={height - bottom} vectorEffect="non-scaling-stroke" />}
      </svg>
      {at && hover !== null && <div className="spark-tip" style={{ left: `${(hover / (samples.length - 1)) * 100}%` }}>{clock(at.at)} · {values[hover]}</div>}
      <div className="spark-x"><span>{samples[0]!.at.slice(5, 10)}</span><span>现在</span></div>
    </div>
    <details className="small"><summary>每天最多</summary><table className="tbl"><tbody>{days.map(([day, value]) => <tr key={day}><td className="mono">{day}</td><td>{value}</td></tr>)}</tbody></table></details>
  </figure>
}
