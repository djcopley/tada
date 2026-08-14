/**
 * Chains two resolvers: jest-expo's base resolver (which maps native
 * modules to mocks) plus react-native-worklets' extension filtering, which
 * swaps its .native.ts TurboModule entrypoints for JS implementations so
 * Reanimated can load under Jest.
 */
const baseResolver = require(require('jest-expo/jest-preset').resolver)

module.exports = (request, options) => {
  if (options.basedir.includes('react-native-worklets') || request.includes('react-native-worklets')) {
    options = {
      ...options,
      extensions: options.extensions?.filter((ext) => !ext.includes('native')),
    }
  }
  return baseResolver(request, options)
}
