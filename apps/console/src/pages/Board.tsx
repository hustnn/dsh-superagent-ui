/**
 * Board: every Ticket by where it is. The agent runs many at once and a person can follow only a few Sessions, so this shows
 * pieces of work, not Sessions: what waits for a worker, what runs, what waits for you, what waits for new messages.
 */
import type { TicketStageKey } from '@dsh-superagent-ui/contract'
import { TicketCard } from '../components/records'
import { ConnectionBanner } from '../components/ui'
import { useLive, useView } from '../live'
import { href } from '../route'

const COLUMNS: { stage: TicketStageKey; label: string; hint: string }[] = [
  { stage: 'queued', label: '排队中', hint: '等空闲的 worker' },
  { stage: 'working', label: '执行中', hint: 'worker 正在干活' },
  { stage: 'person', label: '需要你', hint: '等你回答、评审或处理失败' },
  { stage: 'idle', label: '等新消息', hint: '这一轮做完了，有新消息会继续' },
  { stage: 'ended', label: '最近结束', hint: '' },
]

export function Board() {
  const { data, error } = useView('board')
  const { connection } = useLive()
  const status = data?.status
  return <>
    <div className="head"><div><h1>看板</h1>
      <p>按“事”而不是按 Session 看它在并行推进什么。{status && <>worker {status.running}/{status.maxWorkers}{status.queued ? `，${status.queued} 个在排队` : ''}。</>}</p></div></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data ? <div className="board">{COLUMNS.map(column => {
      const cards = data.columns[column.stage]
      return <section key={column.stage} className="col" aria-label={column.label}>
        <div className="col-h"><span>{column.label}</span><span className="mono muted">{column.stage === 'ended' && data.endedTotal > cards.length ? `${cards.length}/${data.endedTotal}` : cards.length}</span></div>
        {column.hint && <div className="col-hint">{column.hint}</div>}
        {cards.map(card => <TicketCard key={card.id} card={card} showStage={column.stage === 'person' || column.stage === 'ended'} />)}
        {!cards.length && <div className="col-empty">没有</div>}
      </section>
    })}</div> : !error && <div className="card empty">正在读取…</div>}
    {data && !data.columns.person.length && <p className="muted">需要你处理的事都在 <a href={href.home()}>首页</a>。</p>}
  </>
}
