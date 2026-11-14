/**
 * Prompts: what the team says in words about how the agent talks, when it stops and what it delivers. Edits collect in a
 * draft of the whole configuration; saving makes a new revision, which every Session reads on its next model request.
 */
import { useEffect, useMemo, useState } from 'react'
import type { PromptConfig, PromptPart, PromptPreview, PromptRole, PromptsView } from '@dsh-superagent-ui/contract'
import { ApiError, call } from '../api'
import { ConnectionBanner, Pill, useUi } from '../components/ui'
import { useLive, useLiveData } from '../live'
import { href, navigate } from '../route'
import { t } from '../i18n'
import { clock, PAGE } from '../text'

const ROLE: Record<PromptRole, string> = { orchestrator: t('main Session', '主 Session'), worker: 'worker' }
const KIND_LABEL = { fixed: t('Built-in', '内置'), team: t('Team', '团队'), generated: t('Generated', '生成') } as const
const names = (items: string[]) => items.join(t(', ', '、'))
const SKILL_NAME = /^[a-z][a-z0-9-]*$/

export function Prompts({ part }: { part?: string }) {
  const { data, error, reload } = useLiveData(['prompts'], 'prompts', () => call('GET /api/prompts', { query: {} }))
  const { connection } = useLive()
  return <>
    <div className="head"><div><h1>{PAGE.prompts}</h1><p>{t('Everything the team describes in words lives here: how it talks, where it stops, what it delivers. Once saved, every Session reads the new revision on its next model request, with no restart.', '团队用文字描述的行为都在这里：怎么说话、做到哪停、交付标准。保存后，所有 Session 的下一次模型请求就会读到新版本，不需要重启。')}</p></div></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data ? <Editor view={data} selected={part ?? 'communication'} reload={reload} /> : !error && <div className="card empty">{t('Loading…', '正在读取…')}</div>}
  </>
}

/** The text a part has under a configuration: the team's, the skill's, or the override in place of the built-in text. */
function textOf(config: PromptConfig, part: PromptPart): string {
  if (part.kind === 'team') return config[part.key as 'communication' | 'scope' | 'delivery'] ?? ''
  if (part.kind === 'skill') return config.skills[part.key.slice('skill/'.length)] ?? ''
  return config.overrides?.[part.key]?.text ?? part.builtIn?.text ?? ''
}

/** Names of the parts two configurations differ in. */
function changedParts(parts: PromptPart[], before: PromptConfig, after: PromptConfig): string[] {
  const names: string[] = []
  for (const key of ['communication', 'scope', 'delivery'] as const) if (before[key] !== after[key]) names.push(parts.find(part => part.key === key)?.title ?? key)
  for (const name of new Set([...Object.keys(before.skills), ...Object.keys(after.skills)])) {
    if (before.skills[name] !== after.skills[name]) names.push(name in after.skills ? (name in before.skills ? `skill ${name}` : t(`new skill ${name}`, `新增 skill ${name}`)) : t(`deleted skill ${name}`, `删除 skill ${name}`))
  }
  for (const key of new Set([...Object.keys(before.overrides ?? {}), ...Object.keys(after.overrides ?? {})])) {
    const a = before.overrides?.[key], b = after.overrides?.[key]
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    const title = parts.find(part => part.key === key)?.title ?? key
    names.push(!b ? t(`${title} back to default`, `${title}恢复默认`) : !a ? t(`overrode ${title}`, `覆盖${title}`) : a.text !== b.text ? title : t(`${title} (new default confirmed)`, `${title}（确认了新默认）`))
  }
  return names
}

function Editor({ view, selected, reload }: { view: PromptsView; selected: string; reload: () => Promise<void> }) {
  const [base, setBase] = useState(view)
  const [draft, setDraft] = useState<PromptConfig>(() => structuredClone(view.config))
  const [tab, setTab] = useState<'edit' | 'full' | 'history'>('edit')
  const changed = useMemo(() => changedParts(base.parts, base.config, draft), [base, draft])
  useEffect(() => { if (!changed.length) { setBase(view); setDraft(structuredClone(view.config)) } }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  // Skills added in the draft are listed with the saved ones.
  const parts = useMemo(() => {
    const known = new Set(base.parts.map(part => part.key))
    const added = Object.keys(draft.skills).filter(name => !known.has(`skill/${name}`)).map((name): PromptPart =>
      ({ key: `skill/${name}`, kind: 'skill', title: name, description: t('Knowledge the team wrote; the agent reads it when needed.', '团队写的知识，agent 需要时会读。'), roles: ['orchestrator', 'worker'] }))
    return [...base.parts.filter(part => part.kind !== 'skill' || `${part.key.slice(6)}` in draft.skills), ...added]
  }, [base, draft])
  const current = parts.find(part => part.key === selected) ?? parts[0]!
  const outdated = base.sessions.filter(session => session.revision < base.current)

  return <>
    <div className="muted small">{t('Current ', '当前 ')}<span className="mono">r{base.current}</span> · {t(`saved ${clock(base.savedAt)} by ${base.origin}`, `${clock(base.savedAt)} 由${base.origin}保存`)}
      {outdated.length > 0 && <> · {t(`${outdated.length} Sessions last used an older revision; they switch on their next request`, `${outdated.length} 个 Session 最近一次请求用的还是旧版本，下一次请求就会换上`)}</>}</div>
    <div className="pr-wrap">
      <nav className="card pr-list" aria-label={t('Prompt sections', '提示词段落')}>
        {(['team', 'skill', 'part'] as const).map(kind => <div key={kind}>
          <div className="navl">{{ team: t('Team sections', '团队段落'), skill: t('Team skills', '团队 skill'), part: t('Built-in sections', '内置段落') }[kind]}</div>
          {parts.filter(part => part.kind === kind).map(part => <a key={part.key} href={href.prompts(part.key)} className={`navi${part.key === current.key ? ' on' : ''}`}>
            <span className="grow ellipsis">{part.title}</span>
            {part.defaultChanged && (part.defaultChanged.removed || draft.overrides?.[part.key]?.base !== part.builtIn?.base) ? <span className="badge warn">{t('Default updated', '默认已更新')}</span> : part.kind === 'part' && draft.overrides?.[part.key] ? <span className="badge">{t('Overridden', '已覆盖')}</span>
              : part.kind === 'team' && part.teamDefault !== undefined && draft[part.key as 'scope'] !== part.teamDefault ? <span className="badge">{t('Changed', '已改')}</span> : null}
          </a>)}
          {kind === 'skill' && <NewSkill draft={draft} onAdd={name => { setDraft({ ...draft, skills: { ...draft.skills, [name]: '' } }); navigate(href.prompts(`skill/${name}`)) }} />}
        </div>)}
      </nav>
      <section className="card pad pr-main">
        <div className="sec-t"><div><h2>{current.title}</h2><div className="muted small">{current.description}{current.roles.length ? t(` · read by the ${current.roles.map(role => ROLE[role]).join(' and ')}`, ` · ${current.roles.map(role => ROLE[role]).join(' 和 ')} 会读`) : ''}</div></div>
          <div className="seg" role="tablist">{([['edit', t('Edit', '编辑')], ['full', t('Full prompt', '完整提示词')], ['history', t('History', '历史')]] as const).map(([id, label]) =>
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}</div></div>
        {tab === 'edit' && <PartEditor part={current} draft={draft} setDraft={setDraft} />}
        {tab === 'full' && <FullPrompt draft={draft} />}
        {tab === 'history' && <History view={base} onLoad={config => { setDraft(config); setTab('edit') }} />}
      </section>
    </div>
    {changed.length > 0 && <SaveBar base={base} draft={draft} changed={changed} stale={view.current !== base.current}
      onDiscard={() => { setBase(view); setDraft(structuredClone(view.config)) }} onSaved={reload} />}
  </>
}

function NewSkill({ draft, onAdd }: { draft: PromptConfig; onAdd: (name: string) => void }) {
  const [name, setName] = useState('')
  const valid = SKILL_NAME.test(name) && !(name in draft.skills) && name !== 'feishu' && name !== 'github'
  return <form className="add-row pad-x" onSubmit={event => { event.preventDefault(); if (valid) { onAdd(name); setName('') } }}>
    <input value={name} onChange={event => setName(event.target.value.trim())} placeholder={t('New skill name, such as identities', '新 skill 名，例如 identities')} aria-label={t('New skill name', '新 skill 名')} />
    <button className="btn sm" type="submit" disabled={!valid}>{t('Create', '新建')}</button>
  </form>
}

function PartEditor({ part, draft, setDraft }: { part: PromptPart; draft: PromptConfig; setDraft: (config: PromptConfig) => void }) {
  const text = textOf(draft, part)
  if (part.kind === 'team') {
    const key = part.key as 'communication' | 'scope' | 'delivery'
    return <>
      <textarea className="ed tall" value={text} onChange={event => setDraft({ ...draft, [key]: event.target.value })} aria-label={part.title} />
      <div className="row-actions"><span className="muted small">{t('Write prompts in English, one sentence per line.', '提示词用英文写，一句一行。')}</span>
        {part.teamDefault !== undefined && text !== part.teamDefault && <button className="btn sm ghost" onClick={() => setDraft({ ...draft, [key]: part.teamDefault! })}>{t('Restore default', '恢复默认')}</button>}</div>
    </>
  }
  if (part.kind === 'skill') {
    const name = part.key.slice('skill/'.length)
    return <>
      <textarea className="ed tall" value={text} onChange={event => setDraft({ ...draft, skills: { ...draft.skills, [name]: event.target.value } })} aria-label={part.title}
        placeholder={'---\nname: ' + name + '\ndescription: ' + t('When to read this skill.', '什么时候读这个 skill。') + '\n---\n' + t('Body', '正文')} />
      <div className="row-actions"><span className="muted small">{t('The agent reads it by name when needed; the name gets a dsh-superagent- prefix.', 'agent 在需要时按名字读它，名字前会加 dsh-superagent- 前缀。')}</span>
        <button className="btn sm ghost danger" onClick={() => { const skills = { ...draft.skills }; delete skills[name]; setDraft({ ...draft, skills }) }}>{t('Delete this skill', '删除这个 skill')}</button></div>
    </>
  }
  const override = draft.overrides?.[part.key]
  const setOverride = (next: { text: string; base?: string } | undefined) => {
    const overrides = { ...draft.overrides }
    if (next) overrides[part.key] = next; else delete overrides[part.key]
    setDraft({ ...draft, overrides })
  }
  const missing = override ? (part.builtIn?.placeholders ?? []).filter(placeholder => !override.text.includes(placeholder)) : []
  return <>
    {part.defaultChanged && !part.defaultChanged.removed && override && override.base !== part.builtIn?.base && <div className="callout warn">
      <div className="lbl">{t('The default changed', '默认内容已更新')}</div>
      {t('You overrode this section, and an upgrade changed its default text. See whether to follow it.', '你覆盖过这一段。升级后它的默认文本变了，看看要不要跟上。')}
      <div className="dl gap-top">
        <div><div className="muted small">{part.defaultChanged.previous !== undefined ? t('The default you started from', '你当时基于的默认') : t('Your text', '你的文本')}</div><pre className="code">{part.defaultChanged.previous ?? override.text}</pre></div>
        <div><div className="muted small">{t('The new default', '新的默认')}</div><pre className="code">{part.builtIn?.text}</pre></div>
      </div>
      <div className="row-actions"><button className="btn sm" onClick={() => setOverride({ ...override, base: part.builtIn!.base })}>{t('Keep mine', '保留我的')}</button>
        <button className="btn sm" onClick={() => setOverride(undefined)}>{t('Use the new default', '使用新默认')}</button></div>
    </div>}
    {part.defaultChanged?.removed ? <p className="sub">{t('This built-in section no longer exists in the new version. Saving removes the override here. ', '这个内置段落在新版本里已经不存在。保存时会去掉这里的覆盖。')}
      <button className="link" onClick={() => setOverride(undefined)}>{t('Remove it now', '现在去掉')}</button></p>
      : override ? <>
        <textarea className="ed tall" value={override.text} onChange={event => setOverride({ ...override, text: event.target.value })} aria-label={part.title} />
        {missing.length > 0 && <p className="err small">{t(`This is a template: keep ${names(missing)}, or upstream will refuse to save it.`, `这是模板，要保留 ${names(missing)}，否则上游会拒绝保存。`)}</p>}
        <div className="row-actions"><span className="muted small">{t('An overridden built-in section no longer follows default updates.', '覆盖内置段落会让它不再跟随默认更新。')}</span>
          <button className="btn sm ghost" onClick={() => setOverride(undefined)}>{t('Restore default', '恢复默认')}</button></div>
      </> : <>
        <pre className="code tall">{part.builtIn?.text}</pre>
        <div className="row-actions"><span className="muted small">{t('This is built-in text, which updates with upgrades.', '这是内置文本，升级时会跟着更新。')}{part.builtIn?.placeholders.length ? t(` The template must keep ${names(part.builtIn.placeholders)}.`, `模板要保留 ${names(part.builtIn.placeholders)}。`) : ''}</span>
          <button className="btn sm" onClick={() => setOverride({ text: part.builtIn!.text, base: part.builtIn!.base })}>{t('Override this section', '覆盖这一段')}</button></div>
      </>}
  </>
}

function FullPrompt({ draft }: { draft: PromptConfig }) {
  const [role, setRole] = useState<PromptRole>('worker')
  const [preview, setPreview] = useState<PromptPreview | ApiError | undefined>(undefined)
  const key = JSON.stringify(draft)
  useEffect(() => {
    let live = true
    setPreview(undefined)
    call('POST /api/prompts/preview', { body: draft }).then(value => { if (live) setPreview(value) }, (error: unknown) => { if (live) setPreview(error instanceof ApiError ? error : new ApiError(0, 'offline', String(error))) })
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    <div className="seg sm" role="radiogroup" aria-label={t('Role', '角色')}>{(['worker', 'orchestrator'] as const).map(id =>
      <button key={id} role="radio" aria-checked={role === id} className={role === id ? 'on' : ''} onClick={() => setRole(id)}>{ROLE[id]}</button>)}</div>
    {preview instanceof ApiError ? <p className="err small gap-top">{preview.message}</p> : !preview ? <p className="muted gap-top">{t('Assembling…', '正在组装…')}</p> : <>
      <ol className="assembled">{preview.roles[role].map((part, i) => <li key={`${part.name}-${i}`}>
        <details><summary><span className="mono muted">{i + 1}</span> {part.title} <Pill tone={part.kind === 'team' || part.overridden ? 'warn' : 'muted'} dot={false}>{part.overridden ? t('Overridden', '已覆盖') : KIND_LABEL[part.kind]}</Pill></summary>
          <pre className="code">{part.text}</pre></details>
      </li>)}</ol>
      <p className="muted small gap-top">{t('Assembled from the current draft, not saved. ', '这是按当前草稿组装的结果，没有保存。')}{preview.note}</p>
    </>}
  </>
}

function History({ view, onLoad }: { view: PromptsView; onLoad: (config: PromptConfig) => void }) {
  const { toast } = useUi()
  const load = async (revision: number) => {
    try {
      const old = await call('GET /api/prompts', { query: { revision: String(revision) } })
      onLoad(structuredClone(old.config))
      toast(t(`Loaded r${revision} into the draft; saving makes it a new revision`, `已把 r${revision} 载入草稿；保存后成为新的一版`))
    } catch (error) { toast(error instanceof ApiError ? error.message : String(error)) }
  }
  return <ol className="hist">{view.history.map(item => <li key={item.revision}>
    <div className="hist-h"><span className="mono">r{item.revision}</span><span className="muted">{clock(item.savedAt)} · {item.origin}</span><span className="grow" />
      {item.revision !== view.current && <button className="btn sm ghost" onClick={() => void load(item.revision)}>{t('Use as draft', '以这一版为草稿')}</button>}</div>
    <div className="small">{item.changed.length ? t(`Changed ${names(item.changed)}`, `改了 ${names(item.changed)}`) : t('First revision', '第一版')}</div>
  </li>)}</ol>
}

function SaveBar({ base, draft, changed, stale, onDiscard, onSaved }: { base: PromptsView; draft: PromptConfig; changed: string[]; stale: boolean; onDiscard: () => void; onSaved: () => Promise<void> }) {
  const { confirm, toast } = useUi()
  const [saving, setSaving] = useState(false)
  const save = async () => {
    const ok = await confirm({ title: t(`Save as r${base.current + 1}?`, `保存为 r${base.current + 1}？`), action: t('Save', '保存'),
      body: <><p>{t("Every Session reads the new revision on its next model request; turns in progress aren't interrupted.", '所有 Session 的下一次模型请求就会读到新版本；正在进行的回合不会被打断。')}</p><ul className="plain gap-top">{changed.map(name => <li key={name}>{name}</li>)}</ul></> })
    if (!ok) return
    setSaving(true)
    try {
      const saved = await call('PUT /api/prompts', { body: { config: draft, baseRevision: base.current } })
      toast(t(`Saved as r${saved.revision}`, `已保存为 r${saved.revision}`))
      onDiscard()
      await onSaved()
    } catch (error) { toast(error instanceof ApiError ? error.message : String(error)) } finally { setSaving(false) }
  }
  return <div className="savebar" role="region" aria-label={t('Unsaved changes', '未保存的修改')}>
    <div className="txt"><b>{t(`${changed.length} change${changed.length === 1 ? '' : 's'}`, `${changed.length} 处修改`)}</b>{t(': ', '：')}{names(changed.slice(0, 3))}{changed.length > 3 ? t(' and more', ' 等') : ''}
      {stale && <div className="small warn-text">{t('The prompts were changed elsewhere, so saving will fail. Discard your changes to load the latest.', '提示词在别处被改过，保存会失败。放弃修改即可载入最新的。')}</div>}</div>
    <button className="btn ghost" onClick={onDiscard}>{t('Discard', '放弃')}</button>
    <button className="btn primary" disabled={saving} onClick={() => void save()}>{t('Save as', '保存为')} r{base.current + 1}</button>
  </div>
}
