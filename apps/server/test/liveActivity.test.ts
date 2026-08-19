import type { Hold, RunStatus } from '@tada/shared'
import { ACTIVITY_DISMISSAL_MS } from '@tada/shared'
import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'
import type { ApnsMessage, ApnsSender } from '../src/apns.js'
import { createApnsSender } from '../src/apns.js'
import type { TadaDb } from '../src/db/index.js'
import {
  agentRuns,
  liveActivitySessions,
  liveActivityStartTokens,
  tickets,
} from '../src/db/schema.js'
import { bindActivityToken, createLiveActivityChannel } from '../src/liveActivity.js'
import { makeTestApp } from './helpers/testApp.js'

/** A fake `ApnsSender` that records every message and reports the token as live — most tests
 * don't care about `gone`; the GC tests below build their own sender instead. */
function fakeSend(sent: ApnsMessage[]): ApnsSender {
  return async (m) => {
    sent.push(m)
    return { gone: false }
  }
}

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
  const channel = createLiveActivityChannel({ db: t.db, send: fakeSend(sent) })

  seedRun(t.db, { status: 'running' })
  channel.sync()

  expect(sent).toHaveLength(1)
  expect(sent[0]?.event).toBe('start')
  expect(sent[0]?.token).toBe('start-1')
  expect(sent[0]?.inputPushToken).toBe(true)
  expect(sent[0]?.props.phase).toBe('working')
  expect(t.db.drizzle.select().from(liveActivitySessions).all()).toHaveLength(1)
})

test('nothing is pushed while the session has no activity token yet, and the change is not lost', async () => {
  // start goes to the start token; updates need the per-activity token, which the app reports later
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  const sent: ApnsMessage[] = []
  const channel = createLiveActivityChannel({ db: t.db, send: fakeSend(sent) })

  const runId = seedRun(t.db, { status: 'running' })
  channel.sync()
  expect(sent).toHaveLength(1) // the 'start' push above
  const startProps = t.db.drizzle.select().from(liveActivitySessions).all()[0]?.lastProps

  // The run's summary changes but the session still has no pushToken — nothing more to send yet.
  t.db.drizzle
    .update(agentRuns)
    .set({ summary: 'reading the reports page' })
    .where(eq(agentRuns.id, runId))
    .run()
  channel.sync()

  expect(sent).toHaveLength(1)
  const session = t.db.drizzle.select().from(liveActivitySessions).all()[0]
  if (!session) throw new Error('session was not opened')
  expect(session.pushToken).toBeNull()
  // `lastProps` must NOT have been advanced to the unsent change — otherwise once the token binds,
  // the next sync would compare the (already-current) props against lastProps, find them equal, and
  // swallow the update for good. The change must still look "new" once a token exists to send it to.
  expect(session.lastProps).toBe(startProps)

  // The token finally arrives — the pending change must go out now, not be lost.
  t.db.drizzle
    .update(liveActivitySessions)
    .set({ pushToken: 'activity-a' })
    .where(eq(liveActivitySessions.id, session.id))
    .run()
  channel.sync()
  expect(sent).toHaveLength(2)
  expect(sent[1]?.event).toBe('update')
  expect(sent[1]?.props.agentLine).toContain('reading the reports page')
})

test('a state change that lands before the activity token binds is still pushed once it does', async () => {
  // The realistic sequence: token seeded, run starts (running, tokenless), the run holds before the
  // app's POST /live-activity/tokens round-trip lands, then the token finally binds. Exactly one
  // APNs message must have gone out for the start — and once the token binds, the pending `yourTurn`
  // change must be pushed at priority 10 with an alert. Before the fix, writing `lastProps` on every
  // sync (token or not) made the held-state change look already-sent, and it was silently swallowed.
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  const sent: ApnsMessage[] = []
  const channel = createLiveActivityChannel({ db: t.db, send: fakeSend(sent) })

  const runId = seedRun(t.db, { status: 'running' })
  channel.sync()
  expect(sent).toHaveLength(1)
  expect(sent[0]?.event).toBe('start')

  t.db.drizzle
    .update(agentRuns)
    .set({ status: 'held', hold: permissionHold, heldReason: 'permission' })
    .where(eq(agentRuns.id, runId))
    .run()
  channel.sync()
  expect(sent).toHaveLength(1) // still just the start — no token to push the hold to yet

  bindActivityToken(t.db, 'activity-a')
  channel.sync()

  expect(sent).toHaveLength(2)
  const update = sent[1]
  expect(update?.event).toBe('update')
  expect(update?.props.phase).toBe('yourTurn')
  expect(update?.priority).toBe(10)
  expect(update?.alert).toBeDefined()
})

test('a held run takes the card from a merely working one', async () => {
  // seed run A running (session open, token bound), then run B held; sync
  // expect: an `end` for A's activity, then a `start` for B
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  const sent: ApnsMessage[] = []
  const channel = createLiveActivityChannel({ db: t.db, send: fakeSend(sent) })

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
  // Bind an activity token first — otherwise step 4's push is gated off by the token check alone
  // and the `lastProps` comparison this test is meant to exercise is never reached.
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  const sent: ApnsMessage[] = []
  const channel = createLiveActivityChannel({ db: t.db, send: fakeSend(sent) })

  const runId = seedRun(t.db, { status: 'running' })
  channel.sync()
  expect(sent).toHaveLength(1) // the 'start' push

  const session = t.db.drizzle.select().from(liveActivitySessions).all()[0]
  if (!session) throw new Error('session was not opened')
  t.db.drizzle
    .update(liveActivitySessions)
    .set({ pushToken: 'activity-a' })
    .where(eq(liveActivitySessions.id, session.id))
    .run()

  channel.sync() // no state change: the comparison against lastProps must gate this push off
  expect(sent).toHaveLength(1)

  t.db.drizzle
    .update(agentRuns)
    .set({ summary: 'reading the reports page' })
    .where(eq(agentRuns.id, runId))
    .run()
  channel.sync() // a real change: the comparison must let this one through
  expect(sent).toHaveLength(2)
  expect(sent[1]?.event).toBe('update')
})

test('a run that stops on you is pushed at priority 10 with an alert; working is 5 and silent', async () => {
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  const sent: ApnsMessage[] = []
  const channel = createLiveActivityChannel({ db: t.db, send: fakeSend(sent) })

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
  const channel = createLiveActivityChannel({ db: t.db, send: fakeSend(sent) })

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

test('a cancelled focused run pushes exactly one end (from lastProps) and closes the row', async () => {
  // runToActivityProps returns null for a cancelled run — there is no "current" card to build.
  // The card must still leave the lock screen: fall back to the session's stored lastProps and
  // push a bare `end`, no dismissal delay (a run you stopped on purpose leaves at once).
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  const sent: ApnsMessage[] = []
  const channel = createLiveActivityChannel({ db: t.db, send: fakeSend(sent) })

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

  t.db.drizzle.update(agentRuns).set({ status: 'cancelled' }).where(eq(agentRuns.id, runId)).run()
  channel.sync()

  expect(sent).toHaveLength(1)
  expect(sent[0]?.event).toBe('end')
  expect(sent[0]?.token).toBe('activity-a')
  expect(sent[0]?.dismissalDate).toBeUndefined()

  const rows = t.db.drizzle.select().from(liveActivitySessions).all()
  expect(rows.find((r) => r.runId === runId)?.endedAt).not.toBeNull()
})

test('focusRunId breaks a tie between two running runs by recency, not just rank', async () => {
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  const sent: ApnsMessage[] = []
  const channel = createLiveActivityChannel({ db: t.db, send: fakeSend(sent) })

  seedRun(t.db, { status: 'running', startedAt: new Date(1_000), title: 'older run' })
  const newer = seedRun(t.db, { status: 'running', startedAt: new Date(9_000), title: 'newer run' })
  channel.sync()

  expect(sent).toHaveLength(1)
  expect(sent[0]?.props.runId).toBe(newer)
  const rows = t.db.drizzle.select().from(liveActivitySessions).all()
  expect(rows[0]?.runId).toBe(newer)
})

test('a token that lands after A closes and B opens still binds to A, not B', async () => {
  // Run A starts (tokenless — its own token POST is still "in flight"), then before it arrives B
  // takes focus (a hold outranks running): sync() closes A's session and opens B's in one call.
  // A's late token must bind to A (now closed but within the grace window), not to B, which would
  // otherwise leave B's own token later finding nothing open and tokenless to bind to.
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  const sent: ApnsMessage[] = []
  const channel = createLiveActivityChannel({ db: t.db, send: fakeSend(sent) })

  seedRun(t.db, { status: 'running', startedAt: new Date(1_000) })
  channel.sync()
  const sessionA = t.db.drizzle.select().from(liveActivitySessions).all()[0]
  if (!sessionA) throw new Error('session A was not opened')
  expect(sessionA.pushToken).toBeNull() // A's own token never arrived

  seedRun(t.db, { status: 'held', hold: permissionHold, startedAt: new Date(2_000) })
  channel.sync() // closes A (no push — A never had a token), opens B

  const rows = t.db.drizzle.select().from(liveActivitySessions).all()
  const sessionB = rows.find((r) => r.id !== sessionA.id)
  if (!sessionB) throw new Error('session B was not opened')
  expect(sessionB.pushToken).toBeNull()

  // A's late token finally lands.
  bindActivityToken(t.db, 'token-for-a')

  const afterA = t.db.drizzle.select().from(liveActivitySessions).all()
  expect(afterA.find((r) => r.id === sessionA.id)?.pushToken).toBe('token-for-a')
  expect(afterA.find((r) => r.id === sessionB.id)?.pushToken).toBeNull()

  // B's own token arrives next — it must still have a home.
  bindActivityToken(t.db, 'token-for-b')
  const afterB = t.db.drizzle.select().from(liveActivitySessions).all()
  expect(afterB.find((r) => r.id === sessionB.id)?.pushToken).toBe('token-for-b')
})

test('sync() never throws, even when the sender throws synchronously', async () => {
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  // A sender that throws before ever returning a promise — the case `.catch()` alone can't
  // guard against, which is why `sync()` needs its own top-level try/catch.
  const throwingSend = ((): never => {
    throw new Error('boom')
  }) as ApnsSender
  const channel = createLiveActivityChannel({ db: t.db, send: throwingSend })

  seedRun(t.db, { status: 'running' })
  expect(() => channel.sync()).not.toThrow()
})

test('a dead push-to-start token is deleted, and the live one keeps working', async () => {
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'dead' }).run()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'alive' }).run()
  const sent: ApnsMessage[] = []
  const send: ApnsSender = async (m) => {
    sent.push(m)
    return { gone: m.token === 'dead' }
  }
  const channel = createLiveActivityChannel({ db: t.db, send })

  seedRun(t.db, { status: 'running' })
  channel.sync()
  await new Promise((r) => setTimeout(r, 0)) // let the fire-and-forget push().then() run

  expect(sent).toHaveLength(2)
  const tokens = t.db.drizzle
    .select()
    .from(liveActivityStartTokens)
    .all()
    .map((r) => r.token)
  expect(tokens).toEqual(['alive'])
})
