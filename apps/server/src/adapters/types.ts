export interface AdapterEvent {
  type: 'status' | 'tool_use' | 'text' | 'error'
  payload: unknown
}

export interface RunContext {
  runDir: string
  prompt: string
  model: string
  timeoutMs: number
  mcp: { url: string; token: string }
  onEvent: (e: AdapterEvent) => void
  signal: AbortSignal
}

export interface Adapter {
  readonly name: string
  readonly models: readonly string[]
  readonly efforts: readonly string[]
  run(ctx: RunContext): Promise<{ exitCode: number }>
}
