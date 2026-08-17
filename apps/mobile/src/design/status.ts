import type { ApiRun, HeldReason, RunStatus } from '@tada/shared'
import type { Palette } from './tokens'

/**
 * Instrument Ink has exactly three signal colors: orange = an agent is live (running *or* held —
 * a held run is alive, waiting on you), sage = done / ok, red = failure only. Everything else is
 * neutral ink.
 */
export type Signal = 'live' | 'ok' | 'fail' | 'neutral'

export type StatusVisual = {
  label: string
  signal: Signal
  /** Animate the dot while true (an agent is actively working). */
  live?: boolean
}

/** The badge word for why a run is held: "permission" / "question" / "out of time". */
export function heldReasonLabel(reason: HeldReason): string {
  switch (reason) {
    case 'permission':
      return 'permission'
    case 'question':
      return 'question'
    case 'time':
      return 'out of time'
  }
}

export function runStatusVisual(status: RunStatus, heldReason?: HeldReason | null): StatusVisual {
  switch (status) {
    case 'queued':
      return { label: 'queued', signal: 'neutral' }
    case 'running':
      return { label: 'live', signal: 'live', live: true }
    case 'held':
      return { label: heldReason ? heldReasonLabel(heldReason) : 'held', signal: 'live' }
    case 'done':
      return { label: 'done', signal: 'ok' }
    case 'failed':
      return { label: 'failed', signal: 'fail' }
    case 'cancelled':
      return { label: 'stopped', signal: 'neutral' }
  }
}

/** Convenience over a run row (or none — a ticket that has never run). */
export function runVisual(run: ApiRun | null | undefined): StatusVisual | null {
  return run ? runStatusVisual(run.status, run.heldReason) : null
}

/** A run that is stopped on you: held (any reason) or failed. */
export function isStoppedOnYou(run: ApiRun | null | undefined): boolean {
  return run?.status === 'held' || run?.status === 'failed'
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

const ADAPTER_NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' }

/** "claude" → "Claude", "sonnet" → "Sonnet" — humanize raw adapter/model ids. */
export function humanize(id: string): string {
  if (ADAPTER_NAMES[id]) return ADAPTER_NAMES[id]
  return id.charAt(0).toUpperCase() + id.slice(1)
}
