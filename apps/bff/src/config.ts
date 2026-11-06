/** BFF settings, read from the environment. Every value has a default that fits a local dsh-superagent. */
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Config {
  /** Port the BFF listens on; it always binds 127.0.0.1. */
  port: number
  /** dsh-superagent's DSH Web server, as `docs/006-deployment.md` sets it up: profile `superagent`, port 3082. */
  upstreamUrl: string
  /** Where the launch token, the session key and the audit log live. */
  dataDir: string
  /** The Vite dev server's origin, set by `pnpm dev`. */
  devOrigin?: string
  /** Talk to the built-in mock instead of a real dsh-superagent. */
  mock: boolean
  mockPort: number
  pollMs: number
  staticDir: string
}

const int = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const here = dirname(fileURLToPath(import.meta.url))
  return {
    port: int(env.CONSOLE_PORT, 3090),
    upstreamUrl: env.SUPERAGENT_URL ?? 'http://127.0.0.1:3082',
    dataDir: resolve(env.CONSOLE_DATA_DIR ?? join(homedir(), '.dsh-superagent-ui')),
    ...env.CONSOLE_DEV_ORIGIN ? { devOrigin: env.CONSOLE_DEV_ORIGIN } : {},
    mock: env.CONSOLE_MOCK === '1',
    mockPort: int(env.CONSOLE_MOCK_PORT, 3083),
    pollMs: int(env.CONSOLE_POLL_MS, 2000),
    staticDir: resolve(here, '../../console/dist'),
  }
}

/** The address the operator opens: the dev server in development, the BFF otherwise. */
export function consoleUrl(config: Config, token: string): string {
  const base = config.devOrigin ?? `http://127.0.0.1:${config.port}`
  return `${base}/?token=${encodeURIComponent(token)}`
}

/** Both spellings of a loopback dev origin, since the browser sends whichever the operator typed. */
export function devOrigins(config: Config): string[] {
  if (!config.devOrigin) return []
  const url = new URL(config.devOrigin)
  return [`http://127.0.0.1:${url.port}`, `http://localhost:${url.port}`]
}
