import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
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
import { signalColors, type StatusVisual } from '../../design/status'
import { radius, space, type } from '../../design/tokens'

type Props = {
  status: StatusVisual
  /** Extra trailing text inside the tag, e.g. an elapsed time. */
  detail?: string
  testID?: string
}

/** Uppercase mono "departure tag" with a signal dot; the dot pulses while live. */
export function StatusTag({ status, detail, testID }: Props) {
  const { colors } = useTheme()
  const { fg, bg } = signalColors(status.signal, colors)
  const reducedMotion = useReducedMotion()
  const pulse = useSharedValue(1)

  const live = Boolean(status.live) && !reducedMotion
  useEffect(() => {
    if (live) {
      pulse.value = withRepeat(
        withSequence(withTiming(0.25, { duration: 700 }), withTiming(1, { duration: 700 })),
        -1,
      )
    } else {
      cancelAnimation(pulse)
      pulse.value = 1
    }
    return () => cancelAnimation(pulse)
  }, [live, pulse])

  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }))

  return (
    <View
      testID={testID}
      accessibilityLabel={detail ? `${status.label}, ${detail}` : status.label}
      style={[styles.tag, { backgroundColor: bg }]}
    >
      <Animated.View style={[styles.dot, { backgroundColor: fg }, dotStyle]} />
      <Text style={[type.monoSmall, styles.text, { color: fg }]}>
        {status.label}
        {detail ? `  ${detail}` : ''}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs + 2,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    textTransform: 'uppercase',
  },
})
