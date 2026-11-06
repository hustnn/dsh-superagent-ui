/**
 * Access modes decide, per risk tier, whether a principal may run an operation.
 *
 * Every route declares its tier (`server.ts`), and every non-read call is audited whatever the mode decides. Only the
 * local mode exists today. The remote modes planned for M4 (tailnet, Cloudflare Access) plug in here: they keep `read` and
 * `low`, ask a fresh passkey assertion for `high`, and refuse `local-only`, without any route changing.
 */
import type { RiskTier } from '@dsh-superagent-ui/contract'

export interface Principal {
  /** Stable id written to the audit log. */
  id: string
  via: 'local-browser'
}
export type AccessDecision = { ok: true } | { ok: false; reason: string }
export interface AccessMode {
  readonly name: 'local'
  authorize(tier: RiskTier, principal: Principal): AccessDecision
}

/** Loopback only, one operator: everything is allowed, and still audited. */
export const localAccess: AccessMode = { name: 'local', authorize: () => ({ ok: true }) }
export const localPrincipal: Principal = { id: 'local-browser', via: 'local-browser' }
