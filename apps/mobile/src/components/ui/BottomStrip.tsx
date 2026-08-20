import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { goToSection, type SectionKey } from '../../nav'
import { SettingsGear } from './SettingsGear'

export type BottomStripKey = SectionKey

type Props = {
  active: BottomStripKey
  /** Runs stopped on you — shown beside Control. */
  stoppedCount?: number
  testID?: string
}

/** The word-destinations. Settings is the gear at the trailing end, not a fourth tab. */
const TABS: { key: SectionKey; label: string }[] = [
  { key: 'control', label: 'Control' },
  { key: 'board', label: 'Board' },
  { key: 'memory', label: 'Memory' },
]

/** Mobile's segmented Control/Board/Memory row — the recessed-well counterpart to the web Rail,
 * with the settings gear in the same utility corner the Rail's footer gives it. */
export function BottomStrip({ active, stoppedCount, testID }: Props) {
  const router = useRouter()
  const { colors } = useTheme()

  return (
    <View testID={testID} style={[styles.row, { backgroundColor: colors.recessed, borderColor: colors.borderSubtle }]}>
      {TABS.map(({ key, label }) => {
        const isActive = key === active
        return (
          <Pressable
            key={key}
            testID={`bottom-strip-${key}`}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: isActive }}
            onPress={() => goToSection(router, { key, active })}
            style={({ pressed }) => [
              styles.tab,
              isActive && { backgroundColor: colors.controlBg, borderColor: colors.controlBorder },
              pressed && !isActive && { backgroundColor: colors.raised2 },
            ]}
          >
            {/* Tab metrics, not Button's: a regular Button spends 40pt per tab on horizontal
                padding alone, which is what left every label ellipsised on a phone. */}
            <Text numberOfLines={1} style={[type.caption, { color: isActive ? colors.text : colors.textMuted }]}>
              {label}
            </Text>
            {key === 'control' && stoppedCount ? (
              // Its own numeral rather than a ` · 2` suffix: the label's width must not depend on
              // whether something is stopped on you, or the strip reflows mid-run.
              <Text testID="bottom-strip-stopped-count" style={[type.monoSmall, { color: colors.liveText }]}>
                {stoppedCount}
              </Text>
            ) : null}
          </Pressable>
        )
      })}
      <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
      <SettingsGear active={active} testID="bottom-strip-settings" />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: 5,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: 44,
    paddingHorizontal: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    borderRadius: radius.control,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    marginVertical: space.sm,
    marginHorizontal: space.xs,
  },
})
