import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { Button } from '../ui/Button'

/** The board before the first ticket: words, not a diagram. Columns appear as tickets do — an
 * empty five-lane grid is furniture, not information. */
export function FirstRunBoard({ onWrite }: { onWrite: () => void }) {
  const { colors } = useTheme()
  return (
    <View testID="board-first-run" style={styles.root}>
      <View style={[styles.panel, { borderColor: colors.borderStrong }]}>
        <Text style={[type.title, { color: colors.text }]}>No tickets yet</Text>
        <Text style={[type.body, { color: colors.textMuted }]}>
          {"Write one like you'd brief a colleague: what to change, where, and how you'll know it's right. The agent reads memory first, works out of your folder, and stops to ask before anything reaches github."}
        </Text>
        <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>
          {'try: "add a smoke test for the billing webhook — fail loudly if the signature check is skipped"'}
        </Text>
        <Button testID="board-write-first" variant="secondary" small label="Write the first ticket" onPress={onWrite} />
      </View>
      <Text style={[type.caption, { color: colors.textFaintSolid }]}>
        Columns appear as tickets do — an empty five-column grid is furniture, not information.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: space.md, maxWidth: 620 },
  panel: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
    gap: space.sm + 2,
    alignItems: 'flex-start',
  },
})
