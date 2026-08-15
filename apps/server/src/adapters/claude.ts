import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { UserMessageQueue } from './claudeQueue.js'
import type {
  Adapter,
  AdapterEvent,
  AdapterResult,
  AdapterSession,
  AdapterStartCtx,
} from './types.js'

const INPUT_PREVIEW_MAX_CHARS = 500

/** Bridges an AbortSignal (from the start context) to the AbortController the SDK expects. */
function abortControllerFrom(signal: AbortSignal): AbortController {
  const controller = new AbortController()
  if (signal.aborted) {
    controller.abort()
  } else {
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return controller
}

function previewInput(input: unknown): string {
  const json = JSON.stringify(input) ?? String(input)
  return json.length > INPUT_PREVIEW_MAX_CHARS ? `${json.slice(0, INPUT_PREVIEW_MAX_CHARS)}…` : json
}

/** Maps an SDK message to zero or more AdapterEvents for the run journal. */
function toAdapterEvents(msg: SDKMessage): AdapterEvent[] {
  switch (msg.type) {
    case 'assistant': {
      const events: AdapterEvent[] = []
      for (const block of msg.message.content) {
        if (block.type === 'text') {
          events.push({ type: 'text', payload: { text: block.text } })
        } else if (block.type === 'tool_use') {
          events.push({
            type: 'tool_use',
            payload: { name: block.name, inputPreview: previewInput(block.input) },
          })
        }
      }
      if (msg.error) {
        events.push({
          type: 'error',
          payload: { message: `claude sdk assistant error: ${msg.error}` },
        })
      }
      return events
    }
    case 'result':
      if (msg.subtype === 'success') {
        return [{ type: 'status', payload: { kind: 'sdk_result', subtype: msg.subtype } }]
      }
      return [{ type: 'error', payload: { message: `claude sdk result: ${msg.subtype}` } }]
    default:
      return []
  }
}

/** Tada's effort levels map straight onto the SDK's own `effort` option, which is what current
 * models actually read (the older `maxThinkingTokens` is deprecated and now behaves as a mere
 * on/off switch, which would make low and high indistinguishable). */
function thinkingOptions(effort: string): Pick<Options, 'effort'> {
  switch (effort) {
    case 'low':
      return { effort: 'low' }
    case 'medium':
      return { effort: 'medium' }
    case 'high':
      return { effort: 'high' }
    default:
      return {}
  }
}

/** Cheap evidence that this machine can talk to Anthropic: an explicit key/token in the
 * environment, or credentials the `claude` login wrote under the home directory. The SDK ships
 * its own binary, so PATH is deliberately not consulted - a server with the SDK and a logged-in
 * `~/.claude` runs fine with no global CLI installed. */
function hasClaudeCredentials(): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) return true
  const home = homedir()
  return (
    existsSync(join(home, '.claude', '.credentials.json')) || existsSync(join(home, '.claude.json'))
  )
}

export class ClaudeAdapter implements Adapter {
  readonly id = 'claude'
  readonly label = 'Claude'
  readonly models = ['sonnet', 'opus', 'haiku']
  readonly efforts = ['low', 'medium', 'high']
  readonly supportsInjection = true

  private availability: Promise<boolean> | undefined

  /** "Can we run?" is "is the SDK importable and are there credentials?" - cached, like the CLI
   * adapters' probes, since neither answer changes without a restart in practice. */
  available(): Promise<boolean> {
    this.availability ??= Promise.resolve().then(() => {
      try {
        return typeof query === 'function' && hasClaudeCredentials()
      } catch {
        return false
      }
    })
    return this.availability
  }

  start(ctx: AdapterStartCtx): AdapterSession {
    const queue = new UserMessageQueue()
    queue.push(ctx.prompt)

    const q = query({
      prompt: queue,
      options: {
        cwd: ctx.runDir,
        model: ctx.model,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        abortController: abortControllerFrom(ctx.signal),
        ...thinkingOptions(ctx.effort),
        mcpServers: {
          tada: {
            type: 'http',
            url: ctx.mcpUrl,
            headers: { Authorization: `Bearer ${ctx.runToken}` },
          },
        },
      },
    })

    const done = (async (): Promise<AdapterResult> => {
      try {
        for await (const msg of q) {
          for (const event of toAdapterEvents(msg)) ctx.journal.write(event)

          // A `result` message closes a turn. In streaming-input mode the session would then sit
          // idle waiting for more input forever, so the queue ends it here - unless it is still
          // owed a turn for a nudge it injected, in which case the agent keeps going.
          if (msg.type === 'result') queue.onTurnEnd()
        }

        // SDK errors reject this generator's iteration rather than reaching here, so the runner's
        // adapterError branch handles failures; a normal exit means the loop drained cleanly.
        return { exitCode: 0 }
      } finally {
        queue.close()
      }
    })()

    return {
      done,
      inject: (note: string): boolean => {
        const delivered = queue.inject(`the user says: ${note}`)
        if (delivered) ctx.journal.write({ type: 'text', payload: { text: `nudge: ${note}` } })
        return delivered
      },
    }
  }
}
