/**
 * Sources and execution: where the agent listens, and how it works on this machine. Receiving switches, chats, capacity,
 * models and the prepare command save at once; an account change goes through setup's check and restarts dsh-superagent,
 * so it saves on its own, local only.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { ExecutionView, ExecutorSettings, FeishuSettings, GithubSettings, MainModelSwitch, ModelChoice, SourceSettings } from '@dsh-superagent-ui/contract'
import { ApiError, call } from '../api'
import { ConnectionBanner, Pill, useUi } from '../components/ui'
import { useLive, useLiveData } from '../live'
import { href } from '../route'
import { SOURCE_STATE } from '../text'

/** A card that edits a copy of `value` and saves it with one confirmed call. */
function useDraft<T>(value: T) {
  const [draft, setDraft] = useState(value)
  const [base, setBase] = useState(value)
  const dirty = JSON.stringify(draft) !== JSON.stringify(base)
  useEffect(() => { if (!dirty) { setDraft(value); setBase(value) } }, [JSON.stringify(value)]) // eslint-disable-line react-hooks/exhaustive-deps
  return { draft, setDraft, dirty, reset: () => { setDraft(value); setBase(value) } }
}

function SaveRow({ dirty, saving, onSave, onReset, note }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void; note?: ReactNode }) {
  if (!dirty) return null
  return <div className="row-actions card-save"><span className="muted small grow">{note ?? '有未保存的修改'}</span>
    <button className="btn sm ghost" onClick={onReset}>放弃</button><button className="btn sm primary" disabled={saving} onClick={onSave}>保存</button></div>
}

function useSave(reload: () => Promise<void>) {
  const { confirm, toast } = useUi()
  const [saving, setSaving] = useState(false)
  return { saving, save: async (title: string, body: ReactNode, run: () => Promise<{ restarting?: boolean; message?: string } | unknown>, done: () => void, action = '保存') => {
    if (!await confirm({ title, action, body })) return
    setSaving(true)
    try {
      const result = await run() as { restarting?: boolean; message?: string }
      toast(result?.message ?? (result?.restarting ? '已保存，dsh-superagent 正在重启' : '已保存'))
      done()
      await reload()
    } catch (error) { toast(error instanceof ApiError ? error.message : String(error)) } finally { setSaving(false) }
  } }
}

function Switch({ on, label, hint, onChange }: { on: boolean; label: string; hint: string; onChange: (on: boolean) => void }) {
  return <div className="swrow"><div className="grow"><div>{label}</div><div className="muted small">{hint}</div></div>
    <button className={`switch${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} /></div>
}

export function Sources() {
  const { data, error, reload } = useLiveData(['settings'], 'sources', () => call('GET /api/sources'))
  const { connection } = useLive()
  return <>
    <div className="head"><div><h1>来源</h1><p>它在听哪些地方。接收得越多，主动能力越强，也越需要严格的规则；收进来的消息怎么处理，在<a href={href.policy()}>策略</a>的准入表里定。</p></div></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data && <div className="grid2 top">{data.sources.map(source => <SourceCard key={source.id} source={source} setupPending={data.setupPending} reload={reload} />)}</div>}
  </>
}

function SourceCard({ source, setupPending, reload }: { source: SourceSettings; setupPending: boolean; reload: () => Promise<void> }) {
  const { draft, setDraft, dirty, reset } = useDraft({ enabled: source.enabled, github: source.github, feishu: source.feishu })
  const { saving, save } = useSave(reload)
  const state = source.state ? SOURCE_STATE[source.state] : undefined
  return <section className="card pad">
    <div className="sec-t"><h2>{source.title}</h2>{state && <Pill tone={state.tone}>{state.label}</Pill>}</div>
    {source.problem && <p className="err small pre">{source.problem}</p>}
    {source.problem && setupPending && <RecheckSetup />}
    <dl className="kv">{source.facts.map(fact => <div key={fact.label} className="kv-row"><dt>{fact.label}</dt><dd className="mono">{fact.value}</dd></div>)}</dl>
    <div className="gap-top">
      <Switch on={draft.enabled} label="启用这个来源" hint="停用后不再接收这里的消息；排队的回复会等它重新启用。" onChange={enabled => setDraft({ ...draft, enabled })} />
      {draft.github && <GithubFields value={draft.github} onChange={github => setDraft({ ...draft, github })} />}
      {draft.feishu && <FeishuFields value={draft.feishu} joined={source.joined ?? []} sourceId={source.id} reload={reload} onChange={feishu => setDraft({ ...draft, feishu })} />}
    </div>
    <SaveRow dirty={dirty} saving={saving} onReset={reset} onSave={() => void save(`保存${source.title}的设置？`,
      '保存后它马上按新设置接收消息。打开“接收全部”后，再到策略页的准入表决定这些消息怎么处理。', () => call('PUT /api/sources/:id', { params: { id: source.id },
        body: { enabled: draft.enabled, revision: source.revision, ...draft.github ? { github: { observeIssues: draft.github.observeIssues, observePulls: draft.github.observePulls,
          observeComments: draft.github.observeComments, observeCi: draft.github.observeCi, pollSeconds: draft.github.pollSeconds } } : {}, ...draft.feishu ? { feishu: draft.feishu } : {} } }), reset)} />
    <Account source={source} reload={reload} />
  </section>
}

/**
 * The account fields: which repository, and which CLI acts as the agent or the bot. Upstream checks them before saving (a
 * failed check saves nothing) and restarts dsh-superagent after, which interrupts running workers.
 */
function Account({ source, reload }: { source: SourceSettings; reload: () => Promise<void> }) {
  const { draft, setDraft, dirty, reset } = useDraft(source.account)
  const { saving, save } = useSave(reload)
  const github = source.id === 'github'
  return <div className="account gap-top">
    <h3 className="small-h">账号</h3>
    {github && <label className="field">仓库<input className="mono" value={draft.repository ?? ''} placeholder="owner/name" onChange={event => setDraft({ ...draft, repository: event.target.value })} /></label>}
    <label className="field">{github ? 'agent 的 GitHub CLI' : '机器人的 lark-cli'}
      <input className="mono" value={draft.cli} placeholder={github ? '/Users/me/.local/bin/gh-agent' : '/Users/me/.local/bin/lark-bot'} onChange={event => setDraft({ ...draft, cli: event.target.value })} />
      <span className="muted small">{github ? '只登录了 agent 账号的 gh，写命令名或绝对路径。' : '只允许机器人身份（strict mode bot）的 lark-cli，写命令名或绝对路径。'}</span></label>
    <SaveRow dirty={dirty} saving={saving} onReset={reset} note="账号改了，保存时会先检查" onSave={() => void save(`保存${source.title}的账号？`,
      <>dsh-superagent 会先检查{github ? ' CLI 能否读到账号、能否推送到这个仓库' : '这个 CLI 是否只能以机器人身份操作'}；没通过就什么都不保存，并告诉你原因。通过后它会重启：正在运行的 worker 会被打断，重启后带着恢复说明接着做。</>,
      () => call('PUT /api/sources/:id/account', { params: { id: source.id }, body: { ...github ? { repository: draft.repository ?? '' } : {}, cli: draft.cli, revision: source.revision } }), reset)} />
  </div>
}

/** Runs setup's check again: for a problem fixed outside the console, such as a CLI signed in again. It restarts dsh-superagent. */
export function RecheckSetup() {
  const { confirm, toast } = useUi()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!await confirm({ title: '重新检查配置？', action: '重新检查', body: '在控制台外面修好问题后（比如重新登录了 CLI）用这个。检查会重启 dsh-superagent，正在运行的 worker 会被打断，重启后接着做。' })) return
    setBusy(true)
    try { await call('POST /api/setup/check'); toast('dsh-superagent 正在重启并重新检查，稍后这里会更新') }
    catch (error) { toast(error instanceof ApiError ? error.message : String(error)) } finally { setBusy(false) }
  }
  return <button className="btn sm" disabled={busy} onClick={() => void run()}>重新检查</button>
}

function GithubFields({ value, onChange }: { value: GithubSettings; onChange: (value: GithubSettings) => void }) {
  const set = (patch: Partial<GithubSettings>) => onChange({ ...value, ...patch })
  return <>
    <Switch on={value.observeIssues} label="接收所有新 Issue" hint="没人 @ 它也能看到新 Issue，配合“新 issue 分诊”这类规则。" onChange={observeIssues => set({ observeIssues })} />
    <Switch on={value.observePulls} label="接收所有新 PR" hint="配合“依赖升级跟进”：依赖机器人的 PR 出问题时它去修。" onChange={observePulls => set({ observePulls })} />
    <Switch on={value.observeComments} label="接收所有评论" hint="没人 @ 它时也能看到讨论。打开后噪音会明显变多。" onChange={observeComments => set({ observeComments })} />
    <Switch on={value.observeCi} label="接收默认分支的 CI" hint="主干变红时可以主动排查。" onChange={observeCi => set({ observeCi })} />
    <div className="swrow"><div className="grow"><div>轮询间隔</div><div className="muted small">多久问一次 GitHub，60 到 3600 秒。</div></div>
      <input className="num" type="number" min={60} max={3600} step={30} value={value.pollSeconds} onChange={event => set({ pollSeconds: Number(event.target.value) })} aria-label="轮询间隔（秒）" /></div>
  </>
}

function FeishuFields({ value, joined, sourceId, reload, onChange }: { value: FeishuSettings; joined: { chatId: string; name: string }[]; sourceId: string
  reload: () => Promise<void>; onChange: (value: FeishuSettings) => void }) {
  const { toast } = useUi()
  const [chatId, setChatId] = useState(''), [name, setName] = useState('')
  const set = (patch: Partial<FeishuSettings>) => onChange({ ...value, ...patch })
  const add = (id: string, label: string) => {
    if (!/^oc_[a-zA-Z0-9]+$/.test(id) || value.chats.some(chat => chat.chatId === id)) return
    set({ chats: [...value.chats, { chatId: id, ...label.trim() ? { name: label.trim() } : {}, listen: 'mentions' }] })
    setChatId(''); setName('')
  }
  // Chats the bot has joined but this Source does not list yet; upstream rereads them every minute, or now on request.
  const choices = joined.filter(chat => !value.chats.some(item => item.chatId === chat.chatId))
  const refresh = async () => {
    try {
      const { added } = await call('POST /api/sources/:id/labels', { params: { id: sourceId } })
      toast(added.length ? `找到新加入的群：${added.join('、')}` : '群列表已是最新')
      await reload()
    } catch (error) { toast(error instanceof ApiError ? error.message : String(error)) }
  }
  return <>
    <h3 className="small-h gap-top">监听的群</h3>
    <div className="rows-plain">{value.chats.map(chat => <div key={chat.chatId} className="chat-row">
      <div className="grow"><div>{chat.name || chat.chatId}</div><div className="muted small mono">{chat.chatId}</div></div>
      <div className="seg sm">{(['mentions', 'all'] as const).map(listen => <button key={listen} className={chat.listen === listen ? 'on' : ''}
        onClick={() => set({ chats: value.chats.map(item => item.chatId === chat.chatId ? { ...item, listen } : item) })}>{listen === 'all' ? '全部消息' : '仅 @'}</button>)}</div>
      <button className="link danger" onClick={() => set({ chats: value.chats.filter(item => item.chatId !== chat.chatId) })}>移除</button>
    </div>)}</div>
    <div className="add-row">
      <select value="" onChange={event => { const chat = choices.find(item => item.chatId === event.target.value); if (chat) add(chat.chatId, chat.name) }} aria-label="选择机器人所在的群"
        disabled={!choices.length}><option value="">{choices.length ? `加入机器人所在的群（${choices.length}）` : '机器人所在的群都已在列表里'}</option>
        {choices.map(chat => <option key={chat.chatId} value={chat.chatId}>{chat.name}</option>)}</select>
      <button className="btn sm ghost" type="button" onClick={() => void refresh()}>刷新群列表</button>
    </div>
    <details className="small"><summary>按群 id 加入</summary>
      <form className="add-row" onSubmit={event => { event.preventDefault(); add(chatId, name) }}>
        <input value={chatId} onChange={event => setChatId(event.target.value.trim())} placeholder="群 id，oc_ 开头" aria-label="群 id" />
        <input value={name} onChange={event => setName(event.target.value)} placeholder="群名（可选）" aria-label="群名" />
        <button className="btn sm" type="submit" disabled={!/^oc_[a-zA-Z0-9]+$/.test(chatId)}>加入</button>
      </form>
    </details>
    <div className="swrow"><div className="grow"><div>其他群</div><div className="muted small">机器人在、但不在上面列表里的群。</div></div>
      <div className="seg sm">{(['none', 'mentions'] as const).map(other => <button key={other} className={value.otherChats === other ? 'on' : ''} onClick={() => set({ otherChats: other })}>
        {other === 'none' ? '不接收' : '仅 @'}</button>)}</div></div>
    <Switch on={value.directMessages} label="接收私聊" hint="名单里的人私聊机器人，就是明确请求。" onChange={directMessages => set({ directMessages })} />
  </>
}

export function Execution() {
  const { data, error, reload } = useLiveData(['settings'], 'execution', () => call('GET /api/execution'))
  const { connection } = useLive()
  return <>
    <div className="head"><div><h1>执行</h1><p>它在哪干活、同时干几件、用什么模型。</p></div></div>
    <div className="callout muted"><div className="lbl">只能在本机修改</div>prepare 命令会以你的系统用户身份执行，改这一页等于改这台机器上会运行的命令。以后开放远程访问时，这一页只读。</div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data && <>
      <ExecutorCard view={data} reload={reload} />
      <EvalCard view={data} reload={reload} />
      {data.machine && <MachineCard machine={data.machine} />}
    </>}
  </>
}

/** The plugin's machine configuration. Read only: the limits change in DSH's plugin manager, `stateDir` only in the profile. */
function MachineCard({ machine }: { machine: NonNullable<ExecutionView['machine']> }) {
  return <section className="card pad">
    <div className="sec-t"><h2>部署限制</h2><span className="muted small">只读</span></div>
    <dl className="kv">
      <dt>状态目录</dt><dd className="mono">{machine.stateDir}</dd>
      {machine.promptMaxChars !== undefined && <><dt>提示词最长</dt><dd>{machine.promptMaxChars.toLocaleString()} 字符</dd></>}
      {machine.admissionContextMaxPages !== undefined && <><dt>评估时读线程</dt><dd>最多 {machine.admissionContextMaxPages} 页{machine.admissionContextTimeoutMs !== undefined ? `，${machine.admissionContextTimeoutMs / 1000} 秒内` : ''}</dd></>}
    </dl>
    <p className="muted small">这些是 dsh-superagent 插件自己的配置：限制在 DSH 的插件管理里改，立即生效；状态目录只能在 profile 的 cordis.patch.yml 里改。</p>
  </section>
}

function ModelSelect({ value, view, onChange, label }: { value: ModelChoice | null; view: ExecutionView; onChange: (value: ModelChoice | null) => void; label: string }) {
  const options = view.models?.groups.flatMap(group => group.models.map(model => ({ key: `${group.id}/${model.id}`, label: `${group.name} · ${model.name}`, value: { provider: group.id, model: model.id } }))) ?? []
  const current = value ? `${value.provider}/${value.model}` : ''
  return <select value={current} aria-label={label} onChange={event => onChange(options.find(option => option.key === event.target.value)?.value ?? null)}>
    <option value="">默认（{view.models ? `${view.models.default.provider} · ${view.models.default.model}` : 'profile 的默认模型'}）</option>
    {options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
    {value && !options.some(option => option.key === current) && <option value={current}>{current}</option>}
  </select>
}

function ExecutorCard({ view, reload }: { view: ExecutionView; reload: () => Promise<void> }) {
  const { revision, root, ...settings } = view.executor
  const { draft, setDraft, dirty, reset } = useDraft<ExecutorSettings>(settings)
  const { saving, save } = useSave(reload)
  const [command, setCommand] = useState('')
  const insert = (key: string) => setDraft({ ...draft, prepare: `${draft.prepare}${draft.prepare && !draft.prepare.endsWith('\n') && !draft.prepare.endsWith(' ') ? ' ' : ''}"$${key}"` })
  return <section className="card pad">
    <div className="sec-t"><h2>worker</h2></div>
    <div className="swrow"><div className="grow"><div>并发</div><div className="muted small">同时运行的 worker 数。人发来的消息总能多占一个，新活再多也不会挡住你推进已有的 Ticket。</div></div>
      <input className="num" type="number" min={1} step={1} value={draft.maxWorkers} onChange={event => setDraft({ ...draft, maxWorkers: Number(event.target.value) })} aria-label="并发" /></div>
    <div className="swrow"><div className="grow"><div>worker 模型</div><div className="muted small">所有 worker 共用。只对之后新开的 Ticket 生效，已有的 Ticket（包括重试）沿用原来的模型；每个 Ticket 实际用的模型，在它的“worker 在做什么”里。</div></div>
      <ModelSelect value={draft.model} view={view} label="worker 模型" onChange={model => setDraft({ ...draft, model })} /></div>
    <div className="swrow"><div className="grow"><div>Ticket 目录的位置</div><div className="muted small">留空用 <span className="mono">{root || '<状态目录>/work'}</span>。</div></div>
      <input className="path" value={draft.directory} placeholder={root} onChange={event => setDraft({ ...draft, directory: event.target.value })} aria-label="Ticket 目录" /></div>
    <h3 className="small-h gap-top">prepare 命令</h3>
    <p className="muted small">每个 Ticket 第一次派工前，在目录根里用 sh 执行一次，最长 10 分钟。通常用 git worktree 检出一个分支。</p>
    <textarea className="ed mono-ed" rows={4} value={draft.prepare} onChange={event => setDraft({ ...draft, prepare: event.target.value })} aria-label="prepare 命令" />
    <div className="chips gap-top"><span className="muted small">点击插入：</span>{view.variables.map(variable => <button key={variable.key} className="chip mono click" title={variable.description} onClick={() => insert(variable.key)}>${variable.key}</button>)}</div>
    <h3 className="small-h gap-top">禁用命令</h3>
    <div className="chips">{draft.blockedCommands.map(name => <span key={name} className="chip mono">{name}<button className="x" aria-label={`移除 ${name}`} onClick={() => setDraft({ ...draft, blockedCommands: draft.blockedCommands.filter(item => item !== name) })}>×</button></span>)}</div>
    <form className="add-row" onSubmit={event => { event.preventDefault(); const name = command.trim(); if (/^[A-Za-z0-9._-]+$/.test(name) && !draft.blockedCommands.includes(name)) setDraft({ ...draft, blockedCommands: [...draft.blockedCommands, name] }); setCommand('') }}>
      <input value={command} onChange={event => setCommand(event.target.value)} placeholder="命令名，例如 sudo" aria-label="要禁用的命令" /><button className="btn sm" type="submit">加入</button></form>
    <p className="muted small">按命令名拦截，是默认约束，不是安全边界：用绝对路径仍然能运行。</p>
    <SaveRow dirty={dirty} saving={saving} onReset={reset} onSave={() => void save('保存 worker 设置？', '新的 prepare 命令只对还没建目录的 Ticket 生效；并发立即生效。',
      () => call('PUT /api/execution', { body: { executor: draft, revision } }), reset)} />
  </section>
}

const MODEL_SWITCH_COST = '换模型后的第一次调用用不上之前对话的缓存，会慢一点、贵一点，只有这一次。'
function mainModelText(change: MainModelSwitch) {
  return change.result === 'switched' ? `主 Session 下一次调用模型时换成 ${change.model}`
    : change.result === 'unsupported' ? '正在运行的主 Session 没换：要 0.3.0 以上的 companion 插件' : `正在运行的主 Session 没换：${change.error}`
}

function EvalCard({ view, reload }: { view: ExecutionView; reload: () => Promise<void> }) {
  const { revision, ...settings } = view.eval
  const { draft, setDraft, dirty, reset } = useDraft(settings)
  const { saving, save } = useSave(reload)
  const configured = view.eval.model ?? view.models?.default
  const target = configured ? `${configured.provider} · ${configured.model}` : null
  const pending = view.mainModelNext !== view.mainModel ? view.mainModelNext : null
  // Only a saved setting can be applied, so the button waits for the draft to be saved or dropped.
  const canApply = view.canSwitchMainModel && !dirty && !!target && !!view.mainModel && (pending ?? view.mainModel) !== target
  return <section className="card pad">
    <div className="sec-t"><h2>主 Session</h2></div>
    <div className="swrow"><div className="grow"><div>评估时限</div><div className="muted small">候选送到主 Session 后多久没结论就重试；连续三次就记为“评估没完成”。</div></div>
      <input className="num" type="number" min={10} step={10} value={draft.timeoutSeconds} onChange={event => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })} aria-label="评估时限（秒）" /></div>
    <div className="swrow"><div className="grow"><div>模型</div><div className="muted small">主 Session 判断每条消息、接单、派工、评估主动候选都用它。{view.canSwitchMainModel
      ? '保存后，从它下一次调用模型开始换成新模型；worker 和 profile 的默认模型不变。'
      : '它只在主 Session 第一次调用模型前生效，之后改这里不会换掉它正在用的模型。装上 0.3.0 以上的 companion 插件后，保存时会直接切换。'}</div>
      <div className="small gap-top">{view.mainModel ? <>实际在用：<span className="mono">{view.mainModel}</span>{pending && <>，下一次调用换成 <span className="mono">{pending}</span></>}</> : <span className="muted">装上 0.2.0 以上的 companion 插件后，这里显示主 Session 实际在用的模型。</span>}</div>
      {canApply && <button className="btn sm gap-top" disabled={saving} onClick={() => void save(`让主 Session 换成 ${target}？`, `它现在用的和设置不一样。从下一次调用模型开始换成设置里的模型。${MODEL_SWITCH_COST}`,
        async () => ({ message: mainModelText(await call('POST /api/eval/main-model')) }), () => {}, '切换')}>让主 Session 换成设置里的模型</button>}</div>
      <ModelSelect value={draft.model} view={view} label="主 Session 模型" onChange={model => setDraft({ ...draft, model })} /></div>
    <SaveRow dirty={dirty} saving={saving} onReset={reset} onSave={() => void save('保存主 Session 的设置？', view.canSwitchMainModel
      ? `评估时限对之后开始的评估生效；模型从主 Session 下一次调用开始生效。${MODEL_SWITCH_COST}` : '评估时限对之后开始的评估生效；模型只对新建的主 Session 生效。',
      async () => { const { mainModel } = await call('PUT /api/eval', { body: { ...draft, revision } }); return mainModel ? { message: `已保存，${mainModelText(mainModel)}` } : {} }, reset)} />
  </section>
}
