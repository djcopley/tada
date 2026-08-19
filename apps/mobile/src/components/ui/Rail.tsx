import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { goToSection, type SectionKey } from '../../nav'
import { SettingsGear } from './SettingsGear'
import { ThemeToggle } from './ThemeToggle'

export type RailNavKey = SectionKey

type NavItem = {
  key: RailNavKey
  label: string
  count?: number
}

type Props = {
  active: RailNavKey
  /** Runs stopped on you — the count badge on the Control nav item. */
  stoppedCount?: number
  /** Connected repos, shown in the footer line. */
  repoCount?: number
  testID?: string
}

/** 188px web sidebar: wordmark, nav (Control's stopped-on-you count in live-text), a spacer, the
 * repos line, and a footer shelf of night/day toggle + settings gear. Matches the mobile
 * BottomStrip: three word-destinations, settings as a gear in the utility corner. */
export function Rail({ active, stoppedCount, repoCount, testID }: Props) {
  const router = useRouter()
  const { colors } = useTheme()

  const items: NavItem[] = [
    { key: 'control', label: 'Control', count: stoppedCount },
    { key: 'board', label: 'Board' },
    { key: 'memory', label: 'Memory' },
  ]

  return (
    <View testID={testID} style={[styles.root, { borderRightColor: colors.borderSubtle }]}>
      <Text style={[type.title, styles.wordmark, { color: colors.text }]}>
        {'tada'}
        <Text style={{ color: colors.live }}>✱</Text>
      </Text>

      {items.map((item) => {
        const isActive = item.key === active
        return (
          <Pressable
            key={item.key}
            testID={`rail-nav-${item.key}`}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: isActive }}
            onPress={() => goToSection(router, { key: item.key, active })}
            style={({ pressed }) => [
              styles.navRow,
              isActive && { backgroundColor: colors.controlBg },
              pressed && !isActive && { backgroundColor: colors.raised2 },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                type.body,
                styles.navLabel,
                isActive && type.bodyStrong,
                { color: isActive ? colors.text : colors.textMuted },
              ]}
            >
              {item.label}
            </Text>
            {item.count ? (
              <Text style={[type.monoSmall, { color: colors.liveText }]}>{item.count}</Text>
            ) : null}
          </Pressable>
        )
      })}

      <View style={styles.spacer} />

      <View style={styles.footer}>
        {repoCount !== undefined ? (
          <Text numberOfLines={1} style={[type.monoSmall, { color: colors.textFaintSolid }]}>
            {`${repoCount} ${repoCount === 1 ? 'repo' : 'repos'} connected`}
          </Text>
        ) : null}
        {/* The utility shelf: night/day on the left, settings at the far end — the sidebar's
            counterpart to the gear at the trailing end of the mobile BottomStrip. */}
        <View style={styles.footerRow}>
          <ThemeToggle testID="rail-theme-toggle" />
          <View style={styles.spacer} />
          <SettingsGear active={active} size="rail" testID="rail-nav-settings" />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    width: 188,
    flexShrink: 0,
    paddingHorizontal: space.md,
    paddingTop: space.lg,
    paddingBottom: space.md,
    borderRightWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  wordmark: {
    paddingHorizontal: space.sm,
    paddingBottom: space.md,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm - 1,
    paddingHorizontal: space.sm,
    borderRadius: radius.control,
  },
  navLabel: {
    flex: 1,
  },
  spacer: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: space.sm,
    gap: space.md,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
})
