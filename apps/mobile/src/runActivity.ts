import type { ApiRun } from '@tada/shared'
import type { BadgeStatus } from './components/ui/Badge'
import { elapsedLabel } from './control'
import { runStatusVisual } from './design/status'

/**
 * Pure formatting/logic for the live-run screen — split out from the screen component so the
 * header Badge and meta line are unit testable without rendering. Instrument Ink content rules
 * apply: sentence case, mono data, `·` separators, lowercase status labels.
 */

/** `"parlor · parlor-api · attempt 1"` — workspace, first repo source, attempt number. */
export function runMetaLine(workspaceName: string, firstSourceName: string | undefined, attemptNumber: number): string {
  const parts = [workspaceName]
  if (firstSourceName) parts.push(firstSourceName)
  parts.push(`attempt ${attemptNumber}`)
  return parts.join(' · ')
}

/** Header Badge: `"live · 12m"` (ticking) while the run is active, otherwise the run's terminal
 * status label. Badge only has three signal colors — failed is the only one of those that maps
 * cleanly onto a non-live run status, so every other terminal status (needs_review, cancelled)
 * renders in the sage "accepted" face. */
export function runHeaderBadge(
  run: Pick<ApiRun, 'status' | 'startedAt'> | undefined,
  live: boolean,
  now: number,
): { status: BadgeStatus; label: string } | null {
  if (!run) return null
  // Queued counts as active (Stop still applies) but it isn't live yet — no elapsed clock.
  if (run.status === 'queued') return { status: 'neutral', label: 'queued' }
  if (live) return { status: 'live', label: `live · ${elapsedLabel(run.startedAt, now)}` }
  const status: BadgeStatus = run.status === 'failed' ? 'failed' : 'accepted'
  return { status, label: runStatusVisual(run.status).label.toLowerCase() }
}
