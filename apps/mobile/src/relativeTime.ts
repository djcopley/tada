const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

/**
 * Coarse human-readable age of an ISO timestamp relative to now. Buckets
 * intentionally widen (minutes → hours → days) rather than showing exact
 * durations — this is a glance-at-a-list affordance, not a precise clock.
 */
export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < MINUTE_MS) return 'just now'
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}m ago`
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}h ago`
  return `${Math.floor(diffMs / DAY_MS)}d ago`
}

/**
 * Bare age with no "ago" suffix and a week bucket on top — the compact mono
 * meta the Board's cards carry (`2d`, `1w`) instead of a sentence-style
 * timestamp. Takes an explicit `now` (defaulting to `Date.now()`) so callers
 * ticking a shared clock (`useNowTick`) stay internally consistent.
 */
export function bareAge(iso: string, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - new Date(iso).getTime())
  if (diffMs < MINUTE_MS) return 'just now'
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}m`
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}h`
  if (diffMs < WEEK_MS) return `${Math.floor(diffMs / DAY_MS)}d`
  return `${Math.floor(diffMs / WEEK_MS)}w`
}
