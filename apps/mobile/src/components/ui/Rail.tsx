import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { goToSection } from '../../nav'

export type RailNavKey = 'control' | 'board' | 'memory' | 'settings'

type NavItem = {
  key: RailNavKey
  label: string
  href: string
  count?: number
}

type Props = {
  active: RailNavKey
  /** Scopes Board/Memory/Settings; Control is always cross-workspace. */
  workspaceId?: number
  workspaceName?: string
  sourceCount?: number
  /** Live count badge on the Control nav item. */
  needsYouCount?: number
  testID?: string
}

/** 188px web sidebar: wordmark, nav (Control's needs-you count in live-text), a spacer, the
 * scoped-workspace line, and the day-mode switch. Matches the mobile BottomStrip's routes. */
export function Rail({
  active,
  workspaceId,
  workspaceName,
  sourceCount,
  needsYouCount,
  testID,
}: Props) {
  const router = useRouter()
  const { colors, scheme, setScheme } = useTheme()

  const scopedHref = (suffix: string) =>
    workspaceId !== undefined ? `/workspaces/${workspaceId}/${suffix}` : '/workspaces'

  const items: NavItem[] = [
    { key: 'control', label: 'Control', href: '/workspaces', count: needsYouCount },
    { key: 'board', label: 'Board', href: scopedHref('board') },
    { key: 'memory', label: 'Memory', href: scopedHref('memory') },
    { key: 'settings', label: 'Settings', href: scopedHref('settings') },
  ]

  return (
    <View testID={testID} style={[styles.root, { borderRightColor: colors.borderSubtle }]}>
      <Text style={[type.title, styles.wordmark, { color: colors.text }]}>
        {'tada'}
        <Text style={{ color: colors.live }}>✱</Text>
      </Text>

      {items.map((item) => {
        const isActive = item.key === active
        // Board/Memory/Settings need a workspace to scope to; without one they're inert rather
        // than silently routing back to Control (which used to push a duplicate Control per tap).
        const enabled = item.key === 'control' || workspaceId !== undefined
        return (
          <Pressable
            key={item.key}
            testID={`rail-nav-${item.key}`}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: isActive, disabled: !enabled }}
            disabled={!enabled}
            onPress={() => goToSection(router, { key: item.key, active, href: item.href })}
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
                { color: isActive ? colors.text : enabled ? colors.textMuted : colors.textFaintSolid },
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
        {workspaceName ? (
          <Text numberOfLines={1} style={[type.monoSmall, { color: colors.textFaintSolid }]}>
            {sourceCount !== undefined
              ? `${workspaceName} · ${sourceCount} ${sourceCount === 1 ? 'repo' : 'repos'}`
              : workspaceName}
          </Text>
        ) : null}
        <View style={styles.switchRow}>
          <Text style={[type.body, { color: colors.text }]}>Day mode</Text>
          <Switch
            testID="rail-theme-switch"
            accessibilityLabel="Day mode"
            value={scheme === 'day'}
            onValueChange={(on) => setScheme(on ? 'day' : 'night')}
            trackColor={{ true: colors.live, false: colors.raised2 }}
            thumbColor={colors.raised}
          />
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
})
