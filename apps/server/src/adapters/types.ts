export interface AdapterEvent {
  type: 'status' | 'tool_use' | 'text' | 'error' | 'gate'
  payload: unknown
}

/** The subset of `runs/journal.ts`'s Journal an adapter needs. Structural so adapter tests can
 * pass a plain recorder instead of standing up a db-backed journal. */
export interface Journal {
  write(e: AdapterEvent): void
}

export interface GateRequest {
  tool: string
  input: Record<string, unknown>
  toolUseId?: string
}

export type GateDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; reason: string }

/**
 * Called before every tool call an adapter can intercept. The runner's implementation applies the
 * rule table, holds the run (permission / question / time) and resolves when the human decides.
 * A pending gate is what a held run *is*: the agent process sits idle awaiting this promise.
 */
export type ToolGate = (req: GateRequest) => Promise<GateDecision>

export interface AdapterStartCtx {
  prompt: string
  runDir: string
  model: string
  effort: string
  mcpUrl: string
  runToken: string
  signal: AbortSignal
  journal: Journal
  gate: ToolGate
}

export interface AdapterResult {
  exitCode: number
}

export interface AdapterSession {
  /** Resolves when the agent's work is over; rejects on adapter failure. */
  done: Promise<AdapterResult>
  /** Delivers a mid-run note to the live session. Returns false when unsupported or too late. */
  inject(note: string): boolean
  /** Suspends the agent process in place (SIGSTOP-style). Returns false when the adapter cannot —
   * in which case the runner relies on the gate to hold the run at its next tool call. */
  pause(): boolean
  /** Undoes `pause`. */
  resume(): boolean
}

export interface Adapter {
  id: string
  label: string
  models: string[]
  efforts: string[]
  supportsInjection: boolean
  /** Whether the adapter routes tool calls through `ctx.gate` and can call the tada MCP tools.
   * Adapters that can't get every repo checked out eagerly and can never be asked anything. */
  supportsGates: boolean
  /** Whether this machine can actually run the agent (CLI installed, credentials present). */
  available(): Promise<boolean>
  start(ctx: AdapterStartCtx): AdapterSession
}
