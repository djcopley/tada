import type { Adapter, AdapterEvent, RunContext } from './types.js'

export interface FakeScript {
  events?: AdapterEvent[]
  act?: (ctx: RunContext) => Promise<void>
  exitCode?: number
}

export class FakeAdapter implements Adapter {
  readonly name = 'fake'
  readonly models = ['fake-1'] as const

  constructor(private script: FakeScript = {}) {}

  async run(ctx: RunContext): Promise<{ exitCode: number }> {
    ctx.signal.throwIfAborted()
    for (const e of this.script.events ?? []) {
      ctx.onEvent(e)
    }
    await this.script.act?.(ctx)
    return { exitCode: this.script.exitCode ?? 0 }
  }
}
