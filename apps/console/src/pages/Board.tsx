/**
 * Board: every Ticket by where it is. The agent runs many at once and a person can follow only a few Sessions, so this shows
 * pieces of work, not Sessions: what waits for a worker, what runs, what waits for you, what waits for new messages.
 */
import type { TicketStageKey } from '@dsh-superagent-ui/contract'
import { TicketCard } from '../components/records'
import { ConnectionBanner } from '../components/ui'
import { useLive, useView } from '../live'
import { t } from '../i18n'
import { href } from '../route'
import { PAGE } from '../text'

const COLUMNS: { stage: TicketStageKey; label: string; hint: string }[] = [
  { stage: 'queued', label: t('Queued', '排队中'), hint: t('Waiting for a free worker', '等空闲的 worker') },
  { stage: 'working', label: t('Working', '执行中'), hint: t('A worker is on it', 'worker 正在干活') },
  { stage: 'person', label: t('Needs you', '需要你'), hint: t('Waiting for your answer or review, or for you to handle a failure', '等你回答、评审或处理失败') },
  { stage: 'idle', label: t('Waiting for new messages', '等新消息'), hint: t('This round is done; a new message picks it up again', '这一轮做完了，有新消息会继续') },
  { stage: 'ended', label: t('Recently ended', '最近结束'), hint: '' },
]

export function Board() {
  const { data, error } = useView('board')
  const { connection } = useLive()
  const status = data?.status
  return <>
    <div className="head"><div><h1>{PAGE.board}</h1>
      <p>{t('What it is moving forward in parallel, by piece of work rather than by Session. ', '按“事”而不是按 Session 看它在并行推进什么。')}{status && <>worker {status.running}/{status.maxWorkers}{status.queued ? t(`, ${status.queued} queued`, `，${status.queued} 个在排队`) : ''}{t('.', '。')}</>}</p></div></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data ? <div className="board">{COLUMNS.map(column => {
      const cards = data.columns[column.stage]
      return <section key={column.stage} className="col" aria-label={column.label}>
        <div className="col-h"><span>{column.label}</span><span className="mono muted">{column.stage === 'ended' && data.endedTotal > cards.length ? `${cards.length}/${data.endedTotal}` : cards.length}</span></div>
        {column.hint && <div className="col-hint">{column.hint}</div>}
        {cards.map(card => <TicketCard key={card.id} card={card} showStage={column.stage === 'person' || column.stage === 'ended'} />)}
        {!cards.length && <div className="col-empty">{t('None', '没有')}</div>}
      </section>
    })}</div> : !error && <div className="card empty">{t('Loading…', '正在读取…')}</div>}
    {data && !data.columns.person.length && <p className="muted">{t('Everything that needs you is on the ', '需要你处理的事都在 ')}<a href={href.home()}>{PAGE.home}</a>{t('.', '。')}</p>}
  </>
}
