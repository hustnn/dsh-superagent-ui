import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DirectoriesView, DirectoryFilesView } from '@dsh-superagent-ui/contract'
import { DiskUsage, measure, parseDu } from '../src/disk.ts'
import { harness } from './support.ts'

let h: Awaited<ReturnType<typeof harness>>
afterEach(async () => { await h?.close() })
const json = async <T>(response: Response) => { expect(response.status).toBe(200); return await response.json() as T }

/** The list once its measurements have finished. */
async function measured(): Promise<DirectoriesView> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const view = await json<DirectoriesView>(await h.call('/api/directories'))
    if (!view.measuring) return view
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('still measuring')
}
const files = (key: string, path = '') => h.call(`/api/directories/files?key=${encodeURIComponent(key)}&path=${encodeURIComponent(path)}`)

describe('the list of directories', () => {
  it('shows each Ticket’s directory, the largest first, with how many Threads the Ticket follows', async () => {
    h = await harness()
    const view = await measured()
    const owned = view.items.filter(item => item.ticket && item.exists)
    expect(owned.length).toBeGreaterThan(2)
    const sizes = owned.map(item => item.size!)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    expect(sizes.every(size => size > 0)).toBe(true)
    expect(view.total).toBeGreaterThanOrEqual(sizes.reduce((sum, size) => sum + size, 0))
    expect(view.disk!.total).toBeGreaterThan(0)
    const row = h.mock.world.tickets.find(ticket => ticket.id === owned[0]!.key)!
    expect(owned[0]!.ticket).toMatchObject({ id: row.id, title: row.title, threads: row.threads.length })
    expect(owned[0]).toMatchObject({ key: row.id, path: row.directory })
  })
  it('includes a folder no Ticket owns, and says when a Ticket’s directory is not there', async () => {
    h = await harness()
    const view = await measured()
    expect(view.items.find(item => item.key === 'old-experiment')).toMatchObject({ ticket: null, exists: true })
    const queued = h.mock.world.tickets.find(ticket => !ticket.sessionId)!
    expect(view.items.find(item => item.key === queued.id)).toMatchObject({ exists: false, size: null, measuring: false })
    expect(view.items.at(-1)!.exists).toBe(false)
  })
  it('measures again when asked', async () => {
    h = await harness()
    const before = await measured()
    const item = before.items.find(entry => entry.key === 'old-experiment')!
    await writeFile(join(item.path, 'more.bin'), Buffer.alloc(256 * 1024, 'x'))
    expect((await measured()).items.find(entry => entry.key === 'old-experiment')!.size).toBe(item.size)
    expect((await h.post('/api/directories/rescan')).status).toBe(200)
    expect((await measured()).items.find(entry => entry.key === 'old-experiment')!.size).toBeGreaterThan(item.size!)
    expect(h.audit.recent()[0]).toMatchObject({ action: 'directories.rescan', tier: 'low' })
  })
})

describe('what is in a directory', () => {
  const first = () => h.mock.world.tickets.find(ticket => ticket.sessionId)!
  it('lists a folder’s entries, the largest first, with folder sizes from the measurement', async () => {
    h = await harness()
    await measured()
    const view = await json<DirectoryFilesView>(await files(first().id))
    expect(view).toMatchObject({ key: first().id, relative: '', omitted: 0, ticket: { id: first().id } })
    expect(view.entries.map(entry => entry.name)).toEqual(expect.arrayContaining(['README.md', 'src', 'output', 'a', 'link-out']))
    expect(view.entries.find(entry => entry.name === 'output')).toMatchObject({ kind: 'folder' })
    expect(view.entries.find(entry => entry.name === 'output')!.size).toBeGreaterThan(0)
    expect(view.entries.find(entry => entry.name === 'README.md')).toMatchObject({ kind: 'file' })
    expect(view.entries.find(entry => entry.name === 'link-out')).toMatchObject({ kind: 'link' })
    const sizes = view.entries.map(entry => entry.size ?? -1)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    const output = await json<DirectoryFilesView>(await files(first().id, 'output'))
    expect(output).toMatchObject({ relative: 'output' })
    expect(output.size).toBeGreaterThan(0)
  })
  it('measures folders deeper than the measurement when they are opened', async () => {
    h = await harness()
    await measured()
    const view = await json<DirectoryFilesView>(await files(first().id, 'a/b/c/d'))
    expect(view.relative).toBe('a/b/c/d')
    expect(view.entries.find(entry => entry.name === 'e')!.size).toBeGreaterThan(30 * 1024)
    const deepest = await json<DirectoryFilesView>(await files(first().id, 'a/b/c/d/e'))
    expect(deepest.entries.map(entry => entry.name)).toEqual(['deep.txt'])
  })
  it('lists a folder no Ticket owns', async () => {
    h = await harness()
    expect((await json<DirectoryFilesView>(await files('old-experiment'))).entries.map(entry => entry.name)).toEqual(['notes.txt'])
  })
  it('never leaves the directory', async () => {
    h = await harness()
    for (const path of ['..', '../..', 'a/../..', '/etc', 'link-out', 'link-out/x', 'nothing']) expect((await files(first().id, path)).status, path).toBe(400)
    expect((await files('../..')).status).toBe(400)
    expect((await files('nothing')).status).toBe(400)
    expect((await files(first().id, 'README.md')).status).toBe(400)
    expect((await h.call('/api/directories/files')).status).toBe(400)
  })
})

describe('showing a path in Finder', () => {
  const revealed: string[] = []
  const reveal = async (path: string) => { revealed.push(path) }
  afterEach(() => { revealed.length = 0 })
  const first = () => h.mock.world.tickets.find(ticket => ticket.sessionId)!
  const macOnly = process.platform === 'darwin' ? it : it.skip

  macOnly('shows a path inside the directory, and records it', async () => {
    h = await harness({ reveal })
    expect((await h.post('/api/directories/reveal', { key: first().id, path: 'src/index.ts' })).status).toBe(200)
    expect(revealed).toHaveLength(1)
    expect(revealed[0]!.endsWith(join(first().id, 'src', 'index.ts'))).toBe(true)
    expect(h.audit.recent()[0]).toMatchObject({ action: 'directories.reveal', tier: 'local-only', target: first().id, outcome: 'ok' })
  })
  macOnly('refuses a path that leaves the directory', async () => {
    h = await harness({ reveal })
    for (const path of ['..', '/etc', 'link-out']) expect((await h.post('/api/directories/reveal', { key: first().id, path })).status, path).toBe(400)
    expect(revealed).toEqual([])
  })
  it('is refused by an access mode that refuses local-only', async () => {
    h = await harness({ reveal, access: { name: 'local', authorize: tier => tier === 'local-only' ? { ok: false, reason: 'not here' } : { ok: true } } })
    expect((await h.post('/api/directories/reveal', { key: first().id })).status).toBe(403)
    expect(revealed).toEqual([])
  })
})

describe('measuring', () => {
  it('reads du’s records, including a folder whose name holds a line break', () => {
    const output = '8\t/w/a\n4\t/w/line\nbreak\n20\t/w\n'
    const { size, folders } = parseDu(output, '/w')
    expect(size).toBe(20 * 1024)
    expect([...folders]).toEqual([['a', 8 * 1024], ['line\nbreak', 4 * 1024]])
  })
  it('measures real folders down to the given depth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'disk-spec-'))
    try {
      await mkdir(join(root, 'a', 'b'), { recursive: true })
      await writeFile(join(root, 'a', 'b', 'file'), Buffer.alloc(64 * 1024, 'x'))
      const shallow = await measure(root, 1)
      expect(shallow.size).toBeGreaterThanOrEqual(64 * 1024)
      expect([...shallow.folders.keys()]).toEqual(['a'])
      expect([...(await measure(root, 2)).folders.keys()].sort()).toEqual(['a', 'a/b'])
      expect((await measure(join(root, 'missing'), 1)).size).toBeNull()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('runs a measurement once however often it is asked for, and at most two at a time', async () => {
    const started: string[] = []
    const finish: (() => void)[] = []
    const disk = new DiskUsage(directory => new Promise(resolve => {
      started.push(directory)
      finish.push(() => resolve({ size: 1, folders: new Map(), at: Date.now() }))
    }))
    for (const directory of ['a', 'a', 'b', 'c']) disk.request(directory)
    expect(started).toEqual(['a', 'b'])
    expect(disk.busy('c')).toBe(true)
    finish[0]!()
    await new Promise(resolve => setTimeout(resolve))
    expect(started).toEqual(['a', 'b', 'c'])
    expect(disk.get('a')?.size).toBe(1)
    expect(disk.busy('a')).toBe(false)
    disk.forget()
    expect(disk.get('a')).toBeUndefined()
  })
  it('records a failed measurement instead of trying again on every look', async () => {
    const disk = new DiskUsage(() => Promise.reject(new Error('no')))
    disk.request('a')
    await new Promise(resolve => setTimeout(resolve))
    expect(disk.get('a')).toMatchObject({ size: null })
    expect(disk.busy('a')).toBe(false)
  })
})
