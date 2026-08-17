import type { ApiDiffFile, ApiRepoDiff } from '@tada/shared'
import { git } from '../git.js'
import type { SourceStore } from '../sources/store.js'
import { branchFor, type RunDir } from './runDir.js'

/** Parses `git diff --numstat` (one `adds\tdels\tpath` line per file; `-` for binary). */
export function parseNumstat(
  output: string,
): { path: string; additions: number; deletions: number }[] {
  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [adds = '0', dels = '0', ...rest] = line.split('\t')
      return {
        path: rest.join('\t'),
        additions: adds === '-' ? 0 : Number(adds),
        deletions: dels === '-' ? 0 : Number(dels),
      }
    })
}

/**
 * The diff of every repo this run has checked out, `<default>...ticket/<id>` — the run's own
 * worktree branch, before anything reaches github. Repos whose branch is not ahead are omitted.
 */
export async function runDiff(
  store: SourceStore,
  runDir: RunDir,
  ticketId: number,
  opts: { patch: boolean },
): Promise<ApiRepoDiff[]> {
  const branch = branchFor(ticketId)
  const out: ApiRepoDiff[] = []
  for (const [name, wt] of Object.entries(runDir.repoDirs)) {
    const repo = store.repo(name)
    if (!repo) continue
    const range = `${repo.defaultBranch}...${branch}`
    const ahead = await git(wt, 'rev-list', '--count', `${repo.defaultBranch}..${branch}`).catch(
      () => '0',
    )
    if (ahead === '0') continue

    const stat = parseNumstat(await git(wt, 'diff', '--numstat', range))
    const files: ApiDiffFile[] = []
    for (const f of stat) {
      const patch = opts.patch ? await git(wt, 'diff', range, '--', f.path).catch(() => '') : ''
      files.push({ ...f, patch })
    }
    out.push({
      repo: name,
      defaultBranch: repo.defaultBranch,
      branch,
      additions: stat.reduce((n, f) => n + f.additions, 0),
      deletions: stat.reduce((n, f) => n + f.deletions, 0),
      files,
    })
  }
  return out
}

/** Names of the repos whose ticket branch has commits — how a run without tada tools (a CLI
 * agent working in eagerly-created worktrees) earns its repo tags. */
export async function reposAhead(
  store: SourceStore,
  runDir: RunDir,
  ticketId: number,
): Promise<string[]> {
  const diffs = await runDiff(store, runDir, ticketId, { patch: false })
  return diffs.map((d) => d.repo)
}
