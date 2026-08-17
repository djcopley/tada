// DTO shapes as they cross the wire (integer ids, ISO-string dates).
import type {
  ActivityType,
  ColumnKind,
  HeldReason,
  Hold,
  NoteState,
  PingChannel,
  ProposalState,
  RuleDecision,
  RuleSource,
  RunStatus,
  SourceType,
  TicketOrigin,
} from './domain.js'

export interface ApiSettings {
  adapter: string
  model: string
  effort: string
  concurrency: number
  timeoutMs: number
  pingChannel: PingChannel
  /** 0 = never re-ping. */
  repingMs: number
}

export interface ApiSource {
  type: SourceType
  name: string
  url?: string
  defaultBranch?: string
  path?: string
}

export interface ApiRule {
  id: number
  title: string
  description: string
  /** Tool name the rule applies to (`Bash`, `Write`, `mcp__tada__use_repo`, ...) or `*`. */
  tool: string
  /** Glob patterns matched against the call's summary (the Bash command, a file path, or the
   * JSON of the input). Empty = matches every call of `tool`. */
  patterns: string[]
  decision: RuleDecision
  publishes: boolean
  position: number
  source: RuleSource
  sourceRunId: number | null
  updatedAt: string
  /** How many runs are held on this rule right now. */
  holdingCount: number
}

export interface ApiRun {
  id: number
  ticketId: number
  adapter: string
  model: string
  effort: string
  attemptNumber: number
  status: RunStatus
  heldReason: HeldReason | null
  hold: Hold | null
  /** When the current hold began (for "held 2h 14m"). */
  heldAt: string | null
  /** Milliseconds of budget this run has been granted in total. */
  budgetMs: number
  summary: string | null
  diffAdditions: number | null
  diffDeletions: number | null
  testsPassed: number | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export interface ApiTicket {
  id: number
  column: ColumnKind
  title: string
  description: string
  position: number
  repoTags: string[]
  origin: TicketOrigin
  proposalState: ProposalState
  followUpOfTicketId: number | null
  createdAt: string
  doneAt: string | null
  /** The most recent run, if any — enough for a card to render its state. */
  run: ApiRun | null
}

export interface ApiComment {
  id: number
  ticketId: number
  runId: number | null
  author: 'human' | 'agent'
  body: string
  createdAt: string
}

export interface ApiRunDetail extends ApiRun {
  ticketTitle: string
  repoTags: string[]
}

export interface ApiTicketDetail extends ApiTicket {
  comments: ApiComment[]
  runs: ApiRun[]
  followUps: { id: number; title: string; proposalState: ProposalState }[]
  followUpOf: { id: number; title: string } | null
}

export type ApiBoard = Record<ColumnKind, ApiTicket[]>

export interface ApiActivity {
  id: number
  ticketId: number | null
  runId: number | null
  type: ActivityType
  ticketTitle: string | null
  message: string
  createdAt: string
}

export interface ApiMemoryNote {
  id: number
  title: string
  body: string
  tags: string[]
  author: 'human' | 'agent'
  runId: number | null
  state: NoteState
  createdAt: string
  updatedAt: string
}

export interface ApiAdapterInfo {
  id: string
  label: string
  available: boolean
  models: string[]
  efforts: string[]
  supportsInjection: boolean
  supportsGates: boolean
}

export interface ApiHealth {
  ok: true
  version: string
}

export interface ApiStatus {
  ok: true
  version: string
  sources: ApiSource[]
  ticketCount: number
  noteCount: number
  agents: { id: string; available: boolean }[]
}

export interface ApiRunEvent {
  id: number
  runId: number
  type: string
  payload: unknown
  createdAt: string
}

export interface ApiDiffFile {
  path: string
  additions: number
  deletions: number
  patch: string
}

export interface ApiRepoDiff {
  repo: string
  defaultBranch: string
  branch: string
  additions: number
  deletions: number
  files: ApiDiffFile[]
}

export interface ApiRunDiff {
  runId: number
  repos: ApiRepoDiff[]
}

export type WsMessage =
  | { type: 'run_event'; runId: number; event: { type: string; payload: unknown } }
  | { type: 'board_changed' }
  | { type: 'activity' }
  | { type: 'rules_changed' }
