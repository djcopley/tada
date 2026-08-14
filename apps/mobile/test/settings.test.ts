import { Platform } from 'react-native'
import { clearConnection, loadConnection, saveConnection } from '../src/settings'

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key)
    }),
  }
})

const SecureStore = jest.requireMock('expo-secure-store') as {
  getItemAsync: jest.Mock
  setItemAsync: jest.Mock
  deleteItemAsync: jest.Mock
}

describe('settings (native)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('round-trips a connection through SecureStore', async () => {
    expect(await loadConnection()).toBeNull()

    const conn = { baseUrl: 'https://example.com', token: 'secret-token' }
    await saveConnection(conn)
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('tada.connection', JSON.stringify(conn))

    expect(await loadConnection()).toEqual(conn)

    await clearConnection()
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('tada.connection')
    expect(await loadConnection()).toBeNull()
  })

  test('returns null for malformed stored JSON', async () => {
    SecureStore.getItemAsync.mockResolvedValueOnce('not json')
    expect(await loadConnection()).toBeNull()
  })
})

describe('settings (web)', () => {
  const originalWindow = (globalThis as { window?: Window }).window

  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'web')
    const store = new Map<string, string>()
    const localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage
    ;(globalThis as { window?: unknown }).window = { localStorage }
  })

  afterEach(() => {
    ;(globalThis as { window?: Window }).window = originalWindow
  })

  test('round-trips a connection through localStorage', async () => {
    expect(await loadConnection()).toBeNull()

    const conn = { baseUrl: 'https://example.com', token: 'web-token' }
    await saveConnection(conn)
    expect(await loadConnection()).toEqual(conn)

    await clearConnection()
    expect(await loadConnection()).toBeNull()
  })
})
