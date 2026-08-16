import type { agentRuns } from '../db/schema.js'

type RunRow = typeof agentRuns.$inferSelect

/**
 * The run as the API shows it: without the per-run MCP bearer (`runToken`, which lets whoever
 * holds it act as that run's agent) and the server-local transcript path. Every route that
 * returns a run row goes through here.
 */
export function publicRun<T extends RunRow>(row: T): Omit<T, 'runToken' | 'transcriptPath'> {
  const { runToken: _token, transcriptPath: _path, ...rest } = row
  return rest
}
