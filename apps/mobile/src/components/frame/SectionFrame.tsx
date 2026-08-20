import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useBoard, useSources } from '../../api/queries'
import { countStoppedOnYou } from '../../control'
import { useTheme } from '../../design/ThemeContext'
import { space } from '../../design/tokens'
import { useBottomClearance } from '../../design/webSafeArea'
import type { SectionKey } from '../../nav'
import { BottomStrip, Rail } from '../ui'

type Props = {
  active: SectionKey
  testID?: string
}

/**
 * The web Rail, fed from the query cache: Control's stopped-on-you badge from the board (the
 * same query Control itself keeps warm, so this costs no extra requests). Drawn once by the tabs
 * frame (see app/(tabs)/_layout.tsx) rather than per screen, so it stays put while the section
 * content changes underneath.
 */
export function SectionRail({ active, testID }: Props) {
  const { data: board } = useBoard()
  const { data: sources } = useSources()
  return (
    <Rail
      active={active}
      stoppedCount={countStoppedOnYou(board)}
      repoCount={sources?.filter((s) => s.type === 'repo').length}
      testID={testID}
    />
  )
}

/** The mobile BottomStrip in its padded, safe-area-aware well. */
export function SectionStrip({ active, testID }: Props) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const { data: board } = useBoard()
  // space.md holds the strip off the bottom edge of the screen. On an installed iOS PWA the view
  // stops short of that edge anyway (see webSafeArea.tsx), so paying it again just floats the
  // strip higher than it should sit — which is what it looked like. Spend the free clearance.
  const clearance = useBottomClearance()
  return (
    <View
      style={[
        styles.stripWell,
        { backgroundColor: colors.ground, paddingBottom: Math.max(0, space.md - clearance) + insets.bottom },
      ]}
    >
      <BottomStrip active={active} stoppedCount={countStoppedOnYou(board)} testID={testID} />
    </View>
  )
}

const styles = StyleSheet.create({
  stripWell: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
  },
})
