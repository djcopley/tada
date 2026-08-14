/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['react-native-gesture-handler/jestSetup.js', './test/jest.setup.js'],
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
