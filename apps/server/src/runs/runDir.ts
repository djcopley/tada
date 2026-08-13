import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { git } from '../git.js'
import { stateDir } from '../paths.js'
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

  const branch = branchFor(ticketId)
  const repoDirs: Record<string, string> = {}
  for (const repo of wm.manifest(wsId).repos) {
    const canonical = join(wm.reposDir(wsId), repo.name)
    const wt = join(path, repo.name)
    const exists = (await git(canonical, 'branch', '--list', branch)) !== ''
    await (exists
      ? git(canonical, 'worktree', 'add', wt, branch)
      : git(canonical, 'worktree', 'add', '-b', branch, wt, repo.defaultBranch))
    repoDirs[repo.name] = wt
  }

  return { path, repoDirs }
}

export async function cleanupRunDir(
  wm: WorkspaceManager,
  wsId: number,
  runDir: RunDir,
): Promise<void> {
  for (const repo of wm.manifest(wsId).repos) {
    const canonical = join(wm.reposDir(wsId), repo.name)
    const wt = runDir.repoDirs[repo.name]
    if (wt) {
      await git(canonical, 'worktree', 'remove', '--force', wt).catch(() => {})
    }
    await git(canonical, 'worktree', 'prune')
  }
  rmSync(runDir.path, { recursive: true, force: true })
}
