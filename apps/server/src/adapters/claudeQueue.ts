import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

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
 * message and the agent picks it up. Closing the queue ends the session.
 *
 * Knowing *when* to close is the subtle part. The SDK's input pump drains this iterable eagerly -
 * every yielded message is written to the CLI's stdin the moment it is produced - so "is anything
 * still queued here?" is false almost all the time and says nothing about whether the agent has
 * answered. Instead the queue counts messages it has injected but not yet seen answered: each
 * `result` message (one per turn) either retires an outstanding nudge or, when none is
 * outstanding, ends the session. That way a nudge delivered mid-turn always gets its own turn
 * before stdin closes.
 */
export class UserMessageQueue implements AsyncIterable<SDKUserMessage> {
  private readonly pending: SDKUserMessage[] = []
  private outstanding = 0
  private closed = false
  private wake: (() => void) | undefined

  get isClosed(): boolean {
    return this.closed
  }

  /** Injected-but-unanswered notes; exposed for tests and diagnostics. */
  get outstandingCount(): number {
    return this.outstanding
  }

  /** Queues a message without expecting a turn of its own (the initial prompt). */
  push(text: string): boolean {
    if (this.closed) return false
    this.pending.push(userMessage(text))
    this.wake?.()
    return true
  }

  /** Queues a mid-run note and reserves a turn for it, so `onTurnEnd` won't close underneath it. */
  inject(text: string): boolean {
    if (!this.push(text)) return false
    this.outstanding++
    return true
  }

  /** Called for every `result` message: retire one outstanding nudge, or end the session. */
  onTurnEnd(): void {
    if (this.outstanding > 0) {
      this.outstanding--
      return
    }
    this.close()
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
