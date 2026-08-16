import { QueryClient } from '@tanstack/react-query'

/**
 * The QueryClient every screen test renders with. `retry: false` so a rejected mock fails fast,
 * and `gcTime: Infinity` because the default 5-minute garbage-collect timers (armed for every
 * query/mutation whose observers unmount) are ref'd `setTimeout`s that keep the Jest worker
 * alive long after the suite is done — the "worker process has failed to exit gracefully"
 * warning came from dozens of these per file. TanStack's own Jest guidance recommends this.
 */
export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { gcTime: Number.POSITIVE_INFINITY },
    },
  })
}
