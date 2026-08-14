// Reanimated ships an official static mock for Jest; animations resolve
// instantly and worklets run on the JS thread. (The worklets jest resolver
// in jest.config.js keeps this from pulling in native TurboModules.)
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock')
  return {
    ...mock,
    // Not included in the shipped mock ("ADD ME IF NEEDED" upstream).
    useReducedMotion: () => false,
  }
})

// Official mock: zero insets/frame so screens render without a measured
// SafeAreaProvider in the tree.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)

// SecureStore has no native module under jest-expo; an in-memory map keeps
// src/settings.ts (pulled in transitively via ThemeContext) importable in
// suites that don't mock ../src/settings themselves.
jest.mock('expo-secure-store', () => {
  const store = new Map()
  return {
    getItemAsync: jest.fn(async (key) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, value)
    }),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key)
    }),
  }
})

// Fonts resolve instantly so RootLayout doesn't render null in tests.
jest.mock('expo-font', () => ({
  useFonts: () => [true, null],
  loadAsync: jest.fn(() => Promise.resolve()),
  isLoaded: jest.fn(() => true),
}))

