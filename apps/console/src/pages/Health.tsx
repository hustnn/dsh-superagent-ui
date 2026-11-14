/** Health: is it running, are the Sources well, what needs fixing, and what the console itself did. */
import type { HealthView } from '@dsh-superagent-ui/contract'
import { call } from '../api'
import { ConnectionBanner, Pill, useAction, useUi } from '../components/ui'
import { companionLabel } from '../components/worker'
import { useLive, useView } from '../live'
import { t } from '../i18n'
import { RESUME_BODY } from '../components/palette'
import { AUDIT_ACTION, clock, DROP_REASON, PAGE, SOURCE_STATE } from '../text'
import { Problems } from './Home'

export function Health() {
  const { data, error, reload } = useView('health')
  const { connection } = useLive()
  return <>
    <div className="head"><div><h1>{PAGE.health}</h1><p>{t('Only problems you can act on. One-off network errors don\'t count; something shows up here after failing three times in a row.', '只列能动手处理的问题。偶发的网络错误不算，同一项连续失败三次才会出现在这里。')}</p></div></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data ? <HealthBody health={data} reload={reload} /> : !error && <div className="card empty">{t('Loading…', '正在读取…')}</div>}
  </>
}

function HealthBody({ health, reload }: { health: HealthView; reload: () => Promise<void> }) {
  const { confirm } = useUi()
  const { busy, run } = useAction(reload)
  const { status, flow } = health
  const togglePause = async () => {
    const pausing = !status.paused
    const ok = await confirm(pausing
      ? { title: t('Pause processing?', '暂停处理？'), action: t('Pause', '暂停'), body: t('Sources keep recording messages, but nothing is evaluated, no new work is dispatched and no messages are sent. Running workers are not interrupted. Messages from the pause are caught up after resuming.', '来源会继续记录消息，但不评估、不派新活、不发任何消息。正在运行的 worker 不会被打断。恢复后这期间的消息会自动补上。') }
      : { title: t('Resume processing?', '恢复处理？'), action: t('Resume', '恢复'), body: RESUME_BODY() })
    if (ok) await run('pause', () => call('POST /api/executor/pause', { body: { paused: pausing } }), pausing ? t('Processing paused', '已暂停处理') : t('Processing resumed', '已恢复处理'))
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
          {source.parts.filter(part => part.state !== 'ready').map(part => <div key={part.name} className="l">{part.name}{t(': ', '：')}{part.detail}</div>)}
          <div className="l">{t(`24 h: ${source.received} received, ${source.filtered} filtered`, `24 小时收到 ${source.received} 条，过滤 ${source.filtered} 条`)}</div>
        </div>
      })}
      <div className="stat">
        <div className="l">{t('Executor', '执行器')}</div>
        <div className="n mono">{status.running}/{status.maxWorkers}</div>
        <div className="l">{t(`${status.queued} queued · ${status.idle} waiting for new messages`, `${status.queued} 个排队 · ${status.idle} 个在等新消息`)}</div>
      </div>
    </div>

    {health.problems.length > 0 ? <Problems problems={health.problems} reload={reload} />
      : <div className="card empty"><h2>{t('No problems to handle', '没有需要处理的问题')}</h2></div>}

    <div className="grid2">
      <div className="card pad">
        <div className="sec-t"><h2>{t('Pause processing', '暂停处理')}</h2>
          <button className={`switch${status.paused ? ' on' : ''}`} role="switch" aria-checked={status.paused} aria-label={t('Pause processing', '暂停处理')} disabled={busy === 'pause'} onClick={() => void togglePause()} /></div>
        <p className="sub">{t('For maintenance. Sources keep recording messages; nothing is evaluated, dispatched or sent; running workers are not interrupted.', '维护时用。来源继续记录消息；不评估、不派新活、不发消息；正在运行的 worker 不会被打断。')}</p>
      </div>
      <div className="card pad">
        <div className="sec-t"><h2>{t('Last 24 hours', '过去 24 小时')}</h2></div>
        <p className="sub">{t(`${flow.received} received, ${flow.filtered} filtered by sources, ${flow.judged} evaluations, ${flow.accepted} accepted${flow.evaluating ? `, ${flow.evaluating} being evaluated` : ''}, ${flow.dropped} replies dropped.`,
          `收到 ${flow.received} 条，来源过滤 ${flow.filtered} 条，评估 ${flow.judged} 次，接单 ${flow.accepted} 个${flow.evaluating ? `，${flow.evaluating} 个在评估` : ''}，丢弃回复 ${flow.dropped} 条。`)}</p>
      </div>
    </div>

    {dropped.length > 0 && <section>
      <div className="sec-t"><h2>{t('Replies dropped in 24 hours', '24 小时内丢弃的回复')} <span className="muted mono">{dropped.length}</span></h2></div>
      <div className="card rows">{dropped.map(item => <div key={item.id} className="row static">
        <div><span className="chip">{item.source}</span></div>
        <div className="body"><div className="ttl">{t(`"${item.preview}"`, `「${item.preview}」`)}</div><div className="ask">{DROP_REASON[item.reason] ?? item.reason}{item.ticket ? t(` · from "${item.ticket}"`, ` · 属于「${item.ticket}」`) : ''}</div></div>
        <div className="muted mono">{clock(item.at)}</div>
      </div>)}</div>
    </section>}

    <div className="grid2">
      <div className="card pad">
        <div className="sec-t"><h2>{t('Accounts', '账号')}</h2></div>
        <dl className="kv">
          <dt>{t('Repository', '仓库')}</dt><dd className="mono">{health.accounts?.repository ?? '—'}</dd>
          <dt>{t('Agent account', 'agent 账号')}</dt><dd className="mono">{health.accounts?.agent ?? '—'}</dd>
          <dt>{t('Feishu bot', '飞书机器人')}</dt><dd>{health.accounts?.feishu ?? t('Not set up', '未配置')}</dd>
          <dt>{t('Policy version', '策略版本')}</dt><dd className="mono">{status.policyVersion}</dd>
          <dt>dsh-superagent</dt><dd className="mono">{health.connection.url}</dd>
          <dt>{t('Companion plugin', 'companion 插件')}</dt><dd>{companionLabel(health.companion)}{!health.companion.installed && <span className="muted small">{t(": Tickets can't show the worker's steps or what it said", '：Ticket 里看不到 worker 的步骤和它说过的话')}</span>}</dd>
        </dl>
      </div>
      <div className="card pad">
        <div className="sec-t"><h2>{t('Recent console actions', '控制台最近的操作')}</h2></div>
        {health.audit.length ? <table className="tbl"><tbody>{health.audit.slice(0, 8).map(entry => <tr key={entry.id}>
          <td className="mono muted">{clock(entry.at)}</td>
          <td>{AUDIT_ACTION[entry.action] ?? entry.action}{entry.target && entry.target !== 'executor' ? <span className="muted mono"> {entry.target}</span> : ''}</td>
          <td><Pill tone={entry.outcome === 'ok' ? 'ok' : entry.outcome === 'denied' ? 'warn' : 'danger'} dot={false}>{entry.outcome === 'ok' ? t('OK', '成功') : entry.outcome === 'denied' ? t('Denied', '被拒') : t('Failed', '失败')}</Pill></td>
        </tr>)}</tbody></table> : <p className="sub">{t('No actions yet. Retrying, stopping, pausing and the like are all recorded here.', '还没有操作。重试、停止、暂停这类操作都会记在这里。')}</p>}
      </div>
    </div>
  </>
}
