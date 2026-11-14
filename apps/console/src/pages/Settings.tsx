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
import { t } from '../i18n'
import { PAGE, SOURCE_STATE } from '../text'

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
  return <div className="row-actions card-save"><span className="muted small grow">{note ?? t('Unsaved changes', '有未保存的修改')}</span>
    <button className="btn sm ghost" onClick={onReset}>{t('Discard', '放弃')}</button><button className="btn sm primary" disabled={saving} onClick={onSave}>{t('Save', '保存')}</button></div>
}

function useSave(reload: () => Promise<void>) {
  const { confirm, toast } = useUi()
  const [saving, setSaving] = useState(false)
  return { saving, save: async (title: string, body: ReactNode, run: () => Promise<{ restarting?: boolean; message?: string } | unknown>, done: () => void, action = t('Save', '保存')) => {
    if (!await confirm({ title, action, body })) return
    setSaving(true)
    try {
      const result = await run() as { restarting?: boolean; message?: string }
      toast(result?.message ?? (result?.restarting ? t('Saved; dsh-superagent is restarting', '已保存，dsh-superagent 正在重启') : t('Saved', '已保存')))
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
    <div className="head"><div><h1>{PAGE.sources}</h1><p>{t('Where it listens. The more it receives, the more it can do on its own, and the stricter the rules need to be. How incoming messages are handled is set in the admission table under ', '它在听哪些地方。接收得越多，主动能力越强，也越需要严格的规则；收进来的消息怎么处理，在')}<a href={href.policy()}>{PAGE.policy}</a>{t('.', '的准入表里定。')}</p></div></div>
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
      <Switch on={draft.enabled} label={t('Enable this source', '启用这个来源')} hint={t('Once disabled it no longer receives messages here; queued replies wait until it is enabled again.', '停用后不再接收这里的消息；排队的回复会等它重新启用。')} onChange={enabled => setDraft({ ...draft, enabled })} />
      {draft.github && <GithubFields value={draft.github} onChange={github => setDraft({ ...draft, github })} />}
      {draft.feishu && <FeishuFields value={draft.feishu} joined={source.joined ?? []} sourceId={source.id} reload={reload} onChange={feishu => setDraft({ ...draft, feishu })} />}
    </div>
    <SaveRow dirty={dirty} saving={saving} onReset={reset} onSave={() => void save(t(`Save the ${source.title} settings?`, `保存${source.title}的设置？`),
      t('It receives messages with the new settings right away. After turning on "all", decide how those messages are handled in the admission table on the Policy page.', '保存后它马上按新设置接收消息。打开“接收全部”后，再到策略页的准入表决定这些消息怎么处理。'), () => call('PUT /api/sources/:id', { params: { id: source.id },
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
    <h3 className="small-h">{t('Account', '账号')}</h3>
    {github && <label className="field">{t('Repository', '仓库')}<input className="mono" value={draft.repository ?? ''} placeholder="owner/name" onChange={event => setDraft({ ...draft, repository: event.target.value })} /></label>}
    <label className="field">{github ? t("The agent's GitHub CLI", 'agent 的 GitHub CLI') : t("The bot's lark-cli", '机器人的 lark-cli')}
      <input className="mono" value={draft.cli} placeholder={github ? '/Users/me/.local/bin/gh-agent' : '/Users/me/.local/bin/lark-bot'} onChange={event => setDraft({ ...draft, cli: event.target.value })} />
      <span className="muted small">{github ? t("A gh signed in only to the agent's account; a command name or an absolute path.", '只登录了 agent 账号的 gh，写命令名或绝对路径。') : t('A lark-cli that only allows the bot identity (strict mode bot); a command name or an absolute path.', '只允许机器人身份（strict mode bot）的 lark-cli，写命令名或绝对路径。')}</span></label>
    <SaveRow dirty={dirty} saving={saving} onReset={reset} note={t('The account changed; saving checks it first', '账号改了，保存时会先检查')} onSave={() => void save(t(`Save the ${source.title} account?`, `保存${source.title}的账号？`),
      <>{github ? t('dsh-superagent first checks that the CLI can read its account and push to this repository', 'dsh-superagent 会先检查 CLI 能否读到账号、能否推送到这个仓库') : t('dsh-superagent first checks that this CLI can only act as the bot', 'dsh-superagent 会先检查这个 CLI 是否只能以机器人身份操作')}{t('; if the check fails, nothing is saved and you are told why. If it passes, it restarts: running workers are interrupted and carry on after the restart with recovery notes.', '；没通过就什么都不保存，并告诉你原因。通过后它会重启：正在运行的 worker 会被打断，重启后带着恢复说明接着做。')}</>,
      () => call('PUT /api/sources/:id/account', { params: { id: source.id }, body: { ...github ? { repository: draft.repository ?? '' } : {}, cli: draft.cli, revision: source.revision } }), reset)} />
  </div>
}

/** Runs setup's check again: for a problem fixed outside the console, such as a CLI signed in again. It restarts dsh-superagent. */
export function RecheckSetup() {
  const { confirm, toast } = useUi()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!await confirm({ title: t('Check the configuration again?', '重新检查配置？'), action: t('Check again', '重新检查'), body: t('Use this after fixing a problem outside the console (such as signing a CLI in again). Checking restarts dsh-superagent; running workers are interrupted and carry on after the restart.', '在控制台外面修好问题后（比如重新登录了 CLI）用这个。检查会重启 dsh-superagent，正在运行的 worker 会被打断，重启后接着做。') })) return
    setBusy(true)
    try { await call('POST /api/setup/check'); toast(t('dsh-superagent is restarting and checking again; this page updates shortly', 'dsh-superagent 正在重启并重新检查，稍后这里会更新')) }
    catch (error) { toast(error instanceof ApiError ? error.message : String(error)) } finally { setBusy(false) }
  }
  return <button className="btn sm" disabled={busy} onClick={() => void run()}>{t('Check again', '重新检查')}</button>
}

function GithubFields({ value, onChange }: { value: GithubSettings; onChange: (value: GithubSettings) => void }) {
  const set = (patch: Partial<GithubSettings>) => onChange({ ...value, ...patch })
  return <>
    <Switch on={value.observeIssues} label={t('Receive all new Issues', '接收所有新 Issue')} hint={t('Sees new Issues even when nobody @ it; pairs with rules like "New issue triage".', '没人 @ 它也能看到新 Issue，配合“新 issue 分诊”这类规则。')} onChange={observeIssues => set({ observeIssues })} />
    <Switch on={value.observePulls} label={t('Receive all new PRs', '接收所有新 PR')} hint={t('Pairs with "Dependency upgrade follow-up": it fixes dependency bot PRs that break.', '配合“依赖升级跟进”：依赖机器人的 PR 出问题时它去修。')} onChange={observePulls => set({ observePulls })} />
    <Switch on={value.observeComments} label={t('Receive all comments', '接收所有评论')} hint={t('Sees discussions even when nobody @ it. Turning this on adds a lot of noise.', '没人 @ 它时也能看到讨论。打开后噪音会明显变多。')} onChange={observeComments => set({ observeComments })} />
    <Switch on={value.observeCi} label={t("Receive the default branch's CI", '接收默认分支的 CI')} hint={t('Lets it investigate when the main branch goes red.', '主干变红时可以主动排查。')} onChange={observeCi => set({ observeCi })} />
    <div className="swrow"><div className="grow"><div>{t('Poll interval', '轮询间隔')}</div><div className="muted small">{t('How often to ask GitHub, 60 to 3600 seconds.', '多久问一次 GitHub，60 到 3600 秒。')}</div></div>
      <input className="num" type="number" min={60} max={3600} step={30} value={value.pollSeconds} onChange={event => set({ pollSeconds: Number(event.target.value) })} aria-label={t('Poll interval (seconds)', '轮询间隔（秒）')} /></div>
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
      toast(added.length ? t(`Found newly joined groups: ${added.join(', ')}`, `找到新加入的群：${added.join('、')}`) : t('The group list is up to date', '群列表已是最新'))
      await reload()
    } catch (error) { toast(error instanceof ApiError ? error.message : String(error)) }
  }
  return <>
    <h3 className="small-h gap-top">{t('Groups it listens to', '监听的群')}</h3>
    <div className="rows-plain">{value.chats.map(chat => <div key={chat.chatId} className="chat-row">
      <div className="grow"><div>{chat.name || chat.chatId}</div><div className="muted small mono">{chat.chatId}</div></div>
      <div className="seg sm">{(['mentions', 'all'] as const).map(listen => <button key={listen} className={chat.listen === listen ? 'on' : ''}
        onClick={() => set({ chats: value.chats.map(item => item.chatId === chat.chatId ? { ...item, listen } : item) })}>{listen === 'all' ? t('All messages', '全部消息') : t('@ only', '仅 @')}</button>)}</div>
      <button className="link danger" onClick={() => set({ chats: value.chats.filter(item => item.chatId !== chat.chatId) })}>{t('Remove', '移除')}</button>
    </div>)}</div>
    <div className="add-row">
      <select value="" onChange={event => { const chat = choices.find(item => item.chatId === event.target.value); if (chat) add(chat.chatId, chat.name) }} aria-label={t('Pick a group the bot is in', '选择机器人所在的群')}
        disabled={!choices.length}><option value="">{choices.length ? t(`Add a group the bot is in (${choices.length})`, `加入机器人所在的群（${choices.length}）`) : t('Every group the bot is in is already listed', '机器人所在的群都已在列表里')}</option>
        {choices.map(chat => <option key={chat.chatId} value={chat.chatId}>{chat.name}</option>)}</select>
      <button className="btn sm ghost" type="button" onClick={() => void refresh()}>{t('Refresh group list', '刷新群列表')}</button>
    </div>
    <details className="small"><summary>{t('Add by group id', '按群 id 加入')}</summary>
      <form className="add-row" onSubmit={event => { event.preventDefault(); add(chatId, name) }}>
        <input value={chatId} onChange={event => setChatId(event.target.value.trim())} placeholder={t('Group id, starting with oc_', '群 id，oc_ 开头')} aria-label={t('Group id', '群 id')} />
        <input value={name} onChange={event => setName(event.target.value)} placeholder={t('Group name (optional)', '群名（可选）')} aria-label={t('Group name', '群名')} />
        <button className="btn sm" type="submit" disabled={!/^oc_[a-zA-Z0-9]+$/.test(chatId)}>{t('Add', '加入')}</button>
      </form>
    </details>
    <div className="swrow"><div className="grow"><div>{t('Other groups', '其他群')}</div><div className="muted small">{t("Groups the bot is in that aren't listed above.", '机器人在、但不在上面列表里的群。')}</div></div>
      <div className="seg sm">{(['none', 'mentions'] as const).map(other => <button key={other} className={value.otherChats === other ? 'on' : ''} onClick={() => set({ otherChats: other })}>
        {other === 'none' ? t('Ignore', '不接收') : t('@ only', '仅 @')}</button>)}</div></div>
    <Switch on={value.directMessages} label={t('Receive direct messages', '接收私聊')} hint={t('A direct message to the bot from someone on the allow list is an explicit request.', '名单里的人私聊机器人，就是明确请求。')} onChange={directMessages => set({ directMessages })} />
  </>
}

export function Execution() {
  const { data, error, reload } = useLiveData(['settings'], 'execution', () => call('GET /api/execution'))
  const { connection } = useLive()
  return <>
    <div className="head"><div><h1>{PAGE.execution}</h1><p>{t('Where it works, how much at once, and with which model.', '它在哪干活、同时干几件、用什么模型。')}</p></div></div>
    <div className="callout muted"><div className="lbl">{t('Can only be changed on this machine', '只能在本机修改')}</div>{t('The prepare command runs as your system user, so changing this page changes the commands that run on this machine. Once remote access arrives, this page is read-only there.', 'prepare 命令会以你的系统用户身份执行，改这一页等于改这台机器上会运行的命令。以后开放远程访问时，这一页只读。')}</div>
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
    <div className="sec-t"><h2>{t('Deployment limits', '部署限制')}</h2><span className="muted small">{t('Read-only', '只读')}</span></div>
    <dl className="kv">
      <dt>{t('State directory', '状态目录')}</dt><dd className="mono">{machine.stateDir}</dd>
      {machine.promptMaxChars !== undefined && <><dt>{t('Prompt length limit', '提示词最长')}</dt><dd>{t(`${machine.promptMaxChars.toLocaleString()} characters`, `${machine.promptMaxChars.toLocaleString()} 字符`)}</dd></>}
      {machine.admissionContextMaxPages !== undefined && <><dt>{t('Thread reading during evaluation', '评估时读线程')}</dt><dd>{t(`Up to ${machine.admissionContextMaxPages} pages`, `最多 ${machine.admissionContextMaxPages} 页`)}{machine.admissionContextTimeoutMs !== undefined ? t(`, within ${machine.admissionContextTimeoutMs / 1000} seconds`, `，${machine.admissionContextTimeoutMs / 1000} 秒内`) : ''}</dd></>}
    </dl>
    <p className="muted small">{t("These are the dsh-superagent plugin's own configuration: the limits change in DSH's plugin manager and take effect at once; the state directory only changes in the profile's cordis.patch.yml.", '这些是 dsh-superagent 插件自己的配置：限制在 DSH 的插件管理里改，立即生效；状态目录只能在 profile 的 cordis.patch.yml 里改。')}</p>
  </section>
}

function ModelSelect({ value, view, onChange, label }: { value: ModelChoice | null; view: ExecutionView; onChange: (value: ModelChoice | null) => void; label: string }) {
  const options = view.models?.groups.flatMap(group => group.models.map(model => ({ key: `${group.id}/${model.id}`, label: `${group.name} · ${model.name}`, value: { provider: group.id, model: model.id } }))) ?? []
  const current = value ? `${value.provider}/${value.model}` : ''
  return <select value={current} aria-label={label} onChange={event => onChange(options.find(option => option.key === event.target.value)?.value ?? null)}>
    <option value="">{t('Default', '默认')}{t(' (', '（')}{view.models ? `${view.models.default.provider} · ${view.models.default.model}` : t("the profile's default model", 'profile 的默认模型')}{t(')', '）')}</option>
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
    <div className="swrow"><div className="grow"><div>{t('Concurrency', '并发')}</div><div className="muted small">{t("How many workers run at once. A person's message can always take one more, so no amount of new work blocks you from moving an existing Ticket forward.", '同时运行的 worker 数。人发来的消息总能多占一个，新活再多也不会挡住你推进已有的 Ticket。')}</div></div>
      <input className="num" type="number" min={1} step={1} value={draft.maxWorkers} onChange={event => setDraft({ ...draft, maxWorkers: Number(event.target.value) })} aria-label={t('Concurrency', '并发')} /></div>
    <div className="swrow"><div className="grow"><div>{t('Worker model', 'worker 模型')}</div><div className="muted small">{t('Shared by all workers. Only applies to Tickets opened from now on; existing Tickets (retries included) keep their model. The model each Ticket actually used is under its "What the worker is doing".', '所有 worker 共用。只对之后新开的 Ticket 生效，已有的 Ticket（包括重试）沿用原来的模型；每个 Ticket 实际用的模型，在它的“worker 在做什么”里。')}</div></div>
      <ModelSelect value={draft.model} view={view} label={t('Worker model', 'worker 模型')} onChange={model => setDraft({ ...draft, model })} /></div>
    <div className="swrow"><div className="grow"><div>{t('Where Ticket directories go', 'Ticket 目录的位置')}</div><div className="muted small">{t('Leave empty for ', '留空用 ')}<span className="mono">{root || t('<state directory>/work', '<状态目录>/work')}</span>{t('.', '。')}</div></div>
      <input className="path" value={draft.directory} placeholder={root} onChange={event => setDraft({ ...draft, directory: event.target.value })} aria-label={t('Ticket directory', 'Ticket 目录')} /></div>
    <h3 className="small-h gap-top">{t('prepare command', 'prepare 命令')}</h3>
    <p className="muted small">{t("Runs once with sh in the directory root before a Ticket's first dispatch, for up to 10 minutes. Usually it checks out a branch with git worktree.", '每个 Ticket 第一次派工前，在目录根里用 sh 执行一次，最长 10 分钟。通常用 git worktree 检出一个分支。')}</p>
    <textarea className="ed mono-ed" rows={4} value={draft.prepare} onChange={event => setDraft({ ...draft, prepare: event.target.value })} aria-label={t('prepare command', 'prepare 命令')} />
    <div className="chips gap-top"><span className="muted small">{t('Click to insert:', '点击插入：')}</span>{view.variables.map(variable => <button key={variable.key} className="chip mono click" title={variable.description} onClick={() => insert(variable.key)}>${variable.key}</button>)}</div>
    <h3 className="small-h gap-top">{t('Blocked commands', '禁用命令')}</h3>
    <div className="chips">{draft.blockedCommands.map(name => <span key={name} className="chip mono">{name}<button className="x" aria-label={t(`Remove ${name}`, `移除 ${name}`)} onClick={() => setDraft({ ...draft, blockedCommands: draft.blockedCommands.filter(item => item !== name) })}>×</button></span>)}</div>
    <form className="add-row" onSubmit={event => { event.preventDefault(); const name = command.trim(); if (/^[A-Za-z0-9._-]+$/.test(name) && !draft.blockedCommands.includes(name)) setDraft({ ...draft, blockedCommands: [...draft.blockedCommands, name] }); setCommand('') }}>
      <input value={command} onChange={event => setCommand(event.target.value)} placeholder={t('Command name, such as sudo', '命令名，例如 sudo')} aria-label={t('Command to block', '要禁用的命令')} /><button className="btn sm" type="submit">{t('Add', '加入')}</button></form>
    <p className="muted small">{t('Blocking by command name is a default constraint, not a security boundary: an absolute path still runs.', '按命令名拦截，是默认约束，不是安全边界：用绝对路径仍然能运行。')}</p>
    <SaveRow dirty={dirty} saving={saving} onReset={reset} onSave={() => void save(t('Save the worker settings?', '保存 worker 设置？'), t("A new prepare command only applies to Tickets that don't have a directory yet; concurrency applies at once.", '新的 prepare 命令只对还没建目录的 Ticket 生效；并发立即生效。'),
      () => call('PUT /api/execution', { body: { executor: draft, revision } }), reset)} />
  </section>
}

const MODEL_SWITCH_COST = t(" The first call after switching can't reuse the earlier conversation's cache, so it is a little slower and costlier, just that once.", '换模型后的第一次调用用不上之前对话的缓存，会慢一点、贵一点，只有这一次。')
function mainModelText(change: MainModelSwitch) {
  return change.result === 'switched' ? t(`the main Session switches to ${change.model} on its next model call`, `主 Session 下一次调用模型时换成 ${change.model}`)
    : change.result === 'unsupported' ? t("the running main Session didn't switch: it needs companion plugin 0.3.0 or later", '正在运行的主 Session 没换：要 0.3.0 以上的 companion 插件')
    : t(`the running main Session didn't switch: ${change.error}`, `正在运行的主 Session 没换：${change.error}`)
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
    <div className="sec-t"><h2>{t('Main Session', '主 Session')}</h2></div>
    <div className="swrow"><div className="grow"><div>{t('Evaluation time limit', '评估时限')}</div><div className="muted small">{t('How long after a candidate reaches the main Session to retry if there is no conclusion; three in a row are recorded as "evaluation unavailable".', '候选送到主 Session 后多久没结论就重试；连续三次就记为“评估没完成”。')}</div></div>
      <input className="num" type="number" min={10} step={10} value={draft.timeoutSeconds} onChange={event => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })} aria-label={t('Evaluation time limit (seconds)', '评估时限（秒）')} /></div>
    <div className="swrow"><div className="grow"><div>{t('Model', '模型')}</div><div className="muted small">{t('The main Session uses it to judge every message, accept and dispatch work, and evaluate proactive candidates. ', '主 Session 判断每条消息、接单、派工、评估主动候选都用它。')}{view.canSwitchMainModel
      ? t("Once saved, it switches to the new model from its next model call; workers and the profile's default model stay as they are.", '保存后，从它下一次调用模型开始换成新模型；worker 和 profile 的默认模型不变。')
      : t("It only takes effect before the main Session's first model call; changing it later doesn't replace the model in use. With companion plugin 0.3.0 or later, saving switches it directly.", '它只在主 Session 第一次调用模型前生效，之后改这里不会换掉它正在用的模型。装上 0.3.0 以上的 companion 插件后，保存时会直接切换。')}</div>
      <div className="small gap-top">{view.mainModel ? <>{t('In use: ', '实际在用：')}<span className="mono">{view.mainModel}</span>{pending && <>{t('; switches on the next call to ', '，下一次调用换成 ')}<span className="mono">{pending}</span></>}</> : <span className="muted">{t('With companion plugin 0.2.0 or later, the model the main Session actually uses shows here.', '装上 0.2.0 以上的 companion 插件后，这里显示主 Session 实际在用的模型。')}</span>}</div>
      {canApply && <button className="btn sm gap-top" disabled={saving} onClick={() => void save(t(`Switch the main Session to ${target}?`, `让主 Session 换成 ${target}？`), t(`It uses a different model from the setting. From its next model call it switches to the configured one.${MODEL_SWITCH_COST}`, `它现在用的和设置不一样。从下一次调用模型开始换成设置里的模型。${MODEL_SWITCH_COST}`),
        async () => ({ message: mainModelText(await call('POST /api/eval/main-model')) }), () => {}, t('Switch', '切换'))}>{t('Switch the main Session to the configured model', '让主 Session 换成设置里的模型')}</button>}</div>
      <ModelSelect value={draft.model} view={view} label={t('Main Session model', '主 Session 模型')} onChange={model => setDraft({ ...draft, model })} /></div>
    <SaveRow dirty={dirty} saving={saving} onReset={reset} onSave={() => void save(t('Save the main Session settings?', '保存主 Session 的设置？'), view.canSwitchMainModel
      ? t(`The time limit applies to evaluations that start from now on; the model applies from the main Session's next call.${MODEL_SWITCH_COST}`, `评估时限对之后开始的评估生效；模型从主 Session 下一次调用开始生效。${MODEL_SWITCH_COST}`)
      : t('The time limit applies to evaluations that start from now on; the model only applies to a new main Session.', '评估时限对之后开始的评估生效；模型只对新建的主 Session 生效。'),
      async () => { const { mainModel } = await call('PUT /api/eval', { body: { ...draft, revision } }); return mainModel ? { message: t(`Saved; ${mainModelText(mainModel)}`, `已保存，${mainModelText(mainModel)}`) } : {} }, reset)} />
  </section>
}
