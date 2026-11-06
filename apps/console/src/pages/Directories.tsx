/** Ticket directories: how much disk each one takes and what is in it. Nothing here changes a file. */
import { useEffect } from 'react'
import type { DirectoryEntry, DirectoryFilesView, DirectoriesView, DirectoryItem } from '@dsh-superagent-ui/contract'
import { call } from '../api'
import { ConnectionBanner, Pill, useAction } from '../components/ui'
import { useLive, useLiveData } from '../live'
import { href } from '../route'
import { clock, fileSize, stageLabel } from '../text'

const FOLLOW_MS = 3000

/** Follows a measurement still running: sizes appear as it finishes. */
function useFollow(measuring: boolean | undefined, reload: () => Promise<void>) {
  useEffect(() => {
    if (!measuring) return
    const timer = setInterval(() => { void reload() }, FOLLOW_MS)
    return () => clearInterval(timer)
  }, [measuring, reload])
}

const sizeText = (size: number | null, measuring: boolean) => size !== null ? fileSize(size) : measuring ? '计算中…' : '—'

export function Directories({ directory, path }: { directory?: string; path?: string }) {
  return directory ? <Folder directory={directory} path={path ?? ''} /> : <List />
}

function List() {
  const { data, error, reload } = useLiveData(['board', 'settings'], 'directories', () => call('GET /api/directories'))
  const { connection } = useLive()
  const { busy, run } = useAction(reload)
  useFollow(data?.measuring, reload)
  return <>
    <div className="head"><div><h1>工作目录</h1><p>每个 Ticket 有一个工作目录。一个线程可以开多个 Ticket，一个 Ticket 也可以跟多个线程，所以线程和目录不是一一对应。这里只看不改。</p></div>
      <button className="btn" disabled={!!busy || data?.measuring} onClick={() => void run('rescan', () => call('POST /api/directories/rescan'), '开始重新计算')}>重新计算</button></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data ? <ListBody view={data} run={run} busy={busy} /> : !error && <div className="card empty">正在读取…</div>}
  </>
}

type Run = ReturnType<typeof useAction>['run']

function ListBody({ view, run, busy }: { view: DirectoriesView; run: Run; busy: string | null }) {
  return <section className="card pad">
    <p className="small">{view.measuring && !view.total ? '正在计算占用…' : <>共占用 <b>{fileSize(view.total)}</b>{view.measuring && <span className="muted">，还在计算</span>}</>}
      {view.disk && <span className="muted"> · 磁盘还剩 {fileSize(view.disk.free)}，总共 {fileSize(view.disk.total)}</span>}</p>
    <p className="muted small mono">{view.root}</p>
    {view.items.length ? <div className="scroll-x gap-top"><table className="tbl">
      <thead><tr><th>目录</th><th>状态</th><th className="r">大小</th><th className="r">线程</th><th>更新</th><th /></tr></thead>
      <tbody>{view.items.map(item => <ListRow key={item.key} item={item} canReveal={view.canReveal} run={run} busy={busy} />)}</tbody>
    </table></div> : <p className="empty">还没有工作目录。</p>}
  </section>
}

function ListRow({ item, canReveal, run, busy }: { item: DirectoryItem; canReveal: boolean; run: Run; busy: string | null }) {
  const { ticket } = item
  const stage = ticket && stageLabel(ticket)
  return <tr>
    <td>{item.exists ? <a href={href.directories(item.key)}>{ticket?.title ?? item.name}</a> : <span>{ticket?.title ?? item.name}</span>}
      {ticket && <div className="muted small mono">{item.name}</div>}</td>
    <td>{stage ? <Pill tone={stage.tone}>{stage.label}</Pill> : <Pill>没有对应 Ticket</Pill>}</td>
    <td className="r">{item.exists ? sizeText(item.size, item.measuring) : <span className="muted">目录不在</span>}</td>
    <td className="r">{ticket?.threads ?? '—'}</td>
    <td className="muted small">{ticket ? clock(ticket.updatedAt) : '—'}</td>
    <td className="r">{ticket && <a className="btn sm" href={href.ticket(ticket.id)}>Ticket</a>}
      {canReveal && item.exists && <> <RevealButton directory={item.key} path="" run={run} busy={busy} /></>}</td>
  </tr>
}

function RevealButton({ directory, path, run, busy }: { directory: string; path: string; run: Run; busy: string | null }) {
  return <button className="btn sm" disabled={!!busy} onClick={() => void run(`reveal:${path}`, () => call('POST /api/directories/reveal', { body: { key: directory, path } }), '已在访达中显示')}>在访达中显示</button>
}

function Folder({ directory, path }: { directory: string; path: string }) {
  const { data, error, reload } = useLiveData(['settings'], `directory:${directory}/${path}`, () => call('GET /api/directories/files', { query: { key: directory, path } }))
  const { connection } = useLive()
  const { busy, run } = useAction(reload)
  useFollow(data?.measuring, reload)
  return <>
    <div className="head"><div><h1>{data?.ticket?.title ?? data?.name ?? directory}</h1>
      <p className="crumbs"><a href={href.directories()}>工作目录</a><Crumbs directory={directory} name={data?.name ?? directory} path={path} /></p></div>
      {data?.canReveal && <RevealButton directory={directory} path={path} run={run} busy={busy} />}</div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data ? <FolderBody view={data} run={run} busy={busy} /> : error ? <div className="card empty">{error.message}</div> : <div className="card empty">正在读取…</div>}
  </>
}

function Crumbs({ directory, name, path }: { directory: string; name: string; path: string }) {
  const parts = path ? path.split('/') : []
  return <>
    <span className="muted"> / </span><a href={href.directories(directory)}>{name}</a>
    {parts.map((part, index) => <span key={index}><span className="muted"> / </span><a href={href.directories(directory, parts.slice(0, index + 1).join('/'))}>{part}</a></span>)}
  </>
}

function FolderBody({ view, run, busy }: { view: DirectoryFilesView; run: Run; busy: string | null }) {
  return <section className="card pad">
    <p className="small">这个文件夹占用 <b>{sizeText(view.size, view.measuring)}</b>
      {view.ticket && <span className="muted"> · <a href={href.ticket(view.ticket.id)}>打开 Ticket</a></span>}</p>
    <p className="muted small mono">{view.path}</p>
    {view.entries.length ? <div className="scroll-x gap-top"><table className="tbl">
      <thead><tr><th>名称</th><th className="r">大小</th><th>修改时间</th><th /></tr></thead>
      <tbody>{view.entries.map(entry => <EntryRow key={entry.name} view={view} entry={entry} run={run} busy={busy} />)}</tbody>
    </table></div> : <p className="empty">这个文件夹是空的。</p>}
    {view.omitted > 0 && <p className="muted small gap-top">只列出最大的 {view.entries.length} 项，还有 {view.omitted} 项没有列出。</p>}
  </section>
}

function EntryRow({ view, entry, run, busy }: { view: DirectoryFilesView; entry: DirectoryEntry; run: Run; busy: string | null }) {
  const path = view.relative ? `${view.relative}/${entry.name}` : entry.name
  return <tr>
    <td className="mono">{entry.kind === 'folder' ? <a href={href.directories(view.key, path)}>{entry.name}/</a> : entry.name}
      {entry.kind === 'link' && <span className="muted small"> （链接）</span>}</td>
    <td className="r">{entry.kind === 'link' ? '—' : sizeText(entry.size, view.measuring)}</td>
    <td className="muted small">{clock(entry.modifiedAt)}</td>
    {/* A link may point outside the directory, which the BFF refuses. */}
    <td className="r">{view.canReveal && entry.kind !== 'link' && <RevealButton directory={view.key} path={path} run={run} busy={busy} />}</td>
  </tr>
}
