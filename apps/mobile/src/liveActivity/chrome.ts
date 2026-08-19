import type { ActivityPhase } from '@tada/shared'
import { night } from '../design/tokens'

/**
 * The widget's palette. Every value is opaque: the SwiftUI bridge parses 6-digit hex, and the
 * night palette's hairlines are 8-digit (`#F0EADD14`), which would silently render as nothing.
 * These are those tokens composited onto their own surface, once, by hand.
 */
export const WIDGET_INK = {
  ground: night.ground,
  raised: night.raised,
  recessed: night.recessed,
  text: night.text,
  textMuted: night.textMuted,
  /** night.textFaintSolid — the mono labels. */
  textFaint: night.textFaintSolid,
  agentSurface: night.agentSurface,
  /** night.agentSurfaceEdge (#F0EADD0F) over agentSurface. */
  agentSurfaceEdge: '#1A1614',
  agentText: night.agentText,
  agentPrompt: night.agentPrompt,
  /** night.borderSubtle (#F0EADD14) over raised. */
  borderSubtle: '#2A241E',
  controlBg: night.controlBg,
  primaryBg: night.primaryBg,
  primaryText: night.primaryText,
  live: night.live,
  liveText: night.liveText,
  ok: night.ok,
  okText: night.okText,
  fail: night.fail,
  failText: night.failText,
} as const

/**
 * SwiftUI's `timerInterval` needs a real ceiling — it will not draw a live-counting timer with
 * an open-ended upper bound. A run without a time budget has no such ceiling, so we hand it one
 * far enough in the future that it never arrives, rather than falling back to `startedAt` itself
 * (which collapses lower === upper and freezes the timer at zero the instant it appears).
 */
export const TIMER_UNBOUNDED_MS = 365 * 24 * 60 * 60 * 1000

/**
 * The `timerInterval` bounds for a run's live timer. Shared by the header and the compact
 * trailing presentation so the two can't drift out of sync with each other.
 */
export function timerBounds(
  startedAt: number,
  budgetEndsAt?: number,
): { lower: Date; upper: Date } {
  return {
    lower: new Date(startedAt),
    upper: new Date(budgetEndsAt ?? startedAt + TIMER_UNBOUNDED_MS),
  }
}

/** The budget consumed, clamped to `[0, 1]` — clock skew can otherwise push either end past it. */
export function progressValue(startedAt: number, budgetEndsAt: number): number {
  return Math.min(1, Math.max(0, (Date.now() - startedAt) / (budgetEndsAt - startedAt)))
}

/** The dot, the mono text color, and the two-word name each phase gives itself. */
export function phaseChrome(phase: ActivityPhase): { dot: string; text: string; label: string } {
  switch (phase) {
    // Orange is live — working *and* stopped on you. The label is empty for working because the
    // compact trailing draws a running timer there instead.
    case 'working':
      return { dot: WIDGET_INK.live, text: WIDGET_INK.liveText, label: '' }
    case 'yourTurn':
      return { dot: WIDGET_INK.live, text: WIDGET_INK.liveText, label: 'your turn' }
    case 'done':
      return { dot: WIDGET_INK.ok, text: WIDGET_INK.okText, label: 'done' }
    case 'failed':
      return { dot: WIDGET_INK.fail, text: WIDGET_INK.failText, label: 'failed' }
  }
}
