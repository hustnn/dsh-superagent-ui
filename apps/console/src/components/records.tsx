/** The records the pages share: a Ticket card, a thread row, and a message with the path it took. */
import type { MessageRow, ThreadRow, TicketCard as Card } from '@dsh-superagent-ui/contract'
import { call } from '../api'
import { href } from '../route'
import { clock, duration, SOURCE_NAME, stageLabel, THREAD_STAGE } from '../text'
import { Pill, SourceChip, useAction, useNow } from './ui'

export function TicketCard({ card, showStage = true }: { card: Card; showStage?: boolean }) {
  const now = useNow()
  const stage = stageLabel(card)
  const line = card.question ? `它在问：${card.question}` : card.note?.text ?? card.summary
  return <a className="tcard" href={href.ticket(card.id)}>
    <span className="ttl">{card.title}</span>
    {line && <span className={`sum${card.note?.error ? ' err' : ''}`}>{line}</span>}
    <span className="ft">
      {card.thread && <SourceChip thread={card.thread} />}
      {showStage && <Pill tone={stage.tone}>{stage.label}</Pill>}
      {card.strength === 'inferred' && <Pill tone="infer" dot={false}>主动接单</Pill>}
      {card.stage === 'person' && <span className="wait">已等 {duration(now - Date.parse(card.updatedAt))}</span>}
    </span>
  </a>
}

export function ThreadLine({ thread }: { thread: ThreadRow }) {
  const stage = THREAD_STAGE[thread.stage]
  return <a className="row link-row" href={href.thread(thread.key)}>
    <div><span className="chip"><b>{SOURCE_NAME[thread.source] ?? thread.source}</b>{thread.key.split(':').slice(1).join(':')}</span></div>
    <div className="body">
      <div className="ttl">{thread.title}</div>
      {thread.latest && <div className="ask">{thread.latest.actor}：{thread.latest.preview}</div>}
      <div className="meta"><Pill tone={stage.tone}>{stage.label}</Pill>{thread.tickets.map(ticket => <span key={ticket.id} className="muted">{ticket.title}</span>)}</div>
    </div>
    <div className="muted mono">{clock(thread.lastAt)}</div>
  </a>
}

const STEP_MARK = { pass: '✓', stop: '×', route: '→', info: 'i', wait: '…' } as const

/** One message and where it went, step by step. `focus` marks the message the address points at. */
export function MessageCard({ message, focus, showThread, reload }: { message: MessageRow; focus?: boolean; showThread?: boolean; reload: () => Promise<void> }) {
  const { busy, run } = useAction(reload)
  const requeue = () => run(message.id, () => call('POST /api/triggers/:id/requeue', { params: { id: message.id } }), '已放回评估队列')
  return <article className={`msg${focus ? ' focus' : ''}`} id={`m-${message.id}`}>
    <header>
      <b>{message.actor}</b>{!message.human && <span className="muted">（自动）</span>}
      <span className="muted mono">{clock(message.at)}</span>
      {/* A message its Source filtered never got a thread, so there is nothing to link to. */}
      {showThread && message.threadTitle && <a href={href.thread(message.thread, message.id)} className="muted">{message.threadTitle}</a>}
      <span className="grow" />
      <Pill tone={message.path.verdict.tone}>{message.path.verdict.label}</Pill>
    </header>
    <p className="text">{message.text}</p>
    <ol className="path">{message.path.steps.map((step, i) => <li key={i} className={`step s-${step.tone}`}>
      <span className="dot" aria-hidden="true">{STEP_MARK[step.tone]}</span>
      <div><div className="st">{step.title}{step.ticketId && <> · <a href={href.ticket(step.ticketId)}>看 Ticket</a></>}</div>{step.detail && <div className="sd">{step.detail}</div>}</div>
    </li>)}</ol>
    {(message.path.requeue || message.url) && <footer>
      {message.path.requeue && <button className="btn sm" disabled={busy === message.id} onClick={() => void requeue()}>重新评估</button>}
      {message.url && <a className="btn sm ghost" href={message.url} target="_blank" rel="noopener noreferrer">打开原消息 ↗</a>}
    </footer>}
  </article>
}
