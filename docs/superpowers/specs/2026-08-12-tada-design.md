# tada — Design Spec

**Date:** 2026-08-12
**Status:** Approved design, pre-implementation

## What it is

A personal kanban app (web + mobile) where tickets are tasks for coding agents. You organize tickets on boards, drag them to a Ready queue, and agents on your self-hosted server pick them up, do the work against a workspace of git repos (or no repos at all — some tasks are purely operational), report back on the ticket, and notify your phone. Single-user tool.

## Settled decisions

| Decision | Choice |
|---|---|
| Agent runtime | Self-hosted always-on server/VM you own |
| Claude billing | Max subscription — Claude Agent SDK drives Claude Code under a one-time `claude login` on the server; no API key |
| Board model | Board = workspace; a workspace is a named collection of cloned repos + scoped memory |
| Dispatch | Drag to Ready = dispatch with workspace defaults; per-ticket agent/model override chip; Ready order = priority (no priority field) |
| Concurrency | Per-workspace limit, default 1 (sequential); workspaces run independently in parallel |
| Isolation | Git worktree per repo per run; canonical clones stay pristine |
| Deliverable | Outcome-based: PR if commits exist, otherwise just the agent's report. PR is an artifact, never a requirement |
| Client | Expo React Native — one codebase → iOS, Android, web |
| Backend | TypeScript/Node daemon, SQLite, systemd |
| Agent pluggability | Thin adapter per agent CLI + a shared `tada` MCP server for ticket updates |

## Architecture

Three pieces:

1. **`tada-server`** — Node/TS daemon (systemd unit) hosting the REST + WebSocket API, SQLite DB, workspace manager, scheduler, and agent runner.
2. **`tada-app`** — Expo RN app talking to the server over the tailnet.
3. **Workspaces on disk** — under XDG paths (below).

### Filesystem layout

```
$XDG_DATA_HOME/tada/workspaces/<ws>/
  manifest.json          # repos, settings, default agent/model
  repos/<repo>/          # canonical clones
  memory/
    AGENTS.md            # workspace charter: conventions, goals, gotchas
    notes/*.md           # durable learnings agents accumulate
$XDG_CONFIG_HOME/tada/   # server config
$XDG_STATE_HOME/tada/    # transcripts, logs, run journals
```

Fallbacks: `~/.local/share`, `~/.config`, `~/.local/state`.

## Data model (SQLite)

- **Workspace** — name, disk path, repos (url, default branch, local path), settings: default adapter + model, concurrency limit (default 1), run timeout (default 30 min).
- **Column** — per-workspace, user-definable. Default: Backlog / Ready / In Progress / In Review / Done. Purely organizational except Ready (the queue) — the orchestrator moves cards through In Progress/In Review; Backlog→Ready and In Review→Done/back are human-only moves.
- **Ticket** — workspace id, title, description (the agent's prompt — this is the contract), column, position (order within Ready = execution priority), optional target repos, timestamps. Editable until dispatched.
- **Comment** — ticket thread: user comments and agent `update_ticket` posts, interleaved chronologically.
- **AgentRun** — ticket id, adapter, model, status (`queued → running → needs_review | failed | cancelled`), branch name, PR URL, token/cost stats when available, transcript path (JSONL on disk). A ticket can have many runs; send-backs create a new run on the same branch.
- **Event** — append-only per-run log (status changes, tool-use highlights, errors) powering the live activity feed.

## Run lifecycle

1. Card dragged to Ready → run queued. Scheduler takes the top card when the workspace has a free slot (n=1 default).
2. Runner builds a **run dir**: `git worktree add <run-dir>/<repo> -b ticket/<id>` per repo, a shared (not snapshotted) mount of `memory/`, and an empty scratch dir. Agent cwd = run dir. Send-backs get a fresh worktree on the existing `ticket/<id>` branch.
3. Prompt composed from: ticket title + description + comment thread + `AGENTS.md` verbatim + `notes/` filename listing + prior-run summaries (send-backs only) + memory-usage instructions.
4. Adapter executes the agent headlessly; events stream to the journal and the app.
5. On completion the runner inspects git state: commits on `ticket/<id>` → push + open PR (via `gh`/API) + attach to ticket. No commits → ticket completes with the agent's report alone.
6. Card → In Review (always — Done is human-only, even for no-artifact tasks). Push notification fires.

**Failure:** adapter crash, timeout (process tree killed), or explicit `report_outcome(failed)` → card back to Ready with a failed badge, transcript preserved, nothing pushed, never auto-retried. Max usage-limit exhaustion surfaces the same way.

## Agent adapters & the tada MCP server

Adapter contract, deliberately thin:

```
run(runDir, prompt, mcpEndpoint, model, timeout) → exit status
```

- **ClaudeAdapter** — Claude Agent SDK (TypeScript); sessions bill to the Max subscription via the server's `claude login`. Permissions bypassed (unattended).
- **Others** — shell out to headless CLIs: `codex exec --json`, `gemini` CLI, `opencode run`, etc. Each adapter declares its model list so the UI's agent→model picker stays generic.

Every run gets a local **`tada` MCP server** (all major agent CLIs speak MCP) exposing:

- `update_ticket(comment)` — progress notes / final context on the ticket
- `attach_link(url, label)` / `attach_file(path)` — artifacts beyond PRs
- `report_outcome(status, summary)` — structured completion signal

This is the pluggability story: ticket-update powers come from MCP, not per-agent integration.

## Memory & context scoping

Memory is files, scoped by directory — no vector DB, agent-agnostic. `AGENTS.md` is the workspace charter (injected every run); `notes/*.md` are durable learnings agents are instructed to read when relevant and write when they learn something lasting about the workspace. Per-ticket results do NOT go in memory — they live on the ticket (comments, run summaries). Repo-specific conventions stay in each repo's committed CLAUDE.md/AGENTS.md. An agent's cwd, memory mount, and prompt all derive from one workspace; it never sees another board's repos or notes. The app can browse/edit memory directly (it's just markdown).

## Concurrency & isolation rationale

Worktrees remove the git reason to serialize, but the limit stays as a dial (default 1) because: (a) runs can still collide on machine-level side effects — ports, local DBs, docker; (b) parallel runs branch from the same base and can produce mutually conflicting PRs; (c) VM resources and the Max usage window are shared, and strict priority ordering only holds at n=1. Raising the limit is a scheduler number, not an architecture change. Full-workspace copies were considered and rejected: filesystem-dependent cost, stranded commits in divergent clones, and a GC policy problem worktrees answer natively (`worktree remove` when the ticket leaves In Review; the branch survives).

## Clients & notifications

**Screens:** workspace list (badges for running/needs-review) → board (drag-and-drop columns, cards show agent/model chip + status glyph) → ticket detail (description, comment thread, attachments/PRs, run history with live activity view streaming journaled events) → memory browser/editor → workspace settings (repos, defaults, concurrency, timeout).

**Live updates:** one WebSocket per app session, subscribed per workspace. Everything also plain REST.

**Push (Expo Push):** run completed and run failed only — no progress spam. Deep-links to the ticket. Web build uses browser notifications.

**Access:** Tailscale is the happy path (server bound to tailnet IP). A single server-issued bearer token is required on every request regardless, so port exposure isn't instantly fatal. No accounts, no OAuth.

## Security posture

Agents run unattended with permissions bypassed, as the server's user. Ticket text is trusted (you wrote it), but repo/web content makes prompt injection a real if modest risk. v1 mitigations: dedicated user on a dedicated VM; only the credentials this system needs (fine-grained GitHub token scoped to workspace repos, per-workspace SSH key); nothing else of yours on the box. Container-per-run is the known future hardening step and slots into the adapter interface without redesign.

## Crash safety & cleanup

Every state change journals to SQLite first. On boot, orphaned `running` runs → `failed`, worktrees preserved for inspection. Run worktrees are removed when their ticket reaches Done. Transcripts kept under `$XDG_STATE_HOME/tada/` with a retention setting (default: forever).

## Testing

- **FakeAdapter** (scripted events, controllable outcomes) → end-to-end tests of scheduler, state machine, MCP ticket tools, and UI with zero tokens.
- Ticket/run state machine as pure functions, unit-tested exhaustively.
- Real-CLI adapter integration tests behind a manual flag.

## Out of scope for v1

Multi-user/auth systems, container-per-run isolation, auto-retry, "paused until Max window resets" state, in-app diff review (PRs are reviewed in GitHub), dispatching one ticket to multiple agents for comparison (data model already permits it), boards spanning multiple workspaces.
