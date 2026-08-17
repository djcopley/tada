import type { ApiAdapterInfo, ApiStatus } from '@tada/shared'
import { describe, expect, test } from 'vitest'
import { CodexAdapter, codexArgs } from '../src/adapters/codex.js'
import {
  CLI_CAPABILITY_NOTE,
  cliLineEvent,
  probeCli,
  withOutcomeFileInstruction,
} from '../src/adapters/exec.js'
import { FakeAdapter } from '../src/adapters/fake.js'
import { GeminiAdapter, geminiArgs } from '../src/adapters/gemini.js'
import type { Adapter, AdapterEvent, AdapterStartCtx } from '../src/adapters/types.js'
import { serverVersion } from '../src/version.js'
import { makeTestApp } from './helpers/testApp.js'

describe('adapter discovery endpoints', () => {
  test('GET /adapters returns one ApiAdapterInfo per registered adapter, incl. gate support', async () => {
    const t = await makeTestApp({
      adapters: new Map<string, Adapter>([
        ['fake', new FakeAdapter()],
        [
          'cli',
          new FakeAdapter({ supportsGates: false, supportsInjection: false, available: false }),
        ],
      ]),
    })
    const res = await t.json({ method: 'GET', url: '/adapters' })
    const infos = res.body as ApiAdapterInfo[]
    expect(infos.map((i) => [i.id, i.available, i.supportsGates, i.supportsInjection])).toEqual([
      ['fake', true, true, true],
      ['fake', false, false, false],
    ])
    expect(infos[0]).toMatchObject({
      label: 'Fake',
      models: ['fake-1'],
      efforts: ['low', 'medium', 'high'],
    })
    expect((await t.app.inject({ method: 'GET', url: '/adapters' })).statusCode).toBe(401)
  })

  test('GET /status reports version, sources, counts and agent availability', async () => {
    const t = await makeTestApp({
      adapters: new Map<string, Adapter>([['fake', new FakeAdapter()]]),
    })
    const status = (await t.json({ method: 'GET', url: '/status' })).body as ApiStatus
    expect(status).toEqual({
      ok: true,
      version: serverVersion,
      sources: [],
      ticketCount: 0,
      noteCount: 0,
      agents: [{ id: 'fake', available: true }],
    })
  })
})

describe('CLI adapters', () => {
  test('17. codex and gemini advertise their models, efforts, and no injection', () => {
    const codex = new CodexAdapter()
    expect(codex.id).toBe('codex')
    expect(codex.label).toBe('Codex')
    expect(codex.models).toEqual(['gpt-5.2-codex', 'gpt-5.2'])
    expect(codex.efforts).toEqual(['low', 'medium', 'high'])
    expect(codex.supportsInjection).toBe(false)
    expect(codex.supportsGates).toBe(false)

    const gemini = new GeminiAdapter()
    expect(gemini.id).toBe('gemini')
    expect(gemini.label).toBe('Gemini')
    expect(gemini.models).toEqual(['gemini-3-pro', 'gemini-3-flash'])
    expect(gemini.efforts).toEqual(['default'])
    expect(gemini.supportsInjection).toBe(false)
  })

  test('18. probeCli reports false for a missing binary and caches the answer', async () => {
    const missing = `tada-not-a-real-cli-${Date.now()}`
    expect(await probeCli(missing)).toBe(false)
    expect(await probeCli(missing)).toBe(false)
  })

  test('19. the CLI prompt wrapper asks for scratch/outcome.json', () => {
    const wrapped = withOutcomeFileInstruction('do the work')
    expect(wrapped).toContain('do the work')
    expect(wrapped).toContain('scratch/outcome.json')
    expect(wrapped).toContain('summary')
  })

  /** The ctx a runner hands an adapter, with an already-aborted signal so `start` returns without
   * ever spawning the (possibly absent) CLI - argv and the session-start journal line are both
   * produced before the first await. */
  function cliCtx(overrides: Partial<AdapterStartCtx> = {}) {
    const controller = new AbortController()
    controller.abort()
    const events: AdapterEvent[] = []
    const ctx: AdapterStartCtx = {
      prompt: 'do the work',
      runDir: '/tmp/run',
      model: 'gpt-5.2-codex',
      effort: 'high',
      mcpUrl: 'http://127.0.0.1:0/mcp',
      runToken: 'tok',
      signal: controller.signal,
      journal: { write: (e) => events.push(e) },
      gate: async () => ({ behavior: 'allow' as const }),
      ...overrides,
    }
    return { ctx, events }
  }

  test('20. codex argv passes the run model with -m and the effort as a config override', () => {
    const { ctx } = cliCtx()
    const args = codexArgs(ctx)

    expect(args.slice(0, 3)).toEqual([
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
    ])
    expect(args).toContain('-m')
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-5.2-codex')
    expect(args).toContain('-c')
    expect(args[args.indexOf('-c') + 1]).toBe('model_reasoning_effort=high')
    // The prompt is last and still carries the outcome-file instruction.
    expect(args.at(-1)).toContain('do the work')
    expect(args.at(-1)).toContain('scratch/outcome.json')
  })

  test("21. codex omits the effort override for codex's own default ('medium')", () => {
    const args = codexArgs(cliCtx({ effort: 'medium' }).ctx)
    expect(args).not.toContain('-c')
    expect(args).toContain('-m')
  })

  test('22. gemini argv passes the run model with -m (it has no effort flag)', () => {
    const args = geminiArgs(cliCtx({ model: 'gemini-3-pro', effort: 'default' }).ctx)
    expect(args[args.indexOf('-m') + 1]).toBe('gemini-3-pro')
    expect(args).toContain('--yolo')
    expect(args[args.indexOf('-p') + 1]).toContain('scratch/outcome.json')
    expect(args).not.toContain('-c')
  })

  test('23. both CLI adapters journal their reduced capabilities at session start', async () => {
    for (const adapter of [new CodexAdapter(), new GeminiAdapter()]) {
      const { ctx, events } = cliCtx()
      const session = adapter.start(ctx)
      await expect(session.done).rejects.toThrow()

      expect(events[0]).toEqual({ type: 'text', payload: { text: CLI_CAPABILITY_NOTE } })
      expect(CLI_CAPABILITY_NOTE).toContain('scratch/outcome.json')
      expect(CLI_CAPABILITY_NOTE).toBe(CLI_CAPABILITY_NOTE.toLowerCase())
    }
  })
})

describe('CLI stdout line rendering', () => {
  /** The `text` a journaled event would carry for one stdout line. */
  function textOf(line: string): unknown {
    return (cliLineEvent(line).payload as { text: string }).text
  }

  test('24. codex item events render as prose, not JSON blobs', () => {
    expect(
      textOf(
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'item_1', type: 'agent_message', text: 'Fixed the flaky test.' },
        }),
      ),
    ).toBe('Fixed the flaky test.')

    expect(
      textOf(
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_2',
            type: 'command_execution',
            command: 'pnpm test',
            aggregated_output: '...',
            exit_code: 0,
            status: 'completed',
          },
        }),
      ),
    ).toBe('$ pnpm test (exit 0)')

    expect(
      textOf(
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_3',
            type: 'file_change',
            changes: [
              { path: 'src/a.ts', kind: 'update' },
              { path: 'src/b.ts', kind: 'add' },
            ],
            status: 'completed',
          },
        }),
      ),
    ).toBe('edited src/a.ts, src/b.ts')

    expect(
      textOf(
        JSON.stringify({
          type: 'item.started',
          item: { id: 'i', type: 'reasoning', text: 'Planning.' },
        }),
      ),
    ).toBe('Planning.')
  })

  test('25. lifecycle and error events fall back to a compact label or their message', () => {
    expect(textOf(JSON.stringify({ type: 'thread.started', thread_id: 'th_1' }))).toBe(
      'thread.started',
    )
    expect(
      textOf(
        JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } }),
      ),
    ).toBe('turn.completed')
    expect(textOf(JSON.stringify({ type: 'error', message: 'stream disconnected' }))).toBe(
      'stream disconnected',
    )
    expect(
      textOf(JSON.stringify({ type: 'turn.failed', error: { message: 'model overloaded' } })),
    ).toBe('model overloaded')
    // Unknown item shapes degrade to the item type rather than raw JSON.
    expect(
      textOf(
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'i', type: 'web_search', query: 'zod' },
        }),
      ),
    ).toBe('search zod')
  })

  test('26. non-JSON lines pass through verbatim, and the parsed object rides along for JSON lines', () => {
    const plain = cliLineEvent('just some gemini output')
    expect(plain).toEqual({ type: 'text', payload: { text: 'just some gemini output' } })

    const json = cliLineEvent(JSON.stringify({ type: 'thread.started', thread_id: 'th_1' }))
    expect((json.payload as { json: unknown }).json).toEqual({
      type: 'thread.started',
      thread_id: 'th_1',
    })
  })
})
