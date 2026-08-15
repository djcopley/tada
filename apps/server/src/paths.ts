import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const dataDir = (): string =>
  process.env.TADA_DATA_DIR ??
  join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'), 'tada')

export const configDir = (): string =>
  process.env.TADA_CONFIG_DIR ??
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'tada')

export const stateDir = (): string =>
  process.env.TADA_STATE_DIR ??
  join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'tada')

/** Memory shared across every workspace: dataDir()/memory/global/{AGENTS.md,notes/*.md}. */
export const globalMemoryDir = (): string => join(dataDir(), 'memory', 'global')

/** Ensures the global memory dir (AGENTS.md + notes/) exists on disk, seeding a minimal charter
 * the first time it's touched. Idempotent - safe to call on every access. */
export function ensureGlobalMemoryDir(): string {
  const dir = globalMemoryDir()
  mkdirSync(join(dir, 'notes'), { recursive: true })
  const agentsPath = join(dir, 'AGENTS.md')
  if (!existsSync(agentsPath)) {
    writeFileSync(
      agentsPath,
      '# Global memory\n\nCross-workspace charter. Conventions and durable learnings that apply everywhere.\n',
    )
  }
  return dir
}
