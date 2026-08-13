import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AdapterEvent } from '../adapters/types.js'
import type { TadaDb } from '../db/index.js'
import { events } from '../db/schema.js'

export class Journal {
  constructor(
    private db: TadaDb,
    private runId: number,
    private transcriptPath: string,
    private broadcast?: (runId: number, e: AdapterEvent) => void,
  ) {}

  write(e: AdapterEvent): void {
    // Ensure transcript directory exists
    const transcriptDir = dirname(this.transcriptPath)
    mkdirSync(transcriptDir, { recursive: true })

    // Append to transcript file
    appendFileSync(this.transcriptPath, JSON.stringify(e) + '\n')

    // Insert into events table
    this.db.drizzle
      .insert(events)
      .values({
        runId: this.runId,
        type: e.type,
        payload: e.payload,
      })
      .run()

    // Call broadcast hook if provided
    this.broadcast?.(this.runId, e)
  }

  close(): void {
    // No-op placeholder kept for symmetry
  }
}
