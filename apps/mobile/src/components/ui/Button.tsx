import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { Icon, type IconName } from './Icon'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'

type Props = {
  label: string
  onPress: () => void
  variant?: Variant
  icon?: IconName
  disabled?: boolean
  loading?: boolean
  /** Compact height for inline placement (rows, headers). */
  small?: boolean
  testID?: string
  style?: ViewStyle
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  loading = false,
  small = false,
  testID,
  style,
}: Props) {
  const { colors } = useTheme()

  const palette = {
    primary: { bg: colors.ink, fg: colors.onInk, border: 'transparent' },
    secondary: { bg: colors.surface, fg: colors.ink, border: colors.line },
    ghost: { bg: 'transparent', fg: colors.ink, border: 'transparent' },
    destructive: { bg: colors.signalRedBg, fg: colors.signalRed, border: 'transparent' },
  }[variant]

  const blocked = disabled || loading

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked }}
      onPress={onPress}
      disabled={blocked}
      hitSlop={small ? 6 : 0}
      style={({ pressed }) => [
        styles.base,
        small ? styles.small : styles.regular,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : (
        <View style={styles.content}>
          {icon ? <Icon name={icon} size={small ? 14 : 16} color={palette.fg} /> : null}
          <Text style={[small ? type.caption : type.bodyStrong, { color: palette.fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regular: {
    minHeight: 48,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  small: {
    minHeight: 32,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
})
