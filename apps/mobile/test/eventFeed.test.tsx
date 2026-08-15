import type { ApiRunEvent } from '@tada/shared'
import { render, screen } from '@testing-library/react-native'
import { EventFeed, narrationText } from '../src/components/EventFeed'

function evt(overrides: Partial<ApiRunEvent> = {}): ApiRunEvent {
  return {
    id: 1,
    runId: 7,
    type: 'text',
    payload: {},
    createdAt: '2026-01-01T09:41:00.000Z',
    ...overrides,
  }
}

/** The HH:MM stamp is rendered in the machine's local time (matching the component), so tests
 * compute the expected string the same way rather than hardcoding a UTC-derived value. */
function localStamp(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

describe('narrationText', () => {
  test('status and text events narrate their payload field verbatim', () => {
    expect(narrationText(evt({ type: 'status', payload: { status: 'running' } }))).toBe('running')
    expect(narrationText(evt({ type: 'text', payload: { text: 'reproduced the flake' } }))).toBe('reproduced the flake')
  })

  test('a tool call with a file path narrates "editing <path>"', () => {
    const line = narrationText(
      evt({
        type: 'tool_use',
        payload: { name: 'Edit', inputPreview: JSON.stringify({ file_path: 'src/auth/session.ts' }) },
      }),
    )
    expect(line).toBe('editing src/auth/session.ts')
  })

  test('a read-tool call with a path narrates "reading <path>"', () => {
    const line = narrationText(
      evt({ type: 'tool_use', payload: { name: 'Read', inputPreview: JSON.stringify({ path: 'README.md' }) } }),
    )
    expect(line).toBe('reading README.md')
  })

  test('a tool call with a name but no path falls back to the lowercased name', () => {
    expect(
      narrationText(evt({ type: 'tool_use', payload: { name: 'Bash', inputPreview: '{"cmd":"ls"}' } })),
    ).toBe('bash')
  })

  test('a tool call with neither name nor path is skipped entirely', () => {
    expect(narrationText(evt({ type: 'tool_use', payload: {} }))).toBeNull()
  })

  test('truncated/invalid inputPreview JSON falls back to the name instead of throwing', () => {
    expect(
      narrationText(evt({ type: 'tool_use', payload: { name: 'Edit', inputPreview: '{"file_path":"src/a' } })),
    ).toBe('edit')
  })

  test('error events narrate the message field', () => {
    expect(narrationText(evt({ type: 'error', payload: { message: 'boom' } }))).toBe('boom')
  })

  test('unknown event types are skipped', () => {
    expect(narrationText(evt({ type: 'something_else', payload: {} }))).toBeNull()
  })
})

describe('EventFeed', () => {
  test('renders a stamped line per narratable event, skipping tool calls with nothing to say', async () => {
    const events: ApiRunEvent[] = [
      evt({ id: 1, type: 'status', payload: { status: 'running' } }),
      evt({ id: 2, type: 'text', payload: { text: 'thinking about the fix' } }),
      evt({ id: 3, type: 'tool_use', payload: {} }),
      evt({ id: 4, type: 'error', payload: { message: 'boom' } }),
    ]

    await render(<EventFeed events={events} live={false} testID="feed" />)

    expect(screen.getByTestId('event-status-1')).toHaveTextContent(localStamp(events[0]!.createdAt), { exact: false })
    expect(screen.getByTestId('event-status-1')).toHaveTextContent('running', { exact: false })
    expect(screen.getByTestId('event-text-2')).toHaveTextContent('thinking about the fix', { exact: false })
    expect(screen.queryByTestId('event-tool-3')).toBeNull()
    expect(screen.getByTestId('event-error-4')).toHaveTextContent('✕ boom', { exact: false })
  })

  test('while live, the latest narratable line renders the pulsing ▮ marker', async () => {
    const events: ApiRunEvent[] = [
      evt({ id: 1, type: 'text', payload: { text: 'first' } }),
      evt({ id: 2, type: 'text', payload: { text: 'running the suite' } }),
    ]

    await render(<EventFeed events={events} live testID="feed" />)

    expect(screen.getByTestId('event-text-1')).not.toHaveTextContent('▮')
    expect(screen.getByTestId('event-text-2')).toHaveTextContent('▮', { exact: false })
  })

  test('while not live, no line gets the pulsing marker', async () => {
    const events: ApiRunEvent[] = [evt({ id: 1, type: 'text', payload: { text: 'done' } })]

    await render(<EventFeed events={events} live={false} testID="feed" />)

    expect(screen.getByTestId('event-text-1')).not.toHaveTextContent('▮')
  })

  test('an error event never gets the pulsing marker, even if it is the latest line', async () => {
    const events: ApiRunEvent[] = [evt({ id: 1, type: 'error', payload: { message: 'boom' } })]

    await render(<EventFeed events={events} live testID="feed" />)

    expect(screen.getByTestId('event-error-1')).not.toHaveTextContent('▮')
  })
})
