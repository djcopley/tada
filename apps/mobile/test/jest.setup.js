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

// Fonts resolve instantly so RootLayout doesn't render null in tests.
jest.mock('expo-font', () => ({
  useFonts: () => [true, null],
  loadAsync: jest.fn(() => Promise.resolve()),
  isLoaded: jest.fn(() => true),
}))

