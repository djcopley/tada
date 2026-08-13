import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { TadaDb } from '../db/index.js'
import { workspaces } from '../db/schema.js'
import { git } from '../git.js'
import { dataDir } from '../paths.js'

export interface RepoEntry {
  name: string
  url: string
  defaultBranch: string
}

export interface Manifest {
  repos: RepoEntry[]
}

const repoEntrySchema = z.object({
  name: z.string(),
  url: z.string(),
  defaultBranch: z.string(),
})

const manifestSchema = z.object({
  repos: z.array(repoEntrySchema),
})

/** repo name = basename of the clone URL, minus a trailing `.git` */
function repoNameFromUrl(url: string): string {
  const base = basename(url)
  return base.endsWith('.git') ? base.slice(0, -'.git'.length) : base
}

export class WorkspaceManager {
  constructor(private readonly db: TadaDb) {}

  async create(name: string): Promise<number> {
    const path = join(dataDir(), 'workspaces', name)

    mkdirSync(join(path, 'repos'), { recursive: true })
    mkdirSync(join(path, 'memory', 'notes'), { recursive: true })

    this.writeManifest(path, { repos: [] })
    writeFileSync(
      join(path, 'memory', 'AGENTS.md'),
      `# ${name}\n\nWorkspace charter. Conventions, goals, and gotchas agents should know.\n`,
    )

    const [row] = this.db.drizzle.insert(workspaces).values({ name, path }).returning().all()
    if (!row) throw new Error(`failed to insert workspace row for ${name}`)
    return row.id
  }

  async addRepo(wsId: number, url: string): Promise<void> {
    const path = this.pathFor(wsId)
    const name = repoNameFromUrl(url)
    const cloneDir = join(path, 'repos', name)

    await git(path, 'clone', url, cloneDir)
    const defaultBranch = await git(cloneDir, 'symbolic-ref', '--short', 'HEAD')

    const manifest = this.readManifest(path)
    manifest.repos.push({ name, url, defaultBranch })
    this.writeManifest(path, manifest)
  }

  async removeRepo(wsId: number, name: string): Promise<void> {
    const path = this.pathFor(wsId)
    rmSync(join(path, 'repos', name), { recursive: true, force: true })

    const manifest = this.readManifest(path)
    manifest.repos = manifest.repos.filter((r) => r.name !== name)
    this.writeManifest(path, manifest)
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
