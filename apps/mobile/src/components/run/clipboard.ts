import { Platform } from 'react-native'

/**
 * Best-effort copy. Web uses the Clipboard API; native has no clipboard module in this build
 * (expo-clipboard isn't a dependency), so it resolves false and callers say so in a toast rather
 * than pretending. Never throws.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through
  }
  return false
}
