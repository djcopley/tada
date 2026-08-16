/**
 * Chains two resolvers: jest-expo's base resolver (which maps native
 * modules to mocks) plus react-native-worklets' extension filtering, which
 * swaps its .native.ts TurboModule entrypoints for JS implementations so
 * Reanimated can load under Jest.
 */
const baseResolver = require(require('jest-expo/jest-preset').resolver)

module.exports = (request, options) => {
  // Match the worklets package itself, not any pnpm store path that merely mentions it: under
  // pnpm, expo-modules-core lives at `.pnpm/expo-modules-core@…_react-native-worklets@…/`, and a
  // substring match stripped `.native.*` from all of expo-modules-core too, bypassing jest-expo's
  // native mocks (symptom: "No native ExponentConstants module found").
  if (
    request === 'react-native-worklets' ||
    request.startsWith('react-native-worklets/') ||
    /[\\/]node_modules[\\/]react-native-worklets[\\/]/.test(options.basedir)
  ) {
    options = {
      ...options,
      extensions: options.extensions?.filter((ext) => !ext.includes('native')),
    }
  }
  return baseResolver(request, options)
}
