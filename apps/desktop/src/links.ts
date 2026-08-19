export type LinkDecision = 'internal' | 'external' | 'block'

/**
 * Where a URL belongs. `appOrigin` is the window's own origin — `app://tada` when serving the
 * bundle, the Expo dev server when TADA_DESKTOP_DEV is set.
 *
 * Everything that is not the app itself and not a plain web URL is blocked rather than handed to
 * the OS: `shell.openExternal` will happily launch a `file://` or custom-scheme URL, so a link in
 * a run transcript could otherwise open something on this machine.
 */
export function linkDecision(url: string, appOrigin: string): LinkDecision {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'block'
  }

  // For custom schemes like app://, origin may not be set correctly by the URL constructor.
  // Build the expected origin from protocol, hostname, and port.
  let parsedOrigin: string
  try {
    if (parsed.port) {
      parsedOrigin = `${parsed.protocol}//${parsed.hostname}:${parsed.port}`
    } else {
      parsedOrigin = `${parsed.protocol}//${parsed.hostname}`
    }
  } catch {
    return 'block'
  }

  if (parsedOrigin === appOrigin) return 'internal'
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return 'external'
  return 'block'
}
