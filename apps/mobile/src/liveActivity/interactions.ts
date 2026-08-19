import type { ActivityAction, LiveActivityProps } from '@tada/shared'

/** What `parseTarget` recovers from a button's `target` string: which run it acts on, and what
 * to do to it. */
export interface ParsedTarget {
  runId: number
  action: ActivityAction
}

function actionForKind(kind: string, value: string): ActivityAction | null {
  switch (kind) {
    case 'approve':
      return { kind: 'approve', label: 'Approve' }
    case 'deny':
      return { kind: 'deny', label: 'Deny' }
    case 'answer':
      // An empty value is not a real option — the server 400s on an empty answer, so treat it as
      // unparseable (a no-op tap) rather than firing a request that will only bounce.
      return value.length > 0 ? { kind: 'answer', label: value, value } : null
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
 * Parses the `target` string a Live Activity button reports through
 * `addUserInteractionListener`. `TadaRunActivity.tsx` draws every button with
 * `target={`${runId}:${action.kind}:${action.value ?? ''}`}` — this is the other half of that
 * contract. The run id leads and is never omitted: a terminal card (failed, with Re-run/Open) can
 * legitimately linger on the lock screen after a *different* run has taken over the single Live
 * Activity slot, so a tap must name its own run rather than the client guessing which one is
 * "current". Splits on the first TWO colons only — everything after the second is the value, so
 * an answer option that itself contains a colon (e.g. a URL) still round-trips.
 */
export function parseTarget(target: string): ParsedTarget | null {
  const first = target.indexOf(':')
  if (first === -1) return null
  const second = target.indexOf(':', first + 1)
  if (second === -1) return null

  const runId = Number(target.slice(0, first))
  if (!Number.isFinite(runId)) return null

  const kind = target.slice(first + 1, second)
  const value = target.slice(second + 1)
  const action = actionForKind(kind, value)
  return action ? { runId, action } : null
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
