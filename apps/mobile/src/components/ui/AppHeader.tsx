import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { space, type } from '../../design/tokens'
import { Icon, type IconName } from './Icon'

type Action = {
  icon: IconName
  label: string
  onPress: () => void
  testID?: string
}

type Props = {
  title: string
  /** Show a back chevron (router.back). Off for root screens. */
  back?: boolean
  actions?: Action[]
  /** Extra content under the title row (e.g. the board FlipStrip). */
  children?: ReactNode
}

/**
 * The one app header: display-face title, optional back chevron, icon
 * actions. Replaces both the native stack headers and the hand-rolled
 * per-screen header rows.
 */
export function AppHeader({ title, back = false, actions = [], children }: Props) {
  const router = useRouter()
  const { colors } = useTheme()

  return (
    <View style={[styles.root, { borderBottomColor: colors.line }]}>
      <View style={styles.row}>
        {back ? (
          <Pressable
            testID="header-back"
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            hitSlop={8}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Icon name="chevron-left" size={24} />
          </Pressable>
        ) : null}
        <Text numberOfLines={1} style={[type.display, styles.title, { color: colors.ink }]}>
          {title}
        </Text>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            testID={action.testID}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            hitSlop={8}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Icon name={action.icon} size={20} color={colors.inkMuted} />
          </Pressable>
        ))}
      </View>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
  },
  title: {
    flex: 1,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
})
