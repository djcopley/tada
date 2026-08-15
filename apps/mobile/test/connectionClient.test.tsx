import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { useState } from 'react'
import { Pressable, Text } from 'react-native'
import { useWorkspaceSocket } from '../src/api/useWorkspaceSocket'
import { ConnectionProvider, useConnection } from '../src/ConnectionContext'

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://tada.test', token: 'tok' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
  loadThemeScheme: jest.fn(async () => 'night'),
  saveThemeScheme: jest.fn(async () => undefined),
}))

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  close() {
    this.closed = true
  }
}

/** Opens a workspace socket off the context client, and exposes a way to swap the connection —
 * the two things whose interaction this file is about. */
function SocketHost() {
  const { connect } = useConnection()
  useWorkspaceSocket(1, undefined, FakeWebSocket as unknown as typeof WebSocket)
  return (
    <Pressable
      testID="swap-connection"
      onPress={() => {
        void connect({ baseUrl: 'https://other.test', token: 'tok2' })
      }}
    >
      <Text>swap</Text>
    </Pressable>
  )
}

/** Stands in for the app root: any state up here (the theme toggle, in the real app) re-renders
 * ConnectionProvider with fresh children. */
function Root() {
  const [renders, setRenders] = useState(0)
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <Pressable testID="rerender-root" onPress={() => setRenders((n) => n + 1)}>
          <Text>{`renders ${renders}`}</Text>
        </Pressable>
        <SocketHost />
      </ConnectionProvider>
    </QueryClientProvider>
  )
}

describe('ConnectionProvider client identity', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
  })

  test('a root re-render does not reopen workspace sockets', async () => {
    await render(<Root />)
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const socket = FakeWebSocket.instances[0]

    await fireEvent.press(screen.getByTestId('rerender-root'))
    await waitFor(() => expect(screen.getByText('renders 1')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('rerender-root'))
    await waitFor(() => expect(screen.getByText('renders 2')).toBeTruthy())

    // The client is memoized on the connection, so the socket effect never re-ran: same socket,
    // still open. Before that memoization every provider render minted a new TadaClient and
    // every workspace socket tore down and reconnected.
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(socket?.closed).toBe(false)
  })

  test('changing the connection does reopen the socket, against the new server', async () => {
    await render(<Root />)
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const first = FakeWebSocket.instances[0]
    expect(first?.url).toContain('wss://tada.test/ws?workspaceId=1')

    await fireEvent.press(screen.getByTestId('swap-connection'))

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2))
    expect(first?.closed).toBe(true)
    expect(FakeWebSocket.instances[1]?.url).toContain('wss://other.test/ws?workspaceId=1')
  })
})
