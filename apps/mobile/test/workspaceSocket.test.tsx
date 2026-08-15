import type { WsMessage } from '@tada/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react-native'
import { ClientProvider } from '../src/api/ClientContext'
import { keys } from '../src/api/queries'
import { WorkspaceSocket } from '../src/components/WorkspaceSocket'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  close() {}

  emitMessage(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
  }
}

const fakeClient = {
  wsUrl: (wsId: number) => `wss://example.test/ws?workspaceId=${wsId}`,
} as unknown as import('../src/api/client').TadaClient

describe('WorkspaceSocket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
  })

  test('opens a socket for the given workspace and invalidates board/workspaces/activity on board_changed', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const spy = jest.spyOn(queryClient, 'invalidateQueries')

    await render(
      <QueryClientProvider client={queryClient}>
        <ClientProvider client={fakeClient}>
          <WorkspaceSocket workspaceId={7} WebSocketCtor={FakeWebSocket as unknown as typeof WebSocket} />
        </ClientProvider>
      </QueryClientProvider>,
    )

    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeDefined()
    expect(socket?.url).toBe('wss://example.test/ws?workspaceId=7')

    const msg: WsMessage = { type: 'board_changed', workspaceId: 7 }
    socket?.emitMessage(msg)

    // This is the Control-relevant path: a live board_changed push refreshes the board, the
    // workspaces list (triage counts live there), and the cross-workspace activity feed —
    // exactly the queries Control's triage/Today card read.
    expect(spy).toHaveBeenCalledWith({ queryKey: keys.board(7) })
    expect(spy).toHaveBeenCalledWith({ queryKey: keys.workspaces })
    expect(spy).toHaveBeenCalledWith({ queryKey: keys.activity() })
  })

  test('renders nothing', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { toJSON } = await render(
      <QueryClientProvider client={queryClient}>
        <ClientProvider client={fakeClient}>
          <WorkspaceSocket workspaceId={7} WebSocketCtor={FakeWebSocket as unknown as typeof WebSocket} />
        </ClientProvider>
      </QueryClientProvider>,
    )

    expect(toJSON()).toBeNull()
  })
})
