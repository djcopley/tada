import type { Actor, ColumnKind, RunStatus } from './domain.js'

const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['needs_review', 'failed', 'cancelled'],
  needs_review: [],
  failed: [],
  cancelled: [],
}

export const canTransitionRun = (from: RunStatus, to: RunStatus): boolean =>
  RUN_TRANSITIONS[from].includes(to)

const ORCHESTRATOR_MOVES: ReadonlyArray<readonly [ColumnKind, ColumnKind]> = [
  ['ready', 'in_progress'],
  ['in_progress', 'in_review'],
  ['in_progress', 'ready'],
]

export function canMoveCard(actor: Actor, from: ColumnKind, to: ColumnKind): boolean {
  if (actor === 'orchestrator') {
    return ORCHESTRATOR_MOVES.some(([f, t]) => f === from && t === to)
  }
  return to !== 'in_progress'
}
