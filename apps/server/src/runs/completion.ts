import { join } from 'node:path'
import { execa } from 'execa'
import { git } from '../git.js'
import type { WorkspaceManager } from '../workspaces/manager.js'
import { branchFor } from './runDir.js'

export interface CompletionResult {
  pushedRepos: string[]
  prUrls: string[]
  /** Summed `git diff --shortstat` insertions across every repo with a ticket branch ahead of
   * default. Null when no repo had anything to diff, or when computing/parsing the diff failed
   * for any repo — never a silent zero standing in for "unknown". */
  diffAdditions: number | null
  /** Same as diffAdditions, for deletions. */
  diffDeletions: number | null
}

export interface CompletionOpts {
  /** Open a PR via `gh pr create` for each pushed repo. Set false in tests (no network/gh). */
  pr: boolean
  /** PR title; required when opts.pr is true. */
  title?: string
  /** Agent's outcome summary, used as the PR body. */
  summary?: string
  /** Called with a message when a push, `gh pr create`, or diffstat computation fails; failures
   * are non-fatal. */
  onError?: (message: string) => void
}

/** Parses `git diff --shortstat` output, e.g. " 3 files changed, 10 insertions(+), 2
 * deletions(-)". `--shortstat` omits the insertions or deletions clause entirely when that count
 * is zero (and prints nothing at all for an empty diff), so a missing clause parses to 0 — never
 * to null. Null is reserved for "we couldn't compute this at all" (see completeRun). */
function parseShortstat(output: string): { additions: number; deletions: number } {
  const insertions = output.match(/(\d+) insertions?\(\+\)/)?.[1]
  const deletions = output.match(/(\d+) deletions?\(-\)/)?.[1]
  return {
    additions: insertions === undefined ? 0 : Number(insertions),
    deletions: deletions === undefined ? 0 : Number(deletions),
  }
}

/**
 * For each repo in the workspace: if the ticket branch has commits ahead of the repo's
 * default branch, push it (-u origin), open a PR via `gh` (unless opts.pr is false), and fold
 * its `git diff --shortstat` into the run-wide diff totals.
 * Push/PR failures are caught and reported via opts.onError but never thrown — the agent's
 * commits are already safe once pushed (or even if not), so completion must not fail the run.
 * A diffstat exec/parse failure is likewise non-fatal: it just nulls out the totals.
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

  let diffAdditions = 0
  let diffDeletions = 0
  let diffed = false
  let diffFailed = false

  for (const repo of wm.manifest(wsId).sources.filter((s) => s.type === 'repo')) {
    const canonical = join(wm.reposDir(wsId), repo.name)

    // Detection (branch --list, rev-list) is deliberately NOT inside the try/catch below: a
    // failure there (e.g. a corrupted/removed canonical repo) means we can't even tell
    // whether there's anything to push, which is a more fundamental problem than a push/PR
    // failure and is allowed to propagate — the caller (executeRun) guards the whole
    // completion step and routes any throw through its failure path.
    const branchExists = (await git(canonical, 'branch', '--list', branch)) !== ''
    if (!branchExists) continue

    const ahead = await git(canonical, 'rev-list', '--count', `${repo.defaultBranch}..${branch}`)
    if (ahead === '0') continue

    try {
      const shortstat = await git(
        canonical,
        'diff',
        '--shortstat',
        `${repo.defaultBranch}...${branch}`,
      )
      const stat = parseShortstat(shortstat)
      diffAdditions += stat.additions
      diffDeletions += stat.deletions
      diffed = true
    } catch (err) {
      diffFailed = true
      const message = err instanceof Error ? err.message : String(err)
      opts.onError?.(`diffstat failed for ${repo.name}: ${message}`)
    }

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

  return {
    pushedRepos,
    prUrls,
    diffAdditions: diffFailed || !diffed ? null : diffAdditions,
    diffDeletions: diffFailed || !diffed ? null : diffDeletions,
  }
}
