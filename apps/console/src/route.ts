/**
 * The console's addresses. Every page has its own hash, so it can be bookmarked, opened in a new tab or sent to a colleague:
 * `#board`, `#ticket/<id>`, `#lookup/<query>`, `#thread/<key>/<message id>`, `#directories/<key>/<path>`.
 */
export type Route =
  | { page: 'home' }
  | { page: 'board' }
  | { page: 'health' }
  | { page: 'policy' }
  | { page: 'calibration' }
  | { page: 'prompts'; part?: string }
  | { page: 'recipes' }
  | { page: 'insights' }
  | { page: 'sources' }
  | { page: 'execution' }
  | { page: 'directories'; key?: string; path?: string }
  | { page: 'ticket'; id: string }
  | { page: 'lookup'; query: string }
  | { page: 'thread'; key: string; message?: string }

export function parseRoute(hash: string): Route {
  const [page = '', ...rest] = hash.replace(/^#/, '').split('/')
  const part = (index: number) => { try { return decodeURIComponent(rest[index] ?? '') } catch { return '' } }
  switch (page) {
    case 'board': return { page: 'board' }
    case 'health': return { page: 'health' }
    case 'policy': return { page: 'policy' }
    case 'calibration': return { page: 'calibration' }
    case 'prompts': return part(0) ? { page: 'prompts', part: rest.map(item => { try { return decodeURIComponent(item) } catch { return item } }).join('/') } : { page: 'prompts' }
    case 'recipes': return { page: 'recipes' }
    case 'insights': return { page: 'insights' }
    case 'sources': return { page: 'sources' }
    case 'execution': return { page: 'execution' }
    case 'directories': return part(0)
      ? { page: 'directories', key: part(0), ...rest.length > 1 ? { path: rest.slice(1).map((_, index) => part(index + 1)).join('/') } : {} } : { page: 'directories' }
    case 'ticket': return part(0) ? { page: 'ticket', id: part(0) } : { page: 'board' }
    case 'lookup': return { page: 'lookup', query: part(0) }
    case 'thread': return part(0) ? { page: 'thread', key: part(0), ...part(1) ? { message: part(1) } : {} } : { page: 'lookup', query: '' }
    default: return { page: 'home' }
  }
}

export const href = {
  home: () => '#home',
  board: () => '#board',
  health: () => '#health',
  policy: () => '#policy',
  calibration: () => '#calibration',
  prompts: (part?: string) => part ? `#prompts/${part.split('/').map(encodeURIComponent).join('/')}` : '#prompts',
  recipes: () => '#recipes',
  insights: () => '#insights',
  sources: () => '#sources',
  execution: () => '#execution',
  directories: (key?: string, path?: string) => key ? `#directories/${[key, ...path ? path.split('/') : []].map(encodeURIComponent).join('/')}` : '#directories',
  ticket: (id: string) => `#ticket/${encodeURIComponent(id)}`,
  lookup: (query = '') => query ? `#lookup/${encodeURIComponent(query)}` : '#lookup',
  thread: (key: string, message?: string) => `#thread/${encodeURIComponent(key)}${message ? `/${encodeURIComponent(message)}` : ''}`,
}

export function navigate(target: string): void {
  if (location.hash !== target) location.hash = target
}
