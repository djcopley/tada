import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
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
    expect(JSON.parse(readFileSync(manifestPath, 'utf-8'))).toEqual({ repos: [] })

    const agentsPath = join(wsDir, 'memory', 'AGENTS.md')
    expect(existsSync(agentsPath)).toBe(true)
    expect(readFileSync(agentsPath, 'utf-8')).toBe(
      '# demo\n\nWorkspace charter. Conventions, goals, and gotchas agents should know.\n',
    )

    expect(manager.manifest(id)).toEqual({ repos: [] })
  })

  test('addRepo clones into repos/<name> and records it in the manifest', async () => {
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const id = await manager.create('demo')
    const origin = await makeOrigin('proj')

    await manager.addRepo(id, origin)

    const cloneDir = join(manager.reposDir(id), 'proj')
    expect(existsSync(join(cloneDir, 'README.md'))).toBe(true)

    const manifest = manager.manifest(id)
    expect(manifest.repos).toEqual([{ name: 'proj', url: origin, defaultBranch: 'main' }])
  })

  test('removeRepo deletes the clone dir and updates the manifest', async () => {
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const id = await manager.create('demo')
    const origin = await makeOrigin('proj')
    await manager.addRepo(id, origin)

    await manager.removeRepo(id, 'proj')

    const cloneDir = join(manager.reposDir(id), 'proj')
    expect(existsSync(cloneDir)).toBe(false)
    expect(manager.manifest(id)).toEqual({ repos: [] })
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

  test('removeRepo rejects a path-traversal name', async () => {
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const id = await manager.create('demo')
    const origin = await makeOrigin('proj')
    await manager.addRepo(id, origin)

    await expect(manager.removeRepo(id, '../evil')).rejects.toThrow(/invalid/i)
    expect(existsSync(join(manager.reposDir(id), 'proj'))).toBe(true)
  })
})
