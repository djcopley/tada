import { useEffect } from 'react'
import { type DimensionValue, StyleSheet } from 'react-native'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { useTheme } from '../../design/ThemeContext'
import { radius } from '../../design/tokens'

type Props = {
  width?: DimensionValue
  height?: number
  style?: object
}

/** Shimmering placeholder block for loading states. */
export function Skeleton({ width = '100%', height = 16, style }: Props) {
  const { colors } = useTheme()
  const reducedMotion = useReducedMotion()
  const opacity = useSharedValue(0.6)

  useEffect(() => {
    if (reducedMotion) return
    opacity.value = withRepeat(
      withSequence(withTiming(1, { duration: 600 }), withTiming(0.6, { duration: 600 })),
      -1,
    )
    return () => cancelAnimation(opacity)
  }, [opacity, reducedMotion])

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }))

  return (
    <Animated.View
      style={[styles.block, { width, height, backgroundColor: colors.surfaceAlt }, animated, style]}
    />
  )
}

const styles = StyleSheet.create({
  block: {
    borderRadius: radius.sm,
  },
})
