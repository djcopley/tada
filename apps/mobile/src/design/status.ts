import type { QueueState, RunStatus } from '@tada/shared'
import type { Palette } from './tokens'

export type Signal = 'amber' | 'green' | 'violet' | 'red' | 'neutral'

export type StatusVisual = {
  label: string
  signal: Signal
  /** Animate the dot while true (an agent is actively working). */
  live?: boolean
}

export function runStatusVisual(status: RunStatus): StatusVisual {
  switch (status) {
    case 'queued':
      return { label: 'Queued', signal: 'amber' }
    case 'running':
      return { label: 'Running', signal: 'green', live: true }
    case 'needs_review':
      return { label: 'Needs review', signal: 'violet' }
    case 'failed':
      return { label: 'Failed', signal: 'red' }
    case 'cancelled':
      return { label: 'Cancelled', signal: 'neutral' }
  }
}

export function queueStateVisual(state: QueueState): StatusVisual | null {
  switch (state) {
    case 'queued':
      return { label: 'Queued', signal: 'amber' }
    case 'held':
      return { label: 'Held', signal: 'red' }
    default:
      return null
  }
}

export function signalColors(signal: Signal, colors: Palette): { fg: string; bg: string } {
  switch (signal) {
    case 'amber':
      return { fg: colors.signalAmber, bg: colors.signalAmberBg }
    case 'green':
      return { fg: colors.signalGreen, bg: colors.signalGreenBg }
    case 'violet':
      return { fg: colors.signalViolet, bg: colors.signalVioletBg }
    case 'red':
      return { fg: colors.signalRed, bg: colors.signalRedBg }
    case 'neutral':
      return { fg: colors.inkMuted, bg: colors.surfaceAlt }
  }
}

const ADAPTER_NAMES: Record<string, string> = { claude: 'Claude' }

/** "claude" → "Claude", "sonnet" → "Sonnet" — humanize raw adapter/model ids. */
export function humanize(id: string): string {
  if (ADAPTER_NAMES[id]) return ADAPTER_NAMES[id]
  return id.charAt(0).toUpperCase() + id.slice(1)
}
