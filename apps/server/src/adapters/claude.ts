import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Adapter, AdapterEvent, RunContext } from './types.js'

const INPUT_PREVIEW_MAX_CHARS = 500

/** Bridges an AbortSignal (from RunContext) to the AbortController the SDK expects. */
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

export class ClaudeAdapter implements Adapter {
  readonly name = 'claude'
  readonly models = ['sonnet', 'opus', 'haiku'] as const
  readonly efforts = ['low', 'medium', 'high'] as const

  async run(ctx: RunContext): Promise<{ exitCode: number }> {
    const q = query({
      prompt: ctx.prompt,
      options: {
        cwd: ctx.runDir,
        model: ctx.model,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        abortController: abortControllerFrom(ctx.signal),
        mcpServers: {
          tada: {
            type: 'http',
            url: ctx.mcp.url,
            headers: { Authorization: `Bearer ${ctx.mcp.token}` },
          },
        },
      },
    })

    for await (const msg of q) {
      for (const event of toAdapterEvents(msg)) ctx.onEvent(event)
    }

    // SDK errors reject this generator's iteration (thrown from the `for await`) rather than
    // reaching here, so the runner's adapterError branch handles failures; a normal exit means
    // the loop drained without throwing.
    return { exitCode: 0 }
  }
}
