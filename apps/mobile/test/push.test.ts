import { Platform } from 'react-native'
import type { TadaClient } from '../src/api/client'

const mockGetPermissionsAsync: jest.Mock = jest.fn()
const mockRequestPermissionsAsync: jest.Mock = jest.fn()
const mockGetExpoPushTokenAsync: jest.Mock = jest.fn()
const mockGetLastNotificationResponseAsync: jest.Mock = jest.fn(async () => null)
const mockAddNotificationResponseReceivedListener: jest.Mock = jest.fn()
const mockRemove = jest.fn()

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoPushTokenAsync(...args),
  getLastNotificationResponseAsync: (...args: unknown[]) => mockGetLastNotificationResponseAsync(...args),
  addNotificationResponseReceivedListener: (...args: unknown[]) => {
    mockAddNotificationResponseReceivedListener(...args)
    return { remove: mockRemove }
  },
}))

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}))

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import { cleanup, renderHook, waitFor } from '@testing-library/react-native'
import { registerForPush, useNotificationDeepLinks } from '../src/push'

function fakeClient(overrides: Partial<TadaClient> = {}): TadaClient {
  return {
    registerPushToken: jest.fn(async () => undefined),
    ...overrides,
  } as unknown as TadaClient
}

describe('registerForPush', () => {
  const originalPlatform = Platform.OS

  afterEach(() => {
    jest.clearAllMocks()
    Object.defineProperty(Platform, 'OS', { get: () => originalPlatform })
  })

  test('web platform: skips entirely, never calls permission APIs', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'web' })
    const client = fakeClient()

    await registerForPush(client)

    expect(mockGetPermissionsAsync).not.toHaveBeenCalled()
    expect(client.registerPushToken).not.toHaveBeenCalled()
  })

  test('granted permission: registers the push token', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' })
    mockGetPermissionsAsync.mockResolvedValueOnce({ status: 'granted' })
    mockGetExpoPushTokenAsync.mockResolvedValueOnce({ data: 'ExponentPushToken[abc]' })
    const client = fakeClient()

    await registerForPush(client)

    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled()
    expect(client.registerPushToken).toHaveBeenCalledWith('ExponentPushToken[abc]')
  })

  test('undetermined permission requests, then registers when granted', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' })
    mockGetPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined' })
    mockRequestPermissionsAsync.mockResolvedValueOnce({ status: 'granted' })
    mockGetExpoPushTokenAsync.mockResolvedValueOnce({ data: 'ExponentPushToken[xyz]' })
    const client = fakeClient()

    await registerForPush(client)

    expect(mockRequestPermissionsAsync).toHaveBeenCalled()
    expect(client.registerPushToken).toHaveBeenCalledWith('ExponentPushToken[xyz]')
  })

  test('denied permission: does not register a token and does not throw', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' })
    mockGetPermissionsAsync.mockResolvedValueOnce({ status: 'denied' })
    const client = fakeClient()

    await expect(registerForPush(client)).resolves.toBeUndefined()

    expect(mockGetExpoPushTokenAsync).not.toHaveBeenCalled()
    expect(client.registerPushToken).not.toHaveBeenCalled()
  })

  test('registerPushToken network failure: warns but does not throw', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' })
    mockGetPermissionsAsync.mockResolvedValueOnce({ status: 'granted' })
    mockGetExpoPushTokenAsync.mockResolvedValueOnce({ data: 'ExponentPushToken[abc]' })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const client = fakeClient({
      registerPushToken: jest.fn(async () => {
        throw new Error('network down')
      }),
    })

    await expect(registerForPush(client)).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('useNotificationDeepLinks', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  test('navigates to the ticket route when a notification is tapped', async () => {
    const { unmount } = await renderHook(() => useNotificationDeepLinks())

    await waitFor(() => {
      expect(mockAddNotificationResponseReceivedListener).toHaveBeenCalledTimes(1)
    })
    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0][0] as (response: unknown) => void

    listener({ notification: { request: { content: { data: { ticketId: 42 } } } } })

    expect(mockPush).toHaveBeenCalledWith('/tickets/42')

    unmount()
    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalled()
    })
    cleanup()
  })

  test('navigates on cold start via getLastNotificationResponseAsync', async () => {
    mockGetLastNotificationResponseAsync.mockResolvedValueOnce({
      notification: { request: { content: { data: { ticketId: 7 } } } },
    })
    await renderHook(() => useNotificationDeepLinks())

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/tickets/7')
    })
    cleanup()
  })
})
