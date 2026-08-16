// DTO shapes as they cross the wire (integer ids, ISO-string dates).
import type {
  ActivityType,
  ColumnKind,
  CommentKind,
  MemoryScope,
  NoteState,
  ProposalState,
  QueueState,
  RunStatus,
  SourceType,
  TicketOrigin,
} from './domain.js'

export interface ApiWorkspace {
  id: number
  name: string
  defaultAdapter: string
  defaultModel: string
  defaultEffort: string
  concurrency: number
  timeoutMs: number
  createdAt: string
}

export interface ApiWorkspaceListItem extends ApiWorkspace {
  runningCount: number
  needsReviewCount: number
  queuedCount: number
  sourceCount: number
}

export interface ApiSource {
  type: SourceType
  name: string
  url?: string
  defaultBranch?: string
  path?: string
}

export interface ApiWorkspaceDetail extends ApiWorkspace {
  sources: ApiSource[]
}

export interface ApiColumn {
  id: number
  workspaceId: number
  kind: ColumnKind
  title: string
  position: number
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
  effortOverride: string | null
  origin: TicketOrigin
  proposalState: ProposalState
  followUpOfTicketId: number | null
  createdAt: string
}

export interface ApiComment {
  id: number
  ticketId: number
  author: 'human' | 'agent'
  kind: CommentKind
  body: string
  createdAt: string
}

export interface ApiRun {
  id: number
  ticketId: number
  adapter: string
  model: string
  effort: string
  attemptNumber: number
  status: RunStatus
  branch: string | null
  prUrl: string | null
  summary: string | null
  diffAdditions: number | null
  diffDeletions: number | null
  testsPassed: number | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export interface ApiRunDetail extends ApiRun {
  ticketTitle: string
  workspaceId: number
}

export interface ApiTicketDetail extends ApiTicket {
  comments: ApiComment[]
  runs: ApiRun[]
  followUps: { id: number; title: string; proposalState: ProposalState }[]
}

export interface ApiBoard {
  columns: (ApiColumn & { tickets: ApiTicket[] })[]
}

export interface ApiActivity {
  id: number
  workspaceId: number
  ticketId: number | null
  runId: number | null
  type: ActivityType
  ticketTitle: string | null
  message: string
  createdAt: string
}

export interface ApiMemoryNote {
  id: number
  scope: MemoryScope
  workspaceId: number | null
  file: string
  title: string
  author: 'human' | 'agent'
  runId: number | null
  state: NoteState
  body: string
  updatedAt: string
}

export interface ApiMemory {
  agentsMd: string
  notes: ApiMemoryNote[]
}

export interface ApiAdapterInfo {
  id: string
  label: string
  available: boolean
  models: string[]
  efforts: string[]
  supportsInjection: boolean
}

export interface ApiHealth {
  ok: true
  version: string
}

export interface ApiStatus {
  ok: true
  version: string
  workspaces: string[]
  agents: { id: string; available: boolean }[]
}

export interface ApiRunEvent {
  id: number
  runId: number
  type: string
  payload: unknown
  createdAt: string
}

export interface ApiKnownRepo {
  url: string
  name: string
}

export interface ApiNameCheck {
  id: string
  available: boolean
  /** Why it isn't available — 'taken' or the validation message POST /workspaces would give. */
  reason?: string
}

export type WsMessage =
  | { type: 'run_event'; runId: number; event: { type: string; payload: unknown } }
  | { type: 'board_changed'; workspaceId: number }
  | { type: 'activity'; workspaceId: number }
