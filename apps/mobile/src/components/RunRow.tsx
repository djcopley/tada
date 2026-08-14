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
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised2 }]}
    >
      <View style={styles.info}>
        <Text style={[type.mono, { color: colors.text }]}>
          {`${humanize(run.adapter)} · ${humanize(run.model)}`}
        </Text>
        <View style={styles.metaRow}>
          <StatusTag bare status={runStatusVisual(run.status)} />
          <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{relativeTime(run.createdAt)}</Text>
        </View>
      </View>
      {run.prUrl && (
        <Pressable
          testID={`run-pr-${run.id}`}
          accessibilityRole="link"
          accessibilityLabel="View pull request"
          style={({ pressed }) => [
            styles.prButton,
            { backgroundColor: colors.raised2 },
            pressed && { opacity: 0.7 },
          ]}
          onPress={(event) => {
            event.stopPropagation()
            void Linking.openURL(run.prUrl as string)
          }}
        >
          <Icon name="git-pull-request" size={14} color={colors.text} />
          <Text style={[type.caption, { color: colors.text }]}>PR</Text>
        </Pressable>
      )}
      <Icon name="chevron-right" size={16} color={colors.textFaintSolid} />
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
    borderRadius: radius.tag,
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
    borderRadius: radius.tag,
  },
})
