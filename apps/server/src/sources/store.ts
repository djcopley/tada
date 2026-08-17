import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import type { ApiSource } from '@tada/shared'
import { z } from 'zod'
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

const sourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('repo'),
    name: z.string(),
    url: z.string(),
    defaultBranch: z.string(),
  }),
  z.object({ type: z.literal('folder'), name: z.string(), path: z.string() }),
])

const manifestSchema = z.object({ sources: z.array(sourceSchema) })

/** repo name = basename of the clone URL, minus a trailing `.git` */
function repoNameFromUrl(url: string): string {
  const base = basename(url)
  return base.endsWith('.git') ? base.slice(0, -'.git'.length) : base
}

/** basename-only: rejects any name containing '/' (or a resolved-away '..') outright, so a
 * caller can never make a dataDir-joined path escape its intended directory. */
export function assertSafeName(name: string, what: string): void {
  if (name !== basename(name) || name === '' || name === '.' || name === '..') {
    throw new Error(`invalid ${what}: ${name}`)
  }
}

/** Thrown when adding a source whose name is already used by another source. */
export class SourceExistsError extends Error {
  constructor(name: string) {
    super(`a source named "${name}" already exists`)
    this.name = 'SourceExistsError'
  }
}

/**
 * The one set of sources the agent works out of: repo clones under `dataDir/repos/<name>` and
 * attached folders, listed in `dataDir/manifest.json`. The manifest on disk is the single source
 * of truth for what is actually cloned — SQLite has no repos table by design.
 */
export class SourceStore {
  constructor(private readonly root: string = dataDir()) {}

  get reposDir(): string {
    return join(this.root, 'repos')
  }

  private get manifestPath(): string {
    return join(this.root, 'manifest.json')
  }

  manifest(): Manifest {
    if (!existsSync(this.manifestPath)) return { sources: [] }
    return manifestSchema.parse(JSON.parse(readFileSync(this.manifestPath, 'utf-8')))
  }

  list(): ApiSource[] {
    return this.manifest().sources.map((s) => ({ ...s }))
  }

  repos(): RepoSource[] {
    return this.manifest().sources.filter((s): s is RepoSource => s.type === 'repo')
  }

  repo(name: string): RepoSource | undefined {
    return this.repos().find((r) => r.name === name)
  }

  cloneDir(name: string): string {
    return join(this.reposDir, name)
  }

  async addRepo(url: string): Promise<void> {
    const name = repoNameFromUrl(url)
    assertSafeName(name, 'repo source name')
    this.assertNameFree(name)

    mkdirSync(this.reposDir, { recursive: true })
    // `--` so a URL starting with '-' can't be read as a git option.
    await git(this.root, 'clone', '--', url, this.cloneDir(name))
    const defaultBranch = await git(this.cloneDir(name), 'symbolic-ref', '--short', 'HEAD')

    // Re-read: the clone took a while and another add could have landed meanwhile.
    const fresh = this.manifest()
    fresh.sources.push({ type: 'repo', name, url, defaultBranch })
    this.write(fresh)
  }

  /** name = basename of the folder path. Rejects non-absolute or missing/non-directory paths. */
  addFolder(folderPath: string): void {
    if (!isAbsolute(folderPath)) {
      throw new Error(`invalid folder path (must be absolute): ${folderPath}`)
    }
    if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
      throw new Error(`invalid folder path (must be an existing directory): ${folderPath}`)
    }
    const name = basename(folderPath)
    assertSafeName(name, 'folder source name')
    this.assertNameFree(name)
    const manifest = this.manifest()
    manifest.sources.push({ type: 'folder', name, path: folderPath })
    this.write(manifest)
  }

  /** Removes a source of either type by name. Repo sources also have their clone dir deleted;
   * folder sources are just detached (the folder itself is not owned by tada). */
  remove(name: string): boolean {
    assertSafeName(name, 'source name')
    const manifest = this.manifest()
    const source = manifest.sources.find((s) => s.name === name)
    if (!source) return false
    if (source.type === 'repo') rmSync(this.cloneDir(name), { recursive: true, force: true })
    manifest.sources = manifest.sources.filter((s) => s !== source)
    this.write(manifest)
    return true
  }

  /** Source names are unique regardless of type: they become sibling entries in a run dir. */
  private assertNameFree(name: string): void {
    if (this.manifest().sources.some((s) => s.name === name)) throw new SourceExistsError(name)
  }

  private write(manifest: Manifest): void {
    mkdirSync(this.root, { recursive: true })
    const validated = manifestSchema.parse(manifest)
    writeFileSync(this.manifestPath, `${JSON.stringify(validated, null, 2)}\n`)
  }
}
