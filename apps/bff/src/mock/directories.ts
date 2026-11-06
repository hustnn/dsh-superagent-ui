/**
 * Ticket directories for the mock: real folders in a temporary directory, so development and tests measure and list real files.
 * A queued Ticket has none yet, one folder belongs to no Ticket, and one directory holds a link pointing outside it.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MockWorld } from './superagent.ts'

const KB = 1024

export async function seedDirectories(world: MockWorld): Promise<{ remove: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-superagent-ui-mock-'))
  world.directories = root
  let index = 0
  for (const ticket of world.tickets) {
    const directory = join(root, ticket.id)
    ticket.directory = directory
    if (!ticket.sessionId) continue
    await mkdir(join(directory, 'src'), { recursive: true })
    await writeFile(join(directory, 'README.md'), `# ${ticket.title}\n`)
    await writeFile(join(directory, 'src', 'index.ts'), 'export {}\n')
    // Sizes differ by Ticket, so the page has a clear largest.
    await mkdir(join(directory, 'output'), { recursive: true })
    await writeFile(join(directory, 'output', 'data.bin'), Buffer.alloc((index + 1) * 64 * KB, 'x'))
    index++
  }
  const first = world.tickets.find(ticket => ticket.sessionId)
  if (first) {
    await mkdir(join(first.directory!, 'a', 'b', 'c', 'd', 'e'), { recursive: true })
    await writeFile(join(first.directory!, 'a', 'b', 'c', 'd', 'e', 'deep.txt'), Buffer.alloc(32 * KB, 'x'))
    await symlink(tmpdir(), join(first.directory!, 'link-out'))
  }
  await mkdir(join(root, 'old-experiment'), { recursive: true })
  await writeFile(join(root, 'old-experiment', 'notes.txt'), Buffer.alloc(16 * KB, 'x'))
  return { remove: () => rm(root, { recursive: true, force: true }) }
}
