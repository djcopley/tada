import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

/**
 * Minimal cross-platform toast: a module-level pub/sub so any code
 * (mutation error handlers, etc.) can trigger a message without needing to
 * be inside a particular component tree, plus a single <ToastHost/> mounted
 * near the app root that renders whatever was last shown. No external
 * library — this is the whole feature.
 */
type Listener = (message: string) => void

const listeners = new Set<Listener>()

export function showToast(message: string): void {
  for (const listener of listeners) listener(message)
}

const TOAST_DURATION_MS = 3000

export function ToastHost() {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const listener: Listener = (msg) => setMessage(msg)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  useEffect(() => {
    if (message === null) return
    const timer = setTimeout(() => setMessage(null), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [message])

  if (message === null) return null

  return (
    <View pointerEvents="none" style={styles.container}>
      <View style={styles.toast}>
        <Text testID="toast-message" style={styles.text}>
          {message}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 40,
    alignItems: 'center',
  },
  toast: {
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    maxWidth: '90%',
  },
  text: {
    color: '#fff',
    fontSize: 14,
  },
})
