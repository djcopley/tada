import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

/** Server connection settings persisted on-device. */
export interface Connection {
  baseUrl: string
  token: string
}

const KEY = 'tada.connection'

function isWeb(): boolean {
  return Platform.OS === 'web'
}

async function readRaw(): Promise<string | null> {
  if (isWeb()) {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(KEY)
  }
  return SecureStore.getItemAsync(KEY)
}

async function writeRaw(value: string): Promise<void> {
  if (isWeb()) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(KEY, value)
    return
  }
  await SecureStore.setItemAsync(KEY, value)
}

async function removeRaw(): Promise<void> {
  if (isWeb()) {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(KEY)
    return
  }
  await SecureStore.deleteItemAsync(KEY)
}

export async function loadConnection(): Promise<Connection | null> {
  const raw = await readRaw()
  if (raw == null) return null
  try {
    return JSON.parse(raw) as Connection
  } catch {
    return null
  }
}

export async function saveConnection(c: Connection): Promise<void> {
  await writeRaw(JSON.stringify(c))
}

export async function clearConnection(): Promise<void> {
  await removeRaw()
}

/** Night watch is the primary theme; paper day is opt-in. */
export type ThemeScheme = 'night' | 'day'

const THEME_KEY = 'tada.theme'

export async function loadThemeScheme(): Promise<ThemeScheme> {
  try {
    const raw = isWeb()
      ? typeof window === 'undefined'
        ? null
        : window.localStorage.getItem(THEME_KEY)
      : await SecureStore.getItemAsync(THEME_KEY)
    return raw === 'day' ? 'day' : 'night'
  } catch {
    return 'night'
  }
}

export async function saveThemeScheme(scheme: ThemeScheme): Promise<void> {
  if (isWeb()) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(THEME_KEY, scheme)
    return
  }
  await SecureStore.setItemAsync(THEME_KEY, scheme)
}
