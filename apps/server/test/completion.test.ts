import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb } from '../src/db/index.js'
import { git } from '../src/git.js'
import { completeRun } from '../src/runs/completion.js'
import { branchFor, buildRunDir } from '../src/runs/runDir.js'
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
  return { manager, wsId, origin }
}

describe('completeRun', () => {
  beforeEach(() => {
    isolateXdg()
  })

  test('pushes a ticket branch with commits ahead of default and reports it', async () => {
    const { manager, wsId, origin } = await setup()
    const ticketId = 1
    const runDir = await buildRunDir(manager, wsId, ticketId, 1)
    const repoWt = runDir.repoDirs.proj
    if (!repoWt) throw new Error('missing repo worktree')

    writeFileSync(join(repoWt, 'change.txt'), 'work\n')
    await git(repoWt, 'add', '.')
    await git(repoWt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'do the work')

    const result = await completeRun(manager, wsId, ticketId, { pr: false })

    expect(result).toEqual({
      pushedRepos: ['proj'],
      prUrls: [],
      diffAdditions: 1,
      diffDeletions: 0,
    })

    const branches = await git(origin, 'branch', '--list', branchFor(ticketId))
    expect(branches).toContain(branchFor(ticketId))
  })

  test('no commits beyond base: nothing pushed, diffstat null', async () => {
    const { manager, wsId } = await setup()
    const ticketId = 2
    await buildRunDir(manager, wsId, ticketId, 1)

    const result = await completeRun(manager, wsId, ticketId, { pr: false })

    expect(result).toEqual({
      pushedRepos: [],
      prUrls: [],
      diffAdditions: null,
      diffDeletions: null,
    })
  })

  test('diffstat: known diff yields exact additions/deletions', async () => {
    const { manager, wsId } = await setup()
    const ticketId = 3
    const runDir = await buildRunDir(manager, wsId, ticketId, 1)
    const repoWt = runDir.repoDirs.proj
    if (!repoWt) throw new Error('missing repo worktree')

    writeFileSync(join(repoWt, 'change.txt'), 'line1\nline2\nline3\n')
    await git(repoWt, 'add', '.')
    await git(repoWt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'add lines')

    const result = await completeRun(manager, wsId, ticketId, { pr: false })

    expect(result.diffAdditions).toBe(3)
    expect(result.diffDeletions).toBe(0)
  })

  test('diffstat: deletions-only diff yields additions 0, not null', async () => {
    const { manager, wsId } = await setup()
    const ticketId = 4
    const runDir = await buildRunDir(manager, wsId, ticketId, 1)
    const repoWt = runDir.repoDirs.proj
    if (!repoWt) throw new Error('missing repo worktree')

    rmSync(join(repoWt, 'README.md'))
    await git(repoWt, 'add', '.')
    await git(repoWt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'remove readme')

    const result = await completeRun(manager, wsId, ticketId, { pr: false })

    expect(result.diffAdditions).toBe(0)
    expect(result.diffDeletions).toBe(1)
  })

  test('diffstat: sums across multiple repos', async () => {
    const { manager, wsId, origin } = await setup()
    const origin2 = await makeOrigin('proj2')
    await manager.addRepoSource(wsId, origin2)

    const ticketId = 5
    const runDir = await buildRunDir(manager, wsId, ticketId, 1)
    const wt1 = runDir.repoDirs.proj
    const wt2 = runDir.repoDirs.proj2
    if (!wt1 || !wt2) throw new Error('missing repo worktree')

    writeFileSync(join(wt1, 'a.txt'), 'x\ny\ny\n')
    await git(wt1, 'add', '.')
    await git(wt1, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'repo1 work')

    writeFileSync(join(wt2, 'b.txt'), 'x\ny\n')
    await git(wt2, 'add', '.')
    await git(wt2, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'repo2 work')

    const result = await completeRun(manager, wsId, ticketId, { pr: false })

    expect(result.pushedRepos.sort()).toEqual(['proj', 'proj2'])
    expect(result.diffAdditions).toBe(5)
    expect(result.diffDeletions).toBe(0)

    const branches = await git(origin, 'branch', '--list', branchFor(ticketId))
    expect(branches).toContain(branchFor(ticketId))
  })

  test('diffstat: exec failure (missing tree object) -> nulls, journaled, push still attempted', async () => {
    const { manager, wsId } = await setup()
    const ticketId = 6
    const runDir = await buildRunDir(manager, wsId, ticketId, 1)
    const repoWt = runDir.repoDirs.proj
    if (!repoWt) throw new Error('missing repo worktree')

    writeFileSync(join(repoWt, 'change.txt'), 'work\n')
    await git(repoWt, 'add', '.')
    await git(repoWt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'do the work')

    // Corrupt the branch's tree object so `git diff` fails to read it, while `rev-list --count`
    // (which only walks commit objects) still succeeds — this simulates a diffstat-specific
    // exec failure without breaking the push/PR detection logic above it.
    const canonical = join(manager.reposDir(wsId), 'proj')
    const branch = branchFor(ticketId)
    const tree = await git(canonical, 'rev-parse', `${branch}^{tree}`)
    const objFile = join(canonical, '.git', 'objects', tree.slice(0, 2), tree.slice(2))
    rmSync(objFile)

    const errors: string[] = []
    const result = await completeRun(manager, wsId, ticketId, {
      pr: false,
      onError: (message) => errors.push(message),
    })

    expect(result.diffAdditions).toBeNull()
    expect(result.diffDeletions).toBeNull()
    expect(errors.some((m) => m.includes('diffstat failed'))).toBe(true)
  })
})
