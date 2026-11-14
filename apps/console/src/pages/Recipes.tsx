/**
 * Recipes: start from what the agent should do, and let one confirmed step set up the Source, the Policy and the prompts
 * it takes. Proactive rules start out only observed; calibration decides when they run alone.
 */
import { useState } from 'react'
import type { Recipe } from '@dsh-superagent-ui/contract'
import { ApiError, call } from '../api'
import { ConnectionBanner, Pill, useUi } from '../components/ui'
import { useLive, useLiveData } from '../live'
import { t } from '../i18n'
import { href } from '../route'
import { PAGE } from '../text'

export function Recipes() {
  const { data, error, reload } = useLiveData(['policy', 'prompts', 'settings'], 'recipes', () => call('GET /api/recipes'))
  const { connection } = useLive()
  return <>
    <div className="head"><div><h1>{PAGE.recipes}</h1><p>{t('Start from what you want it to do, and set up the source, admission, rules and prompts in one go. Proactive rules only record in observe mode; decide when to let go on ', '从“想让它做什么”出发，一次配好来源、准入、规则和提示词。主动规则在观察模式下只记录不执行，到')}<a href={href.calibration()}>{PAGE.calibration}</a>{t('.', '决定什么时候放手。')}</p></div></div>
    <ConnectionBanner connection={data?.connection ?? connection} {...error ? { error } : {}} />
    {data && <div className="grid2 top">{data.recipes.map(recipe => <RecipeCard key={recipe.id} recipe={recipe} reload={reload} />)}</div>}
  </>
}

function RecipeCard({ recipe, reload }: { recipe: Recipe; reload: () => Promise<void> }) {
  const { confirm, toast } = useUi()
  const [chat, setChat] = useState(recipe.chats?.[0]?.id ?? '')
  const [changes, setChanges] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const appliedTo = Array.isArray(recipe.applied) ? recipe.applied : []
  const inPlace = recipe.needsChat ? appliedTo.includes(chat) : recipe.applied === true
  const body = recipe.needsChat ? { chat } : {}
  const preview = async () => {
    setBusy(true)
    try { setChanges((await call('POST /api/recipes/:id/preview', { params: { id: recipe.id }, body })).changes) }
    catch (error) { toast(error instanceof ApiError ? error.message : String(error)) } finally { setBusy(false) }
  }
  const apply = async () => {
    if (!changes?.length || !await confirm({ title: t(`Apply "${recipe.name}"?`, `启用「${recipe.name}」？`), action: t('Apply', '启用'),
      body: <><ul className="plain">{changes.map(change => <li key={change}>{change}</li>)}</ul><p className="gap-top">{t('Each part is saved on its own; the policy gets a new version and the prompts a new revision.', '每一块分别保存；策略会生成新版本，提示词会生成新的一版。')}</p></> })) return
    setBusy(true)
    try {
      await call('POST /api/recipes/:id/apply', { params: { id: recipe.id }, body })
      toast(t(`Applied "${recipe.name}"`, `已启用「${recipe.name}」`))
      setChanges(null)
      await reload()
    } catch (error) { toast(error instanceof ApiError ? error.message : String(error)) } finally { setBusy(false) }
  }
  return <section className="card pad recipe">
    <div className="sec-t"><h2>{recipe.name}</h2>
      {recipe.needsChat ? appliedTo.length > 0 && <Pill tone="ok">{t(`In use in ${appliedTo.length} group${appliedTo.length === 1 ? '' : 's'}`, `已用在 ${appliedTo.length} 个群`)}</Pill> : <Pill tone={inPlace ? 'ok' : 'muted'}>{inPlace ? t('In use', '已在用') : t('Not applied', '未启用')}</Pill>}</div>
    <p className="sub">{recipe.description}</p>
    {recipe.needsChat && (recipe.chats?.length ? <label className="field">{t('Which group', '用在哪个群')}
      <select value={chat} onChange={event => { setChat(event.target.value); setChanges(null) }}>{recipe.chats.map(item =>
        <option key={item.id} value={item.id}>{item.name}{appliedTo.includes(item.id) ? t(' (in use)', '（已在用）') : ''}</option>)}</select></label>
      : <p className="muted small">{t('First add a Feishu group under ', '先在')}<a href={href.sources()}>{PAGE.sources}</a>{t('.', '里加一个飞书群。')}</p>)}
    {changes && (changes.length ? <ul className="plain changes">{changes.map(change => <li key={change}>{change}</li>)}</ul> : <p className="muted small">{t('Already set up; nothing to change.', '已经配好了，没有要改的。')}</p>)}
    <div className="row-actions">
      {!inPlace && <button className="btn sm" disabled={busy || (recipe.needsChat && !chat)} onClick={() => void preview()}>{t('Preview changes', '预览改动')}</button>}
      {changes && changes.length > 0 && <button className="btn sm primary" disabled={busy} onClick={() => void apply()}>{t('Apply', '启用')}</button>}
    </div>
  </section>
}
