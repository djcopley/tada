import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { FakeAdapter } from '../src/adapters/fake.js'
import type { AdapterEvent, AdapterStartCtx } from '../src/adapters/types.js'
import { createDefaultColumns, openDb } from '../src/db/index.js'
import { agentRuns, columns, tickets, workspaces } from '../src/db/schema.js'
import { Journal } from '../src/runs/journal.js'

/** The AdapterStartCtx a runner would build, with an in-memory journal for assertions. */
function startCtx(overrides: Partial<AdapterStartCtx> = {}): AdapterStartCtx & {
  written: AdapterEvent[]
} {
  const written: AdapterEvent[] = []
  return {
    runDir: mkdtempSync(join(tmpdir(), 'tada-')),
    prompt: 'test prompt',
    model: 'test-model',
    effort: 'medium',
    mcpUrl: 'http://localhost:3000/mcp',
    runToken: 'token',
    signal: new AbortController().signal,
    journal: { write: (e: AdapterEvent) => written.push(e) },
    written,
    ...overrides,
  }
}

describe('FakeAdapter', () => {
  test('1. journals its scripted events and exits with code 0', async () => {
    const adapter = new FakeAdapter({
      events: [
        { type: 'text', payload: 'hi' },
        { type: 'status', payload: 'running' },
      ],
    })

    const ctx = startCtx()
    const result = await adapter.start(ctx).done

    expect(result.exitCode).toBe(0)
    expect(ctx.written).toEqual([
      { type: 'text', payload: 'hi' },
      { type: 'status', payload: 'running' },
    ])
    expect(adapter.id).toBe('fake')
    expect(adapter.models).toEqual(['fake-1'])
    expect(await adapter.available()).toBe(true)
  })

  test('2. act callback runs with ctx and can write to runDir', async () => {
    const { writeFileSync } = await import('node:fs')
    const { readFileSync } = await import('node:fs')

    const adapter = new FakeAdapter({
      act: async (ctx) => {
        writeFileSync(join(ctx.runDir, 'test.txt'), 'hello')
      },
      exitCode: 42,
    })

    const ctx = startCtx()
    const result = await adapter.start(ctx).done

    expect(result.exitCode).toBe(42)
    expect(readFileSync(join(ctx.runDir, 'test.txt'), 'utf-8')).toBe('hello')
  })

  test('2b. inject records the note and journals it; declines when injection is unsupported', async () => {
    const adapter = new FakeAdapter({ act: () => new Promise<void>(() => {}) })
    const ctx = startCtx()
    const session = adapter.start(ctx)

    expect(session.inject('look at the logs')).toBe(true)
    expect(adapter.injected).toEqual(['look at the logs'])
    expect(ctx.written).toEqual([{ type: 'text', payload: { text: 'nudge: look at the logs' } }])

    const silent = new FakeAdapter({
      act: () => new Promise<void>(() => {}),
      supportsInjection: false,
    })
    expect(silent.start(startCtx()).inject('nope')).toBe(false)
    expect(silent.injected).toEqual([])
  })

  test('3. Journal.write appends to events table and transcript file, calls broadcast', async () => {
    const { readFileSync, existsSync } = await import('node:fs')
    const broadcastCalls: Array<{ runId: number; e: AdapterEvent }> = []

    // Setup db
    const dbPath = join(mkdtempSync(join(tmpdir(), 'tada-')), 'tada.db')
    const db = openDb(dbPath)

    // Create workspace, column, ticket, agentRun
    const [ws] = db.drizzle
      .insert(workspaces)
      .values({ name: 'test-ws', path: '/tmp/test' })
      .returning()
      .all()
    if (!ws) throw new Error('workspace insert returned no row')

    createDefaultColumns(db, ws.id)
    const cols = db.drizzle.select().from(columns).all()
    const ready = cols.find((c) => c.kind === 'ready')
    if (!ready) throw new Error('ready column not seeded')

    const [ticket] = db.drizzle
      .insert(tickets)
      .values({
        workspaceId: ws.id,
        columnId: ready.id,
        title: 'Test Ticket',
        description: '',
        position: 1,
      })
      .returning()
      .all()
    if (!ticket) throw new Error('ticket insert returned no row')

    const transcriptPath = join(mkdtempSync(join(tmpdir(), 'tada-')), 'transcript.jsonl')
    const [run] = db.drizzle
      .insert(agentRuns)
      .values({
        ticketId: ticket.id,
        adapter: 'test',
        model: 'test-model',
        status: 'running',
        runToken: 'token123',
        transcriptPath,
      })
      .returning()
      .all()
    if (!run) throw new Error('agentRun insert returned no row')

    // Create journal and write events
    const journal = new Journal(db, run.id, transcriptPath, (runId, e) =>
      broadcastCalls.push({ runId, e }),
    )

    const event1 = { type: 'text' as const, payload: 'first event' }
    const event2 = { type: 'status' as const, payload: 'running' }

    journal.write(event1)
    journal.write(event2)

    // Query the events table
    const { events: eventsTable } = await import('../src/db/schema.js')
    const savedEvents = db.drizzle.select().from(eventsTable).all()
    expect(savedEvents).toHaveLength(2)
    expect(savedEvents[0]).toMatchObject({
      runId: run.id,
      type: event1.type,
      payload: event1.payload,
    })
    expect(savedEvents[1]).toMatchObject({
      runId: run.id,
      type: event2.type,
      payload: event2.payload,
    })

    // Verify transcript file was appended
    expect(existsSync(transcriptPath)).toBe(true)
    const transcript = readFileSync(transcriptPath, 'utf-8')
    const lines = transcript.trim().split('\n')
    expect(lines).toHaveLength(2)
    const [line0, line1] = lines
    if (line0 === undefined || line1 === undefined) throw new Error('expected two transcript lines')
    expect(JSON.parse(line0)).toEqual(event1)
    expect(JSON.parse(line1)).toEqual(event2)

    // Verify broadcast was called
    expect(broadcastCalls).toHaveLength(2)
    expect(broadcastCalls[0]).toEqual({ runId: run.id, e: event1 })
    expect(broadcastCalls[1]).toEqual({ runId: run.id, e: event2 })

    journal.close()
  })

  test('4. FakeAdapter honors ctx.signal - pre-aborted signal rejects with AbortError', async () => {
    const adapter = new FakeAdapter({
      events: [{ type: 'text', payload: 'should not emit' }],
    })

    const controller = new AbortController()
    controller.abort()

    const ctx = startCtx({
      signal: controller.signal,
      journal: {
        write: () => {
          throw new Error('journal.write should not be called')
        },
      },
    })

    await expect(adapter.start(ctx).done).rejects.toThrow(
      expect.objectContaining({
        name: 'AbortError',
      }),
    )
  })
})
