import { Pressable, StyleSheet } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius } from '../../design/tokens'
import { Icon, type IconName } from './Icon'

type Props = {
  icon: IconName
  label: string
  onPress: () => void
  /** Compact 28px control (inline in rows) vs the default 36px standalone size. */
  size?: 'sm' | 'md'
  testID?: string
}

/** Icon-only ghost control — the `−`/`+` stepper and header gear affordances. */
export function IconButton({ icon, label, onPress, size = 'md', testID }: Props) {
  const { colors } = useTheme()
  const dimension = size === 'sm' ? 28 : 36

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        { width: dimension, height: dimension },
        pressed && { backgroundColor: colors.raised2 },
      ]}
    >
      <Icon name={icon} size={size === 'sm' ? 15 : 18} color={colors.textMuted} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
