/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // Matches jest-expo's own default (jest-expo/jest-preset.js), reproduced
  // here so pnpm's `.pnpm/<pkg>/node_modules/<pkg>` layout still transforms
  // React Native / Expo packages that ship untranspiled ESM.
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation))',
  ],
}
