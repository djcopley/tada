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
  /** Label lines before it ellipsises. >1 for agent-authored labels (question options). */
  lines?: number
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
  lines = 1,
  testID,
  style,
}: Props) {
  const { colors } = useTheme()

  const palette = {
    primary: { bg: colors.primaryBg, fg: colors.primaryText, border: 'transparent' },
    secondary: { bg: colors.controlBg, fg: colors.text, border: colors.controlBorder },
    ghost: { bg: 'transparent', fg: colors.textMuted, border: 'transparent' },
    destructive: { bg: colors.failSoft, fg: colors.failText, border: 'transparent' },
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
          <Text numberOfLines={lines} style={[small ? type.caption : type.bodyStrong, styles.label, { color: palette.fg }]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.control,
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
  // Bounded by the button: without the shrink/maxWidth pair a label longer than the button
  // (an agent-authored question option) lays itself out past the border instead of ellipsising,
  // and neighbouring buttons' labels overlap.
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    flexShrink: 1,
    maxWidth: '100%',
  },
  // A caller that gives the button `flexShrink` gets an ellipsised label instead of overflow
  // (workspace names in narrow headers).
  label: {
    flexShrink: 1,
    textAlign: 'center',
  },
})
