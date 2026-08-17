import { probeCli, startCliSession, withOutcomeFileInstruction } from './exec.js'
import type { Adapter, AdapterSession, AdapterStartCtx } from './types.js'

const CLI = 'gemini'

/** Every gemini CLI detail lives here, so a change to its flags is a one-file fix. The run's
 * model is passed through with `-m`; there is no effort flag to pass (this adapter advertises a
 * single 'default' effort). */
export function geminiArgs(ctx: AdapterStartCtx): string[] {
  const args: string[] = []
  if (ctx.model !== '') args.push('-m', ctx.model)
  args.push('-p', withOutcomeFileInstruction(ctx.prompt), '--yolo')
  return args
}

export class GeminiAdapter implements Adapter {
  readonly id = 'gemini'
  readonly label = 'Gemini'
  readonly models = ['gemini-3-pro', 'gemini-3-flash']
  readonly efforts = ['default']
  readonly supportsInjection = false
  readonly supportsGates = false

  available(): Promise<boolean> {
    return probeCli(CLI)
  }

  start(ctx: AdapterStartCtx): AdapterSession {
    return startCliSession(ctx, CLI, geminiArgs(ctx))
  }
}
