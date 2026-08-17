// Domain enums shared by the server and the client.

/** Board lanes. `running` and `stopped` are written by the runner; humans move cards between the
 * other three. */
export type ColumnKind = 'backlog' | 'queued' | 'running' | 'stopped' | 'done'
export const COLUMN_KINDS: readonly ColumnKind[] = [
  'backlog',
  'queued',
  'running',
  'stopped',
  'done',
]

/** One enum for run state. `held` is a single state; *why* it is held lives in `heldReason`. */
export type RunStatus = 'queued' | 'running' | 'held' | 'done' | 'failed' | 'cancelled'
export type HeldReason = 'permission' | 'question' | 'time'
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['done', 'failed', 'cancelled']
export const isTerminalRun = (s: RunStatus): boolean => TERMINAL_RUN_STATUSES.includes(s)
/** A run that owns a card position on the board right now (running or held). */
export const isLiveRun = (s: RunStatus): boolean => s === 'running' || s === 'held'

export type Actor = 'human' | 'orchestrator'

export type Effort = string // adapter-defined; claude uses 'low' | 'medium' | 'high'
export type TicketOrigin = 'human' | 'agent'
export type ProposalState = 'pending' | null
export type NoteState = 'kept' | 'pending'
export type SourceType = 'repo' | 'folder'

/** What a rule does to a matching tool call. `never` denies without asking. */
export type RuleDecision = 'allow' | 'ask' | 'never'
/** Where a rule came from — `gate` rules were written by "Always allow" at a hold. */
export type RuleSource = 'default' | 'human' | 'gate'

export type PingChannel = 'push' | 'off'

export type ActivityType =
  | 'ticket_created'
  | 'run_started'
  | 'run_held'
  | 'run_done'
  | 'run_failed'
  | 'run_cancelled'
  | 'approved'
  | 'always_allowed'
  | 'denied'
  | 'answered'
  | 'continued'
  | 'follow_up_filed'
  | 'memory_proposed'
  | 'note_kept'
  | 'note_discarded'
  | 'undone'

/** What a held run is waiting on. Serialized on the run as `hold`. */
export type Hold =
  | {
      reason: 'permission'
      /** The tool the agent wants to call, and a human-readable rendering of its input. */
      tool: string
      /** For Bash: the command; otherwise a compact JSON preview of the input. */
      summary: string
      /** The rule that stopped it. */
      ruleId: number
      ruleTitle: string
      /** True when this gate is a publish gate (push / pr create / pr merge): the diff is viewable. */
      publishes: boolean
    }
  | {
      reason: 'question'
      question: string
      options: string[]
    }
  | {
      reason: 'time'
      /** The budget that ran out, in ms. */
      budgetMs: number
    }
