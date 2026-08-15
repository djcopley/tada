import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, test } from 'vitest'
import { UserMessageQueue } from '../src/adapters/claudeQueue.js'

/** The single text block each queued message carries. */
function textOf(msg: SDKUserMessage): string {
  const content = msg.message.content
  if (typeof content === 'string') return content
  const [block] = content
  if (block?.type !== 'text') throw new Error('expected a text block')
  return block.text
}

/** Lets a parked `await` in the queue's iterator actually run before we assert on it. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('UserMessageQueue', () => {
  test('1. yields messages FIFO and shapes them as SDK user messages', async () => {
    const queue = new UserMessageQueue()
    queue.push('first')
    queue.inject('second')
    queue.push('third')
    queue.close()

    const seen: SDKUserMessage[] = []
    for await (const msg of queue) seen.push(msg)

    expect(seen.map(textOf)).toEqual(['first', 'second', 'third'])
    expect(seen[0]).toMatchObject({ type: 'user', parent_tool_use_id: null })
    expect(seen[0]?.message.role).toBe('user')
  })

  test('2. push and inject return false once the queue is closed', () => {
    const queue = new UserMessageQueue()
    expect(queue.push('ok')).toBe(true)
    expect(queue.inject('ok too')).toBe(true)

    queue.close()

    expect(queue.isClosed).toBe(true)
    expect(queue.push('too late')).toBe(false)
    expect(queue.inject('also too late')).toBe(false)
    // A refused inject must not reserve a turn.
    expect(queue.outstandingCount).toBe(1)
  })

  test('3. close wakes a consumer parked waiting for input', async () => {
    const queue = new UserMessageQueue()
    queue.push('hello')

    const iterator = queue[Symbol.asyncIterator]()
    expect(textOf((await iterator.next()).value as SDKUserMessage)).toBe('hello')

    // Now parked: no pending messages, queue still open.
    let settled = false
    const parked = iterator.next().then((r) => {
      settled = true
      return r
    })
    await flush()
    expect(settled).toBe(false)

    queue.close()
    expect((await parked).done).toBe(true)
  })

  test('4. a push wakes a parked consumer with the new message', async () => {
    const queue = new UserMessageQueue()
    const iterator = queue[Symbol.asyncIterator]()

    const parked = iterator.next()
    await flush()

    queue.inject('the user says: look at the logs')
    const result = await parked
    expect(result.done).toBe(false)
    expect(textOf(result.value as SDKUserMessage)).toBe('the user says: look at the logs')
  })

  test('5. a result arriving while a nudge is unanswered does not close the queue', async () => {
    const queue = new UserMessageQueue()
    queue.push('the task')

    // The SDK's input pump drains eagerly, so by the time the turn ends nothing is left queued
    // here - the outstanding counter, not the buffer, is what keeps the session alive.
    const iterator = queue[Symbol.asyncIterator]()
    await iterator.next()

    queue.inject('the user says: also fix the docs')
    await iterator.next()
    expect(queue.outstandingCount).toBe(1)

    // The turn the nudge interrupted ends: it retires the nudge rather than closing.
    queue.onTurnEnd()
    expect(queue.isClosed).toBe(false)
    expect(queue.outstandingCount).toBe(0)

    // The nudge's own turn ends: nothing is owed, so the session ends.
    queue.onTurnEnd()
    expect(queue.isClosed).toBe(true)
  })

  test('6. the first result closes a session that was never nudged', () => {
    const queue = new UserMessageQueue()
    queue.push('the task')

    queue.onTurnEnd()

    expect(queue.isClosed).toBe(true)
  })

  test('7. several nudges each get their own turn before the session ends', () => {
    const queue = new UserMessageQueue()
    queue.push('the task')
    queue.inject('one')
    queue.inject('two')
    expect(queue.outstandingCount).toBe(2)

    queue.onTurnEnd()
    queue.onTurnEnd()
    expect(queue.isClosed).toBe(false)

    queue.onTurnEnd()
    expect(queue.isClosed).toBe(true)
  })
})
