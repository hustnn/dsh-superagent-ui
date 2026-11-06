/**
 * How much disk the Ticket directories take. One directory can hold hundreds of thousands of files and take `du` half a minute,
 * so sizes are measured in the background, a few at a time, and kept until someone asks again. `du` rather than a walk in Node:
 * it counts what the disk really holds, the same number a person gets by hand, and its work stays off the BFF's event loop.
 */
import { execFile } from 'node:child_process'

/** How deep a measurement remembers folders; opening a deeper one measures it then. `du` walks the whole tree either way. */
export const MEASURED_DEPTH = 4
const SCAN_TIMEOUT_MS = 10 * 60_000
const CONCURRENT = 2

export interface Measurement {
  /** Bytes the directory takes; null when `du` could not tell. */
  size: number | null
  /** Bytes each folder within the measured depth takes, by its path relative to the directory. */
  folders: Map<string, number>
  at: number
}

/** Reads `du -k`: one `<KiB>\t<path>` record per folder, where a path may itself hold a line break. */
export function parseDu(output: string, directory: string): Pick<Measurement, 'size' | 'folders'> {
  const records: [number, string][] = []
  for (const line of output.split('\n')) {
    const match = /^(\d+)\t(.*)$/.exec(line)
    if (match) records.push([Number(match[1]) * 1024, match[2]!])
    else if (line && records.length) records[records.length - 1]![1] += `\n${line}`
  }
  const folders = new Map<string, number>()
  let size: number | null = null
  for (const [bytes, path] of records) {
    if (path === directory) size = bytes
    else if (path.startsWith(`${directory}/`)) folders.set(path.slice(directory.length + 1), bytes)
  }
  return { size, folders }
}

/** Measures one directory. `du` exits non-zero when it cannot read a subfolder, and what it did read still counts. */
export function measure(directory: string, depth: number, timeoutMs = SCAN_TIMEOUT_MS): Promise<Measurement> {
  return new Promise(resolve => {
    execFile('du', ['-k', '-d', String(depth), directory], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (_error, stdout) => {
      resolve({ ...parseDu(stdout, directory), at: Date.now() })
    })
  })
}

export class DiskUsage {
  readonly #measured = new Map<string, Measurement>()
  readonly #waiting: string[] = []
  readonly #running = new Set<string>()
  readonly #measure: (directory: string) => Promise<Measurement>
  constructor(measureDirectory: (directory: string) => Promise<Measurement> = directory => measure(directory, MEASURED_DEPTH)) {
    this.#measure = measureDirectory
  }

  get(directory: string): Measurement | undefined { return this.#measured.get(directory) }
  busy(directory: string): boolean { return this.#running.has(directory) || this.#waiting.includes(directory) }
  /** Queues a measurement, unless one is already coming. */
  request(directory: string): void {
    if (this.busy(directory)) return
    this.#waiting.push(directory)
    this.#next()
  }
  /** Drops what was measured, so the next look measures again. */
  forget(): void { this.#measured.clear() }

  #next(): void {
    while (this.#running.size < CONCURRENT && this.#waiting.length) {
      const directory = this.#waiting.shift()!
      this.#running.add(directory)
      void this.#measure(directory)
        .then(result => this.#measured.set(directory, result), () => this.#measured.set(directory, { size: null, folders: new Map(), at: Date.now() }))
        .finally(() => { this.#running.delete(directory); this.#next() })
    }
  }
}
