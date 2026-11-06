/**
 * The command palette (⌘K or /): jump to a page or a Ticket, look up a message, or pause processing, without the mouse.
 * Whatever is typed can always become a message lookup, since links and `#123` are what people paste.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardView, StatusSummary } from '@dsh-superagent-ui/contract'
import { call } from '../api'
import { href, navigate } from '../route'
import { stageLabel } from '../text'
import { useAction, useUi } from './ui'

interface Item { label: string; hint: string; run: () => void | Promise<void> }

export function Palette({ status, onClose }: { status?: StatusSummary; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [board, setBoard] = useState<BoardView | undefined>(undefined)
  const { confirm } = useUi()
  const { run } = useAction(() => {})
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { call('GET /api/board').then(setBoard, () => {}) }, [])

  const items = useMemo(() => {
    const q = query.trim()
    const go = (target: string) => () => { navigate(target); onClose() }
    const pages: Item[] = [
      { label: '首页', hint: '页面', run: go(href.home()) },
      { label: '看板', hint: '页面', run: go(href.board()) },
      { label: '消息去向', hint: '页面', run: go(href.lookup()) },
      { label: '校准', hint: '页面', run: go(href.calibration()) },
      { label: '策略', hint: '页面', run: go(href.policy()) },
      { label: '提示词', hint: '页面', run: go(href.prompts()) },
      { label: '场景配方', hint: '页面', run: go(href.recipes()) },
      { label: '洞察', hint: '页面', run: go(href.insights()) },
      { label: '来源', hint: '页面', run: go(href.sources()) },
      { label: '执行', hint: '页面', run: go(href.execution()) },
      { label: '工作目录', hint: '页面', run: go(href.directories()) },
      { label: '健康', hint: '页面', run: go(href.health()) },
    ]
    const tickets: Item[] = board ? (['person', 'working', 'queued', 'idle', 'ended'] as const)
      .flatMap(stage => board.columns[stage]).map(card => ({ label: card.title, hint: stageLabel(card).label, run: go(href.ticket(card.id)) })) : []
    const actions: Item[] = status ? [{ label: status.paused ? '恢复处理' : '暂停处理', hint: '操作', run: async () => {
      onClose()
      const pausing = !status.paused
      const ok = await confirm(pausing
        ? { title: '暂停处理？', action: '暂停', body: '来源会继续记录消息，但不评估、不派新活、不发任何消息。正在运行的 worker 不会被打断。' }
        : { title: '恢复处理？', action: '恢复', body: '恢复后会评估暂停期间记录的消息，派出等待的活，发出排队的回复。' })
      if (ok) await run('pause', () => call('POST /api/executor/pause', { body: { paused: pausing } }), pausing ? '已暂停处理' : '已恢复处理')
    } }] : []
    const lower = q.toLowerCase()
    const matched = [...pages, ...tickets, ...actions].filter(item => !lower || `${item.label} ${item.hint}`.toLowerCase().includes(lower))
    return [...q ? [{ label: `查消息去向：${q}`, hint: '搜索', run: go(href.lookup(q)) }] : [], ...matched].slice(0, 12)
  }, [board, confirm, onClose, query, run, status])

  const index = Math.min(selected, Math.max(0, items.length - 1))
  useEffect(() => { list.current?.children[index]?.scrollIntoView({ block: 'nearest' }) }, [index])
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(Math.min(items.length - 1, index + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(Math.max(0, index - 1)) }
    else if (event.key === 'Enter' && items[index]) { event.preventDefault(); void items[index].run() }
    else if (event.key === 'Escape') onClose()
  }
  return <div className="layer" onClick={onClose}>
    <div className="pal" role="dialog" aria-modal="true" aria-label="命令面板" onClick={event => event.stopPropagation()}>
      <input autoFocus value={query} onChange={event => { setQuery(event.target.value); setSelected(0) }} onKeyDown={onKey}
        placeholder="跳到页面或 Ticket，或粘贴消息链接查去向" aria-label="命令" />
      <div className="pal-list" ref={list} role="listbox">
        {items.map((item, i) => <div key={`${item.hint}:${item.label}`} role="option" aria-selected={i === index} className={`it${i === index ? ' on' : ''}`}
          onMouseEnter={() => setSelected(i)} onClick={() => void item.run()}>
          <span className="lbl">{item.label}</span><span className="k">{item.hint}</span></div>)}
        {!items.length && <div className="it muted">没有匹配的结果</div>}
      </div>
    </div>
  </div>
}
