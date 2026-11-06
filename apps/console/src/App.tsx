/** The console shell: sign-in gate, top bar, navigation, command palette, and the page the address names. */
import { useEffect, useState } from 'react'
import type { HomeView, Meta } from '@dsh-superagent-ui/contract'
import { ApiError, call } from './api'
import { Palette } from './components/palette'
import { Pill, UiProvider } from './components/ui'
import { LiveProvider, useLive, useView } from './live'
import { Board } from './pages/Board'
import { Health } from './pages/Health'
import { Home } from './pages/Home'
import { Calibration } from './pages/Calibration'
import { Lookup } from './pages/Lookup'
import { Policy } from './pages/Policy'
import { Prompts } from './pages/Prompts'
import { Recipes } from './pages/Recipes'
import { Insights } from './pages/Insights'
import { Directories } from './pages/Directories'
import { Execution, Sources } from './pages/Settings'
import { Thread } from './pages/Thread'
import { Ticket } from './pages/Ticket'
import { href, parseRoute, type Route } from './route'

export function App({ tokenRefused }: { tokenRefused: boolean }) {
  const [meta, setMeta] = useState<Meta | 'unauthenticated' | ApiError | undefined>(undefined)
  useEffect(() => {
    call('GET /api/meta').then(setMeta, (error: unknown) =>
      setMeta(error instanceof ApiError && error.kind === 'unauthenticated' ? 'unauthenticated' : error instanceof ApiError ? error : new ApiError(0, 'offline', String(error))))
  }, [])
  if (meta === undefined) return null
  if (meta === 'unauthenticated') return <SignIn refused={tokenRefused} />
  if (meta instanceof ApiError) return <div className="center"><div className="card pad"><h1>控制台打不开</h1><p className="sub">{meta.message}</p></div></div>
  return <UiProvider><LiveProvider><Shell meta={meta} /></LiveProvider></UiProvider>
}

function SignIn({ refused }: { refused: boolean }) {
  return <div className="center"><div className="card pad signin">
    <h1>用启动链接打开控制台</h1>
    <p className="sub">{refused ? '这个链接里的 token 不对，可能已经换过。' : '控制台只接受带 token 的启动链接，这样本机其他网页没法操作你的 agent。'}
      在运行控制台的终端里找“Superagent 控制台”那一行；找不到的话，在项目目录运行：</p>
    <pre className="code">pnpm console:url</pre>
  </div></div>
}

type Section = 'home' | 'board' | 'lookup' | 'calibration' | 'recipes' | 'policy' | 'prompts' | 'health' | 'insights' | 'sources' | 'execution' | 'directories'
const NAV: { group: string; items: { page: Section; label: string; to: string }[] }[] = [
  { group: '工作', items: [{ page: 'home', label: '首页', to: href.home() }, { page: 'board', label: '看板', to: href.board() }, { page: 'lookup', label: '消息去向', to: href.lookup() }] },
  { group: '放手', items: [{ page: 'calibration', label: '校准', to: href.calibration() }, { page: 'recipes', label: '场景配方', to: href.recipes() }] },
  { group: '调教', items: [{ page: 'policy', label: '策略', to: href.policy() }, { page: 'prompts', label: '提示词', to: href.prompts() }] },
  { group: '运行', items: [{ page: 'health', label: '健康', to: href.health() }, { page: 'insights', label: '洞察', to: href.insights() },
    { page: 'sources', label: '来源', to: href.sources() }, { page: 'execution', label: '执行', to: href.execution() }, { page: 'directories', label: '工作目录', to: href.directories() }] },
]
/** Which navigation entry a page belongs under. */
const SECTION: Record<Route['page'], Section> = { home: 'home', board: 'board', ticket: 'board', lookup: 'lookup', thread: 'lookup', health: 'health',
  policy: 'policy', calibration: 'calibration', prompts: 'prompts', recipes: 'recipes', insights: 'insights', sources: 'sources', execution: 'execution', directories: 'directories' }

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash))
  useEffect(() => {
    const onHash = () => { setRoute(parseRoute(location.hash)); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

function Shell({ meta }: { meta: Meta }) {
  const route = useRoute()
  const home = useView('home')
  const [palette, setPalette] = useState(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement).tagName)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette(open => !open) }
      else if (event.key === '/' && !typing && !document.querySelector('.layer')) { event.preventDefault(); setPalette(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const section = SECTION[route.page]
  return <>
    <TopBar home={home.data} meta={meta} onSearch={() => setPalette(true)} />
    <div className="app">
      <nav className="nav" aria-label="主导航">
        {NAV.map(group => <div key={group.group} className="navg">
          <div className="navl">{group.group}</div>
          {group.items.map(item => <a key={item.page} href={item.to} className={`navi${section === item.page ? ' on' : ''}`} aria-current={section === item.page ? 'page' : undefined}>
            {item.label}<Badge page={item.page} home={home.data} /></a>)}
        </div>)}
      </nav>
      <main className="main">
        {route.page === 'home' && <Home view={home} />}
        {route.page === 'board' && <Board />}
        {route.page === 'ticket' && <Ticket id={route.id} />}
        {route.page === 'lookup' && <Lookup query={route.query} />}
        {route.page === 'thread' && <Thread threadKey={route.key} {...route.message ? { message: route.message } : {}} />}
        {route.page === 'health' && <Health />}
        {route.page === 'policy' && <Policy />}
        {route.page === 'calibration' && <Calibration />}
        {route.page === 'prompts' && <Prompts {...route.part ? { part: route.part } : {}} />}
        {route.page === 'recipes' && <Recipes />}
        {route.page === 'insights' && <Insights />}
        {route.page === 'sources' && <Sources />}
        {route.page === 'execution' && <Execution />}
        {route.page === 'directories' && <Directories {...route.key ? { directory: route.key } : {}} {...route.path ? { path: route.path } : {}} />}
      </main>
    </div>
    {palette && <Palette {...home.data ? { status: home.data.status } : {}} onClose={() => setPalette(false)} />}
  </>
}

function Badge({ page, home }: { page: string; home?: HomeView }) {
  if (page === 'calibration' && home?.next?.kind === 'calibrate') return <span className="badge accent">{home.next.pending}</span>
  if (!home || (page !== 'home' && page !== 'health')) return null
  // Each badge counts the list it links to: Tickets on home; on health, every problem, including the next step's.
  const count = page === 'home' ? home.person.length : home.problems.length + (home.next && home.next.kind !== 'first-request' && home.next.kind !== 'calibrate' ? 1 : 0)
  return count ? <span className={`badge ${page === 'home' ? 'warn' : 'danger'}`}>{count}</span> : null
}

function TopBar({ home, meta, onSearch }: { home?: HomeView; meta: Meta; onSearch: () => void }) {
  const { streaming } = useLive()
  const status = home?.status
  return <header className="top"><div className="top-in">
    <a className="brand" href={href.home()}><div className="mark" aria-hidden="true">sa</div><div><b>Superagent 控制台</b>{status?.repository && <span className="mono muted"> {status.repository}</span>}</div></a>
    <button className="searchbtn" onClick={onSearch}><span>跳转、找 Ticket，或粘贴链接查消息去向</span><span className="kbd">⌘K</span></button>
    {status && <div className="chips">
      <Pill tone={status.paused ? 'warn' : 'ok'}>{status.paused ? '已暂停处理' : '运行中'}</Pill>
      <Pill dot={false}><span className="mono">worker {status.running}/{status.maxWorkers}{status.queued ? ` · ${status.queued} 排队` : ''}</span></Pill>
      <Pill dot={false}><span className="mono">策略 {status.policyVersion}</span></Pill>
    </div>}
    <div className="tools">
      {meta.mock && <span className="tag">示例数据 · mock</span>}
      <span className={`live${streaming ? ' on' : ''}`}>{streaming ? '实时' : '重连中'}</span>
    </div>
  </div></header>
}
