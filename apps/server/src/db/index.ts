import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { DEFAULT_RULES } from '../rules.js'
import * as schema from './schema.js'

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../drizzle')

export type TadaDb = { drizzle: ReturnType<typeof drizzle<typeof schema>>; raw: Database.Database }

export function openDb(path: string): TadaDb {
  const raw = new Database(path)
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')
  const d = drizzle(raw, { schema })
  migrate(d, { migrationsFolder: MIGRATIONS })
  const db = { drizzle: d, raw }
  seed(db)
  return db
}

/** First boot: the single settings row and the default rule table. Idempotent — a database that
 * already has them is left alone (deleting every rule is a legitimate choice). */
function seed(db: TadaDb): void {
  const settingsRow = db.drizzle.select().from(schema.settings).get()
  if (!settingsRow) {
    db.drizzle.insert(schema.settings).values({ id: 1 }).run()
    db.drizzle
      .insert(schema.rules)
      .values(DEFAULT_RULES.map((r, i) => ({ ...r, position: i, source: 'default' as const })))
      .run()
  }
}
