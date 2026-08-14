/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // `setupFiles` REPLACES the preset's list (which installs the Expo
  // native-module mocks), so re-include it before our own additions.
  setupFiles: [
    ...(require('jest-expo/jest-preset').setupFiles ?? []),
    'react-native-gesture-handler/jestSetup.js',
    './test/jest.setup.js',
  ],
  // Chained resolver: jest-expo's native-module mapping + worklets'
  // .native.ts filtering so Reanimated loads under Jest.
  resolver: './test/jest.resolver.js',
  // Matches jest-expo's own default (jest-expo/jest-preset.js), reproduced
  // here so pnpm's `.pnpm/<pkg>/node_modules/<pkg>` layout still transforms
  // React Native / Expo packages that ship untranspiled ESM.
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation))',
  ],
  // @tada/shared is authored as NodeNext ESM TS (relative imports carry a
  // `.js` extension that only resolves against a compiled output). We run
  // it straight from source here, so strip that extension for Jest's CJS
  // resolver, same as any other TS-source workspace package.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
}
