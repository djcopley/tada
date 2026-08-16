import type { QueueState, RunStatus } from '@tada/shared'
import type { Palette } from './tokens'

/**
 * Instrument Ink has exactly three signal colors: orange = an agent is live,
 * sage = accepted / your turn, red = failure only. Everything else is
 * neutral ink.
 */
export type Signal = 'live' | 'ok' | 'fail' | 'neutral'

export type StatusVisual = {
  label: string
  signal: Signal
  /** Animate the dot while true (an agent is actively working). */
  live?: boolean
}

export function runStatusVisual(status: RunStatus): StatusVisual {
  switch (status) {
    case 'queued':
      return { label: 'Queued', signal: 'neutral' }
    case 'running':
      return { label: 'Live', signal: 'live', live: true }
    case 'needs_review':
      return { label: 'Your turn', signal: 'ok' }
    case 'failed':
      return { label: 'Failed', signal: 'fail' }
    case 'cancelled':
      return { label: 'Cancelled', signal: 'neutral' }
  }
}

export function queueStateVisual(state: QueueState): StatusVisual | null {
  switch (state) {
    case 'queued':
      return { label: 'Queued', signal: 'neutral' }
    case 'held':
      // A held ticket is a failed (or stopped) run waiting on a human re-queue.
      return { label: 'Held', signal: 'fail' }
    default:
      return null
  }
}

export function signalColors(signal: Signal, colors: Palette): { fg: string; bg: string } {
  switch (signal) {
    case 'live':
      return { fg: colors.liveText, bg: colors.liveSoft }
    case 'ok':
      return { fg: colors.okText, bg: colors.okSoft }
    case 'fail':
      return { fg: colors.failText, bg: colors.failSoft }
    case 'neutral':
      return { fg: colors.textMuted, bg: colors.raised2 }
  }
}

const ADAPTER_NAMES: Record<string, string> = { claude: 'Claude' }

/** "claude" → "Claude", "sonnet" → "Sonnet" — humanize raw adapter/model ids. */
export function humanize(id: string): string {
  if (ADAPTER_NAMES[id]) return ADAPTER_NAMES[id]
  return id.charAt(0).toUpperCase() + id.slice(1)
}
