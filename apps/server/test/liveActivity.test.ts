import type { Hold, RunStatus } from '@tada/shared'
import { ACTIVITY_DISMISSAL_MS } from '@tada/shared'
import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'
import type { ApnsMessage } from '../src/apns.js'
import { createApnsSender } from '../src/apns.js'
import type { TadaDb } from '../src/db/index.js'
import {
  agentRuns,
  liveActivitySessions,
  liveActivityStartTokens,
  tickets,
} from '../src/db/schema.js'
import { createLiveActivityChannel } from '../src/liveActivity.js'
import { makeTestApp } from './helpers/testApp.js'

/** A ticket and a run in a given state, straight into the tables — no scheduler involved. */
function seedRun(
  db: TadaDb,
  state: { status: RunStatus; hold?: Hold | null; startedAt?: Date; title?: string },
): number {
  const ticket = db.drizzle
    .insert(tickets)
    // `position` is notNull with no default — fractional ordering, so any number will do here.
    .values({
      title: state.title ?? 'Add CSV export to the reports page',
      column: 'running',
      position: 1,
    })
    .returning()
    .get()
  const run = db.drizzle
    .insert(agentRuns)
    .values({
      ticketId: ticket.id,
      adapter: 'fake',
      model: 'fake',
      status: state.status,
      hold: state.hold ?? null,
      heldReason: state.hold?.reason ?? null,
      budgetMs: 1_800_000,
      runToken: `token-${ticket.id}`,
      startedAt: state.startedAt ?? new Date(),
    })
    .returning()
    .get()
  return run.id
}

const permissionHold: Hold = {
  reason: 'permission',
  tool: 'Bash',
  summary: 'git push origin main',
  ruleId: 1,
  ruleTitle: 'push a branch',
  publishes: true,
}

test('the first live run gets the card, and the start asks for its token back', async () => {
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  const sent: ApnsMessage[] = []
  const channel = createLiveActivityChannel({ db: t.db, send: async (m) => void sent.push(m) })

  seedRun(t.db, { status: 'running' })
  channel.sync()

  expect(sent).toHaveLength(1)
  expect(sent[0]?.event).toBe('start')
  expect(sent[0]?.token).toBe('start-1')
  expect(sent[0]?.inputPushToken).toBe(true)
  expect(sent[0]?.props.phase).toBe('working')
  expect(t.db.drizzle.select().from(liveActivitySessions).all()).toHaveLength(1)
})

test('nothing is pushed while the session has no activity token yet', async () => {
  // start goes to the start token; updates need the per-activity token, which the app reports later
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  const sent: ApnsMessage[] = []
  const channel = createLiveActivityChannel({ db: t.db, send: async (m) => void sent.push(m) })

  const runId = seedRun(t.db, { status: 'running' })
  channel.sync()
  expect(sent).toHaveLength(1) // the 'start' push above

  // The run's summary changes but the session still has no pushToken — nothing more to send.
  t.db.drizzle
    .update(agentRuns)
    .set({ summary: 'reading the reports page' })
    .where(eq(agentRuns.id, runId))
    .run()
  channel.sync()

  expect(sent).toHaveLength(1)
  const session = t.db.drizzle.select().from(liveActivitySessions).all()[0]
  expect(session?.pushToken).toBeNull()
})

test('a held run takes the card from a merely working one', async () => {
  // seed run A running (session open, token bound), then run B held; sync
  // expect: an `end` for A's activity, then a `start` for B
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  const sent: ApnsMessage[] = []
  const channel = createLiveActivityChannel({ db: t.db, send: async (m) => void sent.push(m) })

  const runA = seedRun(t.db, { status: 'running', startedAt: new Date(1_000) })
  channel.sync()
  const sessionA = t.db.drizzle.select().from(liveActivitySessions).all()[0]
  if (!sessionA) throw new Error('session A was not opened')
  t.db.drizzle
    .update(liveActivitySessions)
    .set({ pushToken: 'activity-a' })
    .where(eq(liveActivitySessions.id, sessionA.id))
    .run()
  sent.length = 0

  seedRun(t.db, { status: 'held', hold: permissionHold, startedAt: new Date(2_000) })
  channel.sync()

  expect(sent).toHaveLength(2)
  expect(sent[0]?.event).toBe('end')
  expect(sent[0]?.token).toBe('activity-a')
  expect(sent[1]?.event).toBe('start')
  expect(sent[1]?.token).toBe('start-1')

  const rows = t.db.drizzle.select().from(liveActivitySessions).all()
  expect(rows.find((r) => r.runId === runA)?.endedAt).not.toBeNull()
  expect(rows.filter((r) => r.endedAt === null)).toHaveLength(1)
})

test('an event that changes nothing on the card sends nothing', async () => {
  // sync twice with no state change; expect one push, not two
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  const sent: ApnsMessage[] = []
  const channel = createLiveActivityChannel({ db: t.db, send: async (m) => void sent.push(m) })

  seedRun(t.db, { status: 'running' })
  channel.sync()
  channel.sync()

  expect(sent).toHaveLength(1)
})

test('a run that stops on you is pushed at priority 10 with an alert; working is 5 and silent', async () => {
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  const sent: ApnsMessage[] = []
  const channel = createLiveActivityChannel({ db: t.db, send: async (m) => void sent.push(m) })

  seedRun(t.db, { status: 'running' })
  channel.sync()
  expect(sent[0]?.priority).toBe(5)
  expect(sent[0]?.alert).toBeUndefined()

  const session = t.db.drizzle.select().from(liveActivitySessions).all()[0]
  if (!session) throw new Error('session was not opened')
  t.db.drizzle
    .update(liveActivitySessions)
    .set({ pushToken: 'activity-a' })
    .where(eq(liveActivitySessions.id, session.id))
    .run()
  sent.length = 0

  seedRun(t.db, { status: 'held', hold: permissionHold, startedAt: new Date(2_000) })
  channel.sync()

  const start = sent.find((m) => m.event === 'start')
  expect(start?.priority).toBe(10)
  expect(start?.alert).toBeDefined()
  expect(start?.alert?.title).toContain('stopped on you')
})

test('a finished run gets a terminal card, then an end four seconds out', async () => {
  // expect: update with phase 'done', then end with dismissalDate ≈ now + ACTIVITY_DISMISSAL_MS
  // and the session row closed
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  const sent: ApnsMessage[] = []
  const channel = createLiveActivityChannel({ db: t.db, send: async (m) => void sent.push(m) })

  const runId = seedRun(t.db, { status: 'running' })
  channel.sync()
  const session = t.db.drizzle.select().from(liveActivitySessions).all()[0]
  if (!session) throw new Error('session was not opened')
  t.db.drizzle
    .update(liveActivitySessions)
    .set({ pushToken: 'activity-a' })
    .where(eq(liveActivitySessions.id, session.id))
    .run()
  sent.length = 0

  const before = Date.now()
  t.db.drizzle.update(agentRuns).set({ status: 'done' }).where(eq(agentRuns.id, runId)).run()
  channel.sync()

  expect(sent).toHaveLength(2)
  expect(sent[0]?.event).toBe('update')
  expect(sent[0]?.props.phase).toBe('done')
  expect(sent[1]?.event).toBe('end')
  const dismissalDate = sent[1]?.dismissalDate
  if (!dismissalDate) throw new Error('end push carried no dismissalDate')
  const delta = dismissalDate.getTime() - before
  expect(delta).toBeGreaterThanOrEqual(ACTIVITY_DISMISSAL_MS - 1000)
  expect(delta).toBeLessThanOrEqual(ACTIVITY_DISMISSAL_MS + 5000)

  const rows = t.db.drizzle.select().from(liveActivitySessions).all()
  expect(rows.find((r) => r.runId === runId)?.endedAt).not.toBeNull()
})

test('with no APNs sender configured the channel is undefined and nothing is stored', async () => {
  // createLiveActivityChannel is only built when a sender exists; assert index.ts's guard shape
  // by calling createApnsSender with an empty config and expecting undefined
  const sender = createApnsSender({} as Parameters<typeof createApnsSender>[0])
  expect(sender).toBeUndefined()
})
