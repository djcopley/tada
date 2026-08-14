import type { ApiRunEvent } from '@tada/shared'
import { render, screen } from '@testing-library/react-native'
import { EventFeed } from '../src/components/EventFeed'

function evt(overrides: Partial<ApiRunEvent> = {}): ApiRunEvent {
  return {
    id: 1,
    runId: 7,
    type: 'text',
    payload: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('EventFeed', () => {
  test('renders one row per event kind with the right testID and content', async () => {
    const events: ApiRunEvent[] = [
      evt({ id: 1, type: 'status', payload: { status: 'running' } }),
      evt({ id: 2, type: 'text', payload: { text: 'thinking about the fix' } }),
      evt({ id: 3, type: 'tool_use', payload: { name: 'bash', inputPreview: '{"cmd":"ls"}' } }),
      evt({ id: 4, type: 'error', payload: { message: 'boom' } }),
    ]

    await render(<EventFeed events={events} live={false} />)

    expect(screen.getByTestId('event-status-1')).toHaveTextContent(/running/)
    expect(screen.getByTestId('event-text-2')).toHaveTextContent(/thinking about the fix/)
    expect(screen.getByTestId('event-tool-3')).toHaveTextContent(/bash\(/)
    expect(screen.getByTestId('event-error-4')).toHaveTextContent(/boom/)
  })

  test('falls back to a JSON preview when a payload does not have the expected shape', async () => {
    const events: ApiRunEvent[] = [evt({ id: 1, type: 'status', payload: { weird: true } })]

    await render(<EventFeed events={events} live={false} />)

    expect(screen.getByTestId('event-status-1')).toHaveTextContent(/\{"weird":true\}/)
  })
})
