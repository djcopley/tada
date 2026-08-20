import { fireEvent, render, screen } from '@testing-library/react-native'
import { BottomStrip, Rail } from '../src/components/ui'

const mockNavigate = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: (href: string) => mockNavigate(href) }),
}))

beforeEach(() => mockNavigate.mockClear())

/**
 * Settings is a gear in each frame's utility corner, not a fourth word-destination: four labels
 * squeezed the narrow strip until every one of them ellipsised ("Cont…", "Setti…").
 */
describe('the settings gear', () => {
  it('is an icon in the strip, not a labelled tab', async () => {
    await render(<BottomStrip active="control" />)
    expect(screen.getByText('Control')).toBeTruthy()
    expect(screen.getByText('Memory')).toBeTruthy()
    expect(screen.queryByText('Settings')).toBeNull()
    expect(screen.getByTestId('bottom-strip-settings').props.accessibilityLabel).toBe('Settings')
  })

  it('is an icon in the rail, not a nav row', async () => {
    await render(<Rail active="control" />)
    expect(screen.getByText('Board')).toBeTruthy()
    expect(screen.queryByText('Settings')).toBeNull()
    expect(screen.getByTestId('rail-nav-settings').props.accessibilityLabel).toBe('Settings')
  })

  it.each([
    ['bottom-strip-settings', <BottomStrip active="control" />],
    ['rail-nav-settings', <Rail active="control" />],
  ])('navigates to settings from %s', async (testID, element) => {
    await render(element)
    fireEvent.press(screen.getByTestId(testID))
    expect(mockNavigate).toHaveBeenCalledWith('/settings')
  })

  it.each([
    ['bottom-strip-settings', <BottomStrip active="settings" />],
    ['rail-nav-settings', <Rail active="settings" />],
  ])('reads as selected on the settings screen (%s)', async (testID, element) => {
    await render(element)
    expect(screen.getByTestId(testID).props.accessibilityState).toMatchObject({ selected: true })
  })
})

describe('BottomStrip tabs', () => {
  it('shows the stopped count beside Control rather than widening its label', async () => {
    await render(<BottomStrip active="board" stoppedCount={3} />)
    // ` · 3` inline is what pushed "Control" past the tab's width — the count is its own numeral.
    expect(screen.getByText('Control')).toBeTruthy()
    expect(screen.getByTestId('bottom-strip-stopped-count')).toHaveTextContent('3')
  })

  it('omits the count when nothing is stopped on you', async () => {
    await render(<BottomStrip active="control" />)
    expect(screen.queryByTestId('bottom-strip-stopped-count')).toBeNull()
  })

  it('navigates between sections and no-ops on the active one', async () => {
    await render(<BottomStrip active="control" />)
    fireEvent.press(screen.getByTestId('bottom-strip-board'))
    expect(mockNavigate).toHaveBeenCalledWith('/board')
    mockNavigate.mockClear()
    fireEvent.press(screen.getByTestId('bottom-strip-control'))
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
