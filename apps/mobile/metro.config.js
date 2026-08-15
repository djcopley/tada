// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// Expo SDK 52+ auto-detects pnpm monorepos and configures watchFolders /
// nodeModulesPaths for us. We only need to make sure both are present in
// case that detection ever misses this layout.
config.watchFolders = Array.from(new Set([...config.watchFolders, monorepoRoot]))
config.resolver.nodeModulesPaths = Array.from(
  new Set([
    ...config.resolver.nodeModulesPaths,
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(monorepoRoot, 'node_modules'),
  ]),
)

// pnpm hoists dependencies into a single node_modules with symlinks; Metro
// needs symlink support enabled to resolve @tada/shared from the workspace.
config.resolver.unstable_enableSymlinks = true

// @tada/shared is authored as NodeNext ESM TS: relative imports carry an
// explicit `.js`/`.mjs` extension (e.g. `export * from './api.js'`) that
// only resolves against a compiled output. TypeScript, tsx, and Jest all
// understand that convention and resolve it back to the `.ts` source, but
// Metro's resolver does not. This used to work only because stale compiled
// `.js` files happened to exist alongside the sources; now that those are
// gone, Metro fails to resolve them. Strip the extension for relative
// specifiers so Metro's normal sourceExts resolution finds the `.ts` file,
// falling back to the original specifier for anything that doesn't resolve
// that way (e.g. a real `.js`/`.mjs` file that exists on disk).
const originalResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (/^\.{1,2}\//.test(moduleName) && /\.m?js$/.test(moduleName)) {
    const strippedModuleName = moduleName.replace(/\.m?js$/, '')
    try {
      return (originalResolveRequest ?? context.resolveRequest)(
        context,
        strippedModuleName,
        platform,
      )
    } catch {
      // Fall through to the original specifier below.
    }
  }
  return (originalResolveRequest ?? context.resolveRequest)(context, moduleName, platform)
}

module.exports = config
