import { useEffect } from 'react'
import { StyleSheet, Text } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { useTheme } from '../../design/ThemeContext'
import { motion } from '../../design/tokens'

type Props = {
  /** Plays the animation once whenever this flips to true. */
  play: boolean
  testID?: string
}

/**
 * The entire celebration budget: a star that pops in and fades out once when
 * a run is accepted. No loop, no bounce — a brief damped scale + fade
 * (`ii-tada`). Reduced-motion users get a plain static glyph instead.
 */
export function TadaStar({ play, testID }: Props) {
  const { colors } = useTheme()
  const reducedMotion = useReducedMotion()
  const scale = useSharedValue(0.6)
  const opacity = useSharedValue(0)

  useEffect(() => {
    if (!play) return
    if (reducedMotion) {
      scale.value = 1
      opacity.value = 1
      return
    }
    scale.value = 0.6
    opacity.value = 1
    scale.value = withSequence(
      withTiming(1.3, { duration: motion.base }),
      withTiming(1, { duration: motion.fast }),
    )
    opacity.value = withDelay(motion.tada - motion.base, withTiming(0, { duration: motion.base }))
  }, [play, reducedMotion, scale, opacity])

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }))

  if (!play) return null

  return (
    <Animated.View testID={testID} style={style}>
      <Text style={[styles.glyph, { color: colors.live }]}>✱</Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  glyph: {
    fontSize: 26,
    fontWeight: '600',
  },
})
