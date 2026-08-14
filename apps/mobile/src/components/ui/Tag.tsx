import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'

/** Neutral mono chip for repo names, attempt counts and other data labels. */
export function Tag({ label, testID }: { label: string; testID?: string }) {
  const { colors } = useTheme()
  return (
    <View
      testID={testID}
      style={[styles.tag, { backgroundColor: colors.raised2, borderColor: colors.borderSubtle }]}
    >
      <Text numberOfLines={1} style={[type.monoSmall, { color: colors.textMuted }]}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  tag: {
    alignSelf: 'flex-start',
    borderRadius: radius.tag,
    borderWidth: 1,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
})
