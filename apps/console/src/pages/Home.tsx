/**
 * Home: only what needs the operator. The next step when there is one, then Tickets that wait for a person (longest wait
 * first, one primary action each), then problems. When nothing needs them, the page says so and stays nearly empty.
 */
import { useEffect, useRef, useState } from 'react'
import type { HomeView, NextStep, PersonItem, ProblemAction, ProblemItem } from '@dsh-superagent-ui/contract'
import { call } from '../api'
import { ConnectionBanner, Pill, SourceChip, useAction, useNow, useUi } from '../components/ui'
import { useLive, useView } from '../live'
import { duration, PERSON } from '../text'
import { href } from '../route'
import { RecheckSetup } from './Settings'

/** The shell owns the home view, since the top bar and the badges read it too. */
export function Home({ view }: { view: ReturnType<typeof useView<'home'>> }) {
  const { data, error, reload } = view
  const { connection } = useLive()
  return <>
    <div className="head"><div><h1>首页</h1><p>只放需要你的事，等得最久的排最前。键盘 <span className="kbd">j</span> <span className="kbd">k</span> 移动，<span className="kbd">Enter</span> 执行这一行的主操作。</p></div></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data ? <HomeBody home={data} reload={reload} /> : !error && <div className="card empty">正在读取…</div>}
  </>
}

function HomeBody({ home, reload }: { home: HomeView; reload: () => Promise<void> }) {
  const others = home.status.running + home.status.queued + home.status.idle
  const nothing = !home.person.length && !home.problems.length
  return <>
    {home.next && <Next step={home.next} />}
    {nothing ? <div className="card empty"><h2>没有需要你处理的事</h2>
      <p>{others ? `${others} 个 Ticket 在正常推进。` : ''}有事需要你时，它会出现在这里，也会在原来的 GitHub 或飞书对话里找你。</p></div>
      : <>
        {home.person.length > 0 && <PersonList items={home.person} reload={reload} />}
        {home.problems.length > 0 && <Problems problems={home.problems} reload={reload} more />}
      </>}
    {!nothing && others > 0 && <div className="quiet card">其余 {others} 个 Ticket 在正常推进：{home.status.running} 个执行中，{home.status.queued} 个排队，{home.status.idle} 个在等新消息。<a href={href.board()}>看板</a></div>}
  </>
}

function Next({ step }: { step: NextStep }) {
  const { toast } = useUi()
  const content = (() => {
    switch (step.kind) {
      case 'setup': return { label: '配置没完成', text: `${step.detail} 修好后点“重新检查”；在来源页能改仓库和 CLI。`, recheck: true }
      case 'no-source': return { label: '还收不到消息', text: 'GitHub 和飞书来源都没在运行。到来源里至少启用一个。', link: href.sources(), go: '去来源' }
      case 'no-allowed': return { label: '还没人能让它干活', text: '名单是空的。把你自己的 GitHub 账号或飞书账号加进名单，它才会接你的请求。', link: href.policy(), go: '去策略' }
      case 'calibrate': return { label: '观察期', text: `有 ${step.pending} 条“本会接单”的判断等你复核。${step.ready.length ? `规则${step.ready.map(name => `「${name}」`).join('')}的判断已经和你足够一致，可以考虑放手。` : '复核得越多，越清楚哪些规则可以放手。'}`, link: href.calibration(), go: '去校准' }
      case 'first-request': {
        const comment = `@${step.agent ?? 'agent'} 帮我看看这个问题`
        const feishu = step.bot ? `，或在机器人所在的飞书群里 @${step.bot} 说出你的请求` : ''
        return { label: '试一次', text: `在 ${step.repository ?? '仓库'} 的任意 issue 下评论“${comment}”${feishu}。一分钟内这里会出现第一个 Ticket。`, copy: comment }
      }
    }
  })()
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('已复制') } catch { toast(`复制这句：${text}`) }
  }
  return <div className="next">
    <div className="txt"><div className="lbl">下一步 · {content.label}</div><div>{content.text}</div></div>
    {'copy' in content && content.copy && <button className="btn primary" onClick={() => void copy(content.copy!)}>复制这句评论</button>}
    {'link' in content && content.link && <a className="btn primary" href={content.link}>{content.go}</a>}
    {'recheck' in content && <><a className="btn" href={href.sources()}>去来源</a><RecheckSetup /></>}
  </div>
}

function PersonList({ items, reload }: { items: PersonItem[]; reload: () => Promise<void> }) {
  const now = useNow()
  const { confirm } = useUi()
  const { busy, run } = useAction(reload)
  const [selected, setSelected] = useState(0)
  const rows = useRef<(HTMLDivElement | null)[]>([])
  const index = Math.min(selected, items.length - 1)

  const stop = async (item: PersonItem) => {
    const ok = await confirm({ title: '停止这个 Ticket？', action: '停止',
      body: `「${item.title}」停止后会撤回它的授权：这个线程上的消息不再交给它，要继续做需要重新接单。正在运行的 worker 会被取消。` })
    if (ok) await run(item.id, () => call('POST /api/tickets/:id/stop', { params: { id: item.id } }), '已停止，记为“被人停止”')
  }
  const retry = (item: PersonItem) => run(item.id, () => call('POST /api/tickets/:id/retry', { params: { id: item.id } }), '已重新派工：沿用同一个 Session、目录和分支')
  const primary = (item: PersonItem) => {
    if (item.actions.retry) return void retry(item)
    if (item.reply) window.open(item.reply.url, '_blank', 'noopener')
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test((event.target as HTMLElement).tagName)) return
      if (document.querySelector('.layer')) return
      if (event.key === 'j' || event.key === 'k') {
        const next = Math.max(0, Math.min(items.length - 1, index + (event.key === 'j' ? 1 : -1)))
        setSelected(next)
        rows.current[next]?.scrollIntoView({ block: 'nearest' })
      } else if (event.key === 'Enter' && items[index]) {
        primary(items[index])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return <section>
    <div className="sec-t"><h2>需要你 <span className="muted mono">{items.length}</span></h2></div>
    <div className="card rows">
      {items.map((item, i) => {
        const meta = PERSON[item.action]
        const thread = item.threads[0]
        return <div key={item.id} ref={el => { rows.current[i] = el }} className={`row${i === index ? ' sel' : ''}`} onClick={() => setSelected(i)}>
          <div><Pill tone={meta.tone}>{meta.label}</Pill></div>
          <div className="body">
            <div className="ttl"><a href={href.ticket(item.id)}>{item.title}</a></div>
            <div className="meta">{thread && <SourceChip thread={thread} />}{item.strength === 'inferred' && <Pill tone="infer" dot={false}>主动接单</Pill>}</div>
            {item.question ? <div className="ask">它在问：{item.question}</div>
              : item.note ? <div className={`ask${item.note.error ? ' err' : ''}`}>{item.note.text}</div>
              : item.summary && <div className="ask clamp">{item.summary}</div>}
          </div>
          <div className="side-col">
            <span className="wait">已等 {duration(now - Date.parse(item.waitingSince))}</span>
            <div className="acts">
              {item.actions.retry && <button className="btn sm primary" disabled={busy === item.id} onClick={() => void retry(item)}>重试</button>}
              {!item.actions.retry && item.reply && <a className="btn sm primary" href={item.reply.url} target="_blank" rel="noopener noreferrer">
                {item.action === 'review' ? '去评审' : item.action === 'answer' ? '去回答' : '打开'} ↗</a>}
              {(item.action === 'failed' || item.action === 'blocked') && item.actions.stop &&
                <button className="btn sm ghost" disabled={busy === item.id} onClick={() => void stop(item)}>停止</button>}
            </div>
          </div>
        </div>
      })}
    </div>
  </section>
}

export function Problems({ problems, reload, more }: { problems: ProblemItem[]; reload: () => Promise<void>; more?: boolean }) {
  const { confirm } = useUi()
  const { busy, run } = useAction(reload)
  const act = async (problem: ProblemItem, action: ProblemAction) => {
    switch (action.kind) {
      case 'requeue': return run(problem.id, () => call('POST /api/triggers/:id/requeue', { params: { id: action.triggerId } }), '已放回评估队列')
      case 'dismiss': return run(problem.id, () => call('POST /api/decisions/:id/dismiss', { params: { id: action.decisionId } }), '已忽略这个问题')
      case 'resume': {
        const ok = await confirm({ title: '恢复处理？', action: '恢复', body: '恢复后会评估暂停期间记录的消息，派出等待的活，发出排队的回复。' })
        if (ok) await run(problem.id, () => call('POST /api/executor/pause', { body: { paused: false } }), '已恢复处理')
        return
      }
      case 'link': window.open(action.href, '_blank', 'noopener')
    }
  }
  const label = (action: ProblemAction) => ({ requeue: '重新评估', dismiss: '忽略', resume: '恢复处理', link: action.kind === 'link' ? `${action.label} ↗` : '' })[action.kind]
  return <section>
    <div className="sec-t"><h2>系统问题 <span className="muted mono">{problems.length}</span></h2>{more && <a className="link" href={href.health()}>去健康页</a>}</div>
    <div className="card rows">
      {problems.map(problem => <div key={problem.id} className="row static">
        <div><Pill tone={problem.tone}>{problem.tone === 'danger' ? '要处理' : '留意'}</Pill></div>
        <div className="body"><div className="ttl">{problem.title}</div><div className="ask">{problem.detail}</div></div>
        <div className="acts">{problem.actions.map((action, i) =>
          <button key={action.kind} className={`btn sm${i ? ' ghost' : ''}`} disabled={busy === problem.id} onClick={() => void act(problem, action)}>{label(action)}</button>)}</div>
      </div>)}
    </div>
  </section>
}
