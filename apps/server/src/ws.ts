import type { WebSocket } from '@fastify/websocket'
import type { WsMessage } from '@tada/shared'
import type { FastifyInstance } from 'fastify'
import type { Broadcaster } from './activity.js'
import type { AdapterEvent } from './adapters/types.js'
import type { Config } from './config.js'

/**
 * Pushes events to every connected websocket client. There is one board, so there is one room.
 *
 * Wiring note: `runEvent` is handed to RunnerDeps as the run journal's broadcast hook, so it fires
 * on every journaled adapter event. Runner's own 'status' events are always paired with a card
 * move (queued->running, running<->stopped, running->done, ->backlog on cancel) — see runner.ts —
 * so re-emitting `board_changed` whenever a 'status' event comes through keeps board state in
 * sync without a separate hook. Route handlers that mutate the board directly call
 * `boardChanged` themselves.
 */
export class BroadcastHub implements Broadcaster {
  private readonly sockets = new Set<WebSocket>()

  register(socket: WebSocket): void {
    this.sockets.add(socket)
    socket.on('close', () => this.sockets.delete(socket))
  }

  runEvent = (runId: number, event: AdapterEvent): void => {
    this.send({ type: 'run_event', runId, event })
    if (event.type === 'status') this.boardChanged()
  }

  boardChanged = (): void => {
    this.send({ type: 'board_changed' })
  }

  activityChanged = (): void => {
    this.send({ type: 'activity' })
  }

  rulesChanged = (): void => {
    this.send({ type: 'rules_changed' })
  }

  private send(message: WsMessage): void {
    const json = JSON.stringify(message)
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(json)
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
    hub.register(socket)
  })
}
