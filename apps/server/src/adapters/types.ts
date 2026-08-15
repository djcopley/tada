export interface AdapterEvent {
  type: 'status' | 'tool_use' | 'text' | 'error'
  payload: unknown
}

/** The subset of `runs/journal.ts`'s Journal an adapter needs. Structural so adapter tests can
 * pass a plain recorder instead of standing up a db-backed journal. */
export interface Journal {
  write(e: AdapterEvent): void
}

export interface AdapterStartCtx {
  prompt: string
  runDir: string
  model: string
  effort: string
  mcpUrl: string
  runToken: string
  signal: AbortSignal
  journal: Journal
}

export interface AdapterResult {
  exitCode: number
}

export interface AdapterSession {
  /** Resolves when the agent's work is over; rejects on adapter failure. */
  done: Promise<AdapterResult>
  /** Delivers a mid-run note to the live session. Returns false when unsupported or too late. */
  inject(note: string): boolean
}

export interface Adapter {
  id: string
  label: string
  models: string[]
  efforts: string[]
  supportsInjection: boolean
  /** Whether this machine can actually run the agent (CLI installed, credentials present). */
  available(): Promise<boolean>
  start(ctx: AdapterStartCtx): AdapterSession
}
