import { fireEvent, render, renderHook, screen } from '@testing-library/react-native'
import { Dimensions } from 'react-native'
import { useLayout, WIDE_BREAKPOINT } from '../src/layout'
import { Rail } from '../src/components/ui/Rail'
import { BottomStrip } from '../src/components/ui/BottomStrip'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockDismissTo = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, dismissTo: mockDismissTo }),
}))

function setWindowWidth(width: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 })
}

describe('useLayout', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('is narrow just under the breakpoint', async () => {
    setWindowWidth(WIDE_BREAKPOINT - 1)
    const { result } = await renderHook(() => useLayout())
    expect(result.current.wide).toBe(false)
  })

  test('is wide at and above the breakpoint', async () => {
    setWindowWidth(WIDE_BREAKPOINT)
    const { result: atBreakpoint } = await renderHook(() => useLayout())
    expect(atBreakpoint.current.wide).toBe(true)

    setWindowWidth(1600)
    const { result: aboveBreakpoint } = await renderHook(() => useLayout())
    expect(aboveBreakpoint.current.wide).toBe(true)
  })
})

describe('Rail', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('from Control, a section is pushed; the active item is a no-op', async () => {
    await render(<Rail active="control" workspaceId={7} workspaceName="parlor" sourceCount={2} />)

    await fireEvent.press(screen.getByTestId('rail-nav-board'))
    expect(mockPush).toHaveBeenCalledWith('/workspaces/7/board')

    await fireEvent.press(screen.getByTestId('rail-nav-memory'))
    expect(mockPush).toHaveBeenCalledWith('/workspaces/7/memory')

    await fireEvent.press(screen.getByTestId('rail-nav-settings'))
    expect(mockPush).toHaveBeenCalledWith('/workspaces/7/settings')

    await fireEvent.press(screen.getByTestId('rail-nav-control'))
    expect(mockPush).not.toHaveBeenCalledWith('/workspaces')
    expect(mockDismissTo).not.toHaveBeenCalled()
  })

  test('between sections it replaces; Control pops back', async () => {
    await render(<Rail active="board" workspaceId={7} />)

    await fireEvent.press(screen.getByTestId('rail-nav-memory'))
    expect(mockReplace).toHaveBeenCalledWith('/workspaces/7/memory')
    expect(mockPush).not.toHaveBeenCalled()

    await fireEvent.press(screen.getByTestId('rail-nav-control'))
    expect(mockDismissTo).toHaveBeenCalledWith('/workspaces')
  })

  test('control nav item shows the needs-you count', async () => {
    await render(<Rail active="control" needsYouCount={2} />)
    expect(screen.getByText('2')).toBeTruthy()
  })

  test('scope line renders the workspace name and source count', async () => {
    await render(<Rail active="board" workspaceId={7} workspaceName="parlor" sourceCount={2} />)
    expect(screen.getByText('parlor · 2 repos')).toBeTruthy()
  })

  test('Board/Memory/Settings are inert when no workspace is scoped', async () => {
    await render(<Rail active="control" />)

    await fireEvent.press(screen.getByTestId('rail-nav-board'))
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
    expect(screen.getByTestId('rail-nav-board')).toBeDisabled()
  })
})

describe('BottomStrip', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('from Control, a segment is pushed scoped to the given workspace; Control pops back', async () => {
    await render(<BottomStrip active="control" workspaceId={7} />)

    await fireEvent.press(screen.getByTestId('bottom-strip-board'))
    expect(mockPush).toHaveBeenCalledWith('/workspaces/7/board')

    await fireEvent.press(screen.getByTestId('bottom-strip-memory'))
    expect(mockPush).toHaveBeenCalledWith('/workspaces/7/memory')

    await fireEvent.press(screen.getByTestId('bottom-strip-control'))
    expect(mockPush).toHaveBeenCalledTimes(2)
  })

  test('between sections it replaces; Control pops back', async () => {
    await render(<BottomStrip active="memory" workspaceId={7} />)

    await fireEvent.press(screen.getByTestId('bottom-strip-board'))
    expect(mockReplace).toHaveBeenCalledWith('/workspaces/7/board')

    await fireEvent.press(screen.getByTestId('bottom-strip-control'))
    expect(mockDismissTo).toHaveBeenCalledWith('/workspaces')
  })

  test('Board/Memory are inert when no workspace is scoped', async () => {
    await render(<BottomStrip active="control" />)
    await fireEvent.press(screen.getByTestId('bottom-strip-board'))
    expect(mockPush).not.toHaveBeenCalled()
  })
})
