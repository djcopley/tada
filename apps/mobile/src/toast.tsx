import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from './design/ThemeContext'
import { radius, space, type } from './design/tokens'

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
  const { colors, shadow } = useTheme()
  const insets = useSafeAreaInsets()

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
    <View pointerEvents="none" style={[styles.container, { bottom: insets.bottom + space.xxl }]}>
      <Animated.View
        entering={FadeInDown.duration(180)}
        exiting={FadeOutDown.duration(180)}
        style={[
          styles.toast,
          // Inverted surface so the toast reads above either theme.
          { backgroundColor: colors.primaryBg },
          shadow.lifted,
        ]}
      >
        <Text testID="toast-message" style={[type.body, { color: colors.primaryText }]}>
          {message}
        </Text>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  toast: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.control,
    maxWidth: '90%',
  },
})
