import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb } from '../src/db/index.js'
import { git } from '../src/git.js'
import { branchFor, buildRunDir, cleanupRunDir } from '../src/runs/runDir.js'
import { WorkspaceManager } from '../src/workspaces/manager.js'
import { isolateXdg, makeOrigin } from './helpers/gitFixtures.js'

function testDb() {
  return openDb(join(mkdtempSync(join(tmpdir(), 'tada-db-')), 'test.db'))
}

async function setup() {
  isolateXdg()
  const db = testDb()
  const manager = new WorkspaceManager(db)
  const wsId = await manager.create('demo')
  const origin = await makeOrigin('proj')
  await manager.addRepoSource(wsId, origin)
  return { manager, wsId }
}

describe('buildRunDir / cleanupRunDir', () => {
  beforeEach(() => {
    isolateXdg()
  })

  test('creates a worktree per repo on branch ticket/<id>, a memory symlink, and an empty scratch dir', async () => {
    const { manager, wsId } = await setup()

    const runDir = await buildRunDir(manager, wsId, 42, 1)

    const repoWt = runDir.repoDirs.proj
    expect(repoWt).toBeDefined()
    expect(existsSync(join(repoWt ?? '', 'README.md'))).toBe(true)
    expect(await git(repoWt ?? '', 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(branchFor(42))

    expect(existsSync(join(runDir.path, 'scratch'))).toBe(true)

    const memoryLink = join(runDir.path, 'memory')
    expect(realpathSync(memoryLink)).toBe(realpathSync(manager.memoryDir(wsId)))
    expect(readlinkSync(memoryLink)).toBe(manager.memoryDir(wsId))
  })

  test('symlinks a folder source into the run dir by name', async () => {
    const { manager, wsId } = await setup()
    const folder = mkdtempSync(join(tmpdir(), 'tada-folder-'))
    mkdirSync(join(folder, 'sub'))
    writeFileSync(join(folder, 'notes.txt'), 'hello\n')
    await manager.addFolderSource(wsId, folder)

    const runDir = await buildRunDir(manager, wsId, 5, 1)

    const link = join(runDir.path, basename(folder))
    expect(realpathSync(link)).toBe(realpathSync(folder))
    expect(readlinkSync(link)).toBe(folder)
    expect(existsSync(join(link, 'notes.txt'))).toBe(true)
  })

  test('a commit made in the worktree is visible from the canonical clone (shared object store)', async () => {
    const { manager, wsId } = await setup()
    const runDir = await buildRunDir(manager, wsId, 7, 1)
    const repoWt = runDir.repoDirs.proj
    if (!repoWt) throw new Error('missing repo worktree')

    writeFileSync(join(repoWt, 'new-file.txt'), 'hello\n')
    await git(repoWt, 'add', '.')
    await git(repoWt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'add new file')

    const canonical = join(manager.reposDir(wsId), 'proj')
    const log = await git(canonical, 'log', branchFor(7), '--oneline')
    expect(log).toContain('add new file')
  })

  test('a second buildRunDir for the same ticket reuses the existing branch, including its commit', async () => {
    const { manager, wsId } = await setup()
    const first = await buildRunDir(manager, wsId, 9, 1)
    const firstWt = first.repoDirs.proj
    if (!firstWt) throw new Error('missing repo worktree')

    writeFileSync(join(firstWt, 'send-back.txt'), 'again\n')
    await git(firstWt, 'add', '.')
    await git(
      firstWt,
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      'commit',
      '-m',
      'send-back commit',
    )
    await cleanupRunDir(manager, wsId, first)

    const second = await buildRunDir(manager, wsId, 9, 2)
    const secondWt = second.repoDirs.proj
    if (!secondWt) throw new Error('missing repo worktree')

    expect(existsSync(join(secondWt, 'send-back.txt'))).toBe(true)
    expect(await git(secondWt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(branchFor(9))
  })

  test('cleanupRunDir removes worktrees but the branch survives', async () => {
    const { manager, wsId } = await setup()
    const runDir = await buildRunDir(manager, wsId, 3, 1)
    const canonical = join(manager.reposDir(wsId), 'proj')

    await cleanupRunDir(manager, wsId, runDir)

    const worktreeList = await git(canonical, 'worktree', 'list')
    expect(worktreeList).not.toContain(runDir.repoDirs.proj ?? '<<missing>>')

    const branches = await git(canonical, 'branch', '--list', branchFor(3))
    expect(branches).toContain(branchFor(3))

    expect(existsSync(runDir.path)).toBe(false)
  })
})
