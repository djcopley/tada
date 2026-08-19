import type { ApiRun, ApiTicket, ActivityAction, LiveActivityProps } from '@tada/shared'
import { runToActivityProps } from '@tada/shared'

/**
 * Parses the `target` string a Live Activity button reports through
 * `addUserInteractionListener`. `TadaRunActivity.tsx` draws every button with
 * `target={`${action.kind}:${action.value ?? ''}`}` — this is the other half of that contract.
 * Splits on the FIRST `:` only, because an `answer` action's value (an option's own text) may
 * itself contain a colon.
 */
export function parseTarget(target: string): ActivityAction | null {
  const sep = target.indexOf(':')
  if (sep === -1) return null
  const kind = target.slice(0, sep)
  const value = target.slice(sep + 1)
  switch (kind) {
    case 'approve':
      return { kind: 'approve', label: 'Approve' }
    case 'deny':
      return { kind: 'deny', label: 'Deny' }
    case 'answer':
      return { kind: 'answer', label: value, value }
    case 'continue':
      return { kind: 'continue', label: 'Continue' }
    case 'stop':
      return { kind: 'stop', label: 'Stop' }
    case 'rerun':
      return { kind: 'rerun', label: 'Re-run' }
    case 'open':
      return { kind: 'open', label: 'Open' }
    default:
      return null
  }
}

/**
 * Maps a button press to the request it fires. Bodies mirror the zod schemas in
 * `apps/server/src/routes/runs.ts` exactly — `saveToMemory` is omitted rather than sent `false`,
 * since the schema already defaults it. `open` needs no call: the app is already being brought
 * forward by the tap, so it returns null.
 */
export function actionRequest(
  props: LiveActivityProps,
  action: ActivityAction,
): { path: string; body: Record<string, unknown> } | null {
  switch (action.kind) {
    case 'approve':
      return { path: `/runs/${props.runId}/approve`, body: { alwaysAllow: false } }
    case 'deny':
      return { path: `/runs/${props.runId}/deny`, body: { note: 'denied from the lock screen' } }
    case 'answer':
      return { path: `/runs/${props.runId}/answer`, body: { answer: action.value ?? action.label } }
    case 'continue':
      return { path: `/runs/${props.runId}/continue`, body: {} }
    case 'stop':
      return { path: `/runs/${props.runId}/cancel`, body: {} }
    // Re-run is filed against the ticket, not the run — which is why ticketId rides in the props.
    case 'rerun':
      return { path: `/tickets/${props.ticketId}/rerun`, body: {} }
    case 'open':
      return null
  }
}

/** What the card shows immediately after a tap, before the network call resolves. */
export function optimisticProps(props: LiveActivityProps): LiveActivityProps {
  return { ...props, phase: 'working', agentLine: 'sending…', actions: [] }
}

/** What the card must fall back to when the call behind a tap doesn't land — never left sitting
 * on the optimistic state above, which would silently misrepresent an approval that never happened. */
export function failedProps(props: LiveActivityProps): LiveActivityProps {
  return {
    ...props,
    phase: 'failed',
    agentLine: "couldn't reach tada — open the app",
    actions: [{ kind: 'open', label: 'Open' }],
  }
}

/**
 * The one run a lock-screen tap can be acting on. ActivityKit hands `addUserInteractionListener`
 * a `target` string and nothing else — no run id, no activity id — so `register.ts` has to
 * rediscover which ticket owns the single Live Activity before it can act. Mirrors the server's
 * `focusRunId` (apps/server/src/liveActivity.ts): a held run outranks a merely-running one, and
 * between equals the most recently started wins — the same run the server would have pushed the
 * card for.
 */
export function pickFocusedTicket(tickets: ApiTicket[]): (ApiTicket & { run: ApiRun }) | null {
  const live = tickets.filter(
    (t): t is ApiTicket & { run: ApiRun } =>
      t.run !== null && (t.run.status === 'running' || t.run.status === 'held'),
  )
  if (live.length === 0) return null
  const rank = (run: ApiRun) => (run.status === 'held' ? 1 : 0)
  const startedAt = (t: ApiTicket & { run: ApiRun }) =>
    t.run.startedAt ? new Date(t.run.startedAt).getTime() : 0
  return live.reduce((a, b) => {
    if (rank(b.run) !== rank(a.run)) return rank(b.run) > rank(a.run) ? b : a
    return startedAt(b) > startedAt(a) ? b : a
  })
}

/** Rebuilds the focused ticket's `LiveActivityProps` from a board response, via the same pure
 * mapping (`@tada/shared#runToActivityProps`) the server uses to build the pushed content state —
 * so a button press acts on a close approximation of what the lock screen is currently showing. */
export function focusedActivityProps(tickets: ApiTicket[]): LiveActivityProps | null {
  const found = pickFocusedTicket(tickets)
  if (!found) return null
  return runToActivityProps({
    ticket: { id: found.id, title: found.title },
    run: {
      id: found.run.id,
      status: found.run.status,
      hold: found.run.hold,
      startedAt: found.run.startedAt ? new Date(found.run.startedAt) : null,
      budgetMs: found.run.budgetMs,
    },
    line: found.run.summary,
  })
}
