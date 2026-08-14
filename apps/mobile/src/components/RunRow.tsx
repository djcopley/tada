import type { ApiRun } from '@tada/shared'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { relativeTime } from '../relativeTime'

export function RunRow({ run, onPress }: { run: ApiRun; onPress: () => void }) {
  return (
    <Pressable testID={`run-row-${run.id}`} style={styles.row} onPress={onPress}>
      <View style={styles.info}>
        <Text style={styles.title}>{`${run.adapter} · ${run.model}`}</Text>
        <Text style={styles.meta}>{`${run.status} · ${relativeTime(run.createdAt)}`}</Text>
      </View>
      {run.prUrl && (
        <Pressable
          testID={`run-pr-${run.id}`}
          style={styles.prButton}
          onPress={(event) => {
            event.stopPropagation()
            void Linking.openURL(run.prUrl as string)
          }}
        >
          <Text style={styles.prText}>View PR</Text>
        </Pressable>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  info: {
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  meta: {
    fontSize: 12,
    color: '#666',
  },
  prButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#e0f0ff',
  },
  prText: {
    color: '#1565c0',
    fontSize: 12,
    fontWeight: '600',
  },
})
