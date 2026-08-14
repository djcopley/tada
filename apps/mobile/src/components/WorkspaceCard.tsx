import type { ApiWorkspaceListItem } from '@tada/shared'
import { Pressable, StyleSheet, Text, View } from 'react-native'

export function WorkspaceCard({
  workspace,
  onPress,
}: {
  workspace: ApiWorkspaceListItem
  onPress: () => void
}) {
  return (
    <Pressable
      testID={`workspace-card-${workspace.id}`}
      style={styles.card}
      onPress={onPress}
    >
      <Text style={styles.name}>{workspace.name}</Text>
      <View style={styles.badges}>
        {workspace.runningCount > 0 && (
          <Text testID={`workspace-running-${workspace.id}`} style={[styles.badge, styles.runningBadge]}>
            {workspace.runningCount} running
          </Text>
        )}
        {workspace.needsReviewCount > 0 && (
          <Text testID={`workspace-review-${workspace.id}`} style={[styles.badge, styles.reviewBadge]}>
            {workspace.needsReviewCount} to review
          </Text>
        )}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
    borderRadius: 8,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
    gap: 8,
  },
  name: {
    fontSize: 17,
    fontWeight: '600',
  },
  badges: {
    flexDirection: 'row',
    gap: 8,
  },
  badge: {
    fontSize: 13,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  runningBadge: {
    backgroundColor: '#e0f0ff',
    color: '#1565c0',
  },
  reviewBadge: {
    backgroundColor: '#fff4e0',
    color: '#b35c00',
  },
})
