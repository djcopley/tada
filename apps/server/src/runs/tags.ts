import { eq } from 'drizzle-orm'
import type { TadaDb } from '../db/index.js'
import { tickets } from '../db/schema.js'
import type { SourceStore } from '../sources/store.js'

/**
 * Names in `names` that aren't connected repos. Tags are only ever repo names the server knows
 * about, so both writers (a run touching a repo, a ticket created against a repo) filter through
 * this first — an unknown tag would be a card that can never surface on any board filter.
 */
export function unknownRepos(store: SourceStore, names: readonly string[]): string[] {
  return names.filter((name) => !store.repo(name))
}

/** De-duplicated, order-preserving repo tag list. */
export function normalizeRepoTags(names: readonly string[]): string[] {
  return [...new Set(names)]
}

/**
 * Stamps a tag as evidence: a run checked this repo out (or, for agents without tada tools, its
 * branch in that repo ended up ahead). Tickets can also be *created* carrying tags — that is a
 * plan, written once at insert time (`POST /tickets`, MCP `propose_ticket`) — but nothing else
 * edits tags afterwards, and there is deliberately no route that sets them on an existing ticket.
 */
export function stampRepoTag(db: TadaDb, ticketId: number, repo: string): boolean {
  const row = db.drizzle
    .select({ repoTags: tickets.repoTags })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .get()
  if (!row || row.repoTags.includes(repo)) return false
  db.drizzle
    .update(tickets)
    .set({ repoTags: [...row.repoTags, repo] })
    .where(eq(tickets.id, ticketId))
    .run()
  return true
}
