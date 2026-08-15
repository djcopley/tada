import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { probeCli } from './exec.js'
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

/** Effort -> thinking budget. Medium is deliberately absent: it means "whatever the SDK does by
 * default", so the option is omitted rather than pinned to a number that could drift. */
function thinkingOptions(effort: string): Pick<Options, 'maxThinkingTokens'> {
  switch (effort) {
    case 'low':
      return { maxThinkingTokens: 1024 }
    case 'high':
      return { maxThinkingTokens: 32_768 }
    default:
      return {}
  }
}

function userMessage(text: string): SDKUserMessage {
  return {
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'text', text }] },
  }
}

/**
 * The async iterable the SDK reads user turns from. Streaming-input mode keeps the session alive
 * for as long as this iterable does, which is exactly the handle a mid-run nudge needs: push a
 * message and the agent picks it up on its next turn. Closing the queue ends the session.
 */
class UserMessageQueue implements AsyncIterable<SDKUserMessage> {
  private readonly pending: SDKUserMessage[] = []
  private closed = false
  private wake: (() => void) | undefined

  get hasPending(): boolean {
    return this.pending.length > 0
  }

  push(text: string): boolean {
    if (this.closed) return false
    this.pending.push(userMessage(text))
    this.wake?.()
    return true
  }

  close(): void {
    this.closed = true
    this.wake?.()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      const next = this.pending.shift()
      if (next !== undefined) {
        yield next
        continue
      }
      if (this.closed) return
      await new Promise<void>((resolve) => {
        this.wake = () => {
          this.wake = undefined
          resolve()
        }
      })
    }
  }
}

export class ClaudeAdapter implements Adapter {
  readonly id = 'claude'
  readonly label = 'Claude'
  readonly models = ['sonnet', 'opus', 'haiku']
  readonly efforts = ['low', 'medium', 'high']
  readonly supportsInjection = true

  /** The SDK drives the local `claude` CLI, so "can we run?" is "is it installed and credentialed?".
   * An explicit key/token in the environment answers that without shelling out at all; otherwise
   * fall back to a cached `claude --version` probe. Any surprise counts as unavailable. */
  async available(): Promise<boolean> {
    try {
      if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) return true
      return await probeCli('claude')
    } catch {
      return false
    }
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
          // idle waiting for more input forever, so end it here - unless a nudge arrived while
          // the turn was running, in which case the queue feeds it and the agent keeps going.
          if (msg.type === 'result' && !queue.hasPending) queue.close()
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
        const delivered = queue.push(`the user says: ${note}`)
        if (delivered) ctx.journal.write({ type: 'text', payload: { text: `nudge: ${note}` } })
        return delivered
      },
    }
  }
}
