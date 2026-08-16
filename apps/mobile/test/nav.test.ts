import { goBackOr, goToControl, goToSection } from '../src/nav'

describe('goToControl', () => {
  test('goes back when the router has history', () => {
    const back = jest.fn()
    const replace = jest.fn()
    goToControl({ back, replace, canGoBack: () => true })
    expect(back).toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  test('falls back to /workspaces when there is no history to unwind', () => {
    const back = jest.fn()
    const replace = jest.fn()
    goToControl({ back, replace, canGoBack: () => false })
    expect(replace).toHaveBeenCalledWith('/workspaces')
    expect(back).not.toHaveBeenCalled()
  })

  test('falls back to /workspaces when canGoBack is not provided', () => {
    const back = jest.fn()
    const replace = jest.fn()
    goToControl({ back, replace })
    expect(replace).toHaveBeenCalledWith('/workspaces')
  })
})

describe('goBackOr', () => {
  test('replaces with the given fallback when there is no history', () => {
    const back = jest.fn()
    const replace = jest.fn()
    goBackOr({ back, replace, canGoBack: () => false }, '/workspaces/3/memory')
    expect(replace).toHaveBeenCalledWith('/workspaces/3/memory')
    expect(back).not.toHaveBeenCalled()
  })
})

describe('goToSection', () => {
  const router = () => ({ navigate: jest.fn() })

  test('tapping the active section is a no-op', () => {
    const r = router()
    goToSection(r, { key: 'board', active: 'board', href: '/workspaces/1/board' })
    expect(r.navigate).not.toHaveBeenCalled()
  })

  test('any other section is a tab jump (navigate), never a push', () => {
    const r = router()
    goToSection(r, { key: 'board', active: 'control', href: '/workspaces/1/board' })
    goToSection(r, { key: 'control', active: 'memory', href: '/workspaces' })
    expect(r.navigate.mock.calls).toEqual([['/workspaces/1/board'], ['/workspaces']])
  })
})
