import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { space, type } from '../../design/tokens'
import { goBackOr } from '../../nav'
import { Icon, type IconName } from './Icon'

type Action = {
  icon: IconName
  label: string
  onPress: () => void
  testID?: string
}

type Props = {
  title: string
  /** Render the tada✱ wordmark before the title (root screens). */
  wordmark?: boolean
  /** Show a back chevron. Off for root screens. */
  back?: boolean
  /** Where the chevron goes when there's no history to unwind (cold deep link / refresh).
   * Defaults to Control. */
  backHref?: string
  actions?: Action[]
  /** Extra content under the title row (e.g. the board status strip). */
  children?: ReactNode
}

/**
 * The one app header: sans-semibold title with tight tracking, optional
 * back chevron, icon actions. Root screens lead with the tada✱ wordmark —
 * the orange star is the only brand mark in the app.
 */
export function AppHeader({
  title,
  wordmark = false,
  back = false,
  backHref = '/',
  actions = [],
  children,
}: Props) {
  const router = useRouter()
  const { colors } = useTheme()

  return (
    <View style={[styles.root, { borderBottomColor: colors.borderSubtle }]}>
      <View style={styles.row}>
        {back ? (
          <Pressable
            testID="header-back"
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => goBackOr(router, backHref)}
            hitSlop={8}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Icon name="chevron-left" size={24} />
          </Pressable>
        ) : null}
        <Text numberOfLines={1} style={[type.display, styles.title, { color: colors.text }]}>
          {wordmark ? (
            <>
              {'tada'}
              <Text style={{ color: colors.live }}>✱</Text>
              {title ? `  ${title}` : ''}
            </>
          ) : (
            title
          )}
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
            <Icon name={action.icon} size={20} color={colors.textMuted} />
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
