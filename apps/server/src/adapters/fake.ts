import type {
  Adapter,
  AdapterEvent,
  AdapterResult,
  AdapterSession,
  AdapterStartCtx,
} from './types.js'

export interface FakeScript {
  events?: AdapterEvent[]
  /** The fake's "work". Gets the start ctx, so a script can call `ctx.gate(...)` to exercise
   * holds exactly the way the Claude adapter's hook would. */
  act?: (ctx: AdapterStartCtx) => Promise<void>
  /** Run for each idle nudge the runner hands back, standing in for the agent's extra turn. */
  onNudge?: (ctx: AdapterStartCtx, note: string, n: number) => Promise<void>
  exitCode?: number
  /** Defaults to true; set false to exercise the unavailable-adapter path. */
  available?: boolean
  /** Defaults to true; set false to exercise the "nudge not delivered" path. */
  supportsInjection?: boolean
  /** Defaults to true. False = a CLI-style agent: no gate, eager worktrees, SIGSTOP-style pause. */
  supportsGates?: boolean
}

export class FakeAdapter implements Adapter {
  readonly id = 'fake'
  readonly label = 'Fake'
  readonly models = ['fake-1']
  readonly efforts = ['low', 'medium', 'high']
  readonly supportsInjection: boolean
  readonly supportsGates: boolean
  /** Notes handed to `inject`, in order — the assertion surface for nudge tests. */
  readonly injected: string[] = []
  /** Notes the runner returned from `onIdle`, in order. */
  readonly nudges: string[] = []
  /** pause/resume calls, in order. */
  readonly signals: ('pause' | 'resume')[] = []

  constructor(private script: FakeScript = {}) {
    this.supportsInjection = script.supportsInjection ?? true
    this.supportsGates = script.supportsGates ?? true
  }

  async available(): Promise<boolean> {
    return this.script.available ?? true
  }

  start(ctx: AdapterStartCtx): AdapterSession {
    const done = (async (): Promise<AdapterResult> => {
      ctx.signal.throwIfAborted()
      for (const e of this.script.events ?? []) ctx.journal.write(e)
      await this.script.act?.(ctx)
      // The script running out is this fake's turn ending, so the runner gets the same chance to
      // ask for another one that the Claude adapter gives it on a `result` message.
      while (true) {
        const note = ctx.onIdle?.() ?? null
        if (note === null) break
        this.nudges.push(note)
        await this.script.onNudge?.(ctx, note, this.nudges.length)
      }
      return { exitCode: this.script.exitCode ?? 0 }
    })()

    return {
      done,
      inject: (note: string): boolean => {
        if (!this.supportsInjection) return false
        this.injected.push(note)
        ctx.journal.write({ type: 'text', payload: { text: `note: ${note}` } })
        return true
      },
      pause: () => {
        if (this.supportsGates) return false
        this.signals.push('pause')
        return true
      },
      resume: () => {
        if (this.supportsGates) return false
        this.signals.push('resume')
        return true
      },
    }
  }
}
