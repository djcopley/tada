import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb } from '../src/db/index.js'
import { dataDir } from '../src/paths.js'
import { WorkspaceManager } from '../src/workspaces/manager.js'
import { isolateXdg, makeOrigin } from './helpers/gitFixtures.js'

function testDb() {
  return openDb(join(mkdtempSync(join(tmpdir(), 'tada-db-')), 'test.db'))
}

describe('WorkspaceManager', () => {
  beforeEach(() => {
    isolateXdg()
  })

  test('create makes workspace dirs, empty manifest, and AGENTS.md stub', async () => {
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const id = await manager.create('demo')

    const wsDir = join(dataDir(), 'workspaces', 'demo')
    expect(existsSync(join(wsDir, 'repos'))).toBe(true)
    expect(existsSync(join(wsDir, 'memory', 'notes'))).toBe(true)

    const manifestPath = join(wsDir, 'manifest.json')
    expect(existsSync(manifestPath)).toBe(true)
    expect(JSON.parse(readFileSync(manifestPath, 'utf-8'))).toEqual({ sources: [] })

    const agentsPath = join(wsDir, 'memory', 'AGENTS.md')
    expect(existsSync(agentsPath)).toBe(true)
    expect(readFileSync(agentsPath, 'utf-8')).toBe(
      '# demo\n\nWorkspace charter. Conventions, goals, and gotchas agents should know.\n',
    )

    expect(manager.manifest(id)).toEqual({ sources: [] })
  })

  test('addRepoSource clones into repos/<name> and records a repo source in the manifest', async () => {
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const id = await manager.create('demo')
    const origin = await makeOrigin('proj')

    await manager.addRepoSource(id, origin)

    const cloneDir = join(manager.reposDir(id), 'proj')
    expect(existsSync(join(cloneDir, 'README.md'))).toBe(true)

    const manifest = manager.manifest(id)
    expect(manifest.sources).toEqual([
      { type: 'repo', name: 'proj', url: origin, defaultBranch: 'main' },
    ])
    expect(manager.listSources(id)).toEqual([
      { type: 'repo', name: 'proj', url: origin, defaultBranch: 'main' },
    ])
  })

  test('removeSource on a repo source deletes the clone dir and updates the manifest', async () => {
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const id = await manager.create('demo')
    const origin = await makeOrigin('proj')
    await manager.addRepoSource(id, origin)

    await manager.removeSource(id, 'proj')

    const cloneDir = join(manager.reposDir(id), 'proj')
    expect(existsSync(cloneDir)).toBe(false)
    expect(manager.manifest(id)).toEqual({ sources: [] })
  })

  test('addFolderSource records a folder source named after the basename', async () => {
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const id = await manager.create('demo')

    const folder = mkdtempSync(join(tmpdir(), 'tada-folder-'))
    const target = join(folder, 'notes')
    mkdirSync(target)

    await manager.addFolderSource(id, target)

    expect(manager.manifest(id).sources).toEqual([{ type: 'folder', name: 'notes', path: target }])
    expect(manager.listSources(id)).toEqual([{ type: 'folder', name: 'notes', path: target }])
  })

  test('addFolderSource rejects a relative path', async () => {
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const id = await manager.create('demo')

    await expect(manager.addFolderSource(id, 'relative/dir')).rejects.toThrow(/absolute/i)
    expect(manager.manifest(id).sources).toEqual([])
  })

  test('addFolderSource rejects a missing path', async () => {
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const id = await manager.create('demo')

    const missing = join(mkdtempSync(join(tmpdir(), 'tada-folder-')), 'does-not-exist')
    await expect(manager.addFolderSource(id, missing)).rejects.toThrow(/directory/i)
    expect(manager.manifest(id).sources).toEqual([])
  })

  test('removeSource on a folder source removes it from the manifest without touching the folder', async () => {
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const id = await manager.create('demo')
    const folder = mkdtempSync(join(tmpdir(), 'tada-folder-'))
    await manager.addFolderSource(id, folder)
    const name = manager.manifest(id).sources[0]?.name
    if (!name) throw new Error('expected a folder source')

    await manager.removeSource(id, name)

    expect(manager.manifest(id).sources).toEqual([])
    expect(existsSync(folder)).toBe(true)
  })

  test('knownRepos returns the union of repo sources across workspaces, deduped by url', async () => {
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const wsA = await manager.create('ws-a')
    const wsB = await manager.create('ws-b')
    const shared = await makeOrigin('shared')
    const onlyA = await makeOrigin('only-a')

    await manager.addRepoSource(wsA, shared)
    await manager.addRepoSource(wsA, onlyA)
    await manager.addRepoSource(wsB, shared)

    const known = manager.knownRepos()
    expect(known).toHaveLength(2)
    expect(known).toEqual(
      expect.arrayContaining([
        { url: shared, name: 'shared' },
        { url: onlyA, name: 'only-a' },
      ]),
    )
  })

  test('paths honor the TADA_DATA_DIR override', async () => {
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const id = await manager.create('demo')
    expect(manager.reposDir(id)).toBe(join(dataDir(), 'workspaces', 'demo', 'repos'))
  })

  test('create rejects a path-traversal name', async () => {
    const db = testDb()
    const manager = new WorkspaceManager(db)
    await expect(manager.create('../evil')).rejects.toThrow(/invalid/i)
    expect(existsSync(join(dataDir(), 'workspaces', 'evil'))).toBe(false)
  })

  test('removeSource rejects a path-traversal name', async () => {
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const id = await manager.create('demo')
    const origin = await makeOrigin('proj')
    await manager.addRepoSource(id, origin)

    await expect(manager.removeSource(id, '../evil')).rejects.toThrow(/invalid/i)
    expect(existsSync(join(manager.reposDir(id), 'proj'))).toBe(true)
  })
})
