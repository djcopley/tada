import type { ApiRun, Hold } from '@tada/shared'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { gateCopy, gateFacts, gateMeta, gateTitle } from '../../runActivity'
import { HoldActions } from '../gate/HoldActions'

/**
 * The gate as user chrome: sans on a raised surface under the held line, never mono. Title says
 * what the agent wants (or asks), a small fact grid, the hold actions, and the copy explaining
 * what approve / always allow do. Nothing has reached github yet — the branch and diff are local.
 */
export function GateCard({ run, hold, ticketId }: { run: ApiRun; hold: Hold; ticketId: number }) {
  const { colors, shadow } = useTheme()
  return (
    <View
      testID="gate-card"
      style={[styles.card, shadow.card, { backgroundColor: colors.raised, borderColor: colors.borderStrong }]}
    >
      <View style={styles.titleRow}>
        <Text testID="gate-title" style={[type.title, { color: colors.text }]}>
          {gateTitle(hold)}
        </Text>
        <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{gateMeta(hold)}</Text>
      </View>
      {gateFacts(hold).length > 0 ? (
        <View style={styles.grid}>
          {gateFacts(hold).map(([k, v]) => (
            <View key={k} style={styles.gridRow}>
              <Text style={[type.caption, styles.gridKey, { color: colors.textFaintSolid }]}>{k}</Text>
              <Text style={[type.monoSmall, styles.gridValue, { color: colors.text }]}>{v}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <HoldActions run={run} ticketId={ticketId} testID="gate-actions" />
      <Text style={[type.caption, { color: colors.textFaintSolid }]}>{gateCopy(hold)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  grid: { gap: 6 },
  gridRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  gridKey: { width: 56 },
  gridValue: { flex: 1 },
})
