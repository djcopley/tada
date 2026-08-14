import * as Haptics from 'expo-haptics'
import { useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useTheme } from '../../design/ThemeContext'
import { signalColors, type Signal } from '../../design/status'
import { motion, space, type } from '../../design/tokens'

export type FlipStripItem = {
  label: string
  count: number
  signal: Signal
}

/**
 * The Dispatch signature: a departure-board strip of mono counters. When a
 * count changes (an agent picked up or finished work) the digit flips over
 * split-flap-style with a haptic tick.
 */
export function FlipStrip({ items, testID }: { items: FlipStripItem[]; testID?: string }) {
  return (
    <View testID={testID} style={styles.strip} accessibilityRole="text">
      {items.map((item) => (
        <FlipCounter key={item.label} {...item} />
      ))}
    </View>
  )
}

function FlipCounter({ label, count, signal }: FlipStripItem) {
  const { colors } = useTheme()
  const { fg } = signalColors(signal, colors)
  const reducedMotion = useReducedMotion()

  const [shown, setShown] = useState(count)
  const shownRef = useRef(count)
  const rotate = useSharedValue(0)

  useEffect(() => {
    if (reducedMotion || count === shownRef.current) {
      shownRef.current = count
      return
    }
    shownRef.current = count
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync()
    }
    // Fold the old digit away, swap, unfold the new one.
    rotate.value = withTiming(90, { duration: motion.base }, (finished) => {
      if (!finished) return
      runOnJS(setShown)(count)
      rotate.value = -90
      rotate.value = withTiming(0, { duration: motion.base })
    })
  }, [count, reducedMotion, rotate])

  const flipStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 300 }, { rotateX: `${rotate.value}deg` }],
  }))

  // With reduced motion there's no flip animation to stage, so render the
  // live count directly instead of the animation-staged value.
  const displayed = reducedMotion ? count : shown
  const active = displayed > 0

  return (
    <View accessibilityLabel={`${label} ${count}`} style={styles.counter}>
      <View style={[styles.dot, { backgroundColor: active ? fg : colors.textFaint }]} />
      <Text style={[type.monoSmall, styles.lower, { color: active ? fg : colors.textFaintSolid }]}>{label}</Text>
      <Animated.Text
        style={[type.monoSmall, styles.digit, { color: active ? fg : colors.textFaintSolid }, flipStyle]}
      >
        {displayed}
      </Animated.Text>
    </View>
  )
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.lg,
  },
  lower: {
    textTransform: 'lowercase',
  },
  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  digit: {
    fontSize: 13,
    lineHeight: 17,
  },
})
