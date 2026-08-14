import type { ColumnKind } from '@tada/shared'
import { StyleSheet, Text, View } from 'react-native'

// Placeholder data sourced from @tada/shared to prove workspace package
// resolution works through Metro's pnpm monorepo config. Real board columns
// will replace this once the workspace/board screens land.
const placeholderColumns: ColumnKind[] = ['backlog', 'ready', 'in_progress', 'in_review', 'done']

export default function Index() {
  return (
    <View style={styles.container}>
      <Text>tada</Text>
      <Text style={styles.hidden} testID="placeholder-columns">
        {placeholderColumns.join(',')}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hidden: {
    display: 'none',
  },
})
