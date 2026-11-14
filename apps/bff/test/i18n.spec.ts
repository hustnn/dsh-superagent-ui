import { afterEach, describe, expect, it } from 'vitest'
import type { HomeView, TicketView } from '@dsh-superagent-ui/contract'
import { lang, parseLang, t, withLang } from '../src/i18n.ts'
import { reasonText, setupText } from '../src/views/reasons.ts'
import { harness } from './support.ts'

let h: Awaited<ReturnType<typeof harness>>
afterEach(async () => { await h?.close() })

const json = async <T>(response: Response) => await response.json() as T

describe('language', () => {
  it('reads only zh as Chinese and defaults to English, inside and outside a request', () => {
    expect(parseLang('zh')).toBe('zh')
    expect(parseLang('fr')).toBe('en')
    expect(parseLang(undefined)).toBe('en')
    expect(lang()).toBe('en')
    expect(withLang('zh', () => t('Stop', '停止'))).toBe('停止')
    expect(t('Stop', '停止')).toBe('Stop')
  })

  it('words reasons and setup problems in the language asked for', () => {
    expect(reasonText([{ code: 'not_human' }, { code: 'routed', values: { ticket: 'tk_1' } }])).toBe('Automated message; Routed to Ticket tk_1')
    expect(withLang('zh', () => reasonText([{ code: 'not_human' }, { code: 'routed', values: { ticket: 'tk_1' } }]))).toBe('自动消息；已转给工单 tk_1')
    const problem = { code: 'repositoryReadOnly', values: { account: 'bot', repository: 'acme/app' }, detail: '' }
    expect(setupText(problem)).toBe('@bot cannot push to acme/app.')
    expect(withLang('zh', () => setupText(problem))).toBe('@bot 没有 acme/app 的推送权限。')
    // A code the console does not know falls back to upstream's own English detail in both languages.
    expect(withLang('zh', () => setupText({ code: 'brandNew', values: {}, detail: 'Something new broke.' }))).toBe('Something new broke.')
  })

  it("answers each request in the language its x-console-lang header names, and in English without one", async () => {
    h = await harness()
    const english = await json<HomeView>(await h.call('/api/home'))
    const chinese = await json<HomeView>(await h.call('/api/home', { headers: { 'x-console-lang': 'zh' } }))
    expect(english.problems.map(problem => problem.title)).toContain("A reply can't be sent")
    expect(chinese.problems.map(problem => problem.title)).toContain('回复发不出去')
    // Upstream's own bilingual fields follow the same choice.
    expect(english.problems.some(problem => problem.title === 'Source error: Feishu')).toBe(true)
    expect(chinese.problems.some(problem => problem.title === '来源出错：飞书')).toBe(true)

    const ticket = await json<TicketView>(await h.call('/api/tickets/tk_142', { headers: { 'x-console-lang': 'zh' } }))
    expect(ticket.why.sentence).toMatch(/所以是明确请求。按策略 \w+ 接单。$/)
    expect(ticket.execution.environment.find(variable => variable.key === 'DSH_SUPERAGENT_DIR')?.description).toBe('Ticket 的目录')
  })

  it('words error messages in the request language too', async () => {
    h = await harness()
    const missing = await h.call('/api/sources/nope', { method: 'PUT', headers: { 'x-console-lang': 'zh', 'x-console-request': '1' }, body: { enabled: true, revision: 1 } })
    expect(missing.status).toBe(404)
    expect((await json<{ error: { message: string } }>(missing)).error.message).toBe('没有这个来源')
  })
})
