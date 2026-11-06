/** Health: is it running, are the Sources well, what needs fixing, and what the console itself did. */
import type { HealthView } from '@dsh-superagent-ui/contract'
import { call } from '../api'
import { ConnectionBanner, Pill, useAction, useUi } from '../components/ui'
import { companionLabel } from '../components/worker'
import { useLive, useView } from '../live'
import { AUDIT_ACTION, clock, DROP_REASON, SOURCE_STATE } from '../text'
import { Problems } from './Home'

export function Health() {
  const { data, error, reload } = useView('health')
  const { connection } = useLive()
  return <>
    <div className="head"><div><h1>健康</h1><p>只列能动手处理的问题。偶发的网络错误不算，同一项连续失败三次才会出现在这里。</p></div></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data ? <HealthBody health={data} reload={reload} /> : !error && <div className="card empty">正在读取…</div>}
  </>
}

function HealthBody({ health, reload }: { health: HealthView; reload: () => Promise<void> }) {
  const { confirm } = useUi()
  const { busy, run } = useAction(reload)
  const { status, flow } = health
  const togglePause = async () => {
    const pausing = !status.paused
    const ok = await confirm(pausing
      ? { title: '暂停处理？', action: '暂停', body: '来源会继续记录消息，但不评估、不派新活、不发任何消息。正在运行的 worker 不会被打断。恢复后这期间的消息会自动补上。' }
      : { title: '恢复处理？', action: '恢复', body: '恢复后会评估暂停期间记录的消息，派出等待的活，发出排队的回复。' })
    if (ok) await run('pause', () => call('POST /api/executor/pause', { body: { paused: pausing } }), pausing ? '已暂停处理' : '已恢复处理')
  }
  const dropped = health.sources.flatMap(source => source.dropped.map(item => ({ ...item, source: source.title })))

  return <>
    <div className="grid3">
      {health.sources.map(source => {
        const state = SOURCE_STATE[source.state]
        return <div key={source.id} className="stat">
          <div className="l">{source.title}</div>
          <div><Pill tone={state.tone}>{state.label}</Pill></div>
          {source.problem && <div className="l err">{source.problem}</div>}
          {source.parts.filter(part => part.state !== 'ready').map(part => <div key={part.name} className="l">{part.name}：{part.detail}</div>)}
          <div className="l">24 小时收到 {source.received} 条，过滤 {source.filtered} 条</div>
        </div>
      })}
      <div className="stat">
        <div className="l">执行器</div>
        <div className="n mono">{status.running}/{status.maxWorkers}</div>
        <div className="l">{status.queued} 个排队 · {status.idle} 个在等新消息</div>
      </div>
    </div>

    {health.problems.length > 0 ? <Problems problems={health.problems} reload={reload} />
      : <div className="card empty"><h2>没有需要处理的问题</h2></div>}

    <div className="grid2">
      <div className="card pad">
        <div className="sec-t"><h2>暂停处理</h2>
          <button className={`switch${status.paused ? ' on' : ''}`} role="switch" aria-checked={status.paused} aria-label="暂停处理" disabled={busy === 'pause'} onClick={() => void togglePause()} /></div>
        <p className="sub">维护时用。来源继续记录消息；不评估、不派新活、不发消息；正在运行的 worker 不会被打断。</p>
      </div>
      <div className="card pad">
        <div className="sec-t"><h2>过去 24 小时</h2></div>
        <p className="sub">收到 {flow.received} 条，来源过滤 {flow.filtered} 条，评估 {flow.judged} 次，接单 {flow.accepted} 个{flow.evaluating ? `，${flow.evaluating} 个在评估` : ''}，丢弃回复 {flow.dropped} 条。</p>
      </div>
    </div>

    {dropped.length > 0 && <section>
      <div className="sec-t"><h2>24 小时内丢弃的回复 <span className="muted mono">{dropped.length}</span></h2></div>
      <div className="card rows">{dropped.map(item => <div key={item.id} className="row static">
        <div><span className="chip">{item.source}</span></div>
        <div className="body"><div className="ttl">「{item.preview}」</div><div className="ask">{DROP_REASON[item.reason] ?? item.reason}{item.ticket ? ` · 属于「${item.ticket}」` : ''}</div></div>
        <div className="muted mono">{clock(item.at)}</div>
      </div>)}</div>
    </section>}

    <div className="grid2">
      <div className="card pad">
        <div className="sec-t"><h2>账号</h2></div>
        <dl className="kv">
          <dt>仓库</dt><dd className="mono">{health.accounts?.repository ?? '—'}</dd>
          <dt>agent 账号</dt><dd className="mono">{health.accounts?.agent ?? '—'}</dd>
          <dt>飞书机器人</dt><dd>{health.accounts?.feishu ?? '未配置'}</dd>
          <dt>策略版本</dt><dd className="mono">{status.policyVersion}</dd>
          <dt>dsh-superagent</dt><dd className="mono">{health.connection.url}</dd>
          <dt>companion 插件</dt><dd>{companionLabel(health.companion)}{!health.companion.installed && <span className="muted small">：Ticket 里看不到 worker 的步骤和它说过的话</span>}</dd>
        </dl>
      </div>
      <div className="card pad">
        <div className="sec-t"><h2>控制台最近的操作</h2></div>
        {health.audit.length ? <table className="tbl"><tbody>{health.audit.slice(0, 8).map(entry => <tr key={entry.id}>
          <td className="mono muted">{clock(entry.at)}</td>
          <td>{AUDIT_ACTION[entry.action] ?? entry.action}{entry.target && entry.target !== 'executor' ? <span className="muted mono"> {entry.target}</span> : ''}</td>
          <td><Pill tone={entry.outcome === 'ok' ? 'ok' : entry.outcome === 'denied' ? 'warn' : 'danger'} dot={false}>{entry.outcome === 'ok' ? '成功' : entry.outcome === 'denied' ? '被拒' : '失败'}</Pill></td>
        </tr>)}</tbody></table> : <p className="sub">还没有操作。重试、停止、暂停这类操作都会记在这里。</p>}
      </div>
    </div>
  </>
}
