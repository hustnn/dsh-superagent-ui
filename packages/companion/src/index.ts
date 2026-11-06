/**
 * The dsh-superagent-ui companion: a DSH plugin added to the same profile as dsh-superagent, serving what the console needs
 * and upstream's management API does not offer: reads, and switching the running main Session's model through DSH. It writes
 * nothing of dsh-superagent's.
 */
import type { Context } from './host.ts'
import { registerRoutes } from './http.ts'

export const name = 'dsh-superagent-ui-companion'
/** `orchestrator` is dsh-superagent's Runtime; the plugin starts once it exists. */
export const inject = ['orchestrator', 'webServer', 'sessionPersistence', 'sessionController', 'agentDefaultModel']
export function apply(ctx: Context): void {
  ctx.effect(() => registerRoutes(ctx), 'superagent-ui companion: routes')
  ctx.logger.info('dsh-superagent-ui companion serving /superagent-ui/api/')
}
