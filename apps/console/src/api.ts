/** Calls to the BFF. Mutations carry `x-console-request: 1`, which the BFF requires and no cross-site form can send. */
import type { Api, ApiFailure } from '@dsh-superagent-ui/contract'

export class ApiError extends Error {
  readonly status: number
  readonly kind: ApiFailure['error']['kind'] | 'offline'
  readonly upstream: ApiFailure['error']['upstream']
  constructor(status: number, kind: ApiError['kind'], message: string, upstream?: ApiFailure['error']['upstream']) {
    super(message)
    this.status = status
    this.kind = kind
    this.upstream = upstream
  }
}

type Route = keyof Api
type Params<R extends Route> = R extends `${string}:id${string}` ? { id: string } : unknown
type Body<R extends Route> = Api[R] extends { body: infer B } ? B : never
type Query<R extends Route> = Api[R] extends { query: infer Q } ? Q : never

export async function call<R extends Route>(route: R, options: { params?: Params<R>; body?: Body<R>; query?: Query<R> } = {}): Promise<Api[R]['response']> {
  const [method, pattern] = route.split(' ') as [string, string]
  const params = options.params as { id?: string } | undefined
  const query = Object.entries((options.query ?? {}) as Record<string, string | undefined>).filter(([, value]) => value !== undefined && value !== '')
  const path = pattern.replace(':id', encodeURIComponent(params?.id ?? ''))
    + (query.length ? `?${new URLSearchParams(query as [string, string][]).toString()}` : '')
  let response: Response
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { ...method === 'GET' ? {} : { 'x-console-request': '1' }, ...options.body === undefined ? {} : { 'content-type': 'application/json' } },
      ...options.body === undefined ? {} : { body: JSON.stringify(options.body) },
    })
  } catch {
    throw new ApiError(0, 'offline', '控制台后端没有响应。确认 pnpm dev 或 pnpm start 还在运行。')
  }
  const value = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    const failure = (value as ApiFailure | null)?.error
    // Vite answers 5xx with no JSON when the BFF behind its proxy is down.
    if (!failure) throw new ApiError(response.status, 'offline', '控制台后端没有响应。确认 pnpm dev 或 pnpm start 还在运行。')
    throw new ApiError(response.status, failure.kind, failure.message, failure.upstream)
  }
  return value as Api[R]['response']
}

/**
 * Trades a launch token in the address bar for a session cookie, then removes the token from the address and history.
 * Answers whether there was a token and whether it worked.
 */
export async function exchangeToken(): Promise<'none' | 'ok' | 'refused'> {
  const url = new URL(location.href)
  const token = url.searchParams.get('token')
  if (!token) return 'none'
  url.searchParams.delete('token')
  history.replaceState(null, '', url.pathname + url.search + url.hash)
  try {
    await call('POST /api/session', { body: { token } })
    return 'ok'
  } catch {
    return 'refused'
  }
}
