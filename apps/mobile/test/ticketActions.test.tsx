import type { ApiBoard, ApiTicket, ApiWorkspace } from '@tada/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { ClientProvider } from '../src/api/ClientContext'
import { ApiError } from '../src/api/client'
import { TicketActions } from '../src/components/TicketActions'
import { ToastHost } from '../src/toast'

const mockMoveTicket = jest.fn()
const mockPatchTicket = jest.fn()

function makeClient() {
  return {
    moveTicket: mockMoveTicket,
    patchTicket: mockPatchTicket,
  } as unknown as import('../src/api/client').TadaClient
}

function workspace(overrides: Partial<ApiWorkspace> = {}): ApiWorkspace {
  return {
    id: 1,
    name: 'Alpha',
    path: '/repos/alpha',
    defaultAdapter: 'claude',
    defaultModel: 'sonnet',
    concurrency: 1,
    timeoutMs: 60_000,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function ticket(overrides: Partial<ApiTicket>): ApiTicket {
  return {
    id: 100,
    workspaceId: 1,
    columnId: 1,
    title: 'Do the thing',
    description: '',
    position: 1,
    queueState: null,
    adapterOverride: null,
    modelOverride: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function columns(): ApiBoard['columns'] {
  return [
    { id: 1, workspaceId: 1, kind: 'backlog', title: 'Backlog', position: 1, createdAt: '2026-01-01T00:00:00.000Z', tickets: [] },
    {
      id: 2,
      workspaceId: 1,
      kind: 'ready',
      title: 'Ready',
      position: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      tickets: [ticket({ id: 200, columnId: 2, position: 5 })],
    },
    { id: 3, workspaceId: 1, kind: 'in_progress', title: 'In Progress', position: 3, createdAt: '2026-01-01T00:00:00.000Z', tickets: [] },
    { id: 4, workspaceId: 1, kind: 'in_review', title: 'In Review', position: 4, createdAt: '2026-01-01T00:00:00.000Z', tickets: [] },
    { id: 5, workspaceId: 1, kind: 'done', title: 'Done', position: 5, createdAt: '2026-01-01T00:00:00.000Z', tickets: [] },
  ]
}

async function renderSheet(props: {
  ticketOverrides?: Partial<ApiTicket>
  cols?: ApiBoard['columns']
  onClose?: () => void
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const t = ticket(props.ticketOverrides ?? {})
  const cols = props.cols ?? columns()
  await render(
    <QueryClientProvider client={queryClient}>
      <ClientProvider client={makeClient()}>
        <TicketActions
          ticket={t}
          columns={cols}
          workspace={workspace()}
          visible
          onClose={props.onClose ?? jest.fn()}
        />
        <ToastHost />
      </ClientProvider>
    </QueryClientProvider>,
  )
  return { queryClient, ticket: t, cols }
}

describe('TicketActions sheet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMoveTicket.mockResolvedValue(undefined)
    mockPatchTicket.mockResolvedValue(ticket({}))
  })

  test('backlog ticket shows Send to Ready and move targets excluding in_progress', async () => {
    await renderSheet({ ticketOverrides: { columnId: 1, position: 1 } })

    expect(screen.getByTestId('action-send-to-ready')).toBeTruthy()
    // canMoveCard('human', ...) only forbids moving INTO in_progress — every
    // other column (including Done) is a valid human move target.
    expect(screen.queryByTestId('action-move-3')).toBeNull() // in_progress not reachable by human
    expect(screen.getByTestId('action-move-2')).toBeTruthy() // ready
    expect(screen.getByTestId('action-move-4')).toBeTruthy() // in_review
    expect(screen.getByTestId('action-move-5')).toBeTruthy() // done
  })

  test('Done option is present when the ticket is in In Review', async () => {
    await renderSheet({ ticketOverrides: { columnId: 4, position: 1 } })

    expect(screen.getByTestId('action-move-5')).toBeTruthy()
  })

  test('Send to Ready is hidden once the ticket is already queued', async () => {
    await renderSheet({ ticketOverrides: { columnId: 1, queueState: 'queued' } })

    expect(screen.queryByTestId('action-send-to-ready')).toBeNull()
  })

  test('Send to Ready moves the ticket to the end of the Ready column', async () => {
    await renderSheet({ ticketOverrides: { columnId: 1, position: 1 } })

    fireEvent.press(screen.getByTestId('action-send-to-ready'))

    await waitFor(() => {
      expect(mockMoveTicket).toHaveBeenCalledWith(100, { columnId: 2, position: 6 })
    })
  })

  test('409 from moveTicket shows the run-in-progress toast', async () => {
    mockMoveTicket.mockRejectedValueOnce(new ApiError(409, { error: 'run in progress' }))

    await renderSheet({ ticketOverrides: { columnId: 1, position: 1 } })

    fireEvent.press(screen.getByTestId('action-send-to-ready'))

    await waitFor(() => {
      expect(screen.getByTestId('toast-message')).toBeTruthy()
    })
    expect(screen.getByText('Agent is working on this ticket — wait or cancel the run')).toBeTruthy()
  })

  test('agent/model row is disabled with a hint while the ticket is in progress', async () => {
    await renderSheet({ ticketOverrides: { columnId: 3, position: 1 } })

    expect(screen.getByTestId('action-agent-hint')).toBeTruthy()
  })
})
