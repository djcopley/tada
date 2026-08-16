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
  const router = () => ({ push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() })

  test('tapping the active section is a no-op', () => {
    const r = router()
    goToSection(r, { key: 'board', active: 'board', href: '/workspaces/1/board' })
    expect(r.push).not.toHaveBeenCalled()
    expect(r.replace).not.toHaveBeenCalled()
    expect(r.dismissTo).not.toHaveBeenCalled()
  })

  test('Control pops back to the Control already in the stack', () => {
    const r = router()
    goToSection(r, { key: 'control', active: 'memory', href: '/workspaces' })
    expect(r.dismissTo).toHaveBeenCalledWith('/workspaces')
  })

  test('a section opened from Control is pushed', () => {
    const r = router()
    goToSection(r, { key: 'board', active: 'control', href: '/workspaces/1/board' })
    expect(r.push).toHaveBeenCalledWith('/workspaces/1/board')
  })

  test('switching between sections replaces instead of stacking', () => {
    const r = router()
    goToSection(r, { key: 'memory', active: 'board', href: '/workspaces/1/memory' })
    expect(r.replace).toHaveBeenCalledWith('/workspaces/1/memory')
    expect(r.push).not.toHaveBeenCalled()
  })
})
