# tada-build: full product build against the Instrument Ink screens

Date: 2026-08-14
Status: approved (design approved in chat; accept flow simplified per user)

## Goal

Make the app look exactly like the seven artboards in `docs/design/tada-build.dc.html`
(Instrument Ink design system, `docs/design/instrument-ink-readme.md`) and make every
affordance on those screens fully functional. One Expo codebase serves both form factors:
≥1000px renders the web layout (fixed left rail + panes), below that the mobile layout.

**Hard rule: no backwards compatibility.** Delete any code, endpoint, DTO field, screen,
component, or test that the new design obsoletes. Do not keep shims, dual paths, or
deprecated fields. The DB is disposable (single-user, self-hosted): squash to whatever
schema is right; a fresh migration set is fine.

## Decisions already made (do not re-litigate)

1. **Web** = responsive Expo web from the existing `apps/mobile` codebase. No new app.
2. **Accept** = the ticket simply moves to Done and is considered finished. No merge run,
   no `gh pr merge`. The artboard copy "accept merges pr #481" / "On accept, the agent runs
   once more…" is replaced with close-the-ticket copy; everything else stays exact.
   Accepting plays the `ii-tada` star once (the only celebration in the product).
3. **Nudge** = real mid-run injection. `ClaudeAdapter` moves to the Agent SDK's
   streaming-input mode; `POST /runs/:id/nudge` pushes a user message into the live
   session between turns. Adapters that cannot inject decline (client copy says the note
   will reach the next attempt instead, and it lands in the thread).
4. **Harnesses** = adapter discovery (`GET /adapters`) + real `codex` and `gemini` CLI
   adapters that run when those CLIs are installed on the server; unavailable harnesses
   render disabled in Settings with a "not installed on the server" hint.

## Server

### Schema (rewrite migrations from scratch — delete `drizzle/` and regenerate)

- `workspaces`: + `defaultEffort` (text, default `'medium'`). Existing fields stay.
- `tickets`: + `origin` (`'human' | 'agent'`, default human), `proposalState`
  (`'pending' | null`), `followUpOfTicketId` (nullable FK → tickets, set null on delete).
- `agent_runs`: + `attemptNumber` (int, 1-based per ticket), `effort` (text),
  `diffAdditions` (int, nullable), `diffDeletions` (int, nullable), `testsPassed`
  (int, nullable). Add an index on `events.runId`.
- New `activity`: `id`, `workspaceId` (FK, cascade), `ticketId?`, `runId?`, `type`
  (`run_started | needs_review | run_failed | accepted | sent_back | follow_up_filed |
  memory_written | note_kept | note_discarded | ticket_created`), `message` (display
  string, prebuilt server-side), `createdAt`.
- New `memory_notes` (metadata; note bodies stay as files): `id`, `scope`
  (`'global' | 'workspace'`), `workspaceId?`, `file` (unique per scope), `title`,
  `author` (`'human' | 'agent'`), `runId?`, `state` (`'kept' | 'pending'`), `createdAt`,
  `updatedAt`. Human writes are `kept` immediately; agent writes are `pending` until
  kept/discarded.

### Memory

- Global scope lives at `dataDir()/memory/global/` (`AGENTS.md` + `notes/*.md`); it is
  symlinked into every run dir alongside the workspace memory, and the prompt lists both.
- Agents no longer write memory files directly. New MCP tool
  `write_memory_note(title, body)` → server slugifies the title to a filename, writes the
  file under the run's workspace notes, inserts `memory_notes` row (`author: 'agent'`,
  `state: 'pending'`, `runId`), records activity `memory_written`. Remove the
  write-notes-directly instruction from the prompt; instruct the tool instead.
- Routes:
  - `GET /memory` → global scope `{ agentsMd, notes: [{file, title, body, author, state, runId?, updatedAt}] }`
  - `PUT /memory/:file`, `DELETE /memory/:file` (global)
  - `GET /workspaces/:id/memory` → same shape as global (workspace scope)
  - `PUT /workspaces/:id/memory/:file`, `DELETE /workspaces/:id/memory/:file`
  - `POST /memory-notes/:id/keep` and `POST /memory-notes/:id/discard` (discard deletes
    the file). Both write activity.

### Tickets / runs / flow

- `POST /tickets/:id/accept` — allowed when the ticket is `in_review` (latest run
  `needs_review`). Moves card to Done, cleans up run dirs/worktrees (existing logic),
  writes activity `accepted`, returns the updated ticket. No merge.
- `POST /tickets/:id/send-back { feedback }` — allowed when `in_review`. Inserts a
  human comment flagged as send-back feedback (`comments` gains `kind`:
  `'note' | 'feedback' | 'nudge'`), moves card to the queued column, enqueues a new run.
  The next prompt renders feedback as the first instruction, verbatim, under
  `## Your feedback on attempt N`.
- `POST /runs/:id/nudge { note }` — live runs only. Stores a `nudge` comment on the
  ticket and injects into the adapter session if it supports injection; response reports
  `{ delivered: boolean }`.
- `GET /runs/:id` — run + its ticket id/title. Delete the client's `?ticketId=` plumbing.
- Agent follow-ups: new MCP tool `propose_ticket(title, description?)` → creates a ticket
  in Backlog with `origin: 'agent'`, `proposalState: 'pending'`, `followUpOfTicketId` =
  the run's ticket; activity `follow_up_filed`. `POST /tickets/:id/proposal
  { action: 'keep' | 'dismiss' }` — keep clears `proposalState`; dismiss deletes the
  ticket. Pending proposals do not enqueue.
- `report_outcome` gains optional `testsPassed` (int). On success, completion computes
  diffstat per repo (`git diff --shortstat <defaultBranch>...<branch>`) and stores the
  summed additions/deletions on the run.
- `attemptNumber` assigned at enqueue (`1 + max(previous attempts on ticket)`).
- Activity written at: enqueue→start (`run_started`), completion (`needs_review` /
  `run_failed`), accept, send-back, proposal filed, memory written, note kept/discarded,
  human ticket creation.
- `GET /activity?workspaceId=<id|all>&limit=` — newest first, includes ticket titles.

### Adapters / discovery / effort

- `Adapter` interface gains `efforts: string[]`, `available(): Promise<boolean>`, and
  optional `inject(runId, note)` capability (claude implements it; declared via a
  `supportsInjection` flag).
- `ClaudeAdapter`: streaming-input mode; effort maps to thinking budget
  (low → off/minimal, medium → default, high → high `maxThinkingTokens`). Models:
  sonnet, opus, haiku.
- New `CodexAdapter` (`codex exec` non-interactive, JSON output mode) and
  `GeminiAdapter` (`gemini` CLI non-interactive). Both run in the run dir with the
  composed prompt; MCP tools are exposed to them via CLI MCP config where supported;
  where a capability is missing the adapter journals a note. Availability = CLI on PATH
  (probed at boot, cached). Effort/model lists are adapter-defined constants.
- `GET /adapters` → `[{ id, label, available, models: [..], efforts: [..] }]`. Delete
  the client's hardcoded `src/adapters.ts` mirror.
- `GET /status` (authed) → `{ ok, version, workspaces: [names], agents: [{id, available}] }`.
  `GET /health` (unauthed) → `{ ok: true, version }`. Version read from the server
  package.json. Connect checklist consumes these.

### Sources

- Manifest entries become tagged: `{ type: 'repo', name, url, defaultBranch }` or
  `{ type: 'folder', name, path }`. Folder sources are absolute server paths symlinked
  into run dirs (agents may read/write them; no git flow). Routes:
  `POST /workspaces/:id/sources` (`{type:'repo', url}` or `{type:'folder', path}`),
  `DELETE /workspaces/:id/sources/:name`. Delete the old `/repos` routes.
- `GET /repos/known` → union of repo sources across workspaces (feeds the new-workspace
  attach checkboxes). `GET /workspaces/check-name?name=` → `{ id, available }` (slug +
  collision check) for the live "✓ id acme-web · available" line.

### WS

`board_changed` also fires on activity-relevant mutations (accept, send-back, proposal,
memory writes) so Control stays live. Add `{ type: 'activity', workspaceId }` if
piggybacking on `board_changed` proves too coarse — implementer's choice, but Control
must update without manual refresh.

## Client (apps/mobile, responsive)

### Frame

- `useLayout()` hook: `wide` ≥1000px (web rail layout), else `narrow`.
- Wide: fixed 188px left rail — wordmark `tada✱`, nav items Control (with needs-you
  count), Board, Memory, Settings, spacer, scope line (`parlor · 2 repos`), Day-mode
  Switch. Content pane per route. Board/Memory/Settings routes operate on the active
  workspace (persisted selection).
- Narrow: current stack navigation + the bottom Control / Board / Memory segmented strip
  from the artboard.
- Workspace switcher: one overlay menu behind every `parlor ▾` trigger and ⌘K on web —
  Scope section (Global row for Memory), Workspaces with per-row counts
  (`2 repos · 1 live`), divider, New workspace, `⌘K to switch` hint.
- Theme: Day mode switch (rail on wide, Settings on narrow), still persisted.

### Screens (match the artboards; file references are current paths)

- **Control** (`app/workspaces/index.tsx` → becomes the home for both form factors):
  headline "N things need you" + mono subline; NEEDS YOU cards — title, meta, badge
  (`your turn` / `failed`), mono stat line (`attempt 2 · pr #481 · +412 −38 · 214 tests
  pass`), agent last-line well (recessed mono with `▸`), actions (Accept run / Send back /
  Open diff — failed: Re-run / Edit brief and re-run / Move to backlog); LIVE NOW cards —
  title, source tag, RunStatus with elapsed, AgentPanel tail (last 1–2 narration lines,
  live line pulsing), Full log / Nudge with a note; "1 slot free — next: <ticket> ·
  Start now" pill when capacity exists and something is queued (Start now = move to front
  of queue); right rail (wide): Memory card (top notes + newest pending agent note
  highlighted + Edit memory), Today card (activity feed, `HH:MM` + typed glyphs
  `✱ + ✎ ✕`, Full history), workspace strips (name, `2 queued · 1 live · 2 yours`,
  Board button). Narrow shows needs-you cards with paired big buttons, a compact live-now
  AgentPanel, and the bottom nav strip.
- **Ticket detail** (`app/tickets/[id].tsx`): header row (← Control, badge, `attempt N`
  tag); title + mono meta; "Your review is needed" card (agent well with summary + pr
  stats line, Accept run / Send back / Open pr, close-copy: "On accept the ticket is
  closed."); Brief card ("what the agent reads", edit); THREAD — two-voice bubbles
  (agent mono/recessed with `▸` + relative time; you sans/raised, send-back feedback
  labeled "sent back:"), note composer ("Add a note — the agent reads the thread on its
  next attempt"); right rail: Attempts card (`#2 in review now / pr #481 · ran 34m`,
  `#1 sent back …`), Linked card (follow-up chain with `proposed by agent · in backlog`),
  Memory it read card, "If you send it back" card (verbatim-first-instruction copy).
- **Live run** (`app/runs/[id].tsx`): header (← Control, title, mono meta
  `workspace · repo · attempt N`, badge `live · 12m`, Stop run danger); one AgentPanel
  (`run #4131 · attempt 1` header, `live · 12m` meta) — narration lines with `HH:MM`
  stamps derived from events (status/text → narration; the current live line pulses `▮`
  in signal orange; key findings in body color), RAW OUTPUT collapsible section inside
  the panel (transcript tail); nudge composer ("Nudge with a note — the agent sees it
  between steps" + Send); "Safe to close — it runs unattended…" footnote.
- **Board** (`app/workspaces/[id]/board.tsx`): five columns — BACKLOG, QUEUED, RUNNING
  (live StatusDot header), IN REVIEW (ok StatusDot), DONE (column at .68 opacity).
  Display names change; DB kinds stay (`ready`→"Queued", `in_progress`→"Running").
  Cards per artboard: backlog/queued minimal (title + mono meta, `next up`, `retry ·
  attempt 2`); proposed-by-agent card (dashed border, `PROPOSED BY AGENT` caps line,
  follow-up meta, Keep / Dismiss); running card (elapsed accent, live narration well,
  Watch live); in-review card (badge, stat line, Accept / Send back); done cards
  (`pr #468 merged · 1w`). `+ Add a ticket` under Backlog. DnD preserved.
- **Memory** (`app/workspaces/[id]/memory/*` → gains scope model): header (Memory,
  `parlor ▾` picker, `4 notes`, New note); explainer line; Global card (scope `every
  workspace · N`, note bodies in mono); workspace divider (`PARLOR · 4 NOTES`); note
  cards (title + `edited by you · 2w`); pending agent note as AgentPanel (`learned: …`,
  `by agent · 07:58`) with Keep / Discard below. Editor keeps unsaved-guard.
- **New workspace**: Dialog — explainer, Name input, live `✓ id acme-web · available`
  mono line (from check-name), ATTACH REPOS — OPTIONAL checkboxes (from `/repos/known`),
  "You can attach more later in Settings…" note, Cancel / Create workspace.
- **Connect** (`app/connect.tsx`): forced light theme for this screen per artboard;
  wordmark 30px, tagline "Tickets in, pull requests out…", Server address + API token
  (mono inputs), Connect, then the three ✓ checklist lines (server reachable · vX.Y.Z /
  N workspaces found — names / agent keys present on the server) from `/health` +
  `/status`; footer "Self-hosted · single user · your keys never leave your box."
- **Settings** (`app/workspaces/[id]/settings.tsx`): SOURCES — THIS WORKSPACE ONLY
  (rows: mono name, Tag `repo · github` / `folder · server`, Remove; Add repo / Add
  folder); AGENT (Harness segmented buttons from `/adapters` with unavailable disabled;
  Model dropdown; Effort segmented; helper "Model and effort options come from the
  selected harness."); RUN LIMITS (Concurrent runs stepper with − / count / +;
  Per-run timeout dropdown `30 min ▾`); GLOBAL — APPLIES TO EVERY WORKSPACE (Server row
  with ok StatusDot + url + Disconnect danger; API token masked `tada_••••…3f9a` +
  Replace).

### Design-system deltas

Tokens already match (`src/design/tokens.ts`). Add/adjust primitives to the artboard
components: Badge (pill, status colors incl. `live`), RunStatus (dot + label + mono
meta), AgentPanel (header/meta variant, collapsible raw section), overlay Menu (for
switcher/dropdowns, `--surface-overlay` + `--shadow-overlay`), Switch with side label,
Select-as-button (`parlor ▾`), stepper IconButtons. Content rules from the readme are
law: sentence case, no emoji/exclamations, mono for all data, `·` separators, timestamps
relative lowercase. Delete unused primitives after the rebuild (candidates: FlipStrip if
no screen uses it — the artboards don't show it).

## Testing

- Server vitest: accept, send-back (prompt renders feedback first), nudge
  (delivered/undeliverable), proposals (keep/dismiss), memory provenance + global scope,
  activity writes + endpoint, discovery, status/version, diffstat + testsPassed, sources
  (repo + folder), check-name, attempt numbering. Update every existing suite the
  changes touch; delete tests for deleted behavior.
- Client jest: per-screen suites updated to the new layouts + new suites (control triage
  actions, switcher, nudge, keep/discard, connect checklist, adapters-driven settings).
- Manual verification: run the server + `expo start --web`; walk all seven artboards at
  wide and 390px; verify against `docs/design/tada-build.dc.html` rendering.

## Out of scope

Markdown rendering in comments, multi-select, in-app diff review (Open diff opens the
PR URL), accounts/multi-user, container isolation.
