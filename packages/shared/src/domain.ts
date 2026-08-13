// Type definitions for domain entities
export type ColumnKind = 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'done' | 'custom'
export type RunStatus = 'queued' | 'running' | 'needs_review' | 'failed' | 'cancelled'
export type QueueState = 'queued' | 'held' | null // held = failed run; needs re-queue by human
export type Actor = 'human' | 'orchestrator'

export interface RunOutcome {
  status: 'success' | 'failed'
  summary: string
}

// Entity interfaces mirroring DB rows
export interface Workspace {
  id: string
  name: string
  path: string
  defaultAdapter: string
  defaultModel: string
  concurrency: number
  timeoutMs: number
}

export interface Ticket {
  id: string
  workspaceId: string
  columnId: string
  title: string
  description: string
  position: number
  queueState: QueueState
  adapterOverride: string | null
  modelOverride: string | null
}

export interface Comment {
  id: string
  ticketId: string
  author: 'human' | 'agent'
  body: string
}

export interface AgentRun {
  id: string
  ticketId: string
  adapter: string
  model: string
  status: RunStatus
  branch: string | null
  prUrl: string | null
  summary: string | null
}

export interface RunEvent {
  id: string
  runId: string
  type: string
  payload: unknown
}
