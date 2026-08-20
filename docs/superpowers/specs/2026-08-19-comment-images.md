# Image attachments on comments

Source of truth: ticket #82 thread (decisions recorded below). Today a comment is `{ body: text }`
only; `attach_file` writes an agent-local filesystem path into that text and nothing ever serves
it back — no client can see what was attached. This spec adds real image attachments: humans
attach screenshots from the mobile app (library or camera), agents attach screenshots via
`attach_file`, and both render inline in the thread.

## Decisions

- **Storage: local disk.** No object storage. Files live under `stateDir()`, matching how
  `attach_file` already works — just re-keyed (below) so they survive the run that created them.
- **Attachments are optional and belong to the comment, not the ticket.** A comment carries zero
  or more images alongside its `body`. `body` may be empty if a comment is images-only.
- **One upload path for agents.** `attach_file` is extended to handle all files as it does today
  (arbitrary path → copied, linked, done), but now auto-detects images by content-sniffed mime
  type and attaches them as structured, renderable attachments instead of a dead path string.
  No new `attach_image` tool.
- **One small control for humans.** An icon button sits next to Send in the composer; tapping it
  opens the system picker with both **Photo Library** and **Camera** options (`expo-image-picker`'s
  combined picker, not two separate buttons).
- **10 MB cap, enforced twice.** The mobile client compresses/resizes before upload so a normal
  photo never gets close to the cap; the server independently rejects anything over 10 MB
  regardless of client behavior. Agent-attached images go through the same server-side check —
  `attach_file` has no client to pre-compress on its behalf.

## Domain (`packages/shared`, `apps/server/src/db/schema.ts`)

New table, not a column on `comments` (a comment can carry more than one image):

```ts
export const attachments = sqliteTable('attachments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  commentId: integer('comment_id').notNull().references(() => comments.id, { onDelete: 'cascade' }),
  ticketId: integer('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),       // original basename, display-only
  mimeType: text('mime_type').notNull(),       // sniffed, not trusted from extension/client
  byteSize: integer('byte_size').notNull(),
  createdAt: createdAt(),
})
```

`ticketId` is denormalized onto the row (derivable via `commentId → comments.ticketId`) so the
serving route and cleanup can filter by ticket without a join — cheap, and matches how `comments`
already denormalizes against `tickets`.

`ApiComment` (`packages/shared/src/api.ts`) gains `attachments: ApiAttachment[]`, where
`ApiAttachment = { id, filename, mimeType, byteSize, url }`. `url` is server-computed at
serialization time (`routes/serialize.ts`), not stored — see Serving below.

Run `pnpm --filter @tada/server exec drizzle-kit generate` for the migration; commit it under
`apps/server/drizzle/`.

## Storage layout

`<stateDir>/attachments/<ticketId>/<attachmentId>.<ext>` — keyed by **ticket**, not run. Today's
`attach_file` keys by `runId`, which is wrong for this feature: human uploads from mobile have no
run in scope, and attachments should outlive the run that created them for as long as the ticket
does. `<ext>` comes from the sniffed mime type, not the client-supplied filename (avoids path
traversal via a crafted name; `filename` is stored separately for display and never used to build
a path).

Cleanup: deleting a ticket cascades the DB rows (`onDelete: 'cascade'`); a post-delete hook removes
`<stateDir>/attachments/<ticketId>/` from disk, called from the same place `cleanupRunDirs` is
called on ticket delete (`routes/tickets.ts`). This also closes the existing leak where
`attach_file`'s current per-run attachment dirs are never cleaned up — that old `attachments/<runId>/`
tree is dropped entirely in favor of the ticket-keyed one.

## Server

**`attach_file` (`apps/server/src/mcp/server.ts`)** — same signature (`{ path: string }`), new
behavior:
1. Read the file, sniff its mime type from content (magic bytes), not the extension.
2. If `byteSize > 10 MB`, return a tool error (`"file exceeds 10MB limit"`) — no partial write.
3. Copy into `<stateDir>/attachments/<ticketId>/<attachmentId>.<ext>` (id assigned by the DB
   insert, done first in a transaction so the path is known before the copy).
4. Insert a `comments` row the same way `addAgentComment` does today (`author: 'agent'`, `body`
   left empty or a short caption if the tool gains an optional `caption` param — out of scope for
   v1, body stays `''`), and one `attachments` row pointing at it.
5. `hub.boardChanged()`, same as every other comment-adding path.
6. Return the same thing as today (the tool result text is the dest path) so existing agent
   prompts referencing "attach_file returns the path" keep working — it's now purely informational
   since agents don't need to construct client-facing URLs themselves.

Non-image files keep exactly today's behavior (copy + `"Attached file: <path>"` text comment) —
"auto-detect images" means the branch is on sniffed mime type, not a blanket format change.

**Human upload — extend `POST /tickets/:id/notes`.** Add `@fastify/multipart` (not present in
`apps/server/package.json` today) and accept either `application/json` (today's `{ body }`,
unchanged) or `multipart/form-data` with a `body` field (may be empty string) and 0+ `image` file
parts. Same 10 MB-per-file check as `attach_file`, plus a small cap on file count per request
(e.g. 6) to bound one request's work. On success: one `comments` row, N `attachments` rows, same
`hub.boardChanged()` / live-run `inject()` behavior as today — injection uses `body` text only
(images aren't meaningful to inject into a CLI agent's stdin; the agent sees them next time it
reads the ticket thread, same as it reads any other comment).

**Serving — new route, `GET /tickets/:ticketId/attachments/:attachmentId`.** Bearer-token-gated
like every other route, *plus* accepts the token as a `?token=` query param as a fallback, because
RN `<Image>` supports request `headers` but plain web `<img src>` does not — the mobile client uses
the header form, a future web client would use the query-param form. Looks up the row, streams the
file with `reply.type(mimeType).send(createReadStream(path))` (same shape as the existing
`GET /runs/:id/transcript` binary-ish response in `routes/runs.ts`). 404 if the row or file is
missing (don't 500 on a stale/cleaned-up attachment).

`serialize.ts`'s `publicComment`/`publicTicket` computes each attachment's `url` as
`/tickets/${ticketId}/attachments/${id}` (relative — the client already prefixes `baseUrl`).

## Mobile (`apps/mobile`)

**Composer (`src/components/ticket/Thread.tsx`)** — add an `IconButton` (existing component,
`src/components/ui/IconButton.tsx`) in the `composer` row, left of the `Input`, e.g.
`icon="image"`, `label="Attach image"`. Tapping it calls `expo-image-picker`'s
`launchImageLibraryAsync`/`launchCameraAsync` behind a single "Photo Library / Take Photo" action
sheet (new dependency — not installed today). Selected images show as small thumbnails above the
input before Send, removable individually; `send()` now calls `onSend(body, images)` and Send is
enabled if *either* body text or at least one image is present (today it's gated on
`draft.trim().length === 0` alone).

**Compression before upload** — `expo-image-manipulator` (new dependency) resizes to a max
dimension (e.g. 2048px) and re-encodes as JPEG at a fixed quality before the image ever leaves the
device, so ordinary photos land well under 10 MB. If a compressed image is still over the cap
(pathological source image), reject client-side with a toast rather than sending a request that
the server will bounce anyway.

**Client (`src/api/client.ts`)** — new `TadaClient.noteWithImages(ticketId, body, images)` using
`FormData`/multipart (following the pattern of `transcript()`, the one existing method that
bypasses the JSON-only `req()` helper), alongside the existing `note()` for text-only sends (kept
as the fast path — no need to force multipart when there's nothing to attach).

**Rendering (`Thread.tsx`)** — a comment's `attachments` render as tappable thumbnails below its
body (new small component, e.g. `AttachmentImage`, using RN `<Image>` with
`source={{ uri, headers: { Authorization: 'Bearer <token>' } }}`); tapping opens a full-screen
viewer. This is new UI — today's `linkify.ts` only handles markdown text links and has no image
path at all; it is untouched by this change (agent captions, if added later, still flow through it
for any plain URLs they contain).

## Out of scope for v1

- Non-image file attachments getting the same structured/renderable treatment (`attach_file` for
  non-images stays exactly as it is today — path-as-text).
- Editing/deleting a single attachment after send.
- Image captions on `attach_file` (mentioned above as a natural follow-up, not required for this
  spec).
- Web client attachment upload UI (the serving route's query-param auth exists for it, but no web
  composer work is included here).
