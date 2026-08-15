# Instrument Ink Design System

**"Instrument panel with ink."** A design system for an agent-runs console — a tool you check at odd hours to see what your agent is doing, steer it, and accept its work. Braun-style instrument discipline, warmed up: paper tones instead of dev-tool grey, a mono voice with personality, and exactly one earned moment of delight.

No external sources were provided (no codebase, Figma, or brand files). This system was authored from scratch against the written brand brief. **No logo exists** — the sources contained none, so none was invented; wherever a mark would go, render the wordmark "Instrument Ink" in plain type (`--font-ui`, semibold, tracking-tight). See ICONOGRAPHY.

## The one structural quirk: two materials
Everything **the agent** does is monospace ink on recessed dark panels. Everything **you** do is proportional type on raised light surfaces. "Whose turn is it" is texture, not tags. This holds in BOTH themes — the agent's material (`--agent-*` tokens) never changes; the user's surfaces flip with the theme. Never mix the materials: no mono in user chrome except data (ids, timestamps, counts); no proportional type inside an agent panel.

## Modes
Dark ("night watch") is the **primary** mode and lives on `:root` — warm charcoal, brown-black, never blue-black. Light ("paper day") is opt-in via `data-theme="light"` on `<html>`: warm paper off-white. Both are warm; neither is neutral grey.

## CONTENT FUNDAMENTALS
- **Two speakers, two registers.** The agent speaks in mono: literal, present-tense, lowercase-leaning, terminal-set — `reading src/auth.ts`, `3 files changed · 2 tests passing`, `waiting on your review`. Terse but never cryptic; a well-set terminal, not a log dump. The product speaks to the user in sentence-case proportional type: calm, direct, second person — "Your review is needed", "Accept run".
- **Casing:** Sentence case everywhere in UI chrome (buttons, titles, empty states). Never Title Case, never ALL CAPS except tiny mono labels (`--tracking-caps`) like `RUN #4128` or `LIVE`. Agent output is lowercase unless quoting code.
- **Person:** The product says "you/your" to the user and refers to the agent as "the agent" or by task ("Refactor auth"). The agent says "I" sparingly and factually (`i'll retry with --force`), never enthusiastically.
- **No exclamation marks, no emoji, no praise-speak.** The celebration budget is spent on the tada★ animation, not on copy. Errors are plain and actionable: "Run failed — tests did not pass. See line 214." Never "Oops!".
- **Numbers and code are always mono**, even inline in a sentence: durations (`4m 12s`), counts (`38 files`), ids, paths, branch names.
- **Timestamps** are relative and lowercase (`2m ago`, `at 03:14`) — this tool is used at odd hours; the clock matters.

## VISUAL FOUNDATIONS
- **Color:** near-monochrome with exactly two voices — warm signal orange `--accent-live` (live / working / needs-you-now) and green-sage `--accent-ok` (your turn done / accepted), plus red `--accent-fail` reserved STRICTLY for failure. No decorative color anywhere else: no blue links, no purple gradients, no colored illustrations. If it isn't live, accepted, or failed, it's ink and paper.
- **Backgrounds:** flat warm solids only. No gradients, no textures, no imagery, no patterns. Depth comes from the surface stack: `--surface-recessed` (agent panels, wells) < `--surface-ground` < `--surface-raised` (cards, user surfaces) < `--surface-raised-2` / `--surface-overlay` (menus, dialogs).
- **Depth system:** on dark ground, drop shadows barely read — depth is drawn with hairline edges (`--border-subtle`), a 1px inset top-light on raised surfaces (`--edge-raised`), and inset shadow on recessed wells (`--recess`). Light mode gains soft real shadows (`--shadow-raised`, `--shadow-overlay`). Overlays sit on a warm scrim (`--scrim`); **no background blur** — this is an instrument panel, everything stays legible.
- **Shape:** tight radii on controls (`--radius-control: 5px` — buttons, inputs, tags 4px) and generous soft radii on big containers (`--radius-card: 14px`, `--radius-panel: 18px`). Pills only for status badges.
- **Type:** Instrument Sans for everything the user touches (UI chrome, headings, body); IBM Plex Mono for everything the agent says plus all data. Headings are semibold with `--tracking-heading`; mono runs one optical notch smaller than adjacent sans (`--text-mono-*`) and looser-leaded (`--leading-mono: 1.7`).
- **Spacing:** 4px base scale; controls are compact (7px/14px padding), panels breathe (`--pad-panel: 24px`). Density is instrument-like: tight within a control, generous between blocks.
- **Motion:** brief and damped — `--ease-out`, 120–320ms. Fades and small translates only; nothing bounces, nothing floats. Two sanctioned animations: `ii-pulse` (the live-status dot breathing while the agent works) and `ii-tada` (the star that plays ONCE when you accept a run — the entire celebration budget).
- **Hover:** surface lightens one step (`--control-bg-hover`) or text goes from muted→body; never opacity fades on text. **Press:** darken + `transform: translateY(0.5px)`; no shrink-scale.
- **Focus:** a 2-gap double ring in signal orange (`--focus-ring`). Keyboard-first product; never remove it.
- **Borders:** hairlines everywhere (`--border-hairline`); strong border (`--border-strong`) only on interactive affordances.
- **Layout:** fixed left rail + scrolling content; agent transcript is the center column, capped at `--measure`. No parallax, no fixed floating buttons.
- **Imagery:** none. This brand draws nothing and photographs nothing; the transcript is the picture.

## ICONOGRAPHY
- No proprietary icon set was provided, and none was invented. Use **Lucide** — 1.5px stroke, round caps, matching the hairline instrument feel. Render at 16px inside controls, 18px standalone, `stroke-width: 1.75`. **This is a flagged substitution** — replace with brand icons if they exist.
- Icons are always monochrome `currentColor`. Never filled variants, never two-tone, never colored except when the icon IS the status (dot, check, x in the three accent colors).
- Unicode-as-icon is part of the voice in mono contexts: `·` separators, `→` arrows, `✱` (the tada star glyph), `▸` disclosure. Emoji are never used.
- **No logo** (see above). Do not draw one.

## Components (in _ds_bundle.js, namespace InstrumentInkDesignSystem_76629c)
- core: Button, IconButton, Badge, Tag, Card
- forms: Input, Select, Checkbox, Radio, Switch
- navigation: Tabs
- feedback: Dialog, Toast, Tooltip, StatusDot
- agent: AgentPanel, RunStatus, TadaStar (brand-specific: two-materials quirk + the single celebration)
