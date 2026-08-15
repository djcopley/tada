import type {
  Adapter,
  AdapterEvent,
  AdapterResult,
  AdapterSession,
  AdapterStartCtx,
} from './types.js'

export interface FakeScript {
  events?: AdapterEvent[]
  act?: (ctx: AdapterStartCtx) => Promise<void>
  exitCode?: number
  /** Defaults to true; set false to exercise the unavailable-adapter path. */
  available?: boolean
  /** Defaults to true; set false to exercise the "nudge not delivered" path. */
  supportsInjection?: boolean
}

export class FakeAdapter implements Adapter {
  readonly id = 'fake'
  readonly label = 'Fake'
  readonly models = ['fake-1']
  readonly efforts = ['low', 'medium', 'high']
  readonly supportsInjection: boolean
  /** Notes handed to `inject`, in order — the assertion surface for nudge tests. */
  readonly injected: string[] = []

  constructor(private script: FakeScript = {}) {
    this.supportsInjection = script.supportsInjection ?? true
  }

  async available(): Promise<boolean> {
    return this.script.available ?? true
  }

  start(ctx: AdapterStartCtx): AdapterSession {
    const done = (async (): Promise<AdapterResult> => {
      ctx.signal.throwIfAborted()
      for (const e of this.script.events ?? []) ctx.journal.write(e)
      await this.script.act?.(ctx)
      return { exitCode: this.script.exitCode ?? 0 }
    })()

    return {
      done,
      inject: (note: string): boolean => {
        if (!this.supportsInjection) return false
        this.injected.push(note)
        ctx.journal.write({ type: 'text', payload: { text: `nudge: ${note}` } })
        return true
      },
    }
  }
}
