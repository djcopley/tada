import { type PushEnv, pushUiState } from '../src/webPush'

const env = (over: Partial<PushEnv> = {}): PushEnv => ({
  hasPushManager: true,
  isIos: false,
  isStandalone: false,
  permission: 'default',
  ...over,
})

describe('pushUiState', () => {
  it('reports unsupported when the browser has no PushManager', () => {
    expect(pushUiState(env({ hasPushManager: false }))).toBe('unsupported')
  })

  it('demands installation on iOS only — Safari refuses push in a plain tab', () => {
    expect(pushUiState(env({ isIos: true, isStandalone: false }))).toBe('needs-install')
    expect(pushUiState(env({ isIos: true, isStandalone: true }))).toBe('can-enable')
  })

  it('lets a desktop browser enable without installing anything', () => {
    expect(pushUiState(env({ isIos: false, isStandalone: false }))).toBe('can-enable')
  })

  it('reports enabled once permission is granted', () => {
    expect(pushUiState(env({ permission: 'granted' }))).toBe('enabled')
    expect(pushUiState(env({ isIos: true, isStandalone: true, permission: 'granted' }))).toBe(
      'enabled',
    )
  })

  it('reports blocked when permission was denied', () => {
    expect(pushUiState(env({ permission: 'denied' }))).toBe('blocked')
  })

  it('prefers unsupported over every other state', () => {
    expect(pushUiState(env({ hasPushManager: false, permission: 'granted' }))).toBe('unsupported')
  })
})
