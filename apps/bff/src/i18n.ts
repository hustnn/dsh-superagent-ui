/**
 * The language a request's views are worded in. The console names it in the `x-console-lang` header; the middleware in
 * `server.ts` runs each request inside `withLang`, so view builders call `t` without passing the language around.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Lang } from '@dsh-superagent-ui/contract'

const current = new AsyncLocalStorage<Lang>()

export const parseLang = (value: string | undefined): Lang => value === 'zh' ? 'zh' : 'en'
export const withLang = <T>(lang: Lang, run: () => T): T => current.run(lang, run)
export const lang = (): Lang => current.getStore() ?? 'en'

/** The English or the Chinese, whichever the request asked for. */
export const t = (en: string, zh: string): string => lang() === 'zh' ? zh : en

/** Upstream's own bilingual text (`{ zh, en }`) in the request's language; plain strings pass through. */
export const local = (text: string | { zh: string; en: string } | undefined): string =>
  text === undefined ? '' : typeof text === 'string' ? text : text[lang()]

/** Joins clauses the way each language does. */
export const list = (items: readonly string[]): string => items.join(lang() === 'zh' ? '；' : '; ')
