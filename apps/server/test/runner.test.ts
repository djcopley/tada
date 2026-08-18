import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'
import { FakeAdapter, type FakeScript } from '../src/adapters/fake.js'
import type { Adapter, GateDecision } from '../src/adapters/types.js'
import { activity, agentRuns, memoryNotes, rules, settings, tickets } from '../src/db/schema.js'
import { git } from '../src/git.js'
import { runDirPath } from '../src/runs/runDir.js'
import { makeOrigin } from './helpers/gitFixtures.js'
import { reportOutcome } from './helpers/reportOutcome.js'
import { makeTestApp, seedTicket, type TestApp, waitFor } from './helpers/testApp.js'

const runRow = (t: TestApp, id: number) =>
  t.db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, id)).get()
const ticketRow = (t: TestApp, id: number) =>
  t.db.drizzle.select().from(tickets).where(eq(tickets.id, id)).get()
const activityTypes = (t: TestApp) =>
  t.db.drizzle
    .select({ type: activity.type })
    .from(activity)
    .all()
    .map((r) => r.type)

async function setup(script: FakeScript, opts: { repo?: boolean; timeoutMs?: number } = {}) {
  const fake = new FakeAdapter(script)
  const t = await makeTestApp({ adapters: new Map<string, Adapter>([['fake', fake]]) })
  await t.json({ method: 'PATCH', url: '/settings', payload: { adapter: 'fake', model: 'fake-1' } })
  if (opts.timeoutMs !== undefined) {
    await t.json({ method: 'PATCH', url: '/settings', payload: { timeoutMs: opts.timeoutMs } })
  }
  if (opts.repo) await t.store.addRepo(await makeOrigin('proj'))
  const ticket = seedTicket(t.db, { column: 'queued' })
  return { t, fake, ticket }
}

/** Waits until the run for `ticketId` is at `status`. */
async function untilRun(t: TestApp, ticketId: number, status: string) {
  let run: ReturnType<typeof runRow> | undefined
  await waitFor(() => {
    run = t.db.drizzle.select().from(agentRuns).where(eq(agentRuns.ticketId, ticketId)).get()
    return run?.status === status
  })
  if (!run) throw new Error('no run')
  return run
}

describe('a run that finishes', () => {
  test('moves itself to done — no review step, card in done, activity recorded', async () => {
    const { t, ticket } = await setup({
      act: async (ctx) => {
        // the fake reports through the same channel the MCP tool uses
        const run = t.db.drizzle
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.runToken, ctx.runToken))
          .get()
        if (!run) throw new Error('no run')
        reportOutcome(t.db, run.id, 'success', 'shipped it', 12)
      },
    })
    const runId = t.scheduler.enqueue(ticket.id)
    const run = await untilRun(t, ticket.id, 'done')
    expect(run.id).toBe(runId)
    expect(run.summary).toBe('shipped it')
    expect(run.testsPassed).toBe(12)
    expect(run.finishedAt).not.toBeNull()
    expect(ticketRow(t, ticket.id)?.column).toBe('done')
    expect(ticketRow(t, ticket.id)?.doneAt).not.toBeNull()
    expect(activityTypes(t)).toEqual(['run_started', 'run_done'])
    // the run dir is gone once the ticket filed itself
    expect(existsSync(runDirPath(runId))).toBe(false)
  })

  test('the outcome file is the fallback for agents without tools', async () => {
    const { t, ticket } = await setup({
      supportsGates: false,
      act: async (ctx) => {
        writeFileSync(
          join(ctx.runDir, 'scratch', 'outcome.json'),
          JSON.stringify({ status: 'success', summary: 'via file' }),
        )
      },
    })
    t.scheduler.enqueue(ticket.id)
    const run = await untilRun(t, ticket.id, 'done')
    expect(run.summary).toBe('via file')
  })
})

describe('failure', () => {
  test('is the only red: card in stopped, no auto-retry, reason journaled', async () => {
    const { t, ticket } = await setup({ exitCode: 3 })
    t.scheduler.enqueue(ticket.id)
    const run = await untilRun(t, ticket.id, 'failed')
    expect(run.summary).toBe('exited with code 3')
    expect(ticketRow(t, ticket.id)?.column).toBe('stopped')
    // nothing queued a new attempt
    expect(t.db.drizzle.select().from(agentRuns).all()).toHaveLength(1)
    expect(activityTypes(t)).toEqual(['run_started', 'run_failed'])
  })

  test('a turn that ends without an outcome is nudged back to work, not failed', async () => {
    const { t, fake, ticket } = await setup({
      // The first turn ends with no report — the sleep-in-the-background trap.
      onNudge: async (ctx) => {
        const run = t.db.drizzle
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.runToken, ctx.runToken))
          .get()
        if (!run) throw new Error('no run')
        reportOutcome(t.db, run.id, 'success', 'finished after the nudge')
      },
    })
    t.scheduler.enqueue(ticket.id)
    const run = await untilRun(t, ticket.id, 'done')
    expect(run.summary).toBe('finished after the nudge')
    expect(fake.nudges).toHaveLength(1)
    expect(fake.nudges[0]).toMatch(/report_outcome/)
  })

  test('an agent that ignores the nudges still fails, and is only nudged twice', async () => {
    const { t, fake, ticket } = await setup({})
    t.scheduler.enqueue(ticket.id)
    const run = await untilRun(t, ticket.id, 'failed')
    expect(run.summary).toBe('agent did not report an outcome')
    expect(fake.nudges).toHaveLength(2)
  })

  test('an agent that reported is never nudged', async () => {
    const { t, fake, ticket } = await setup({
      act: async (ctx) => {
        const run = t.db.drizzle
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.runToken, ctx.runToken))
          .get()
        if (!run) throw new Error('no run')
        reportOutcome(t.db, run.id, 'success', 'done first time')
      },
    })
    t.scheduler.enqueue(ticket.id)
    await untilRun(t, ticket.id, 'done')
    expect(fake.nudges).toEqual([])
  })

  test('re-run is a fresh attempt: new run, old transcript kept, card back through queued', async () => {
    const { t, ticket } = await setup({ exitCode: 1 })
    t.scheduler.enqueue(ticket.id)
    const first = await untilRun(t, ticket.id, 'failed')

    const res = await t.json({ method: 'POST', url: `/tickets/${ticket.id}/rerun` })
    expect(res.status).toBe(200)
    await waitFor(
      () =>
        t.db.drizzle
          .select()
          .from(agentRuns)
          .all()
          .filter((r) => r.status === 'failed').length === 2,
    )
    const runs = t.db.drizzle.select().from(agentRuns).all()
    expect(runs.map((r) => r.attemptNumber)).toEqual([1, 2])
    expect(runRow(t, first.id)?.status).toBe('failed') // preserved
  })
})

describe('cancel', () => {
  test('Stop run: the run is cancelled and the card goes to backlog', async () => {
    let release: (() => void) | undefined
    const { t, ticket } = await setup({
      act: (ctx) =>
        new Promise<void>((resolve, reject) => {
          release = resolve
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    })
    const runId = t.scheduler.enqueue(ticket.id)
    await untilRun(t, ticket.id, 'running')
    const res = await t.json({ method: 'POST', url: `/runs/${runId}/cancel` })
    expect(res.status).toBe(200)
    await untilRun(t, ticket.id, 'cancelled')
    expect(ticketRow(t, ticket.id)?.column).toBe('backlog')
    release?.()
  })
})

describe('permission gates', () => {
  const gated = (onDecision?: (d: GateDecision) => void): FakeScript => ({
    act: async (ctx) => {
      const decision = await ctx.gate({
        tool: 'Bash',
        input: { command: 'gh pr create --title x' },
      })
      onDecision?.(decision)
      const run = t0.db.drizzle
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.runToken, ctx.runToken))
        .get()
      if (run) reportOutcome(t0.db, run.id, 'success', 'done after gate')
    },
  })
  let t0: TestApp

  test('an `ask` rule holds the run in place: status held, reason permission, card in stopped, slot freed', async () => {
    const decisions: GateDecision[] = []
    const { t, ticket } = await setup(gated((d) => decisions.push(d)))
    t0 = t
    const runId = t.scheduler.enqueue(ticket.id)
    const held = await untilRun(t, ticket.id, 'held')
    expect(held.heldReason).toBe('permission')
    expect(held.hold).toMatchObject({
      reason: 'permission',
      tool: 'Bash',
      summary: 'gh pr create --title x',
      ruleTitle: 'Open a pull request',
      publishes: true,
    })
    expect(held.heldAt).not.toBeNull()
    expect(ticketRow(t, ticket.id)?.column).toBe('stopped')
    // held runs don't occupy a slot
    expect(t.scheduler.runningCount()).toBe(0)
    expect(activityTypes(t)).toEqual(['run_started', 'run_held'])

    // approve → resumes at that step, then finishes and files itself
    const res = await t.json({ method: 'POST', url: `/runs/${runId}/approve`, payload: {} })
    expect(res.status).toBe(200)
    await untilRun(t, ticket.id, 'done')
    expect(decisions).toEqual([{ behavior: 'allow' }])
    expect(runRow(t, runId)?.hold).toBeNull()
    expect(activityTypes(t)).toEqual(['run_started', 'run_held', 'approved', 'run_done'])
  })

  test('deny with a note is a redirection: the agent gets the note as the tool error and keeps going', async () => {
    const decisions: GateDecision[] = []
    const { t, ticket } = await setup(gated((d) => decisions.push(d)))
    t0 = t
    const runId = t.scheduler.enqueue(ticket.id)
    await untilRun(t, ticket.id, 'held')
    const res = await t.json({
      method: 'POST',
      url: `/runs/${runId}/deny`,
      payload: { note: 'split it first', saveToMemory: true },
    })
    expect(res.status).toBe(200)
    await untilRun(t, ticket.id, 'done')
    expect(decisions[0]?.behavior).toBe('deny')
    expect((decisions[0] as { reason: string }).reason).toContain('split it first')
    // the note is on the thread and in memory
    const detail = await t.json({ method: 'GET', url: `/tickets/${ticket.id}` })
    expect(detail.body.comments.map((c: { body: string }) => c.body)).toEqual(['split it first'])
    const notes = t.db.drizzle.select().from(memoryNotes).all()
    expect(notes.map((n) => [n.title, n.state, n.author])).toEqual([
      ['split it first', 'kept', 'human'],
    ])
  })

  test('always allow writes the rule table with provenance and a Today receipt, atomically with the resume', async () => {
    const { t, ticket } = await setup(gated())
    t0 = t
    const runId = t.scheduler.enqueue(ticket.id)
    const held = await untilRun(t, ticket.id, 'held')
    const ruleId = (held.hold as { ruleId: number }).ruleId

    const res = await t.json({
      method: 'POST',
      url: `/runs/${runId}/approve`,
      payload: { alwaysAllow: true },
    })
    expect(res.status).toBe(200)
    const rule = t.db.drizzle.select().from(rules).where(eq(rules.id, ruleId)).get()
    expect(rule).toMatchObject({ decision: 'allow', source: 'gate', sourceRunId: runId })
    const receipts = t.db.drizzle
      .select()
      .from(activity)
      .where(eq(activity.type, 'always_allowed'))
      .all()
    expect(receipts).toHaveLength(1)
    expect(receipts[0]?.message).toContain('always allow')
    await untilRun(t, ticket.id, 'done')

    // and the same table is what Settings renders
    const list = await t.json({ method: 'GET', url: '/rules' })
    const shown = list.body.find((r: { id: number }) => r.id === ruleId)
    expect(shown).toMatchObject({ decision: 'allow', source: 'gate', sourceRunId: runId })
  })

  test('a `never` rule denies without holding', async () => {
    const decisions: GateDecision[] = []
    const { t, ticket } = await setup({
      act: async (ctx) => {
        decisions.push(
          await ctx.gate({ tool: 'Bash', input: { command: 'git push --force origin main' } }),
        )
        decisions.push(
          await ctx.gate({ tool: 'Bash', input: { command: 'git push origin ticket/1' } }),
        )
        decisions.push(await ctx.gate({ tool: 'Read', input: { file_path: '/x' } }))
        const run = t.db.drizzle
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.runToken, ctx.runToken))
          .get()
        if (run) reportOutcome(t.db, run.id, 'success', 'ok')
      },
    })
    t.scheduler.enqueue(ticket.id)
    await untilRun(t, ticket.id, 'done')
    expect(decisions.map((d) => d.behavior)).toEqual(['deny', 'allow', 'allow'])
    expect(activityTypes(t)).not.toContain('run_held')
  })

  test('the wrong resolution for a hold is refused', async () => {
    const { t, ticket } = await setup(gated())
    t0 = t
    const runId = t.scheduler.enqueue(ticket.id)
    await untilRun(t, ticket.id, 'held')
    expect(
      (await t.json({ method: 'POST', url: `/runs/${runId}/answer`, payload: { answer: 'x' } }))
        .status,
    ).toBe(409)
    expect(
      (await t.json({ method: 'POST', url: `/runs/${runId}/continue`, payload: {} })).status,
    ).toBe(409)
    // and a run that isn't held at all
    expect((await t.json({ method: 'POST', url: `/runs/999/approve`, payload: {} })).status).toBe(
      404,
    )
    await t.json({ method: 'POST', url: `/runs/${runId}/approve`, payload: {} })
    await untilRun(t, ticket.id, 'done')
  })
})

describe('questions', () => {
  test('ask_user holds with reason question; the answer flows back into the tool input', async () => {
    let seen: GateDecision | undefined
    const { t, ticket } = await setup({
      act: async (ctx) => {
        seen = await ctx.gate({
          tool: 'mcp__tada__ask_user',
          input: { question: 'which backoff?', options: ['30s', '5m'] },
        })
        const run = t.db.drizzle
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.runToken, ctx.runToken))
          .get()
        if (run) reportOutcome(t.db, run.id, 'success', 'ok')
      },
    })
    const runId = t.scheduler.enqueue(ticket.id)
    const held = await untilRun(t, ticket.id, 'held')
    expect(held.hold).toEqual({
      reason: 'question',
      question: 'which backoff?',
      options: ['30s', '5m'],
    })
    const res = await t.json({
      method: 'POST',
      url: `/runs/${runId}/answer`,
      payload: { answer: '30s' },
    })
    expect(res.status).toBe(200)
    await untilRun(t, ticket.id, 'done')
    expect(seen).toEqual({
      behavior: 'allow',
      updatedInput: { question: 'which backoff?', options: ['30s', '5m'], answer: '30s' },
    })
    expect(activityTypes(t)).toContain('answered')
  })
})

describe('out of time', () => {
  const tinyBudget = (t: TestApp, ms: number) =>
    t.db.drizzle.update(settings).set({ timeoutMs: ms }).where(eq(settings.id, 1)).run()

  test('is a hold, not a failure: the gate holds at the next tool call and +time continues in place', async () => {
    const decisions: GateDecision[] = []
    const { t, ticket } = await setup({
      act: async (ctx) => {
        decisions.push(await ctx.gate({ tool: 'Read', input: { file_path: 'a' } }))
        await new Promise((r) => setTimeout(r, 150))
        decisions.push(await ctx.gate({ tool: 'Read', input: { file_path: 'b' } }))
        const run = t.db.drizzle
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.runToken, ctx.runToken))
          .get()
        if (run) reportOutcome(t.db, run.id, 'success', 'made it')
      },
    })
    tinyBudget(t, 50)
    const runId = t.scheduler.enqueue(ticket.id)
    const held = await untilRun(t, ticket.id, 'held')
    expect(held.heldReason).toBe('time')
    expect(held.hold).toEqual({ reason: 'time', budgetMs: 50 })
    expect(ticketRow(t, ticket.id)?.column).toBe('stopped')
    expect(decisions).toEqual([{ behavior: 'allow' }]) // the second call is what's holding

    const res = await t.json({
      method: 'POST',
      url: `/runs/${runId}/continue`,
      payload: { extraMs: 60_000 },
    })
    expect(res.status).toBe(200)
    await untilRun(t, ticket.id, 'done')
    expect(decisions).toEqual([{ behavior: 'allow' }, { behavior: 'allow' }])
    expect(runRow(t, runId)?.budgetMs).toBe(50 + 60_000)
    expect(activityTypes(t)).toEqual(['run_started', 'run_held', 'continued', 'run_done'])
  })

  test('for an agent that can be suspended, time up pauses it immediately; continue resumes it', async () => {
    let finish: (() => void) | undefined
    const { t, fake, ticket } = await setup({
      supportsGates: false,
      act: (ctx) =>
        new Promise<void>((resolve) => {
          finish = () => {
            writeFileSync(
              join(ctx.runDir, 'scratch', 'outcome.json'),
              JSON.stringify({ status: 'success', summary: 'eventually' }),
            )
            resolve()
          }
        }),
    })
    tinyBudget(t, 30)
    const runId = t.scheduler.enqueue(ticket.id)
    await untilRun(t, ticket.id, 'held')
    expect(fake.signals).toEqual(['pause'])
    await t.json({ method: 'POST', url: `/runs/${runId}/continue`, payload: { extraMs: 60_000 } })
    await untilRun(t, ticket.id, 'running')
    expect(fake.signals).toEqual(['pause', 'resume'])
    finish?.()
    await untilRun(t, ticket.id, 'done')
  })

  test('stopping an out-of-time run cancels it (card to backlog), never fails it', async () => {
    const { t, ticket } = await setup({
      supportsGates: false,
      act: (ctx) =>
        new Promise<void>((_, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    })
    tinyBudget(t, 30)
    const runId = t.scheduler.enqueue(ticket.id)
    await untilRun(t, ticket.id, 'held')
    await t.json({ method: 'POST', url: `/runs/${runId}/cancel` })
    await untilRun(t, ticket.id, 'cancelled')
    expect(ticketRow(t, ticket.id)?.column).toBe('backlog')
  })
})

describe('repo tags are output', () => {
  test('use_repo (lazy worktree) stamps the tag; the ticket had none before', async () => {
    const { t, ticket } = await setup(
      {
        act: async (ctx) => {
          // simulate what the MCP use_repo tool does, via the same server-side function
          const { addWorktree, runDirFor } = await import('../src/runs/runDir.js')
          const { stampRepoTag } = await import('../src/runs/tags.js')
          const run = t.db.drizzle
            .select()
            .from(agentRuns)
            .where(eq(agentRuns.runToken, ctx.runToken))
            .get()
          if (!run) throw new Error('no run')
          const repo = t.store.repo('proj')
          if (!repo) throw new Error('no repo')
          const dir = runDirFor(t.store, run.id)
          const wt = await addWorktree(t.store, dir, ticket.id, repo)
          stampRepoTag(t.db, ticket.id, 'proj')
          writeFileSync(join(wt, 'new.txt'), 'hi\n')
          await git(wt, 'add', '.')
          await git(wt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'work')
          reportOutcome(t.db, run.id, 'success', 'committed')
        },
      },
      { repo: true },
    )
    expect(ticketRow(t, ticket.id)?.repoTags).toEqual([])
    t.scheduler.enqueue(ticket.id)
    const run = await untilRun(t, ticket.id, 'done')
    expect(ticketRow(t, ticket.id)?.repoTags).toEqual(['proj'])
    expect(run.diffAdditions).toBe(1)
    expect(run.diffDeletions).toBe(0)
  })

  test('an agent without tools gets eager worktrees and is tagged for the repos it moved', async () => {
    const { t, ticket } = await setup(
      {
        supportsGates: false,
        act: async (ctx) => {
          const wt = join(ctx.runDir, 'proj')
          expect(existsSync(join(wt, 'README.md'))).toBe(true)
          writeFileSync(join(wt, 'x.txt'), 'x\n')
          await git(wt, 'add', '.')
          await git(wt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'work')
          writeFileSync(
            join(ctx.runDir, 'scratch', 'outcome.json'),
            JSON.stringify({ status: 'success', summary: 'ok' }),
          )
        },
      },
      { repo: true },
    )
    t.scheduler.enqueue(ticket.id)
    await untilRun(t, ticket.id, 'done')
    expect(ticketRow(t, ticket.id)?.repoTags).toEqual(['proj'])
  })

  test('there is no API that writes tags', async () => {
    const { t, ticket } = await setup({})
    const res = await t.json({
      method: 'PATCH',
      url: `/tickets/${ticket.id}`,
      payload: { title: 'renamed', repoTags: ['sneaky'] },
    })
    // zod strips unknown keys; the tag never lands
    expect(res.status).toBe(200)
    expect(ticketRow(t, ticket.id)?.repoTags).toEqual([])
  })
})

describe('notes', () => {
  test('a note on a live run is injected; on an idle ticket it waits in the thread', async () => {
    let finish: (() => void) | undefined
    const { t, fake, ticket } = await setup({
      act: (ctx) =>
        new Promise<void>((resolve) => {
          finish = () => {
            const run = t.db.drizzle
              .select()
              .from(agentRuns)
              .where(eq(agentRuns.runToken, ctx.runToken))
              .get()
            if (run) reportOutcome(t.db, run.id, 'success', 'ok')
            resolve()
          }
        }),
    })
    t.scheduler.enqueue(ticket.id)
    await untilRun(t, ticket.id, 'running')
    const live = await t.json({
      method: 'POST',
      url: `/tickets/${ticket.id}/notes`,
      payload: { body: 'go faster' },
    })
    expect(live.status).toBe(201)
    expect(live.body.delivered).toBe(true)
    expect(fake.injected).toEqual(['go faster'])
    finish?.()
    await untilRun(t, ticket.id, 'done')

    const idle = await t.json({
      method: 'POST',
      url: `/tickets/${ticket.id}/notes`,
      payload: { body: 'later' },
    })
    expect(idle.body.delivered).toBe(false)
    const detail = await t.json({ method: 'GET', url: `/tickets/${ticket.id}` })
    expect(detail.body.comments.map((c: { body: string }) => c.body)).toEqual([
      'go faster',
      'later',
    ])
  })
})

describe('adapter problems', () => {
  test('an unavailable adapter fails the run with a journaled reason', async () => {
    const { t, ticket } = await setup({ available: false })
    t.scheduler.enqueue(ticket.id)
    const run = await untilRun(t, ticket.id, 'failed')
    expect(run.summary).toBe('adapter not available on this server')
  })
})
