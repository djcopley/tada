import type { ApiRunEvent } from '@tada/shared'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { EventFeed } from '../src/components/EventFeed'
import { ThemeProvider } from '../src/design/ThemeContext'
import { night } from '../src/design/tokens'

const ev = (id: number, type: ApiRunEvent['type'], payload: unknown): ApiRunEvent => ({
  id,
  runId: 1,
  type,
  payload,
  createdAt: '2026-01-01T09:41:00.000Z',
})

const events = [
  ev(1, 'text', { text: 'made a worktree for parlor-api — off main' }),
  ev(2, 'tool_use', { name: 'Edit', inputPreview: '{"file_path":"src/auth/session.ts"}' }),
  ev(3, 'error', { message: 'playwright install failed' }),
  ev(4, 'gate', { kind: 'hold', hold: { reason: 'permission', tool: 'Bash', summary: 'gh pr create', ruleId: 3, ruleTitle: 'Open a pull request', publishes: true } }),
]

const renderFeed = (props: Partial<React.ComponentProps<typeof EventFeed>> = {}) =>
  render(
    <ThemeProvider>
      <EventFeed events={events} live={true} {...props} />
    </ThemeProvider>,
  )

describe('EventFeed', () => {
  test('narrates each event once, tool calls as prose, errors with ✕, holds with ⏸', async () => {
    await renderFeed()
    expect(screen.getByTestId('event-text-1')).toHaveTextContent(/made a worktree for parlor-api/)
    expect(screen.getByTestId('event-tool-2')).toHaveTextContent(/editing src\/auth\/session.ts/)
    expect(screen.getByTestId('event-error-3')).toHaveTextContent(/✕ playwright install failed/)
    expect(screen.getByTestId('event-gate-4')).toHaveTextContent(/⏸ gh pr create — stopped, waiting on you/)
  })

  test('the hold line is live-coloured and errors are fail-coloured', async () => {
    await renderFeed()
    const hold = screen.getByText(/⏸ gh pr create/)
    expect(hold.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ color: night.liveText })]))
    const err = screen.getByText(/✕ playwright install failed/)
    expect(err.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ color: night.failText })]))
  })

  test('long press asks for the line context menu and the selected line is outlined', async () => {
    const onLineContext = jest.fn()
    await renderFeed({ onLineContext, selectedId: 2 })
    fireEvent(screen.getByTestId('event-tool-2'), 'longPress')
    expect(onLineContext).toHaveBeenCalledWith({ line: expect.objectContaining({ text: 'editing src/auth/session.ts' }) })
    expect(screen.getByTestId('event-tool-2').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ borderColor: night.live })]))
  })

  test('skips events with nothing to say', async () => {
    await render(
      <ThemeProvider>
        <EventFeed events={[ev(9, 'tool_use', { name: null }), ev(10, 'gate', { kind: 'nope' })]} live={false} />
      </ThemeProvider>,
    )
    expect(screen.queryByTestId('event-tool-9')).toBeNull()
    expect(screen.queryByTestId('event-gate-10')).toBeNull()
  })
})
