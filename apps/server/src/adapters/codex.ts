import { probeCli, startCliSession, withOutcomeFileInstruction } from './exec.js'
import type { Adapter, AdapterSession, AdapterStartCtx } from './types.js'

const CLI = 'codex'

/** Every codex CLI detail lives here, so a change to its flags is a one-file fix. */
function codexArgs(prompt: string): string[] {
  return ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', prompt]
}

export class CodexAdapter implements Adapter {
  readonly id = 'codex'
  readonly label = 'Codex'
  readonly models = ['gpt-5.2-codex', 'gpt-5.2']
  readonly efforts = ['low', 'medium', 'high']
  readonly supportsInjection = false

  available(): Promise<boolean> {
    return probeCli(CLI)
  }

  start(ctx: AdapterStartCtx): AdapterSession {
    return startCliSession(ctx, CLI, codexArgs(withOutcomeFileInstruction(ctx.prompt)))
  }
}
