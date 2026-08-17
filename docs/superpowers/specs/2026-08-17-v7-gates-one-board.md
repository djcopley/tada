# tada v7 — one board, gates in the middle of the run

Source of truth: the Claude Design project `tadav7.dc.html` (build spec v7). This document records
the engineering decisions made while implementing it. No backwards compatibility with the
workspace-era schema or API is kept — everything is set up fresh.

## The workflow

- A finished run **moves itself to done**. There is no review column and no accept/send-back.
- Approval sits **in the middle of the run**: a rule table is checked before every tool call.
  A matching `ask` rule halts the run at that call, with its context intact; approving continues
  from that step. Denying feeds the human's note back to the agent as the tool's error and the
  agent carries on. **Always allow** flips the matched rule to `allow` (with provenance: set from a
  gate, date, run) and logs a Today event — the same rule table Settings renders.
- **Held is one run state** (`held`) with a `heldReason`: `permission`, `question`, or `time`.
  A held run releases its concurrency slot: the scheduler counts only `running` runs against the
  cap. Resuming a held run never waits for a slot (it may briefly oversubscribe the cap; new
  starts wait) — that is what "resumes at the front" means.
- **Out of time is a hold, not a failure.** The per-run time budget holds the run (`time`) and
  "Continue +30m" extends the budget and continues in place. For the Claude adapter the hold takes
  effect at the agent's next tool call (the same gate every hold uses); CLI adapters are SIGSTOPped
  and SIGCONTed.
- **Failure is the only red** and it never auto-retries. Re-run creates a fresh run: new
  worktrees, memory re-read, the failed transcript preserved on the ticket.
- Cancelling ("Stop run") is a human decision: the run ends `cancelled` and the card goes to
  backlog.
- Everything the human types to the agent is a **note** (`comments`). A note on a live run is
  injected into the session; a note on a queued/backlog ticket is read at the next run's start.

## Domain

`packages/shared`:

- `ColumnKind = backlog | queued | running | stopped | done`. `tickets.column` is stored; the
  runner drives `running`/`stopped`, humans drive the rest.
- `RunStatus = queued | running | held | done | failed | cancelled`,
  `HeldReason = permission | question | time`.
- Run transitions: `queued → running|cancelled`, `running → held|done|failed|cancelled`,
  `held → running|failed|cancelled`. `held → failed` exists for recovery (server restart while held —
  the process is gone).
- Human card moves: any column → `backlog | queued | done`, never into `running` or `stopped`.
  A card whose run is live (running/held) can only be moved to backlog (which cancels the run).
- Rules: `{ title, tool, patterns[], decision: allow|ask|never, publishes, source: default|human|gate,
  sourceRunId }`, first match wins, unmatched tools are allowed. `publishes` marks the gates where
  code leaves the box (push, pr create, pr merge) — the only place the diff endpoint answers.
- Repo tags are **output**: `tickets.repoTags` is written only by the server when a run makes a
  worktree for a repo. There is no API to set them.

## Server

- No workspaces. One `settings` row (adapter, model, effort, concurrency, timeoutMs, pings),
  one `manifest.json` of sources (`dataDir/manifest.json`, clones under `dataDir/repos/`),
  one board, one memory list, one rule table.
- Run dir: `<stateDir>/runs/<runId>/` with folder sources symlinked in. Repo worktrees are created
  lazily by the MCP tool `use_repo(name)` (branch `ticket/<id>`), which stamps the ticket's repo
  tag and returns the memory notes tagged to that repo. Adapters without tada tools (codex,
  gemini) get every repo checked out eagerly and are tagged for repos whose branch ends up ahead.
- Gates: the Claude adapter installs a `PreToolUse` hook that calls `ctx.gate(tool, input)`; the
  runner's gate applies rules, holds for permission, holds for `time` once the budget is spent,
  and answers `ask_user` questions (holding with reason `question`; the answer is passed back as
  `updatedInput.answer`).
- The agent pushes and opens PRs itself (`git push`, `gh pr create`) — the default rules make the
  PR the review moment (push allowed, pr create/merge ask, force-push/main never). There is no
  automatic push/PR after the run.
- Memory notes live in SQLite (`memory_notes`: title, body, tags, author, state, runId). Global
  notes ride on every prompt; repo-tagged notes are handed over by `use_repo`.
- Recovery on boot: `queued` runs stay queued (the overnight queue survives a restart);
  `running`/`held` → `failed` with the card in `stopped`.
- Pings: Expo push on hold and failure only (done runs are quiet), plus one re-ping after the
  configured delay if a run is still held.

## Client

expo-router: `/` Control, `/board`, `/memory`, `/settings` are tabs; `/tickets/[id]`,
`/runs/[id]`, `/runs/[id]/diff`, `/memory/[id]`, `/connect` push over them. One WebSocket
(`/ws`), no workspace param.
