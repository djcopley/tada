import type { Hold, LiveActivityProps } from '@tada/shared'
import { ACTIVITY_DISMISSAL_MS, runToActivityProps } from '@tada/shared'
import { and, asc, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm'
import type { ApnsMessage, ApnsSender } from './apns.js'
import type { TadaDb } from './db/index.js'
import {
  activity,
  agentRuns,
  liveActivitySessions,
  liveActivityStartTokens,
  tickets,
} from './db/schema.js'

/**
 * How long a session that just closed is still allowed to catch a late-arriving token. Covers a
 * background-launched app's round trip to POST /live-activity/tokens — generous on purpose, since
 * the failure mode of too-short (a token silently dropped) is worse than too-long (an inert token
 * bound to an already-closed session, which is harmless — nothing reads a closed session's token).
 */
const TOKEN_BIND_GRACE_MS = 30_000

/**
 * Binds a token the app just read off ActivityKit to the session it must belong to. iOS returns a
 * token with no way to say which activity, and therefore which run, it is for — that's the whole
 * reason only one activity exists at a time.
 *
 * The match is FIFO — the OLDEST still-tokenless session, not the newest — and includes sessions
 * that closed within the last `TOKEN_BIND_GRACE_MS`, not just open ones. Both are needed together:
 * without the grace window, a session that finishes (run A) right as a new one opens (run B) drops
 * out of the pool the instant it closes, so A's in-flight token POST lands on B's row instead —
 * and B's own token then finds nothing open and tokenless to bind to at all. Keeping the closing
 * session bindable a little longer, and always preferring the oldest pending request over the
 * newest, means a late token still finds the session it was actually issued for. A token with
 * nothing to bind to (older than the grace window, or none tokenless at all) is dropped: the
 * activity it belongs to is already over.
 */
export function bindActivityToken(db: TadaDb, token: string): void {
  const cutoff = new Date(Date.now() - TOKEN_BIND_GRACE_MS)
  const target = db.drizzle
    .select()
    .from(liveActivitySessions)
    .where(
      and(
        isNull(liveActivitySessions.pushToken),
        or(isNull(liveActivitySessions.endedAt), gte(liveActivitySessions.endedAt, cutoff)),
      ),
    )
    .orderBy(asc(liveActivitySessions.startedAt))
    .get()
  if (!target) return
  db.drizzle
    .update(liveActivitySessions)
    .set({ pushToken: token })
    .where(eq(liveActivitySessions.id, target.id))
    .run()
}

/**
 * The agent's most recent line for a run: its `summary` when the run has one, else the newest
 * `activity` row logged for it, else null (a run that has said nothing yet still gets a card —
 * `runToActivityProps` falls back to "working").
 */
function latestLine(db: TadaDb, runId: number, run: { summary: string | null }): string | null {
  if (run.summary) return run.summary
  const row = db.drizzle
    .select()
    .from(activity)
    .where(eq(activity.runId, runId))
    .orderBy(desc(activity.createdAt))
    .get()
  return row?.message ?? null
}

/**
 * The focused run: the one run that owns the single Live Activity. A run that wants you outranks
 * a run that is merely working; between equals, the most recent wins. Everything else is
 * non-focused and simply has no card — it still pings, and it still sits on the board.
 */
export function focusRunId(db: TadaDb): number | null {
  const live = db.drizzle
    .select()
    .from(agentRuns)
    .where(inArray(agentRuns.status, ['running', 'held']))
    .all()
  if (live.length === 0) return null
  const rank = (r: (typeof live)[number]) => (r.status === 'held' ? 1 : 0)
  const best = live.reduce((a, b) => {
    if (rank(b) !== rank(a)) return rank(b) > rank(a) ? b : a
    return (b.startedAt?.getTime() ?? 0) > (a.startedAt?.getTime() ?? 0) ? b : a
  })
  return best.id
}

/**
 * `yourTurn` and `failed` are the only two states allowed to alert. A run that is merely working
 * updates at priority 5 and stays silent — the entire point of an overnight agent is that it does
 * not wake you.
 */
function delivery(
  props: LiveActivityProps,
  title: string,
): Pick<ApnsMessage, 'priority' | 'alert'> {
  if (props.phase === 'yourTurn') {
    return { priority: 10, alert: { title: `"${title}" is stopped on you`, body: props.agentLine } }
  }
  if (props.phase === 'failed') {
    return { priority: 10, alert: { title: `"${title}" failed`, body: props.agentLine } }
  }
  return { priority: 5 }
}

/** A run plus its ticket, the pair `runToActivityProps` needs. Null when either row is gone —
 * defensive; nothing actually deletes a run or ticket out from under an open session. */
function loadRunAndTicket(
  db: TadaDb,
  runId: number,
): { run: typeof agentRuns.$inferSelect; ticket: typeof tickets.$inferSelect } | null {
  const run = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
  if (!run) return null
  const ticket = db.drizzle.select().from(tickets).where(eq(tickets.id, run.ticketId)).get()
  if (!ticket) return null
  return { run, ticket }
}

function buildProps(
  db: TadaDb,
  run: typeof agentRuns.$inferSelect,
  ticket: typeof tickets.$inferSelect,
) {
  return runToActivityProps({
    ticket: { id: ticket.id, title: ticket.title },
    run: {
      id: run.id,
      status: run.status,
      hold: run.hold as Hold | null,
      startedAt: run.startedAt,
      budgetMs: run.budgetMs,
    },
    line: latestLine(db, run.id, run),
  })
}

export interface LiveActivityChannel {
  /**
   * Recompute which run owns the lock screen and push whatever actually changed. Every run
   * lifecycle event calls this and nothing else — one entry point means the card cannot get out
   * of step with the board, whatever order events arrive in.
   */
  sync(): void
}

/**
 * Builds the one live-activity policy. `db` and `send` are both injected so tests never touch
 * the network and can seed state directly into the tables. Every push is fire-and-forget —
 * `sync()` is called from the runner's hot path and must never throw or block on the network; a
 * failed push (dead token, APNs outage) just leaves the card stale, it does not fail the run.
 */
export function createLiveActivityChannel(deps: {
  db: TadaDb
  send: ApnsSender
}): LiveActivityChannel {
  const { db, send: sender } = deps
  // `start` is the only event sent to a push-to-start token (see startIfFocusedAndIdle) —
  // update/end go to a session's per-activity token, which lives only in `liveActivitySessions`
  // and is never reused, so there is nothing to garbage-collect there. A dead start token
  // (APNs 410/BadDeviceToken/ExpiredToken, e.g. after the app reinstalls) is deleted the same way
  // notify.ts#sendWeb drops a dead web push subscription — otherwise it fans `start` out forever
  // and, while a rotated token briefly coexists with its replacement, can produce two cards.
  const push = (msg: ApnsMessage) =>
    void sender(msg)
      .then((result) => {
        if (result.gone && msg.event === 'start') {
          db.drizzle
            .delete(liveActivityStartTokens)
            .where(eq(liveActivityStartTokens.token, msg.token))
            .run()
        }
      })
      .catch(() => {})

  function sync(): void {
    // sync() is called from the runner's hot path on every lifecycle event and must never throw
    // — a bad row, a synchronously-throwing sender, anything unexpected here must not take the
    // run down with it. Log and swallow; the card just goes stale until the next event retries.
    try {
      syncUnguarded()
    } catch (err) {
      console.error('live activity sync failed:', err)
    }
  }

  function syncUnguarded(): void {
    const openSession = db.drizzle
      .select()
      .from(liveActivitySessions)
      .where(isNull(liveActivitySessions.endedAt))
      .get()
    const focused = focusRunId(db)

    // Step 2: the open session no longer belongs to the focused run (including no focus at all).
    // Close it, pushing a terminal update + end when the run finished, or a bare end otherwise.
    if (openSession && openSession.runId !== focused) {
      const source = loadRunAndTicket(db, openSession.runId)
      if (source && openSession.pushToken) {
        const props = buildProps(db, source.run, source.ticket)
        const terminal =
          source.run.status === 'done' ||
          source.run.status === 'failed' ||
          source.run.status === 'cancelled'
        if (props && terminal) {
          push({
            token: openSession.pushToken,
            event: 'update',
            props,
            ...delivery(props, source.ticket.title),
          })
          push({
            token: openSession.pushToken,
            event: 'end',
            props,
            priority: 5,
            dismissalDate: new Date(Date.now() + ACTIVITY_DISMISSAL_MS),
          })
        } else if (props) {
          push({ token: openSession.pushToken, event: 'end', props, priority: 5 })
        } else if (openSession.lastProps) {
          // `runToActivityProps` returns null for a `cancelled` (or `queued`) run — there is no
          // "current" card to describe. That is still a real card going away (Stop run / rerun
          // are normal paths, not errors), so fall back to the last props actually pushed and
          // end it with no dismissal delay: a run you stopped on purpose leaves the lock screen
          // at once, unlike a finished run's card, which lingers to be read. With no `lastProps`
          // either, nothing was ever pushed to this activity — just close the row below.
          push({
            token: openSession.pushToken,
            event: 'end',
            props: JSON.parse(openSession.lastProps) as LiveActivityProps,
            priority: 5,
          })
        }
      }
      db.drizzle
        .update(liveActivitySessions)
        .set({ endedAt: new Date() })
        .where(eq(liveActivitySessions.id, openSession.id))
        .run()

      // Step 3 can apply in the same sync: closing session A must not stop run B, held at the
      // same moment, from getting its card in this very call.
      if (focused !== null) startIfFocusedAndIdle(focused)
      return
    }

    if (focused === null) return

    if (!openSession) {
      startIfFocusedAndIdle(focused)
      return
    }

    // Step 4: the open session already belongs to the focused run — update it in place, but only
    // when the props actually changed.
    const source = loadRunAndTicket(db, focused)
    if (!source) return
    const props = buildProps(db, source.run, source.ticket)
    if (!props) return
    const propsJson = JSON.stringify(props)
    if (propsJson === openSession.lastProps) return
    // `lastProps` is only written when a push actually goes out. If it were written unconditionally
    // (even with no token yet), a change that lands in the tokenless window between "start" and the
    // app's POST /live-activity/tokens would be recorded as already-sent and never pushed once the
    // token finally arrives — the card would sit on stale "working" props for the run's first gate,
    // silently, since a held run produces no further props change to retry with. Leaving `lastProps`
    // untouched here means the next sync (e.g. the one bindActivityToken triggers) still sees a
    // mismatch and pushes it for real.
    if (!openSession.pushToken) return
    db.drizzle
      .update(liveActivitySessions)
      .set({ lastProps: propsJson })
      .where(eq(liveActivitySessions.id, openSession.id))
      .run()
    push({
      token: openSession.pushToken,
      event: 'update',
      props,
      ...delivery(props, source.ticket.title),
    })
  }

  // Step 3: there is a focused run and no open session — start one. A push-to-start token goes
  // to every registered device (there is exactly one in practice, but nothing enforces that).
  function startIfFocusedAndIdle(focused: number): void {
    const source = loadRunAndTicket(db, focused)
    if (!source) return
    const props = buildProps(db, source.run, source.ticket)
    if (!props) return
    const startTokens = db.drizzle.select().from(liveActivityStartTokens).all()
    // With no start tokens, a card cannot be started at all — inserting a session here would
    // strand the next reported activity token against a run that never got a card.
    if (startTokens.length === 0) return
    db.drizzle
      .insert(liveActivitySessions)
      .values({ runId: focused, pushToken: null, lastProps: JSON.stringify(props) })
      .run()
    for (const t of startTokens) {
      push({
        token: t.token,
        event: 'start',
        props,
        inputPushToken: true,
        ...delivery(props, source.ticket.title),
      })
    }
  }

  return { sync }
}
