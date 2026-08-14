import type { WebSocket } from '@fastify/websocket'
import type { WsMessage } from '@tada/shared'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { AdapterEvent } from './adapters/types.js'
import type { Config } from './config.js'
import type { TadaDb } from './db/index.js'
import { agentRuns, tickets } from './db/schema.js'

interface Subscription {
  socket: WebSocket
  workspaceId: number
}

/**
 * Tracks websocket clients subscribed to a workspace and pushes events to them.
 *
 * Wiring note: `broadcast` is handed to RunnerDeps as the run journal's broadcast hook, so it
 * fires on every journaled adapter event. Runner's own 'status' events are always paired with a
 * card move (ready->in_progress, in_progress->in_review, in_progress->ready on
 * failure/cancellation) - see runner.ts - so re-emitting `board_changed` whenever a 'status'
 * event comes through keeps board state in sync without a separate hook into RunnerDeps. Route
 * handlers that mutate the board directly (ticket move/edit) call `boardChanged` themselves.
 */
export class BroadcastHub {
  private readonly subs = new Set<Subscription>()

  constructor(private readonly db: TadaDb) {}

  register(socket: WebSocket, workspaceId: number): void {
    const sub: Subscription = { socket, workspaceId }
    this.subs.add(sub)
    socket.on('close', () => this.subs.delete(sub))
  }

  broadcast = (runId: number, event: AdapterEvent): void => {
    const workspaceId = this.workspaceIdForRun(runId)
    if (workspaceId === undefined) return
    this.send(workspaceId, { type: 'run_event', runId, event })
    if (event.type === 'status') this.boardChanged(workspaceId)
  }

  boardChanged = (workspaceId: number): void => {
    this.send(workspaceId, { type: 'board_changed', workspaceId })
  }

  private workspaceIdForRun(runId: number): number | undefined {
    const row = this.db.drizzle
      .select({ workspaceId: tickets.workspaceId })
      .from(agentRuns)
      .innerJoin(tickets, eq(agentRuns.ticketId, tickets.id))
      .where(eq(agentRuns.id, runId))
      .get()
    return row?.workspaceId
  }

  private send(workspaceId: number, message: WsMessage): void {
    const json = JSON.stringify(message)
    for (const sub of this.subs) {
      if (sub.workspaceId === workspaceId && sub.socket.readyState === sub.socket.OPEN) {
        sub.socket.send(json)
      }
    }
  }
}

export function registerWsRoute(app: FastifyInstance, hub: BroadcastHub, config: Config): void {
  app.get('/ws', { websocket: true }, (socket, req) => {
    const query = req.query as Record<string, unknown>

    const authHeader = req.headers.authorization
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    const authorized = query.token === config.bearerToken || headerToken === config.bearerToken
    if (!authorized) {
      socket.close(1008, 'unauthorized')
      return
    }

    const workspaceId = Number(query.workspaceId)
    if (!Number.isInteger(workspaceId)) {
      socket.close(1008, 'workspaceId query param required')
      return
    }
    hub.register(socket, workspaceId)
  })
}
