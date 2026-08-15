import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { git } from '../git.js'
import { ensureGlobalMemoryDir, stateDir } from '../paths.js'
import type { WorkspaceManager } from '../workspaces/manager.js'

export interface RunDir {
  path: string
  repoDirs: Record<string, string>
}

export const branchFor = (ticketId: number): string => `ticket/${ticketId}`

export async function buildRunDir(
  wm: WorkspaceManager,
  wsId: number,
  ticketId: number,
  runId: number,
): Promise<RunDir> {
  const path = join(stateDir(), 'runs', String(runId))
  mkdirSync(join(path, 'scratch'), { recursive: true })
  symlinkSync(wm.memoryDir(wsId), join(path, 'memory'))
  symlinkSync(ensureGlobalMemoryDir(), join(path, 'memory-global'))

  const branch = branchFor(ticketId)
  const repoDirs: Record<string, string> = {}
  for (const source of wm.manifest(wsId).sources) {
    if (source.type === 'folder') {
      symlinkSync(source.path, join(path, source.name))
      continue
    }

    const canonical = join(wm.reposDir(wsId), source.name)
    const wt = join(path, source.name)
    const exists = (await git(canonical, 'branch', '--list', branch)) !== ''
    await (exists
      ? git(canonical, 'worktree', 'add', wt, branch)
      : git(canonical, 'worktree', 'add', '-b', branch, wt, source.defaultBranch))
    repoDirs[source.name] = wt
  }

  return { path, repoDirs }
}

/** The RunDir layout a given run id would have had: `<stateDir>/runs/<runId>`, with one worktree
 * per repo source beneath it, named after the source. Lets callers that only know a run id (the
 * on-Done cleanup, the pre-build cleanup of earlier attempts) reconstruct what to remove without
 * having kept the RunDir that `buildRunDir` returned. */
export function runDirFor(wm: WorkspaceManager, wsId: number, runId: number): RunDir {
  const path = join(stateDir(), 'runs', String(runId))
  const repoDirs = Object.fromEntries(
    wm
      .manifest(wsId)
      .sources.filter((s) => s.type === 'repo')
      .map((s) => [s.name, join(path, s.name)]),
  )
  return { path, repoDirs }
}

/**
 * Tears down the run dirs of the given (earlier) runs, keeping their branches. Called before
 * building attempt N+1's run dir: a finished attempt's worktree still holds the `ticket/<id>`
 * branch checked out, and git refuses to check the same branch out twice ("branch already used
 * by worktree"), so without this every re-run of a repo-backed ticket would fail at setup.
 * Each run is cleaned independently and failures are swallowed — a run dir that was already
 * removed (or never built) is exactly the state we want.
 */
export async function cleanupRunDirs(
  wm: WorkspaceManager,
  wsId: number,
  runIds: number[],
): Promise<void> {
  for (const runId of runIds) {
    try {
      await cleanupRunDir(wm, wsId, runDirFor(wm, wsId, runId))
    } catch {
      // already cleaned up (or never built) - ignore
    }
  }
}

export async function cleanupRunDir(
  wm: WorkspaceManager,
  wsId: number,
  runDir: RunDir,
): Promise<void> {
  for (const source of wm.manifest(wsId).sources) {
    if (source.type === 'folder') continue

    const canonical = join(wm.reposDir(wsId), source.name)
    const wt = runDir.repoDirs[source.name]
    if (wt) {
      await git(canonical, 'worktree', 'remove', '--force', wt).catch(() => {})
    }
    await git(canonical, 'worktree', 'prune')
  }
  rmSync(runDir.path, { recursive: true, force: true })
}
