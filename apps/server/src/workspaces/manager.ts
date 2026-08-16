import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import type { ApiKnownRepo, ApiSource } from '@tada/shared'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { TadaDb } from '../db/index.js'
import { workspaces } from '../db/schema.js'
import { git } from '../git.js'
import { dataDir } from '../paths.js'

export interface RepoSource {
  type: 'repo'
  name: string
  url: string
  defaultBranch: string
}

export interface FolderSource {
  type: 'folder'
  name: string
  path: string
}

export type Source = RepoSource | FolderSource

export interface Manifest {
  sources: Source[]
}

const repoSourceSchema = z.object({
  type: z.literal('repo'),
  name: z.string(),
  url: z.string(),
  defaultBranch: z.string(),
})

const folderSourceSchema = z.object({
  type: z.literal('folder'),
  name: z.string(),
  path: z.string(),
})

const sourceSchema = z.discriminatedUnion('type', [repoSourceSchema, folderSourceSchema])

const manifestSchema = z.object({
  sources: z.array(sourceSchema),
})

/** repo name = basename of the clone URL, minus a trailing `.git` */
function repoNameFromUrl(url: string): string {
  const base = basename(url)
  return base.endsWith('.git') ? base.slice(0, -'.git'.length) : base
}

/** basename-only: rejects any name containing '/' (or a resolved-away '..') outright, so a
 * caller can never make a dataDir-joined path escape its intended directory. */
function assertSafeName(name: string, what: string): void {
  if (name !== basename(name) || name === '' || name === '.' || name === '..') {
    throw new Error(`invalid ${what}: ${name}`)
  }
}

/** Thrown when adding a source whose name is already used by another source in the workspace. */
export class SourceExistsError extends Error {
  constructor(name: string) {
    super(`a source named "${name}" already exists in this workspace`)
    this.name = 'SourceExistsError'
  }
}

/** Thrown by `create` when the name is already taken (db row or on-disk directory). */
export class WorkspaceExistsError extends Error {
  constructor(name: string) {
    super(`workspace already exists: ${name}`)
    this.name = 'WorkspaceExistsError'
  }
}

export class WorkspaceManager {
  constructor(private readonly db: TadaDb) {}

  async create(name: string): Promise<number> {
    assertSafeName(name, 'workspace name')
    const path = join(dataDir(), 'workspaces', name)

    // Checked up front so a duplicate never gets as far as touching disk: the manifest/AGENTS.md
    // writes below would otherwise wipe the existing workspace before the unique-name insert
    // failed.
    // Case-insensitive on purpose: the workspace directory may sit on a case-insensitive
    // filesystem (macOS), where `Parlor` and `parlor` would be the same folder.
    const taken = this.db.drizzle
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(sql`lower(${workspaces.name}) = lower(${name})`)
      .get()
    if (taken || existsSync(path)) throw new WorkspaceExistsError(name)

    mkdirSync(join(path, 'repos'), { recursive: true })
    mkdirSync(join(path, 'memory', 'notes'), { recursive: true })

    this.writeManifest(path, { sources: [] })
    writeFileSync(
      join(path, 'memory', 'AGENTS.md'),
      `# ${name}\n\nWorkspace charter. Conventions, goals, and gotchas agents should know.\n`,
    )

    const [row] = this.db.drizzle.insert(workspaces).values({ name, path }).returning().all()
    if (!row) throw new Error(`failed to insert workspace row for ${name}`)
    return row.id
  }

  async addRepoSource(wsId: number, url: string): Promise<void> {
    const path = this.pathFor(wsId)
    const name = repoNameFromUrl(url)
    assertSafeName(name, 'repo source name')
    const cloneDir = join(path, 'repos', name)

    const manifest = this.readManifest(path)
    this.assertSourceNameFree(manifest, name)

    // `--` so a URL starting with '-' can't be read as a git option.
    await git(path, 'clone', '--', url, cloneDir)
    const defaultBranch = await git(cloneDir, 'symbolic-ref', '--short', 'HEAD')

    // Re-read: the clone took a while and another add could have landed meanwhile.
    const fresh = this.readManifest(path)
    fresh.sources.push({ type: 'repo', name, url, defaultBranch })
    this.writeManifest(path, fresh)
  }

  /** name = basename of the folder path. Rejects non-absolute or missing/non-directory paths. */
  async addFolderSource(wsId: number, folderPath: string): Promise<void> {
    if (!isAbsolute(folderPath)) {
      throw new Error(`invalid folder path (must be absolute): ${folderPath}`)
    }
    if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
      throw new Error(`invalid folder path (must be an existing directory): ${folderPath}`)
    }

    const name = basename(folderPath)
    assertSafeName(name, 'folder source name')

    const path = this.pathFor(wsId)
    const manifest = this.readManifest(path)
    this.assertSourceNameFree(manifest, name)
    manifest.sources.push({ type: 'folder', name, path: folderPath })
    this.writeManifest(path, manifest)
  }

  /** Source names are unique per workspace regardless of type: they become sibling entries in
   * a run dir (repos/<name>, folder symlink <name>), and removal is by name. */
  private assertSourceNameFree(manifest: Manifest, name: string): void {
    if (manifest.sources.some((s) => s.name === name)) {
      throw new SourceExistsError(name)
    }
  }

  /** Removes a source of either type by name. Repo sources also have their clone dir deleted;
   * folder sources are just detached from the manifest (the folder itself is server-external and
   * not owned by tada). */
  async removeSource(wsId: number, name: string): Promise<boolean> {
    assertSafeName(name, 'source name')
    const path = this.pathFor(wsId)
    const manifest = this.readManifest(path)
    const source = manifest.sources.find((s) => s.name === name)
    if (!source) return false
    if (source.type === 'repo') {
      rmSync(join(path, 'repos', name), { recursive: true, force: true })
    }

    manifest.sources = manifest.sources.filter((s) => s !== source)
    this.writeManifest(path, manifest)
    return true
  }

  listSources(wsId: number): ApiSource[] {
    return this.manifest(wsId).sources.map((s) => ({ ...s }))
  }

  /** Union of repo sources across all workspaces, deduped by url (first workspace wins the
   * display name for a given url). Feeds the new-workspace "attach repos" checkboxes. */
  knownRepos(): ApiKnownRepo[] {
    const rows = this.db.drizzle.select({ path: workspaces.path }).from(workspaces).all()

    const byUrl = new Map<string, string>()
    for (const row of rows) {
      let sources: Source[]
      try {
        sources = this.readManifest(row.path).sources
      } catch {
        // A workspace whose manifest is missing/corrupt simply contributes no known repos.
        continue
      }
      for (const source of sources) {
        if (source.type === 'repo' && !byUrl.has(source.url)) {
          byUrl.set(source.url, source.name)
        }
      }
    }

    return [...byUrl.entries()].map(([url, name]) => ({ url, name }))
  }

  manifest(wsId: number): Manifest {
    return this.readManifest(this.pathFor(wsId))
  }

  memoryDir(wsId: number): string {
    return join(this.pathFor(wsId), 'memory')
  }

  reposDir(wsId: number): string {
    return join(this.pathFor(wsId), 'repos')
  }

  private pathFor(wsId: number): string {
    const row = this.db.drizzle
      .select({ path: workspaces.path })
      .from(workspaces)
      .where(eq(workspaces.id, wsId))
      .get()
    if (!row) throw new Error(`workspace ${wsId} not found`)
    return row.path
  }

  private readManifest(path: string): Manifest {
    const raw = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf-8'))
    return manifestSchema.parse(raw)
  }

  private writeManifest(path: string, manifest: Manifest): void {
    const validated = manifestSchema.parse(manifest)
    writeFileSync(join(path, 'manifest.json'), `${JSON.stringify(validated, null, 2)}\n`)
  }
}
