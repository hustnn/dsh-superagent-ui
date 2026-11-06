/**
 * Message lookup: "why didn't the agent answer me?" Paste a GitHub or Feishu link, `#123`, an id, or words from the message,
 * and see where each matching message went. Below, the threads, by what they are waiting for.
 */
import { useEffect, useState } from 'react'
import type { SearchView, ThreadFilter } from '@dsh-superagent-ui/contract'
import { call } from '../api'
import { MessageCard, ThreadLine, TicketCard } from '../components/records'
import { ConnectionBanner } from '../components/ui'
import { useLive, useLiveData } from '../live'
import { href, navigate } from '../route'

const FILTERS: { id: ThreadFilter; label: string }[] = [
  { id: 'subscribed', label: '有 Ticket 在关注' },
  { id: 'evaluating', label: '评估中' },
  { id: 'recent', label: '24 小时有新消息' },
  { id: 'all', label: '全部' },
]

export function Lookup({ query }: { query: string }) {
  const [draft, setDraft] = useState(query)
  useEffect(() => setDraft(query), [query])
  return <>
    <div className="head"><div><h1>消息去向</h1><p>“它怎么没理我？”粘贴消息链接、<span className="mono">#123</span>、id 或消息里的几个字，看它走过的每一步。</p></div></div>
    <form className="search" onSubmit={event => { event.preventDefault(); navigate(href.lookup(draft.trim())) }}>
      <input id="lookup-q" value={draft} onChange={event => setDraft(event.target.value)} autoFocus={!query}
        placeholder="https://github.com/acme/harness-app/issues/151#issuecomment-2210" aria-label="要查的消息" />
      <button className="btn primary" type="submit">查去向</button>
    </form>
    {query && <Results query={query} />}
    <Threads />
  </>
}

function Results({ query }: { query: string }) {
  const { data, error, reload } = useLiveData(['thread'], query, () => call('GET /api/search', { query: { q: query } }))
  if (error) return <ConnectionBanner error={error} />
  if (!data) return <div className="card empty">正在查…</div>
  if (empty(data)) return <div className="card empty"><h2>没找到</h2><p>dsh-superagent 没收到过匹配的消息。消息所在的群或仓库不在监听范围时，它根本不会收到。</p></div>
  return <>
    {data.messages.length > 0 && <section>
      <div className="sec-t"><h2>消息 <span className="muted mono">{data.messages.length}</span></h2></div>
      <div className="msgs">{data.messages.map(message => <MessageCard key={message.id} message={message} showThread reload={reload} />)}</div>
    </section>}
    {data.threads.length > 0 && <section>
      <div className="sec-t"><h2>线程</h2></div>
      <div className="card rows">{data.threads.map(thread => <ThreadLine key={thread.key} thread={thread} />)}</div>
    </section>}
    {data.tickets.length > 0 && <section>
      <div className="sec-t"><h2>Ticket</h2></div>
      <div className="cards">{data.tickets.map(card => <TicketCard key={card.id} card={card} />)}</div>
    </section>}
  </>
}
const empty = (result: SearchView) => !result.messages.length && !result.threads.length && !result.tickets.length

function Threads() {
  const [filter, setFilter] = useState<ThreadFilter>('subscribed')
  const { data, error } = useLiveData(['threads'], filter, () => call('GET /api/threads', { query: { filter } }))
  const { connection } = useLive()
  return <section>
    <div className="sec-t"><h2>线程</h2>
      <div className="seg" role="group" aria-label="线程筛选">{FILTERS.map(item =>
        <button key={item.id} className={filter === item.id ? 'on' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data && (data.items.length ? <div className="card rows">{data.items.map(thread => <ThreadLine key={thread.key} thread={thread} />)}</div>
      : <div className="card empty">没有符合条件的线程。</div>)}
  </section>
}
