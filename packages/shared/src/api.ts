// DTO shapes as they cross the wire (integer ids, ISO-string dates).
import type { ColumnKind, QueueState, RunStatus } from './domain.js'

export interface ApiWorkspace {
  id: number
  name: string
  path: string
  defaultAdapter: string
  defaultModel: string
  concurrency: number
  timeoutMs: number
  createdAt: string
}

export interface ApiWorkspaceListItem extends ApiWorkspace {
  runningCount: number
  needsReviewCount: number
}

export interface ApiColumn {
  id: number
  workspaceId: number
  kind: ColumnKind
  title: string
  position: number
  createdAt: string
}

export interface ApiTicket {
  id: number
  workspaceId: number
  columnId: number
  title: string
  description: string
  position: number
  queueState: QueueState
  adapterOverride: string | null
  modelOverride: string | null
  createdAt: string
}

export interface ApiComment {
  id: number
  ticketId: number
  author: 'human' | 'agent'
  body: string
  createdAt: string
}

export interface ApiRun {
  id: number
  ticketId: number
  adapter: string
  model: string
  status: RunStatus
  branch: string | null
  prUrl: string | null
  summary: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface ApiBoard {
  columns: Array<ApiColumn & { tickets: ApiTicket[] }>
}

export interface ApiRunEvent {
  id: number
  runId: number
  type: 'status' | 'tool_use' | 'text' | 'error'
  payload: unknown
  createdAt: string
}

export interface ApiMemory {
  agentsMd: string
  notes: Array<{ name: string; body: string }>
}

export interface ApiRepo {
  name: string
  url: string
  defaultBranch: string
}

export type WsMessage =
  | { type: 'run_event'; runId: number; event: { type: ApiRunEvent['type']; payload: unknown } }
  | { type: 'board_changed'; workspaceId: number }
