import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSettings } from '../../src/api/queries'
import { useAppSocket } from '../../src/api/useAppSocket'
import { AgentCard } from '../../src/components/settings/AgentCard'
import { LimitsCard } from '../../src/components/settings/LimitsCard'
import { PingsCard } from '../../src/components/settings/PingsCard'
import { RulesCard } from '../../src/components/settings/RulesCard'
import { ServerCard } from '../../src/components/settings/ServerCard'
import { SourcesCard } from '../../src/components/settings/SourcesCard'
import { AppHeader, EmptyState, Screen, Skeleton } from '../../src/components/ui'
import { useTheme } from '../../src/design/ThemeContext'
import { radius, space, type } from '../../src/design/tokens'
import { useLayout } from '../../src/layout'

/**
 * Settings — one page, no scopes, no tabs: server, sources, agent, the permission rule table
 * (what gates check before every tool call), run limits, pings. Nothing here switches auto-done:
 * finished runs always file themselves.
 */
export default function SettingsScreen() {
  const { colors } = useTheme()
  const { wide } = useLayout()
  const { data: settings, isLoading, isError } = useSettings()
  // The rule table changes underneath us when "always allow" is chosen at a gate.
  useAppSocket()

  const body = isError ? (
    <EmptyState icon="alert-circle" message="Could not load settings." />
  ) : isLoading || !settings ? (
    <View style={styles.skeletons}>
      <Skeleton height={120} style={{ borderRadius: radius.control }} />
      <Skeleton height={180} style={{ borderRadius: radius.control }} />
      <Skeleton height={300} style={{ borderRadius: radius.control }} />
    </View>
  ) : (
    <>
      <ServerCard />
      <SourcesCard />
      <AgentCard settings={settings} />
      <RulesCard />
      <LimitsCard settings={settings} />
      <PingsCard settings={settings} />
    </>
  )

  if (wide) {
    return (
      <View style={[styles.wideRoot, { backgroundColor: colors.ground }]} testID="settings-wide">
        <ScrollView contentContainerStyle={styles.wideContent}>
          <View style={styles.headerRow}>
            <Text style={[type.display, { color: colors.text }]}>Settings</Text>
          </View>
          {body}
        </ScrollView>
      </View>
    )
  }

  return (
    <Screen testID="settings-narrow">
      <AppHeader title="Settings" wordmark />
      <ScrollView contentContainerStyle={styles.content}>{body}</ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  skeletons: { width: '100%', maxWidth: 680, gap: space.lg },
  wideRoot: { flex: 1 },
  wideContent: { flexGrow: 1, alignItems: 'center', padding: space.xxl, gap: space.xl },
  headerRow: { width: '100%', maxWidth: 680, flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  content: { padding: space.lg, gap: space.xl },
})
