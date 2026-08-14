import type { ApiRunEvent } from '@tada/shared'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { useClient } from './ClientContext'

export interface WsRunEvent {
  type: ApiRunEvent['type']
  payload: unknown
}

/**
 * Accumulates the run activity feed from two independent sources that share
 * one growing list:
 *
 *  - Polling: while `live` is true, refetches `runEvents(runId, after)`
 *    every 2s, always passing the highest server event id seen so far as
 *    `after` so each page only contains events we haven't appended yet.
 *    Dedupe-by-id guards this path specifically (a page can legitimately
 *    repeat an id we've already appended, e.g. after a refetch race).
 *
 *  - `ingest(evt)`: for WS-delivered events (wired in Task 10). These
 *    arrive as `{ type, payload }` with no id from the server, so each one
 *    is assigned a synthetic, strictly-decreasing negative id — negative
 *    so it can never collide with a real (positive) server id. Dedupe does
 *    NOT apply to this path: ingest has no server id to compare against,
 *    so every call appends a new row.
 */
export function useRunEvents(runId: number, { live }: { live: boolean }) {
  const client = useClient()
  const [events, setEvents] = useState<ApiRunEvent[]>([])
  const seenServerIds = useRef<Set<number>>(new Set())
  const lastServerId = useRef<number | undefined>(undefined)
  const nextSyntheticId = useRef(0)

  useQuery({
    queryKey: ['runEvents', runId],
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

  const ingest = useCallback(
    (evt: WsRunEvent) => {
      nextSyntheticId.current -= 1
      const event: ApiRunEvent = {
        id: nextSyntheticId.current,
        runId,
        type: evt.type,
        payload: evt.payload,
        createdAt: new Date().toISOString(),
      }
      setEvents((prev) => [...prev, event])
    },
    [runId],
  )

  return { events, ingest }
}
