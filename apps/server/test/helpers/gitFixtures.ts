import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../../src/git.js'

/** Creates a bare origin with one commit on main; returns its path (file:// clonable). */
export async function makeOrigin(name = 'proj'): Promise<string> {
  const base = mkdtempSync(join(tmpdir(), 'tada-git-'))
  const work = join(base, 'work')
  await git(base, 'init', '-b', 'main', work)
  writeFileSync(join(work, 'README.md'), `# ${name}\n`)
  await git(work, 'add', '.')
  await git(
    work,
    '-c',
    'user.email=t@t',
    '-c',
    'user.name=t',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'init',
  )
  const bare = join(base, `${name}.git`)
  await git(base, 'clone', '--bare', work, bare)
  return bare
}

/** Test env: point all tada dirs at a fresh temp dir. Call in beforeEach. */
export function isolateXdg(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tada-xdg-'))
  process.env.TADA_DATA_DIR = join(dir, 'data')
  process.env.TADA_CONFIG_DIR = join(dir, 'config')
  process.env.TADA_STATE_DIR = join(dir, 'state')
  // Force-disable commit signing for git commands spawned in tests: a developer machine's
  // global gitconfig may have commit.gpgsign=true wired to an interactive signer (e.g. a
  // hardware key or 1Password), which would hang non-interactive test commits.
  process.env.GIT_CONFIG_COUNT = '1'
  process.env.GIT_CONFIG_KEY_0 = 'commit.gpgsign'
  process.env.GIT_CONFIG_VALUE_0 = 'false'
  return dir
}
