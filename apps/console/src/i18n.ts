/**
 * The console's language: English unless the viewer picked Chinese. The choice lives in this browser and is fixed for a
 * page load, so switching reloads the page and every module-level table is worded once. Requests carry it to the BFF.
 */
import type { Lang } from '@dsh-superagent-ui/contract'

const KEY = 'console.lang'

function stored(): Lang {
  try { return localStorage.getItem(KEY) === 'zh' ? 'zh' : 'en' } catch { return 'en' }
}

export const lang: Lang = stored()
export const locale = lang === 'zh' ? 'zh-CN' : 'en-US'

/** The English or the Chinese, whichever this page load uses. */
export const t = (en: string, zh: string): string => lang === 'zh' ? zh : en

export function setLang(next: Lang): void {
  try { localStorage.setItem(KEY, next) } catch { return /* storage is blocked, so the choice could not outlive the reload */ }
  location.reload()
}
