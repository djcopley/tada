import { eq } from 'drizzle-orm'
import type { TadaDb } from '../db/index.js'
import { tickets } from '../db/schema.js'

/**
 * The only writer of `tickets.repoTags`. A tag is stamped when a run checks a repo out (or, for
 * agents without tada tools, when their branch in that repo ends up ahead) — evidence of what the
 * run touched, never a plan. There is deliberately no API route that sets tags.
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
