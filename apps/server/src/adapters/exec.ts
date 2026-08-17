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

/**
 * Journaled once per CLI session, in the agent's own voice, so a reader of the run's activity
 * knows why this run has no tool calls, no ticket comments and no memory notes: the CLI agents
 * run outside the tada MCP server and report through the outcome file instead.
 */
export const CLI_CAPABILITY_NOTE =
  'running without tada tools — outcome via scratch/outcome.json; ticket comments and memory notes unavailable'

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** Human summary of one `item.started`/`item.updated`/`item.completed` payload. */
function itemText(item: Record<string, unknown>): string | undefined {
  const kind = str(item.type) ?? str(item.item_type)
  switch (kind) {
    case 'agent_message':
    case 'reasoning':
      return str(item.text)
    case 'command_execution': {
      const command = str(item.command)
      if (!command) return 'command'
      const exit = typeof item.exit_code === 'number' ? ` (exit ${item.exit_code})` : ''
      return `$ ${command}${exit}`
    }
    case 'file_change': {
      const changes = Array.isArray(item.changes) ? item.changes : []
      const paths = changes
        .map((c) => (isRecord(c) ? str(c.path) : undefined))
        .filter((p): p is string => p !== undefined)
      return paths.length > 0 ? `edited ${paths.join(', ')}` : 'edited files'
    }
    case 'mcp_tool_call':
    case 'collab_tool_call': {
      const tool = str(item.tool)
      const server = str(item.server)
      return `tool ${[server, tool].filter((p) => p !== undefined).join('.') || 'call'}`
    }
    case 'web_search':
      return `search ${str(item.query) ?? ''}`.trim()
    case 'todo_list':
      return 'updated its todo list'
    case 'error':
      return str(item.message)
    default:
      return kind
  }
}

/**
 * A display string for one JSON stdout line from a CLI agent.
 *
 * codex `exec --json` speaks the ThreadEvent stream (`thread.started`, `turn.*`, `item.*`,
 * `error`), where the interesting content is the assistant message / command / patch inside
 * `item`. Journaling the raw JSONL as the event text - what this used to do - put unreadable
 * blobs on every UI surface that renders run events, so the text is the human part and the
 * parsed object rides along in the payload for the transcript. Anything unrecognised degrades to
 * a compact `<type>` label, and only a line that isn't JSON at all falls back to the raw line.
 */
export function cliDisplayText(json: unknown, raw: string): string {
  if (!isRecord(json)) return raw

  // Older codex builds wrap everything in {id, msg:{type, ...}}.
  if (isRecord(json.msg)) {
    const msg = json.msg
    return str(msg.message) ?? str(msg.text) ?? str(msg.type) ?? raw
  }

  const type = str(json.type)
  if (type?.startsWith('item.') && isRecord(json.item)) {
    return itemText(json.item) ?? type
  }
  if (type === 'error') return str(json.message) ?? type
  if (type === 'turn.failed') {
    return isRecord(json.error) ? (str(json.error.message) ?? type) : type
  }
  return type ?? raw
}

/** One stdout line -> one `text` event: a human-readable `text` (see `cliDisplayText`) with the
 * parsed object kept alongside it when the CLI speaks JSON (codex `--json`), and the raw line as
 * the text when it does not. */
export function cliLineEvent(line: string): AdapterEvent {
  const json = parseJsonLine(line)
  return json === undefined
    ? { type: 'text', payload: { text: line } }
    : { type: 'text', payload: { text: cliDisplayText(json, line), json } }
}

/**
 * Runs a one-shot CLI agent, journaling its stdout line by line. These CLIs take their whole task
 * on argv and have no channel for mid-run input, so the session's `inject` always declines. They
 * run outside the gate too, so an out-of-time hold suspends the whole process (SIGSTOP) and
 * "continue" wakes it (SIGCONT).
 */
export function startCliSession(ctx: AdapterStartCtx, cmd: string, args: string[]): AdapterSession {
  ctx.journal.write({ type: 'text', payload: { text: CLI_CAPABILITY_NOTE } })

  let subprocess: ReturnType<typeof execa> | undefined
  const done = (async (): Promise<AdapterResult> => {
    ctx.signal.throwIfAborted()
    subprocess = execa(cmd, args, { cwd: ctx.runDir, cancelSignal: ctx.signal })
    for await (const line of subprocess) {
      const text = typeof line === 'string' ? line : Buffer.from(line).toString('utf-8')
      if (text.length > 0) ctx.journal.write(cliLineEvent(text))
    }
    const result = await subprocess
    return { exitCode: result.exitCode ?? 0 }
  })()

  return {
    done,
    inject: () => false,
    pause: () => subprocess?.kill('SIGSTOP') ?? false,
    resume: () => subprocess?.kill('SIGCONT') ?? false,
  }
}
