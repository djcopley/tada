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
