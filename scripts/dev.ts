/**
 * Runs the BFF (restarting on change) and the Vite dev server together, with prefixed output.
 * `--mock` points the BFF at its built-in mock dsh-superagent instead of a real one.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const mock = process.argv.includes('--mock')
const dir = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url))
const DEV_ORIGIN = 'http://127.0.0.1:5173'

const processes: [string, string[], string, NodeJS.ProcessEnv][] = [
  ['bff', ['--watch', '--watch-path=src', 'src/index.ts'], dir('apps/bff'), { CONSOLE_DEV_ORIGIN: DEV_ORIGIN, ...mock ? { CONSOLE_MOCK: '1' } : {} }],
  ['web', ['node_modules/vite/bin/vite.js'], dir('apps/console'), {}],
]

const children: ChildProcess[] = processes.map(([name, args, cwd, env]) => {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  const prefix = (chunk: Buffer) => chunk.toString().split('\n').filter(Boolean).map(line => `[${name}] ${line}\n`).join('')
  child.stdout?.on('data', chunk => process.stdout.write(prefix(chunk)))
  child.stderr?.on('data', chunk => process.stderr.write(prefix(chunk)))
  child.on('exit', code => { if (!stopping) { console.error(`[${name}] exited with ${code}`); stop(1) } })
  return child
})

let stopping = false
function stop(code = 0) {
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 500).unref()
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
