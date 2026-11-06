/**
 * Ticket directories: how much disk each one takes and what is in it. Every Ticket has one directory under the execution root;
 * Threads and Tickets are many to many, so a Thread can lead to several directories. Everything here only reads, except that
 * `revealEntry` asks Finder to show a path. A path from the console never leaves its directory, symbolic links included.
 */
import { execFile } from 'node:child_process'
import { lstat, readdir, realpath, statfs } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import type { Connection, DirectoriesView, DirectoryEntry, DirectoryFilesView, DirectoryItem } from '@dsh-superagent-ui/contract'
import { MEASURED_DEPTH, measure, type DiskUsage } from '../disk.ts'
import type { UpstreamClient } from '../upstream/client.ts'
import type { TicketRow } from '../upstream/types.ts'
import { DraftError } from './policy.ts'
import { ticketCard } from './tickets.ts'

/** An open Ticket's directory keeps changing; an ended one's changes only when a message resumes it, which updates the Ticket. */
const OPEN_MAX_AGE_MS = 5 * 60_000
const DEEP_FOLDER_TIMEOUT_MS = 15_000
/** How many entries of one folder are looked at and how many of the largest are listed. */
const EXAMINED = 5000
const LISTED = 500
const PAGE = 100

type Upstream = Pick<UpstreamClient, 'settings' | 'tickets'>
export const canReveal = process.platform === 'darwin'

async function allTickets(upstream: Pick<UpstreamClient, 'tickets'>): Promise<TicketRow[]> {
  const rows: TicketRow[] = []
  for (const state of ['open', 'ended'] as const) {
    let offset: number | null = 0
    while (offset !== null) {
      const page: Awaited<ReturnType<UpstreamClient['tickets']>> = await upstream.tickets(state, PAGE, offset)
      rows.push(...page.items)
      offset = page.next_offset
    }
  }
  return rows
}

const isDirectory = (path: string) => lstat(path).then(stat => stat.isDirectory(), () => false)
function foldersIn(root: string): Promise<string[]> {
  return readdir(root, { withFileTypes: true }).then(entries => entries.filter(entry => entry.isDirectory()).map(entry => entry.name), () => [])
}

function ticketOf(row: TicketRow): DirectoryItem['ticket'] {
  const { stage, action, outcome } = ticketCard(row)
  return { id: row.id, title: row.title, stage, ...action ? { action } : {}, ...outcome ? { outcome } : {}, threads: row.threads.length, updatedAt: row.updatedAt }
}

function stale(disk: DiskUsage, path: string, row: TicketRow | undefined, now: number): boolean {
  const known = disk.get(path)
  if (!known) return true
  if (!row) return false
  return Date.parse(row.updatedAt) > known.at || (row.state === 'open' && now - known.at > OPEN_MAX_AGE_MS)
}

export async function buildDirectories(upstream: Upstream, disk: DiskUsage, connection: () => Connection, now = Date.now()): Promise<DirectoriesView> {
  const [settings, rows] = await Promise.all([upstream.settings(), allTickets(upstream)])
  const root = settings.environment?.root ?? ''
  const owned = rows.filter(row => row.directory)
  const claimed = new Set(owned.map(row => row.directory))
  const loose = root ? (await foldersIn(root)).filter(name => !claimed.has(join(root, name))) : []
  const item = async (key: string, path: string, row?: TicketRow): Promise<DirectoryItem> => {
    const exists = await isDirectory(path)
    if (exists && stale(disk, path, row, now)) disk.request(path)
    const known = disk.get(path)
    return { key, name: basename(path), path, exists, size: exists ? known?.size ?? null : null, measuring: exists && disk.busy(path),
      ...known ? { measuredAt: new Date(known.at).toISOString() } : {}, ticket: row ? ticketOf(row) : null }
  }
  const items = await Promise.all([...owned.map(row => item(row.id, row.directory!, row)), ...loose.map(name => item(name, join(root, name)))])
  // The largest first; what has no size yet follows, and directories that are gone come last.
  const rank = (entry: DirectoryItem) => entry.exists ? entry.size ?? -1 : -2
  items.sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name))
  const space = root ? await statfs(root).catch(() => null) : null
  return { connection: connection(), root, disk: space ? { free: space.bavail * space.bsize, total: space.blocks * space.bsize } : null,
    total: items.reduce((sum, entry) => sum + (entry.size ?? 0), 0), measuring: items.some(entry => entry.measuring), canReveal, items }
}

/** The directory a key names: a Ticket's, or a folder under the execution root that no Ticket owns. */
async function locate(upstream: Upstream, key: string): Promise<{ path: string; row?: TicketRow } | undefined> {
  const [settings, rows] = await Promise.all([upstream.settings(), allTickets(upstream)])
  const row = rows.find(item => item.id === key)
  if (row?.directory) return { path: row.directory, row }
  const root = settings.environment?.root
  if (!root || key === '.' || key === '..' || key.includes('/') || key.includes(sep)) return undefined
  const path = join(root, key)
  return await isDirectory(path) ? { path } : undefined
}

/** Resolves a path relative to a directory, following links, and refuses anything that ends up outside it. */
async function inside(directory: string, path: string): Promise<{ real: string; relative: string }> {
  if (isAbsolute(path) || path.split('/').includes('..')) throw new DraftError('路径不对')
  const base = await realpath(directory).catch(() => null)
  if (!base) throw new DraftError('这个目录已经不在了')
  const real = await realpath(join(base, path)).catch(() => null)
  if (!real) throw new DraftError('这个路径已经不在了')
  if (real !== base && !real.startsWith(base + sep)) throw new DraftError('路径不对')
  return { real, relative: relative(base, real).split(sep).join('/') }
}

const KIND = (entry: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }): DirectoryEntry['kind'] =>
  entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'folder' : entry.isFile() ? 'file' : 'other'

export async function directoryFiles(upstream: Upstream, disk: DiskUsage, key: string, path: string, connection: () => Connection): Promise<DirectoryFilesView> {
  const found = await locate(upstream, key)
  if (!found) throw new DraftError('没有这个目录')
  const { real, relative: at } = await inside(found.path, path)
  if (!(await lstat(real)).isDirectory()) throw new DraftError('这不是文件夹')
  if (!disk.get(found.path)) disk.request(found.path)
  const known = disk.get(found.path)
  const depth = at ? at.split('/').length : 0
  // Folders within the measured depth come from the measurement; deeper ones are measured now, which is quick because they hold
  // little, and a folder too big to finish in time just shows no size.
  const measured = depth < MEASURED_DEPTH ? known?.folders : known ? (await measure(real, 1, DEEP_FOLDER_TIMEOUT_MS)).folders : undefined
  const sizeOf = (name: string) => measured?.get(depth < MEASURED_DEPTH ? (at ? `${at}/${name}` : name) : name) ?? null
  const names = await readdir(real, { withFileTypes: true })
  const examined = names.slice(0, EXAMINED)
  const entries = await inBatches(examined, async (entry): Promise<DirectoryEntry | null> => {
    const stat = await lstat(join(real, entry.name)).catch(() => null)
    if (!stat) return null
    const kind = KIND(entry)
    return { name: entry.name, kind, size: kind === 'folder' ? sizeOf(entry.name) : stat.blocks * 512, modifiedAt: stat.mtime.toISOString() }
  })
  const present = entries.filter((entry): entry is DirectoryEntry => !!entry)
  present.sort((a, b) => (b.size ?? -1) - (a.size ?? -1) || a.name.localeCompare(b.name))
  return { connection: connection(), key, name: basename(found.path), path: real, relative: at, ticket: found.row ? ticketOf(found.row) : null,
    size: known ? (at ? known.folders.get(at) ?? null : known.size) : null, measuring: disk.busy(found.path),
    entries: present.slice(0, LISTED), omitted: names.length - Math.min(present.length, LISTED), canReveal }
}

async function inBatches<T, R>(items: T[], work: (item: T) => Promise<R>, size = 64): Promise<R[]> {
  const results: R[] = []
  for (let index = 0; index < items.length; index += size) results.push(...await Promise.all(items.slice(index, index + size).map(work)))
  return results
}

/** Shows a path in Finder. `-R` selects it there and never opens it, so a folder that is really an app does not launch. */
export function revealInFinder(path: string): Promise<void> {
  return new Promise((resolve, reject) => { execFile('open', ['-R', path], error => { if (error) reject(error); else resolve() }) })
}

export async function revealEntry(upstream: Upstream, key: string, path: string, reveal: (path: string) => Promise<void>): Promise<void> {
  if (!canReveal) throw new DraftError('只有 macOS 上能在访达中显示')
  const found = await locate(upstream, key)
  if (!found) throw new DraftError('没有这个目录')
  await reveal((await inside(found.path, path)).real)
}
