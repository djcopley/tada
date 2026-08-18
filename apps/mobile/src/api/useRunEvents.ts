import type { ApiRunEvent } from '@tada/shared'
import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useClient } from './ClientContext'
import { keys } from './queries'

/**
 * Polls `runEvents(runId, after)` every 2s while `live` is true, always
 * passing the highest server event id seen so far as `after` so each page
 * only contains events we haven't appended yet. Dedupe-by-id guards this
 * specifically: a page can legitimately repeat an id we've already
 * appended, e.g. after a refetch race.
 *
 * There is no separate WS-ingest path. WS `run_event` messages carry no
 * server id, so appending them directly used to produce a second,
 * synthetic-id row for the same event the next poll fetched with its real
 * id — every event rendered twice whenever the socket was healthy. Callers
 * that receive a WS event should call the returned `refetch` instead, which
 * pulls the same event down through the deduped polling path.
 */
export function useRunEvents(runId: number, { live }: { live: boolean }) {
  const client = useClient()
  const [events, setEvents] = useState<ApiRunEvent[]>([])
  const seenServerIds = useRef<Set<number>>(new Set())
  const lastServerId = useRef<number | undefined>(undefined)

  const { refetch } = useQuery({
    queryKey: keys.runEvents(runId),
    queryFn: async () => {
      const page = await client.runEvents(runId, lastServerId.current)
      const additions = page.filter((event) => !seenServerIds.current.has(event.id))
      if (additions.length > 0) {
        for (const event of additions) seenServerIds.current.add(event.id)
        const maxId = page.reduce((max, event) => Math.max(max, event.id), lastServerId.current ?? -Infinity)
        lastServerId.current = maxId
        setEvents((prev) => [...prev, ...additions])
      }
      return page
    },
    refetchInterval: live ? 2000 : false,
  })

  return { events, refetch }
}
