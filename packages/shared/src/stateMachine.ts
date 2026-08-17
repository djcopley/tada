import type { Actor, ColumnKind, RunStatus } from './domain.js'

const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['held', 'done', 'failed', 'cancelled'],
  // held -> failed only happens on recovery: the server restarted while the run was held, so the
  // paused process is gone and there is nothing to resume.
  held: ['running', 'failed', 'cancelled'],
  done: [],
  failed: [],
  cancelled: [],
}

export const canTransitionRun = (from: RunStatus, to: RunStatus): boolean =>
  RUN_TRANSITIONS[from].includes(to)

const ORCHESTRATOR_MOVES: ReadonlyArray<readonly [ColumnKind, ColumnKind]> = [
  ['queued', 'running'],
  ['running', 'stopped'],
  ['stopped', 'running'],
  ['running', 'done'],
  // Stop run: a cancelled run's card goes to backlog, whether it was running or held.
  ['running', 'backlog'],
  ['stopped', 'backlog'],
]

/**
 * `human` may put a card in backlog, queued or done — never into running or stopped, which the
 * runner owns. `orchestrator` moves are the ones the run lifecycle makes.
 */
export function canMoveCard(actor: Actor, from: ColumnKind, to: ColumnKind): boolean {
  if (actor === 'orchestrator') {
    return ORCHESTRATOR_MOVES.some(([f, t]) => f === from && t === to)
  }
  return to === 'backlog' || to === 'queued' || to === 'done'
}
