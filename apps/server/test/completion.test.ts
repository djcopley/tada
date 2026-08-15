import { mkdtempSync, writeFileSync } from 'node:fs'
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

    expect(result).toEqual({ pushedRepos: ['proj'], prUrls: [] })

    const branches = await git(origin, 'branch', '--list', branchFor(ticketId))
    expect(branches).toContain(branchFor(ticketId))
  })

  test('no commits beyond base: nothing pushed', async () => {
    const { manager, wsId } = await setup()
    const ticketId = 2
    await buildRunDir(manager, wsId, ticketId, 1)

    const result = await completeRun(manager, wsId, ticketId, { pr: false })

    expect(result).toEqual({ pushedRepos: [], prUrls: [] })
  })
})
