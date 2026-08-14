import type { ApiWorkspaceListItem } from '@tada/shared'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../design/ThemeContext'
import { space, type } from '../design/tokens'
import { Card } from './ui/Card'
import { FlipStrip } from './ui/FlipStrip'
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
      <View style={styles.titleRow}>
        <Text numberOfLines={1} style={[type.title, styles.name, { color: colors.ink }]}>
          {workspace.name}
        </Text>
        <Icon name="chevron-right" size={16} color={colors.inkFaint} />
      </View>
      {idle ? (
        <Text style={[type.monoSmall, { color: colors.inkFaint }]}>ALL QUIET</Text>
      ) : (
        <View style={styles.badges}>
          {workspace.runningCount > 0 && (
            <View testID={`workspace-running-${workspace.id}`}>
              <FlipStrip items={[{ label: 'Running', count: workspace.runningCount, signal: 'green' }]} />
            </View>
          )}
          {workspace.needsReviewCount > 0 && (
            <View testID={`workspace-review-${workspace.id}`}>
              <FlipStrip items={[{ label: 'Review', count: workspace.needsReviewCount, signal: 'violet' }]} />
            </View>
          )}
        </View>
      )}
    </Card>
  )
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space.lg,
    marginVertical: space.xs + 2,
    gap: space.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  name: {
    flex: 1,
  },
  badges: {
    flexDirection: 'row',
    gap: space.sm,
  },
})
