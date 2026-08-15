import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { Icon } from './Icon'

type Props = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  testID?: string
}

/** Small square check for "attach repos"-style optional multi-select lists. */
export function Checkbox({ label, checked, onChange, testID }: Props) {
  const { colors } = useTheme()

  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}
      hitSlop={4}
    >
      <View
        style={[
          styles.box,
          {
            backgroundColor: checked ? colors.primaryBg : 'transparent',
            borderColor: checked ? colors.primaryBg : colors.controlBorder,
          },
        ]}
      >
        {checked ? <Icon name="check" size={12} color={colors.primaryText} /> : null}
      </View>
      <Text style={[type.body, { color: colors.text }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  box: {
    width: 18,
    height: 18,
    borderRadius: radius.tag,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
