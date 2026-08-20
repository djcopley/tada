import { Platform } from 'react-native'
import { type PushEnv, pushUiState, readPushEnv, reconcileWebPushSubscription } from '../src/webPush'

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

  it('offers Enable again when permission is granted but nothing is subscribed', () => {
    expect(pushUiState(env({ permission: 'granted', hasSubscription: false }))).toBe('lapsed')
    // undefined means "not looked yet" and must keep reading as enabled, or the card would flash
    // a re-opt-in prompt on every mount before the reconcile answers.
    expect(pushUiState(env({ permission: 'granted', hasSubscription: undefined }))).toBe('enabled')
    expect(pushUiState(env({ permission: 'granted', hasSubscription: true }))).toBe('enabled')
  })

  it('reports blocked when permission was denied', () => {
    expect(pushUiState(env({ permission: 'denied' }))).toBe('blocked')
  })

  it('prefers unsupported over every other state', () => {
    expect(pushUiState(env({ hasPushManager: false, permission: 'granted' }))).toBe('unsupported')
  })
})

describe('readPushEnv', () => {
  const originalPlatform = Platform.OS

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { get: () => originalPlatform })
    delete (globalThis as Record<string, unknown>).tadaDesktop
  })

  it('reports no PushManager under the Electron shell — its Chromium has no push service', () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'web' })
    ;(globalThis as Record<string, unknown>).tadaDesktop = { notify: jest.fn(), onOpenRun: () => () => {} }

    expect(readPushEnv()).toEqual({
      hasPushManager: false,
      isIos: false,
      isStandalone: false,
      permission: 'default',
    })
  })
})

describe('reconcileWebPushSubscription', () => {
  const withServiceWorker = (getRegistration: () => Promise<unknown>) => {
    Object.defineProperty(global, 'navigator', {
      value: { serviceWorker: { getRegistration } },
      configurable: true,
      writable: true,
    })
  }

  it('re-posts the live subscription — the row may have vanished server-side', async () => {
    const toJSON = () => ({ endpoint: 'https://push/1', keys: { p256dh: 'p', auth: 'a' } })
    withServiceWorker(async () => ({ pushManager: { getSubscription: async () => ({ toJSON }) } }))
    const client = { registerWebPushSubscription: jest.fn(async () => {}) }

    await expect(reconcileWebPushSubscription(client as never)).resolves.toBe(true)
    expect(client.registerWebPushSubscription).toHaveBeenCalledWith(toJSON())
  })

  it('reports no live subscription when the browser has none', async () => {
    withServiceWorker(async () => ({ pushManager: { getSubscription: async () => null } }))
    const client = { registerWebPushSubscription: jest.fn(async () => {}) }

    await expect(reconcileWebPushSubscription(client as never)).resolves.toBe(false)
    expect(client.registerWebPushSubscription).not.toHaveBeenCalled()
  })

  it('reports no live subscription when no service worker is registered', async () => {
    withServiceWorker(async () => undefined)
    await expect(
      reconcileWebPushSubscription({ registerWebPushSubscription: jest.fn() } as never),
    ).resolves.toBe(false)
  })

  it('swallows failures and assumes the subscription is still live', async () => {
    withServiceWorker(async () => {
      throw new Error('offline')
    })
    await expect(
      reconcileWebPushSubscription({ registerWebPushSubscription: jest.fn() } as never),
    ).resolves.toBe(true)

    // A failing POST is transient too — the subscription exists, the network did not.
    withServiceWorker(async () => ({
      pushManager: { getSubscription: async () => ({ toJSON: () => ({}) }) },
    }))
    const client = {
      registerWebPushSubscription: jest.fn(async () => {
        throw new Error('500')
      }),
    }
    await expect(reconcileWebPushSubscription(client as never)).resolves.toBe(true)
  })
})
