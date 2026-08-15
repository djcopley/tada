import { goToControl } from '../src/nav'

describe('goToControl', () => {
  test('goes back when the router has history', () => {
    const back = jest.fn()
    const push = jest.fn()
    goToControl({ back, push, canGoBack: () => true })
    expect(back).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  test('falls back to /workspaces when there is no history to unwind', () => {
    const back = jest.fn()
    const push = jest.fn()
    goToControl({ back, push, canGoBack: () => false })
    expect(push).toHaveBeenCalledWith('/workspaces')
    expect(back).not.toHaveBeenCalled()
  })

  test('falls back to /workspaces when canGoBack is not provided', () => {
    const back = jest.fn()
    const push = jest.fn()
    goToControl({ back, push })
    expect(push).toHaveBeenCalledWith('/workspaces')
  })
})
