import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'

export type BadgeStatus = 'accepted' | 'failed' | 'live'

type Props = {
  status: BadgeStatus
  /** Lowercase label text, e.g. "your turn", "failed", "live · 12m". */
  label: string
  testID?: string
}

/** Lowercase mono status pill. Exactly three colors: sage (accepted), red (failed), orange
 * (live) — no other signal exists in Instrument Ink. */
export function Badge({ status, label, testID }: Props) {
  const { colors } = useTheme()
  const { fg, bg } =
    status === 'accepted'
      ? { fg: colors.okText, bg: colors.okSoft }
      : status === 'failed'
        ? { fg: colors.failText, bg: colors.failSoft }
        : { fg: colors.liveText, bg: colors.liveSoft }

  return (
    <View testID={testID} style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[type.monoSmall, styles.text, { color: fg }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  text: {
    textTransform: 'lowercase',
  },
})
