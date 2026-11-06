/**
 * What a Ticket's worker did and what the agent said, both read through the companion plugin. The transcript follows a running
 * worker by asking again every few seconds; older steps load on request.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { CompanionState, SaidMessage, TranscriptItem, TranscriptView } from '@dsh-superagent-ui/contract'
import { ApiError, call } from '../api'
import { clock, DROP_REASON, SOURCE_NAME } from '../text'
import { Pill } from './ui'

const FOLLOW_MS = 4000
const GUIDE = 'https://github.com/hustnn/dsh-superagent-ui/blob/main/docs/operations.md#companion-插件'

export function Missing({ what }: { what: string }) {
  return <p className="muted small">装上 companion 插件后，这里能看到{what}。<a href={GUIDE} target="_blank" rel="noopener noreferrer">怎么装</a></p>
}

export function Transcript({ ticketId, working }: { ticketId: string; working: boolean }) {
  const [view, setView] = useState<TranscriptView | null>(null)
  const [older, setOlder] = useState<TranscriptItem[]>([])
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setView(await call('GET /api/tickets/:id/transcript', { params: { id: ticketId } })); setError(null) }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : String(failure)) }
  }, [ticketId])
  useEffect(() => { setOlder([]); void load() }, [load])
  // Follow a running worker; stop once its turn ends and the Ticket no longer works.
  useEffect(() => {
    if (!working && !view?.running) return
    const timer = setInterval(() => { void load() }, FOLLOW_MS)
    return () => clearInterval(timer)
  }, [working, view?.running, load])
  useEffect(() => { if (view && !older.length) setMore(view.more) }, [view, older.length])

  const earlier = async () => {
    const first = older[0] ?? view?.items[0]
    if (!first) return
    const page = await call('GET /api/tickets/:id/transcript', { params: { id: ticketId }, query: { before: String(first.seq) } })
    setOlder(items => [...page.items, ...items])
    setMore(page.more)
  }

  if (error) return <p className="muted small">读不到 worker 的记录：{error}</p>
  if (!view) return <p className="muted small">正在读取…</p>
  if (!view.companion.installed) return <Missing what=" worker 的每一步：它读了什么、跑了什么命令、结果如何" />
  if (!view.exists) return <p className="muted small">worker 还没开始。排队的 Ticket 拿到 worker 后，这里会出现它的每一步。</p>
  const items = [...older, ...view.items]
  return <div className="transcript">
    <p className="small tr-model">{view.models === null ? <span className="muted">升级到 0.2.0 以上的 companion 插件后，这里显示这一单用的模型。</span>
      : view.models.length > 1 ? <>模型：先后用过 <span className="mono">{view.models.join('、')}</span>，最近一次是 <span className="mono">{view.model}</span></>
      : view.model ? <>模型：<span className="mono">{view.model}</span></> : null}</p>
    {more && <button className="btn sm ghost" onClick={() => void earlier()}>更早的步骤</button>}
    <ol>{items.map(item => <li key={item.seq} className={`tr-${item.kind}`}><Step item={item} /></li>)}</ol>
    {view.running && <p className="muted small"><Pill tone="accent">进行中</Pill> 每 {FOLLOW_MS / 1000} 秒刷新一次</p>}
  </div>
}

function Step({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'turn': return <div className="tr-turn-line"><span className="mono">{clock(item.at)}</span> {item.text}</div>
    case 'input': return <><Head at={item.at}><b>{item.label}</b></Head><Fold text={item.text} /></>
    case 'thinking': return <><Head at={item.at}><span className="muted">思考</span></Head><Fold text={item.text} muted /></>
    case 'say': return <><Head at={item.at}><b>它说</b>{item.interrupted && <Pill tone="warn">被打断</Pill>}</Head><div className="pre"><Linked text={item.text} /></div></>
    case 'tool': return <details>
      <summary><Head at={item.at}><span className="mono">{item.name}</span><span className="tr-label">{item.label}</span>
        {item.ok === null ? <Pill tone="accent">运行中</Pill> : item.ok ? null : <Pill tone="danger">出错</Pill>}
        {item.exit !== undefined && <Pill tone={item.exit === '0' ? 'muted' : 'warn'} dot={false}>{/^-?\d+$/.test(item.exit) ? `退出码 ${item.exit}` : item.exit}</Pill>}
        {item.ms !== undefined && <span className="muted small mono">{seconds(item.ms)}</span>}</Head></summary>
      <div className="tr-io"><div className="lbl">参数</div><pre>{item.args}</pre>
        {item.error && <><div className="lbl">错误</div><pre className="err">{item.error}</pre></>}
        {item.result !== undefined && <><div className="lbl">结果</div><pre>{item.result || '（没有输出）'}</pre></>}</div>
    </details>
  }
}

function Head({ at, children }: { at: string; children: ReactNode }) {
  return <div className="tr-head"><span className="mono muted">{clock(at)}</span>{children}</div>
}
/** Long text folds to three lines until opened. */
function Fold({ text, muted }: { text: string; muted?: boolean }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 240 || text.split('\n').length > 4
  return <>
    <div className={`pre${muted ? ' muted' : ''}${long && !open ? ' clamp' : ''}`}>{text}</div>
    {long && <button className="btn sm ghost" onClick={() => setOpen(!open)}>{open ? '收起' : '展开'}</button>}
  </>
}
/** The agent writes Markdown links in its messages, such as `[PR #1](https://…)`; they open as links here. */
function Linked({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    parts.push(text.slice(last, match.index), <a key={match.index} href={match[2]} target="_blank" rel="noopener noreferrer">{match[1]}</a>)
    last = match.index + match[0].length
  }
  parts.push(text.slice(last))
  return <>{parts}</>
}
const seconds = (ms: number) => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`

const KIND: Record<SaidMessage['kind'], string> = { acknowledgement: '确认', reply: '回复', notice: '通知' }
export function Said({ said }: { said: SaidMessage[] | null }) {
  if (!said) return <Missing what="它在这个 Ticket 的对话里说过的每句话" />
  if (!said.length) return <p className="muted small">它还没在这个 Ticket 的对话里说过话。</p>
  return <ol className="said">{said.map((message, i) => <li key={i}>
    <div className="tr-head"><b>{KIND[message.kind]}</b><span className="muted small">{SOURCE_NAME[message.source] ?? message.source}</span>
      {message.status === 'pending' && <Pill tone="warn">还没发出</Pill>}
      {message.status === 'dropped' && <Pill tone="danger">丢弃：{DROP_REASON[message.dropped?.reason ?? ''] ?? message.dropped?.reason}</Pill>}</div>
    <div className="pre"><Linked text={message.text} /></div>
  </li>)}</ol>
}

export function companionLabel(state: CompanionState): string {
  return state.installed ? `已安装 ${state.version}` : '未安装'
}
