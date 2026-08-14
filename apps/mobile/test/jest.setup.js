// Reanimated ships an official static mock for Jest; animations resolve
// instantly and worklets run on the JS thread.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'))

// Official mock: zero insets/frame so screens render without a measured
// SafeAreaProvider in the tree.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock'))

// Fonts resolve instantly so RootLayout doesn't render null in tests.
jest.mock('expo-font', () => ({
  useFonts: () => [true, null],
  loadAsync: jest.fn(() => Promise.resolve()),
  isLoaded: jest.fn(() => true),
}))

