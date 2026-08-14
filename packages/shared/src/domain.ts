// Type definitions for domain entities
export type ColumnKind = 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'done' | 'custom'
export type RunStatus = 'queued' | 'running' | 'needs_review' | 'failed' | 'cancelled'
export type QueueState = 'queued' | 'held' | null // held = failed run; needs re-queue by human
export type Actor = 'human' | 'orchestrator'

export interface RunOutcome {
  status: 'success' | 'failed'
  summary: string
}
