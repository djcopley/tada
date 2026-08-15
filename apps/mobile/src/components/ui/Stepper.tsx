import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { Icon } from './Icon'

type Props = {
  value: number
  onDecrement: () => void
  onIncrement: () => void
  min?: number
  max?: number
  testID?: string
}

/** "− count +" row for small bounded numbers (concurrency, quantities). */
export function Stepper({ value, onDecrement, onIncrement, min, max, testID }: Props) {
  const { colors } = useTheme()
  const atMin = min !== undefined && value <= min
  const atMax = max !== undefined && value >= max

  return (
    <View testID={testID} style={styles.row}>
      <Pressable
        testID={testID ? `${testID}-decrement` : undefined}
        accessibilityRole="button"
        accessibilityLabel="Decrease"
        accessibilityState={{ disabled: atMin }}
        disabled={atMin}
        onPress={onDecrement}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.raised2 },
          (atMin || pressed) && { opacity: atMin ? 0.4 : 0.6 },
        ]}
      >
        <Icon name="minus" size={16} color={colors.text} />
      </Pressable>
      <Text style={[type.mono, styles.value, { color: colors.text }]}>{value}</Text>
      <Pressable
        testID={testID ? `${testID}-increment` : undefined}
        accessibilityRole="button"
        accessibilityLabel="Increase"
        accessibilityState={{ disabled: atMax }}
        disabled={atMax}
        onPress={onIncrement}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.raised2 },
          (atMax || pressed) && { opacity: atMax ? 0.4 : 0.6 },
        ]}
      >
        <Icon name="plus" size={16} color={colors.text} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: radius.tag + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    minWidth: 24,
    textAlign: 'center',
  },
})
