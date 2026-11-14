/**
 * The command palette (⌘K or /): jump to a page or a Ticket, look up a message, or pause processing, without the mouse.
 * Whatever is typed can always become a message lookup, since links and `#123` are what people paste.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardView, StatusSummary } from '@dsh-superagent-ui/contract'
import { call } from '../api'
import { href, navigate } from '../route'
import { t } from '../i18n'
import { PAGE, stageLabel, type PageName } from '../text'
import { useAction, useUi } from './ui'

interface Item { label: string; hint: string; run: () => void | Promise<void> }

/** What pausing and resuming do, shared with the Health page. */
export const PAUSE_BODY = () => t('Sources keep recording messages, but nothing is evaluated, no new work is dispatched and no messages are sent. Running workers are not interrupted.',
  '来源会继续记录消息，但不评估、不派新活、不发任何消息。正在运行的 worker 不会被打断。')
export const RESUME_BODY = () => t('Messages recorded while paused get evaluated, waiting work is dispatched, and queued replies are sent.',
  '恢复后会评估暂停期间记录的消息，派出等待的活，发出排队的回复。')

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
    const page = (name: PageName, to: string): Item => ({ label: PAGE[name], hint: t('Page', '页面'), run: go(to) })
    const pages: Item[] = [
      page('home', href.home()), page('board', href.board()), page('lookup', href.lookup()), page('calibration', href.calibration()),
      page('policy', href.policy()), page('prompts', href.prompts()), page('recipes', href.recipes()), page('insights', href.insights()),
      page('sources', href.sources()), page('execution', href.execution()), page('directories', href.directories()), page('health', href.health()),
    ]
    const tickets: Item[] = board ? (['person', 'working', 'queued', 'idle', 'ended'] as const)
      .flatMap(stage => board.columns[stage]).map(card => ({ label: card.title, hint: stageLabel(card).label, run: go(href.ticket(card.id)) })) : []
    const actions: Item[] = status ? [{ label: status.paused ? t('Resume processing', '恢复处理') : t('Pause processing', '暂停处理'), hint: t('Action', '操作'), run: async () => {
      onClose()
      const pausing = !status.paused
      const ok = await confirm(pausing
        ? { title: t('Pause processing?', '暂停处理？'), action: t('Pause', '暂停'), body: PAUSE_BODY() }
        : { title: t('Resume processing?', '恢复处理？'), action: t('Resume', '恢复'), body: RESUME_BODY() })
      if (ok) await run('pause', () => call('POST /api/executor/pause', { body: { paused: pausing } }), pausing ? t('Processing paused', '已暂停处理') : t('Processing resumed', '已恢复处理'))
    } }] : []
    const lower = q.toLowerCase()
    const matched = [...pages, ...tickets, ...actions].filter(item => !lower || `${item.label} ${item.hint}`.toLowerCase().includes(lower))
    return [...q ? [{ label: t(`Trace message: ${q}`, `查消息去向：${q}`), hint: t('Search', '搜索'), run: go(href.lookup(q)) }] : [], ...matched].slice(0, 12)
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
    <div className="pal" role="dialog" aria-modal="true" aria-label={t('Command palette', '命令面板')} onClick={event => event.stopPropagation()}>
      <input autoFocus value={query} onChange={event => { setQuery(event.target.value); setSelected(0) }} onKeyDown={onKey}
        placeholder={t('Jump to a page or Ticket, or paste a message link to trace it', '跳到页面或 Ticket，或粘贴消息链接查去向')} aria-label={t('Command', '命令')} />
      <div className="pal-list" ref={list} role="listbox">
        {items.map((item, i) => <div key={`${item.hint}:${item.label}`} role="option" aria-selected={i === index} className={`it${i === index ? ' on' : ''}`}
          onMouseEnter={() => setSelected(i)} onClick={() => void item.run()}>
          <span className="lbl">{item.label}</span><span className="k">{item.hint}</span></div>)}
        {!items.length && <div className="it muted">{t('No matches', '没有匹配的结果')}</div>}
      </div>
    </div>
  </div>
}
