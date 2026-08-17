import type { ApiRun, ApiRunEvent, Hold } from '@tada/shared'
import type { BadgeStatus } from './components/ui/Badge'
import { budgetLabel, elapsedLabel } from './control'
import { heldReasonLabel } from './design/status'

/**
 * Pure formatting/logic for the run screen — split out from the screen component so the header
 * Badge, the narration text per journal event, and the gate-card copy are unit testable without
 * rendering. Instrument Ink content rules apply: sentence case, mono data, `·` separators,
 * lowercase status labels.
 */

/** A run that is alive right now — running or held (its process is waiting on you). */
export function isLiveRun(status: ApiRun['status'] | undefined): boolean {
  return status === 'running' || status === 'held'
}

/** `"parlor-web · run #4128"` — repo tags (or "no repo"), run id. */
export function runMetaLine(repoTags: string[], runId: number): string {
  return `${repoTags.length > 0 ? repoTags.join(', ') : 'no repo'} · run #${runId}`
}

/**
 * Header Badge: `"live · 12m"` (ticking) while running, `"held · 2h 14m"` while held (orange —
 * a held run is alive, waiting on you), otherwise the terminal status: sage `done`, red
 * `failed`, neutral `stopped` (cancelled) / `queued`.
 */
export function runHeaderBadge(
  run: Pick<ApiRun, 'status' | 'startedAt' | 'heldAt'> | undefined,
  now: number,
): { status: BadgeStatus; label: string } | null {
  if (!run) return null
  switch (run.status) {
    case 'queued':
      return { status: 'neutral', label: 'queued' }
    case 'running':
      return { status: 'live', label: `live · ${elapsedLabel(run.startedAt, now)}` }
    case 'held':
      return { status: 'live', label: `held · ${elapsedLabel(run.heldAt ?? run.startedAt, now)}` }
    case 'done':
      return { status: 'accepted', label: 'done' }
    case 'failed':
      return { status: 'failed', label: 'failed' }
    case 'cancelled':
      return { status: 'neutral', label: 'stopped' }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringField(payload: unknown, field: string): string | undefined {
  return isRecord(payload) && typeof payload[field] === 'string' ? (payload[field] as string) : undefined
}

/** "09:41" clock stamp for a narration line. */
export function timeStamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--'
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Pulls the interesting field out of a tool call's JSON `inputPreview` — a file path for file
 * tools, the command for Bash, a repo name for `use_repo`. `inputPreview` can be truncated
 * mid-JSON (the server caps its length), so a parse failure just means nothing, not an error. */
function parsePreview(inputPreview: string | undefined): Record<string, unknown> | undefined {
  if (!inputPreview) return undefined
  try {
    const parsed: unknown = JSON.parse(inputPreview)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Concise prose for a tool call: `$ <command>` for Bash, "editing <path>" / "reading <path>",
 * "checking out <repo>" for use_repo, "asking you a question", otherwise the tool's name
 * lowercased (`null` skips the line entirely). */
export function toolNarration(payload: unknown): string | null {
  const name = stringField(payload, 'name')
  const input = parsePreview(stringField(payload, 'inputPreview'))
  const command = typeof input?.command === 'string' ? input.command : undefined
  if (name && /bash/i.test(name) && command) return `$ ${command.split('\n')[0]}`
  const pathValue = input?.file_path ?? input?.path ?? input?.filePath ?? input?.notebook_path
  const path = typeof pathValue === 'string' ? pathValue : undefined
  if (path) {
    const verb = name && /read|glob|grep/i.test(name) ? 'reading' : name && /bash|run|exec/i.test(name) ? 'running' : 'editing'
    return `${verb} ${path}`
  }
  if (name && /use_repo/i.test(name)) {
    return typeof input?.name === 'string' ? `checking out ${input.name}` : 'checking out a repo'
  }
  if (name && /ask_user/i.test(name)) return 'asking you a question'
  if (name && /report_outcome/i.test(name)) return 'reporting its outcome'
  if (name && /update_ticket/i.test(name)) return 'posting on the ticket'
  return name ? name.replace(/^mcp__tada__/, '').toLowerCase() : null
}

/** Status events narrated as prose rather than raw enum values. Run-status transitions and the
 * agent's own outcome report both arrive as `status` events (payload.kind tells them apart). */
export function statusNarration(payload: unknown): string | null {
  const status = stringField(payload, 'status')
  if (!status) return null
  const kind = stringField(payload, 'kind')
  if (kind === 'outcome') {
    const summary = stringField(payload, 'summary')?.trim()
    const head = status === 'success' ? 'reported success' : `reported ${status}`
    return summary ? `${head} — ${summary}` : head
  }
  const words: Record<string, string> = {
    queued: 'queued',
    running: 'running',
    held: 'stopped — waiting on you',
    done: 'finished and moved itself to done',
    failed: 'failed',
    cancelled: 'stopped by you',
  }
  return words[status] ?? status.replace(/_/g, ' ')
}

/** The one-line rendering of a hold, in the agent's voice — what a `gate` event narrates. */
export function holdNarration(hold: Hold): string {
  switch (hold.reason) {
    case 'permission':
      return `⏸ ${hold.summary.split('\n')[0]} — stopped, waiting on you`
    case 'question':
      return `? ${hold.question}`
    case 'time':
      return `⏸ hit the ${budgetLabel(hold.budgetMs)} limit — stopped, waiting on you`
  }
}

/** `gate` events: hold / resume / never / time_up / continued. */
export function gateNarration(payload: unknown): string | null {
  const kind = stringField(payload, 'kind')
  switch (kind) {
    case 'hold': {
      const hold = isRecord(payload) && isRecord(payload.hold) ? (payload.hold as unknown as Hold) : undefined
      return hold ? holdNarration(hold) : '⏸ stopped, waiting on you'
    }
    case 'resume':
      return '▸ resumed from that step'
    case 'never': {
      const summary = stringField(payload, 'summary')?.split('\n')[0]
      const title = stringField(payload, 'ruleTitle')
      return `✕ refused ${summary ?? 'a call'} — your rule says never${title ? ` (${title})` : ''}`
    }
    case 'time_up': {
      const budget = isRecord(payload) && typeof payload.budgetMs === 'number' ? payload.budgetMs : undefined
      return budget !== undefined ? `⏸ ${budgetLabel(budget)} budget spent — will stop at the next step` : '⏸ budget spent'
    }
    case 'continued': {
      const extra = isRecord(payload) && typeof payload.extraMs === 'number' ? payload.extraMs : undefined
      return extra !== undefined ? `▸ given another ${budgetLabel(extra)} — continuing` : '▸ continuing'
    }
    default:
      return null
  }
}

/** The narration text for one run event, or `null` to skip it (an event type this feed doesn't
 * narrate, or a tool call with nothing concise to say). */
export function narrationText(event: Pick<ApiRunEvent, 'type' | 'payload'>): string | null {
  switch (event.type) {
    case 'status':
      return statusNarration(event.payload)
    case 'text':
      return stringField(event.payload, 'text') ?? null
    case 'error':
      return stringField(event.payload, 'message') ?? 'error'
    case 'tool_use':
      return toolNarration(event.payload)
    case 'gate':
      return gateNarration(event.payload)
    default:
      return null
  }
}

/** Which colour voice a narrated line takes: `hold` lines are live (orange), errors fail. */
export function lineTone(event: Pick<ApiRunEvent, 'type' | 'payload'>): 'error' | 'hold' | 'ok' | 'text' | 'muted' {
  if (event.type === 'error') return 'error'
  if (event.type === 'gate') {
    const kind = stringField(event.payload, 'kind')
    return kind === 'never' ? 'error' : kind === 'hold' || kind === 'time_up' ? 'hold' : 'text'
  }
  if (event.type === 'status') {
    const status = stringField(event.payload, 'status')
    if (status === 'done' || status === 'success') return 'ok'
    if (status === 'failed') return 'error'
    if (status === 'held') return 'hold'
    return 'muted'
  }
  return event.type === 'text' ? 'text' : 'muted'
}

/** The gate card's title, in plain sentence case. */
export function gateTitle(hold: Hold): string {
  switch (hold.reason) {
    case 'permission':
      return `The agent wants to: ${hold.ruleTitle.charAt(0).toLowerCase()}${hold.ruleTitle.slice(1)}`
    case 'question':
      return hold.question
    case 'time':
      return 'It ran out of time'
  }
}

/** The mono meta beside the gate title: the tool for a permission gate, "question", or the budget. */
export function gateMeta(hold: Hold): string {
  switch (hold.reason) {
    case 'permission':
      return `${hold.tool.replace(/^mcp__tada__/, '').toLowerCase()} · ${hold.publishes ? 'publishes' : 'write'}`
    case 'question':
      return hold.options.length > 0 ? `question · ${hold.options.length} options` : 'question'
    case 'time':
      return `${budgetLabel(hold.budgetMs)} budget`
  }
}

/** Key/value rows for the gate card. */
export function gateFacts(hold: Hold): [string, string][] {
  switch (hold.reason) {
    case 'permission':
      return [
        ['call', hold.summary],
        ['rule', `${hold.ruleTitle} → ask`],
      ]
    case 'question':
      return hold.options.length > 0 ? [['options', hold.options.join(' · ')]] : []
    case 'time':
      return [['budget', `${budgetLabel(hold.budgetMs)} used up · context kept`]]
  }
}

/** The explanatory copy under the gate actions. */
export function gateCopy(hold: Hold): string {
  switch (hold.reason) {
    case 'permission':
      return `Rule ${hold.ruleTitle} → ask. Always allow updates that rule and leaves a receipt in Today.${
        hold.publishes ? ' Nothing has reached github yet — the branch and the diff are local to this run.' : ''
      }`
    case 'question':
      return 'Your answer goes back to the agent at this step. It can be saved to memory.'
    case 'time':
      return 'Continuing picks up mid-run — no re-clone.'
  }
}

/** The terminal-state line under the panel, if the run is over. */
export function terminalLine(run: Pick<ApiRun, 'status' | 'summary'> | undefined): { tone: 'ok' | 'error' | 'muted'; text: string } | null {
  if (!run) return null
  switch (run.status) {
    case 'done':
      return { tone: 'ok', text: `✱ finished and moved itself to done${run.summary ? ` — ${run.summary}` : ''}` }
    case 'failed':
      return { tone: 'error', text: `✕ run failed${run.summary ? ` — ${run.summary}` : ''}` }
    case 'cancelled':
      return { tone: 'muted', text: 'stopped by you' }
    default:
      return null
  }
}

/** Whether the diff exists for this run: only while held at a publish gate. */
export function atPublishGate(run: Pick<ApiRun, 'status' | 'hold'> | undefined): boolean {
  return run?.status === 'held' && run.hold?.reason === 'permission' && run.hold.publishes === true
}

/** Text of every narrated line from `from` (inclusive) to the end, joined — for "copy from here". */
export function linesFrom(events: ApiRunEvent[], fromId: number): string {
  const idx = events.findIndex((e) => e.id === fromId)
  const slice = idx === -1 ? events : events.slice(idx)
  return slice
    .map((e) => {
      const text = narrationText(e)
      return text === null ? null : `${timeStamp(e.createdAt)}  ${text}`
    })
    .filter((l): l is string => l !== null)
    .join('\n')
}

/** Reason word for the panel header meta: "live" / "held · permission". */
export function panelMeta(run: Pick<ApiRun, 'status' | 'heldReason' | 'startedAt'> | undefined, now: number): string {
  if (!run) return '—'
  if (run.status === 'running') return `live · ${elapsedLabel(run.startedAt, now)}`
  if (run.status === 'held') return `held${run.heldReason ? ` · ${heldReasonLabel(run.heldReason)}` : ''}`
  return runHeaderBadge({ ...run, heldAt: null }, now)?.label ?? '—'
}
