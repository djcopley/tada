import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { git } from '../git.js'
import { stateDir } from '../paths.js'
import type { RepoSource, SourceStore } from '../sources/store.js'

export interface RunDir {
  path: string
  /** repo name -> worktree path, for every repo this run has checked out so far. */
  repoDirs: Record<string, string>
}

export const branchFor = (ticketId: number): string => `ticket/${ticketId}`

export const runDirPath = (runId: number): string => join(stateDir(), 'runs', String(runId))

/**
 * The agent works out of one folder: `<stateDir>/runs/<runId>/` with `scratch/` and every folder
 * source symlinked in. Repo worktrees are *not* created here — they appear lazily via
 * `addWorktree` (the MCP `use_repo` tool), which is the moment a ticket earns its repo tag.
 */
export function buildRunDir(store: SourceStore, runId: number): RunDir {
  const path = runDirPath(runId)
  mkdirSync(join(path, 'scratch'), { recursive: true })
  for (const source of store.manifest().sources) {
    if (source.type === 'folder') symlinkSync(source.path, join(path, source.name))
  }
  return { path, repoDirs: {} }
}

/** Checks `repo` out into the run dir on branch `ticket/<id>` (created off the default branch if
 * it doesn't exist yet — a re-run reuses the branch, so earlier commits are kept). Idempotent for
 * a repo this run already has. */
export async function addWorktree(
  store: SourceStore,
  runDir: RunDir,
  ticketId: number,
  repo: RepoSource,
): Promise<string> {
  const existing = runDir.repoDirs[repo.name]
  if (existing) return existing

  const canonical = store.cloneDir(repo.name)
  const wt = join(runDir.path, repo.name)
  const branch = branchFor(ticketId)
  const branchExists = (await git(canonical, 'branch', '--list', branch)) !== ''
  await (branchExists
    ? git(canonical, 'worktree', 'add', wt, branch)
    : git(canonical, 'worktree', 'add', '-b', branch, wt, repo.defaultBranch))
  runDir.repoDirs[repo.name] = wt
  return wt
}

/** The RunDir a given run id has (or had) on disk: `<stateDir>/runs/<runId>`, with a worktree per
 * repo source that actually exists beneath it. Lets callers that only know a run id (cleanup, the
 * diff endpoint) reconstruct the layout without having kept the RunDir `buildRunDir` returned. */
export function runDirFor(store: SourceStore, runId: number): RunDir {
  const path = runDirPath(runId)
  const repoDirs: Record<string, string> = {}
  for (const repo of store.repos()) {
    const wt = join(path, repo.name)
    if (existsSync(wt)) repoDirs[repo.name] = wt
  }
  return { path, repoDirs }
}

/**
 * Tears down the run dirs of the given runs, keeping their branches. Called before building a
 * re-run's run dir: a finished attempt's worktree still holds the `ticket/<id>` branch checked
 * out, and git refuses to check the same branch out twice ("branch already used by worktree"),
 * so without this every re-run of a repo-backed ticket would fail at setup. Each run is cleaned
 * independently and failures are swallowed — a run dir that was already removed (or never built)
 * is exactly the state we want.
 */
export async function cleanupRunDirs(store: SourceStore, runIds: number[]): Promise<void> {
  for (const runId of runIds) {
    try {
      await cleanupRunDir(store, runDirFor(store, runId))
    } catch {
      // already cleaned up (or never built) - ignore
    }
  }
}

export async function cleanupRunDir(store: SourceStore, runDir: RunDir): Promise<void> {
  for (const [name, wt] of Object.entries(runDir.repoDirs)) {
    const canonical = store.cloneDir(name)
    if (!existsSync(canonical)) continue
    await git(canonical, 'worktree', 'remove', '--force', wt).catch(() => {})
    await git(canonical, 'worktree', 'prune').catch(() => {})
  }
  rmSync(runDir.path, { recursive: true, force: true })
}
