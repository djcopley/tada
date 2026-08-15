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
import { space, type } from '../../design/tokens'

export type RunStatusChipSignal = 'live' | 'ok' | 'neutral'

type Props = {
  status: RunStatusChipSignal
  label: string
  /** Trailing mono detail, e.g. an elapsed time ("12m"). */
  meta?: string
  testID?: string
}

/** Dot + label for inline run-status rows (live-now cards, board glyphs). The dot pulses
 * (`ii-pulse`) while `status === 'live'`. */
export function RunStatusChip({ status, label, meta, testID }: Props) {
  const { colors } = useTheme()
  const color = status === 'live' ? colors.liveText : status === 'ok' ? colors.okText : colors.textMuted
  const reducedMotion = useReducedMotion()
  const pulse = useSharedValue(1)

  const live = status === 'live' && !reducedMotion
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
      accessibilityLabel={meta ? `${label}, ${meta}` : label}
      style={styles.row}
    >
      <Animated.View style={[styles.dot, { backgroundColor: color }, dotStyle]} />
      <Text style={[type.monoSmall, styles.text, { color }]}>
        {label}
        {meta ? ` · ${meta}` : ''}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs + 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    textTransform: 'lowercase',
  },
})
