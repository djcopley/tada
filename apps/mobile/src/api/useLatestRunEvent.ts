import { type UseQueryOptions, useQueries, useQuery } from '@tanstack/react-query'
import { narrationText } from '../components/EventFeed'
import { useClient } from './ClientContext'

/** Shared query shape for both the singular and plural hooks below, so a ticket rendered on
 * Board (via {@link useLatestRunEvent}) and on Control (via {@link useLatestRunEvents}) hits the
 * same cache entry instead of double-fetching. */
function latestRunEventQuery(
  client: ReturnType<typeof useClient>,
  runId: number | undefined,
  enabled: boolean,
): UseQueryOptions<string | null, Error, string | null, readonly ['latestRunEvent', number | undefined]> {
  const active = enabled && runId !== undefined
  return {
    queryKey: ['latestRunEvent', runId] as const,
    queryFn: async () => {
      const events = await client.runEvents(runId as number)
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const text = narrationText(events[i]!)
        if (text !== null) return text
      }
      // react-query logs an error and refuses to cache a query function that resolves to
      // `undefined` — `null` is the "no narratable event yet" sentinel instead; both hooks below
      // fold it back to `undefined` for callers, since neither cares about the distinction.
      return null
    },
    enabled: active,
    // A modest tail poll, not the full-transcript hook's 2s — this only ever renders one line.
    refetchInterval: active ? 4000 : false,
  }
}

/**
 * The latest narratable event for a run (via {@link narrationText} — the same text/status/error/
 * tool-use narration the run's own event feed shows), for the one-line agent-well tails on Board
 * and Control: `working…` is the true no-events-yet fallback, not the default. `runId` is the
 * *running* run's id (undefined until one resolves — no query fires yet); `enabled` gates polling
 * to while the run is actually live, since a finished run has nothing left to tail.
 */
export function useLatestRunEvent(runId: number | undefined, enabled: boolean): string | undefined {
  const client = useClient()
  const { data } = useQuery(latestRunEventQuery(client, runId, enabled))
  return data ?? undefined
}

/** Plural form for a list rendered from one parent component (Control's wide live cards and
 * narrow digest both read from the same `liveNow` list) — Rules of Hooks forbids calling
 * {@link useLatestRunEvent} once per array item there, so this drives every entry off a single
 * `useQueries` call and returns a lookup by run id. */
export function useLatestRunEvents(runIds: (number | undefined)[]): Map<number, string | undefined> {
  const client = useClient()
  const results = useQueries({
    queries: runIds.map((runId) => latestRunEventQuery(client, runId, runId !== undefined)),
  })
  const byRunId = new Map<number, string | undefined>()
  runIds.forEach((runId, i) => {
    if (runId !== undefined) byRunId.set(runId, results[i]?.data ?? undefined)
  })
  return byRunId
}
