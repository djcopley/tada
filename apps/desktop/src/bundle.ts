import path from 'node:path'

/**
 * Maps an `app://tada/<pathname>` request onto a file inside the Expo static export.
 *
 * Resolution order matters: an exact hit serves assets, `<path>.html` serves the per-route files
 * `expo export --platform web` writes, a directory's `index.html` covers nested routes, and
 * `index.html` is the SPA fallback — without it every expo-router path that was pushed with
 * history.pushState would 404 on reload.
 *
 * `isFile` is injected so the resolution order is testable without a real bundle on disk.
 * Returns null for anything that escapes `root`: `app://tada/../../secret` must never be served.
 */
export function resolveBundlePath(
  root: string,
  pathname: string,
  isFile: (p: string) => boolean,
): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // A malformed escape is a bad request, not a crash in the protocol handler.
    return null
  }

  const relative = decoded.replace(/^\/+/, '')
  const target = path.resolve(root, relative)
  const inside = path.relative(root, target)
  if (inside.startsWith('..') || path.isAbsolute(inside)) return null

  const fallback = path.join(root, 'index.html')
  if (relative === '') return fallback

  for (const candidate of [target, `${target}.html`, path.join(target, 'index.html')]) {
    if (isFile(candidate)) return candidate
  }
  return fallback
}
