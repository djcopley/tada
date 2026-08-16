// Type definitions for domain entities
export type ColumnKind = 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'done' | 'custom'
export type RunStatus = 'queued' | 'running' | 'needs_review' | 'failed' | 'cancelled'
// held = the last run failed or was stopped; the scheduler leaves the card alone until a human
// re-queues it (Re-run / Send to Ready / drag). null = not in the queue at all.
export type QueueState = 'queued' | 'held' | null
export type Actor = 'human' | 'orchestrator'

export interface RunOutcome {
  status: 'success' | 'failed'
  summary: string
}

// New types for tada-build feature set
export type Effort = string // adapter-defined; claude uses 'low' | 'medium' | 'high'
export type TicketOrigin = 'human' | 'agent'
export type ProposalState = 'pending' | null
export type CommentKind = 'note' | 'feedback' | 'nudge'
export type MemoryScope = 'global' | 'workspace'
export type NoteState = 'kept' | 'pending'
export type SourceType = 'repo' | 'folder'
export type ActivityType =
  | 'run_started'
  | 'needs_review'
  | 'run_failed'
  | 'accepted'
  | 'sent_back'
  | 'follow_up_filed'
  | 'memory_written'
  | 'note_kept'
  | 'note_discarded'
  | 'ticket_created'
