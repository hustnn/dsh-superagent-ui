/**
 * Request trust for the local access mode: which pages may talk to the BFF at all.
 *
 * Proxying removes the same-origin fence upstream keeps around an agent that runs shell commands as the operator, so the
 * BFF puts it back: the Host must be the BFF's own loopback authority (which defeats DNS rebinding), a browser Origin must
 * be that authority or a configured development origin, and a cross-site fetch is refused. These checks establish no
 * identity; the session cookie does (`session.ts`).
 */
export interface TrustOptions {
  port: number
  /** Extra origins allowed to call the API, such as the Vite dev server's. */
  origins: readonly string[]
}
export type TrustResult = { ok: true } | { ok: false; reason: 'host' | 'origin' | 'cross-site' }

export function trusted(header: (name: string) => string | undefined, options: TrustOptions): TrustResult {
  const host = header('host')
  if (host !== `127.0.0.1:${options.port}` && host !== `localhost:${options.port}`) return { ok: false, reason: 'host' }
  if (header('sec-fetch-site') === 'cross-site') return { ok: false, reason: 'cross-site' }
  const origin = header('origin')
  if (origin !== undefined && origin !== `http://${host}` && !options.origins.includes(origin)) return { ok: false, reason: 'origin' }
  return { ok: true }
}
