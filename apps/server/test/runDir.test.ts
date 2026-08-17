import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { git } from '../src/git.js'
import { runDiff } from '../src/runs/diff.js'
import {
  addWorktree,
  buildRunDir,
  cleanupRunDirs,
  runDirFor,
  runDirPath,
} from '../src/runs/runDir.js'
import { SourceStore } from '../src/sources/store.js'
import { isolateXdg, makeOrigin } from './helpers/gitFixtures.js'

let store: SourceStore

beforeEach(async () => {
  isolateXdg()
  store = new SourceStore()
  await store.addRepo(await makeOrigin('proj'))
})

describe('run dir', () => {
  test('starts with scratch and folder symlinks only — no worktrees until use_repo', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'tada-f-'))
    store.addFolder(folder)
    const dir = buildRunDir(store, 1)
    expect(dir.path).toBe(runDirPath(1))
    expect(existsSync(join(dir.path, 'scratch'))).toBe(true)
    expect(existsSync(join(dir.path, folder.split('/').pop() ?? ''))).toBe(true)
    expect(dir.repoDirs).toEqual({})
    expect(existsSync(join(dir.path, 'proj'))).toBe(false)
  })

  test('addWorktree checks out ticket/<id> off the default branch, reuses the branch on a re-run', async () => {
    const repo = store.repo('proj')
    if (!repo) throw new Error('no repo')
    const dir1 = buildRunDir(store, 1)
    const wt1 = await addWorktree(store, dir1, 9, repo)
    expect(await git(wt1, 'branch', '--show-current')).toBe('ticket/9')
    writeFileSync(join(wt1, 'a.txt'), 'a\n')
    await git(wt1, 'add', '.')
    await git(wt1, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'a')
    // idempotent for the same run
    expect(await addWorktree(store, dir1, 9, repo)).toBe(wt1)
    expect(runDirFor(store, 1).repoDirs).toEqual({ proj: wt1 })

    const diffs = await runDiff(store, dir1, 9, { patch: true })
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({ repo: 'proj', branch: 'ticket/9', additions: 1, deletions: 0 })
    expect(diffs[0]?.files[0]?.patch).toContain('+a')

    // re-run: earlier run dir torn down, branch (and its commit) kept
    await cleanupRunDirs(store, [1])
    expect(existsSync(dir1.path)).toBe(false)
    const dir2 = buildRunDir(store, 2)
    const wt2 = await addWorktree(store, dir2, 9, repo)
    expect(existsSync(join(wt2, 'a.txt'))).toBe(true)
  })

  test('cleanupRunDirs tolerates never-built runs', async () => {
    await expect(cleanupRunDirs(store, [123])).resolves.toBeUndefined()
  })
})
