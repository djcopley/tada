import { probeCli, startCliSession, withOutcomeFileInstruction } from './exec.js'
import type { Adapter, AdapterSession, AdapterStartCtx } from './types.js'

const CLI = 'codex'

/** codex's own default reasoning effort - no `-c` override is emitted for it. */
const DEFAULT_EFFORT = 'medium'

/** Every codex CLI detail lives here, so a change to its flags is a one-file fix. The run's
 * model and effort are passed through (`-m`, and `-c model_reasoning_effort=<effort>` for
 * anything other than codex's own default) - the workspace/ticket pickers in Settings promise
 * they take effect, so they have to reach the process. */
export function codexArgs(ctx: AdapterStartCtx): string[] {
  const args = ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox']
  if (ctx.model !== '') args.push('-m', ctx.model)
  if (ctx.effort !== '' && ctx.effort !== DEFAULT_EFFORT) {
    args.push('-c', `model_reasoning_effort=${ctx.effort}`)
  }
  args.push(withOutcomeFileInstruction(ctx.prompt))
  return args
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
    return startCliSession(ctx, CLI, codexArgs(ctx))
  }
}
