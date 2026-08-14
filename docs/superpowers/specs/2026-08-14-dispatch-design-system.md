# tada "Dispatch" design system & UI redesign

Date: 2026-08-14
Status: approved (direction + full-redesign scope chosen by Daniel)

## Why

The mobile client has no design system: 25+ hardcoded hex literals across 12 files, two
competing primary blues (`#1565c0` / `#007AFF`), two error reds, emoji as status icons, stock
RN `<Button>`s beside hand-rolled ones, no motion, no gestures, no haptics, no dark mode, no
safe-area handling, `<Text>Loading…</Text>` for loading states, and four reimplemented modals.
Moving a kanban card takes long-press → modal → tap. This spec defines a complete visual and
interaction system and rebuilds every screen on it.

## Concept: Dispatch

tada is a dispatch desk: you queue work, agents pick it up, the board reports back. The
aesthetic borrows from transit departure boards — calm ink-and-bone surfaces where **color is
reserved exclusively for status**, statuses render as uppercase tabular-mono "departure tags",
and the board header is a live strip whose counts tick over with a flip animation when an agent
picks up or finishes work.

## Tokens (`apps/mobile/src/design/tokens.ts`)

### Color

Semantic tokens with light and dark values. Chrome is neutral; the four signal colors are the
only saturated colors in the app and always mean the same thing.

| Token | Light | Dark | Role |
|---|---|---|---|
| `bg` | `#F2F1EC` (bone) | `#10161F` | app background |
| `surface` | `#FFFFFF` | `#1A2230` | cards, sheets |
| `surfaceAlt` | `#E9E7E0` | `#141B26` | column lanes, insets |
| `ink` | `#16202E` | `#E8E6E1` | primary text, primary buttons |
| `inkMuted` | `#5B6572` | `#98A2AE` | secondary text |
| `inkFaint` | `#9AA1AA` | `#5B6572` | tertiary/disabled text |
| `line` | `#D8D5CD` | `#2A3342` | hairlines, borders |
| `signalAmber` | `#B97700` | `#E0A030` | queued / waiting / paused |
| `signalGreen` | `#20803F` | `#4CAF6E` | running / success |
| `signalViolet` | `#6D4FC4` | `#9B84E8` | needs review |
| `signalRed` | `#B3372F` | `#E06055` | failed / destructive |
| Each signal also has a `*Bg` tint | e.g. amber `#F6ECD9`/`#2B2414` | | tag fills |
| `scrim` | `rgba(16,22,31,0.45)` both | | sheet backdrop |

Primary buttons are `ink` on `bg` (light) / `E8E6E1` on dark — deliberately colorless, so
signal colors never compete with chrome.

### Type

Loaded via `expo-font` + `@expo-google-fonts`:

- **UI**: Barlow (400 / 500 / 600) — grotesque drawn from US roadway signage; the transit gene.
- **Display**: Barlow Semi Condensed 600 — screen titles and the board strip, uppercase with
  `letterSpacing: 0.5`.
- **Data**: IBM Plex Mono (400 / 500) — ticket metadata, statuses, timestamps, counts,
  transcripts, memory editor. Tabular by nature so flip counters don't jitter.

Scale (`size/lineHeight`): `display 24/30 (semi-condensed 600)`, `title 18/24 600`,
`body 15/21 400`, `bodyStrong 15/21 600`, `caption 12/16 500`, `mono 13/18`, `monoSmall 11/15`.
Statuses/tags render uppercase mono with `letterSpacing 0.8`.

### Space, radius, motion

- Spacing: 4-pt scale — `4, 8, 12, 16, 20, 24, 32, 48`.
- Radius: `sm 4` (tags), `md 10` (cards, inputs), `lg 16` (sheets, modals), `full` (pills).
- Elevation: soft ink-tinted shadow for cards (`shadowColor: ink`, low opacity), stronger for
  a lifted (dragging) card. Android `elevation` equivalents.
- Motion: `fast 120ms`, `base 200ms`, `slow 320ms`; easing standard cubic; flip animation for
  the strip counters; respect `useReducedMotion`.

Dark mode follows the OS (`useColorScheme`); `app.json` `userInterfaceStyle: "automatic"`.

## Primitives (`apps/mobile/src/design/` + `src/components/ui/`)

`ThemeProvider`/`useTheme` (tokens by scheme) · `Screen` (safe-area, bg) · `AppHeader` (one
shared header: back, display-face title, right actions — replaces the three hand-rolled
headers and inconsistent native headers) · `Button` (primary/secondary/ghost/destructive,
pressed states, loading spinner) · `Card` · `Input` (label, error, focus ring) · `Sheet`
(gesture-driven bottom sheet: handle, snap, drag-to-dismiss, scrim fade — replaces
`Modal animationType="slide"`) · `Dialog` (small centered modal for create/confirm — replaces
the four ad-hoc modals and `Alert.alert` confirms) · `StatusTag` (uppercase mono tag with
signal dot; pulsing dot when running) · `Badge` · `ListRow` · `EmptyState` (icon, line of
copy, action) · `Skeleton` (shimmer) · `Toast` (animated, safe-area aware) · `Icon` (lucide
via `@expo/vector-icons` Feather or `lucide-react-native`; no emoji anywhere).

**Signature — `FlipStrip`**: the board header strip. Workspace name in display face plus mono
counters (`QUEUED 2 · RUNNING 1 · REVIEW 3`); when a count changes (WebSocket
`board_changed`), the digit flips over (rotateX split-flap-style, 320ms, haptic tick).
Also used on the workspaces list rows for running/review counts.

## Interaction system

- **Drag-and-drop board**: long-press lifts a card (scale 1.03, stronger shadow, haptic);
  drag reorders within a column with animated gap; on the paged (narrow) board, holding at
  the screen edge pages to the adjacent column; drop settles with spring + haptic. Powered by
  reanimated + gesture-handler. Optimistic move via existing fractional positions; server
  round-trip reconciles. The action sheet remains as the accessible, non-gesture path.
- **Swipe actions**: ticket card swipe-right = Send to Ready (board), workspace/memory rows
  get swipe where destructive actions exist.
- **Sheets**: all bottom sheets dismiss by drag or scrim tap.
- **Haptics** (`expo-haptics`): light tick on lift/drop/flip, success notification on run
  completion toast, warning on destructive confirm.
- **Optimistic updates** for move/reorder/comment in `queries.ts` (onMutate/rollback).
- **Keyboard**: `KeyboardAvoidingView` on connect, comment composer, memory editor, dialogs.

## Screens

- **Connect**: centered wordmark ("tada" display face + a small split-flap glyph), URL/token
  inputs, primary Connect button with loading state, keyboard avoidance, plain-language
  errors ("Couldn't reach the server at …").
- **Workspaces**: `AppHeader` ("Dispatch"), cards with name + FlipStrip counts, skeletons,
  empty state ("No workspaces yet — create one to start dispatching work"), create Dialog.
- **Board**: AppHeader with workspace title + Memory/Settings icons; FlipStrip; columns as
  `surfaceAlt` lanes with sticky mono headers (`BACKLOG 4`); page dots on narrow; drag-and-drop;
  wide (≥900px) layout keeps all columns; per-column empty hints; "+ Add" only on backlog.
- **Ticket detail**: title block, StatusTag row, description; edit via pencil affordance —
  visibly locked with an explanation while a run is active; comment thread with timestamps
  and keyboard-avoiding composer; runs section as tappable rows with StatusTags; actions via
  Sheet (FAB-style bottom bar, not a buried button).
- **Run activity**: AppHeader with humanized status ("Running · 4m"), pulsing StatusTag,
  Cancel as destructive button with Dialog confirm; event feed with timestamps, text events
  as prose, tool calls as collapsible mono cards, errors in signalRed; transcript in a
  proper mono panel (`IBM Plex Mono`, correct per-platform); auto-scroll with "jump to
  latest" pill when scrolled up.
- **Memory**: list rows with file icons, AGENTS.md pinned with a tag; editor in Plex Mono
  with an unsaved-changes guard and keyboard toolbar-safe layout.
- **Settings**: sectioned cards (Repositories / Defaults / Advanced), consistent row
  controls, pickers as Sheets, inline errors in the input's error slot, destructive confirm
  via Dialog.

## Copy

Sentence case, active voice, no raw domain strings: `needs_review` → "Needs review",
`claude · sonnet` → "Claude · Sonnet". Errors say what to do next. Empty states invite the
first action.

## Dependencies added (mobile)

`react-native-reanimated`, `react-native-gesture-handler`, `expo-haptics`, `expo-font`,
`@expo-google-fonts/barlow`, `@expo-google-fonts/barlow-semi-condensed`,
`@expo-google-fonts/ibm-plex-mono`, `lucide-react-native` + `react-native-svg` (or
`@expo/vector-icons` if lighter), installed via `npx expo install` for SDK-57-compatible
versions. Root layout gains `GestureHandlerRootView` and font loading with a branded splash
hold.

## Constraints

- Existing `testID`s (`board-paged`, `board-wide`, `ticket-glyph-*`, `action-*`, …) stay
  stable; tests asserting presentational strings (e.g. `▲ Move up`) are updated to the new
  copy; behavioral assertions must keep passing.
- Web (react-native-web) stays working: reanimated/gesture-handler web support; the 900px
  wide board remains.
- No server or shared-package API changes; `canMoveCard` and fractional positions are reused.

## Out of scope

Android native project, tablet-specific layouts beyond the existing 900px breakpoint, agent
transcript markdown rendering, theming settings UI (OS-driven only).
