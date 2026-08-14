import type { ApiRun } from '@tada/shared'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../design/ThemeContext'
import { humanize, runStatusVisual } from '../design/status'
import { radius, space, type } from '../design/tokens'
import { relativeTime } from '../relativeTime'
import { Icon } from './ui/Icon'
import { StatusTag } from './ui/StatusTag'

export function RunRow({ run, onPress }: { run: ApiRun; onPress: () => void }) {
  const { colors } = useTheme()
  return (
    <Pressable
      testID={`run-row-${run.id}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      <View style={styles.info}>
        <Text style={[type.mono, { color: colors.ink }]}>
          {`${humanize(run.adapter)} · ${humanize(run.model)}`}
        </Text>
        <View style={styles.metaRow}>
          <StatusTag status={runStatusVisual(run.status)} />
          <Text style={[type.caption, { color: colors.inkMuted }]}>{relativeTime(run.createdAt)}</Text>
        </View>
      </View>
      {run.prUrl && (
        <Pressable
          testID={`run-pr-${run.id}`}
          accessibilityRole="link"
          accessibilityLabel="View pull request"
          style={({ pressed }) => [
            styles.prButton,
            { backgroundColor: colors.surfaceAlt },
            pressed && { opacity: 0.7 },
          ]}
          onPress={(event) => {
            event.stopPropagation()
            void Linking.openURL(run.prUrl as string)
          }}
        >
          <Icon name="git-pull-request" size={14} color={colors.ink} />
          <Text style={[type.caption, { color: colors.ink }]}>PR</Text>
        </Pressable>
      )}
      <Icon name="chevron-right" size={16} color={colors.inkFaint} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.xs,
    borderRadius: radius.sm,
  },
  info: {
    flex: 1,
    gap: space.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  prButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
  },
})
