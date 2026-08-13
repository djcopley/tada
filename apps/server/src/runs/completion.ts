import { join } from 'node:path'
import { execa } from 'execa'
import { git } from '../git.js'
import type { WorkspaceManager } from '../workspaces/manager.js'
import { branchFor } from './runDir.js'

export interface CompletionResult {
  pushedRepos: string[]
  prUrls: string[]
}

export interface CompletionOpts {
  /** Open a PR via `gh pr create` for each pushed repo. Set false in tests (no network/gh). */
  pr: boolean
  /** PR title; required when opts.pr is true. */
  title?: string
  /** Agent's outcome summary, used as the PR body. */
  summary?: string
  /** Called with a message when a push or `gh pr create` fails; failures are non-fatal. */
  onError?: (message: string) => void
}

/**
 * For each repo in the workspace: if the ticket branch has commits ahead of the repo's
 * default branch, push it (-u origin) and, unless opts.pr is false, open a PR via `gh`.
 * Push/PR failures are caught and reported via opts.onError but never thrown — the agent's
 * commits are already safe once pushed (or even if not), so completion must not fail the run.
 */
export async function completeRun(
  wm: WorkspaceManager,
  wsId: number,
  ticketId: number,
  opts: CompletionOpts,
): Promise<CompletionResult> {
  const branch = branchFor(ticketId)
  const pushedRepos: string[] = []
  const prUrls: string[] = []

  for (const repo of wm.manifest(wsId).repos) {
    const canonical = join(wm.reposDir(wsId), repo.name)

    const branchExists = (await git(canonical, 'branch', '--list', branch)) !== ''
    if (!branchExists) continue

    const ahead = await git(canonical, 'rev-list', '--count', `${repo.defaultBranch}..${branch}`)
    if (ahead === '0') continue

    try {
      await git(canonical, 'push', '-u', 'origin', branch)
      pushedRepos.push(repo.name)

      if (opts.pr) {
        const body = `${opts.summary ?? ''}\n\nCloses ticket #${ticketId} (tada)`
        const { stdout } = await execa(
          'gh',
          ['pr', 'create', '--head', branch, '--title', opts.title ?? '', '--body', body],
          { cwd: canonical },
        )
        prUrls.push(stdout.trim())
      }
    } catch (err) {
      opts.onError?.(err instanceof Error ? err.message : String(err))
    }
  }

  return { pushedRepos, prUrls }
}
