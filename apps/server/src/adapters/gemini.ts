import { probeCli, startCliSession, withOutcomeFileInstruction } from './exec.js'
import type { Adapter, AdapterSession, AdapterStartCtx } from './types.js'

const CLI = 'gemini'

/** Every gemini CLI detail lives here, so a change to its flags is a one-file fix. */
function geminiArgs(prompt: string): string[] {
  return ['-p', prompt, '--yolo']
}

export class GeminiAdapter implements Adapter {
  readonly id = 'gemini'
  readonly label = 'Gemini'
  readonly models = ['gemini-3-pro', 'gemini-3-flash']
  readonly efforts = ['default']
  readonly supportsInjection = false

  available(): Promise<boolean> {
    return probeCli(CLI)
  }

  start(ctx: AdapterStartCtx): AdapterSession {
    return startCliSession(ctx, CLI, geminiArgs(withOutcomeFileInstruction(ctx.prompt)))
  }
}
