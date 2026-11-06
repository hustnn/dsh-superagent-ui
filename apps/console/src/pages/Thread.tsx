/** One thread: its Tickets, and every message on it with where it went. The address can point at one message. */
import { useEffect } from 'react'
import type { ThreadView } from '@dsh-superagent-ui/contract'
import { call } from '../api'
import { MessageCard, TicketCard } from '../components/records'
import { ConnectionBanner, Pill, useAction, useUi } from '../components/ui'
import { useLive, useLiveData } from '../live'
import { SOURCE_NAME, THREAD_STAGE } from '../text'

export function Thread({ threadKey, message }: { threadKey: string; message?: string }) {
  const { data, error, reload } = useLiveData(['thread'], `${threadKey}|${message ?? ''}`,
    () => call('GET /api/thread', { query: { key: threadKey, ...message ? { around: message } : {} } }))
  const { connection } = useLive()
  return <>
    <div><button className="link" onClick={() => history.back()}>← 返回</button></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error && error.kind !== 'not-found' ? { error } : {}} />
    {error?.kind === 'not-found' && <div className="card empty"><h2>没有这个线程</h2><p>来源过滤掉的消息不会建线程，去“消息去向”里按链接查它。</p></div>}
    {data && <ThreadBody thread={data} focus={message} reload={reload} />}
    {!data && !error && <div className="card empty">正在读取…</div>}
  </>
}

function ThreadBody({ thread, focus, reload }: { thread: ThreadView; focus?: string; reload: () => Promise<void> }) {
  const { confirm } = useUi()
  const { busy, run } = useAction(reload)
  const stage = THREAD_STAGE[thread.stage]
  useEffect(() => {
    if (focus) document.getElementById(`m-${focus}`)?.scrollIntoView({ block: 'center' })
  }, [focus, thread.messages.length])
  const unsubscribe = async () => {
    const ok = await confirm({ title: '退订这个线程？', action: '退订',
      body: '退订后，这个线程上的新消息不再送到下面的 Ticket；有人再发消息，会重新走准入和评估。已经送到的消息仍由各自的 worker 处理。' })
    if (ok) await run('unsubscribe', () => call('POST /api/thread/unsubscribe', { body: { key: thread.key } }), '已退订')
  }
  return <>
    <div className="card pad">
      <div className="tk-head">
        <div className="grow">
          <h1>{thread.title}</h1>
          <div className="chips">
            <span className="chip"><b>{SOURCE_NAME[thread.source] ?? thread.source}</b>{thread.key.split(':').slice(1).join(':')}</span>
            <Pill tone={stage.tone}>{stage.label}</Pill>
            {thread.pending > 0 && <Pill tone="accent" dot={false}>{thread.pending} 条等评估</Pill>}
          </div>
        </div>
        <div className="acts">
          {thread.url && <a className="btn" href={thread.url} target="_blank" rel="noopener noreferrer">打开原线程 ↗</a>}
          {thread.unsubscribe && <button className="btn ghost danger" disabled={busy === 'unsubscribe'} onClick={() => void unsubscribe()}>退订</button>}
        </div>
      </div>
    </div>
    {thread.ticketCards.length > 0 && <section>
      <div className="sec-t"><h2>这个线程上的 Ticket</h2></div>
      <div className="cards">{thread.ticketCards.map(card => <div key={card.id} className="card-wrap">
        <TicketCard card={card} />{card.context && <span className="muted small">只把这里当参考</span>}</div>)}</div>
    </section>}
    <section>
      <div className="sec-t"><h2>消息 <span className="muted mono">{thread.messages.length}</span></h2>{thread.earlier && <span className="muted small">只显示最近的消息</span>}</div>
      <div className="msgs">{thread.messages.map(message => <MessageCard key={message.id} message={message} focus={message.id === focus} reload={reload} />)}</div>
    </section>
  </>
}
