import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { RunOutcome } from '../mcp/server.js'

/** Relative to the run directory; also the path the CLI adapters tell their agent to write. */
export const OUTCOME_FILE = join('scratch', 'outcome.json')

const outcomeFileSchema = z.object({
  status: z.enum(['success', 'failed']),
  summary: z.string(),
  testsPassed: z.number().optional(),
})

export type OutcomeFileRead =
  | { kind: 'missing' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'outcome'; outcome: RunOutcome }

/**
 * Fallback outcome channel for adapters that cannot call the tada MCP tools (the codex/gemini
 * CLIs): the agent writes `scratch/outcome.json` in its run directory and the runner reads it
 * whenever nothing came in over MCP. A malformed file is reported as invalid rather than ignored,
 * so a garbled report fails the run loudly instead of looking like "no outcome at all".
 */
export function readOutcomeFile(runDir: string): OutcomeFileRead {
  const path = join(runDir, OUTCOME_FILE)

  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'invalid', reason: `could not read ${OUTCOME_FILE}: ${String(err)}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'invalid', reason: `${OUTCOME_FILE} is not valid JSON` }
  }

  const result = outcomeFileSchema.safeParse(parsed)
  if (!result.success) {
    return { kind: 'invalid', reason: `${OUTCOME_FILE} has an unexpected shape` }
  }

  return { kind: 'outcome', outcome: result.data }
}
