import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { space, type } from '../../design/tokens'
import { Icon, type IconName } from './Icon'

type Props = {
  title: string
  subtitle?: string
  icon?: IconName
  /** Trailing content: a value, tag, or control. Defaults to a chevron when pressable. */
  trailing?: ReactNode
  onPress?: () => void
  destructive?: boolean
  testID?: string
}

/** Standard tappable row for lists and sheets. */
export function ListRow({ title, subtitle, icon, trailing, onPress, destructive = false, testID }: Props) {
  const { colors } = useTheme()
  const titleColor = destructive ? colors.failText : colors.text

  const body = (
    <>
      {icon ? <Icon name={icon} size={18} color={destructive ? colors.failText : colors.textMuted} /> : null}
      <View style={styles.textBlock}>
        <Text numberOfLines={1} style={[type.body, { color: titleColor }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[type.caption, { color: colors.textMuted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ?? (onPress ? <Icon name="chevron-right" size={16} color={colors.textFaintSolid} /> : null)}
    </>
  )

  if (!onPress) {
    return (
      <View testID={testID} style={styles.row}>
        {body}
      </View>
    )
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised2 }]}
    >
      {body}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 52,
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
    borderRadius: 8,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
})
