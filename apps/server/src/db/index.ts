import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../drizzle')
const DEFAULT_COLUMNS = [
  ['backlog', 'Backlog'],
  ['ready', 'Ready'],
  ['in_progress', 'In Progress'],
  ['in_review', 'In Review'],
  ['done', 'Done'],
] as const

export type TadaDb = { drizzle: ReturnType<typeof drizzle<typeof schema>>; raw: Database.Database }

export function openDb(path: string): TadaDb {
  const raw = new Database(path)
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')
  const d = drizzle(raw, { schema })
  migrate(d, { migrationsFolder: MIGRATIONS })
  return { drizzle: d, raw }
}

export function createDefaultColumns(db: TadaDb, workspaceId: number): void {
  db.drizzle
    .insert(schema.columns)
    .values(DEFAULT_COLUMNS.map(([kind, title], i) => ({ workspaceId, kind, title, position: i })))
    .run()
}
