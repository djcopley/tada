import { execa } from 'execa'
import type { AdapterEvent, AdapterResult, AdapterSession, AdapterStartCtx } from './types.js'

const PROBE_TIMEOUT_MS = 10_000

/** `cmd --version` results, memoized per command for the process lifetime: a CLI does not appear
 * or disappear mid-session often enough to justify shelling out on every discovery request. */
const probes = new Map<string, Promise<boolean>>()

export function probeCli(cmd: string): Promise<boolean> {
  const cached = probes.get(cmd)
  if (cached) return cached

  const probe = execa(cmd, ['--version'], { timeout: PROBE_TIMEOUT_MS, reject: false })
    .then((result) => result.exitCode === 0)
    .catch(() => false)
  probes.set(cmd, probe)
  return probe
}

/**
 * The CLI agents cannot be relied on to call the tada MCP tools, so they report through a file
 * instead: the runner reads `scratch/outcome.json` whenever no MCP outcome arrived. Appended by
 * the adapter rather than `composePrompt` so Claude's prompt stays free of it.
 */
export function withOutcomeFileInstruction(prompt: string): string {
  return `${prompt}

## Reporting your outcome

When you are finished, write your outcome to \`scratch/outcome.json\` (relative to the directory
you started in) as a single JSON object:

{"status": "success" | "failed", "summary": "<one paragraph on what you did>", "testsPassed": <number, optional>}

This file is the only way the orchestrator learns what happened. A run that does not write it is
recorded as a failure.`
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

/** One stdout line -> one `text` event, keeping the parsed object alongside the raw line when the
 * CLI speaks JSON (codex `--json`) and falling back to the raw line when it does not. */
export function cliLineEvent(line: string): AdapterEvent {
  const json = parseJsonLine(line)
  return json === undefined
    ? { type: 'text', payload: { text: line } }
    : { type: 'text', payload: { text: line, json } }
}

/**
 * Runs a one-shot CLI agent, journaling its stdout line by line. These CLIs take their whole task
 * on argv and have no channel for mid-run input, so the session's `inject` always declines.
 */
export function startCliSession(ctx: AdapterStartCtx, cmd: string, args: string[]): AdapterSession {
  const done = (async (): Promise<AdapterResult> => {
    ctx.signal.throwIfAborted()
    const subprocess = execa(cmd, args, { cwd: ctx.runDir, cancelSignal: ctx.signal })
    for await (const line of subprocess) {
      if (line.length > 0) ctx.journal.write(cliLineEvent(line))
    }
    const result = await subprocess
    return { exitCode: result.exitCode ?? 0 }
  })()

  return { done, inject: () => false }
}
