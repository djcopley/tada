import { readFileSync } from 'node:fs'

/** The server's own package version, surfaced by /health and /status so a client can tell which
 * build it is talking to. Read at import time from package.json (the single source of truth);
 * `resolveJsonModule` is off repo-wide, hence readFileSync rather than an import. */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as {
      version?: unknown
    }
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export const serverVersion: string = readVersion()
