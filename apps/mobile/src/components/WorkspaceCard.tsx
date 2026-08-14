import type { ApiWorkspaceListItem } from '@tada/shared'
import { StyleSheet, Text } from 'react-native'
import { useTheme } from '../design/ThemeContext'
import { space, type } from '../design/tokens'
import { Card } from './ui/Card'
import { Icon } from './ui/Icon'

export function WorkspaceCard({
  workspace,
  onPress,
}: {
  workspace: ApiWorkspaceListItem
  onPress: () => void
}) {
  const { colors } = useTheme()
  const idle = workspace.runningCount === 0 && workspace.needsReviewCount === 0

  return (
    <Card testID={`workspace-card-${workspace.id}`} onPress={onPress} style={styles.card}>
      <Text numberOfLines={1} style={[type.bodyStrong, styles.name, { color: colors.text }]}>
        {workspace.name}
      </Text>
      {idle ? (
        <Text style={[type.monoSmall, styles.counts, { color: colors.textFaintSolid }]}>all quiet</Text>
      ) : (
        <Text numberOfLines={1} style={[type.monoSmall, styles.counts, { color: colors.textFaintSolid }]}>
          {workspace.runningCount > 0 ? (
            <Text testID={`workspace-running-${workspace.id}`} style={{ color: colors.liveText }}>
              {`${workspace.runningCount} live`}
            </Text>
          ) : null}
          {workspace.runningCount > 0 && workspace.needsReviewCount > 0 ? ' · ' : ''}
          {workspace.needsReviewCount > 0 ? (
            <Text testID={`workspace-review-${workspace.id}`} style={{ color: colors.okText }}>
              {`${workspace.needsReviewCount} yours`}
            </Text>
          ) : null}
        </Text>
      )}
      <Icon name="chevron-right" size={16} color={colors.textFaintSolid} />
    </Card>
  )
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space.lg,
    marginVertical: space.xs + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  name: {
    flexShrink: 1,
  },
  counts: {
    flex: 1,
  },
})
