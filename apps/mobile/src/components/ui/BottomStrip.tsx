import { useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space } from '../../design/tokens'
import { goToSection, type SectionKey } from '../../nav'
import { Button } from './Button'

export type BottomStripKey = SectionKey

type Props = {
  active: BottomStripKey
  /** Runs stopped on you — shown beside Control. */
  stoppedCount?: number
  testID?: string
}

const LABELS: Record<BottomStripKey, string> = {
  control: 'Control',
  board: 'Board',
  memory: 'Memory',
  settings: 'Settings',
}

/** Mobile's segmented Control/Board/Memory/Settings row — the recessed-well counterpart to the
 * web Rail. */
export function BottomStrip({ active, stoppedCount, testID }: Props) {
  const router = useRouter()
  const { colors } = useTheme()

  return (
    <View testID={testID} style={[styles.row, { backgroundColor: colors.recessed, borderColor: colors.borderSubtle }]}>
      {(['control', 'board', 'memory', 'settings'] as const).map((key) => (
        <Button
          key={key}
          testID={`bottom-strip-${key}`}
          label={key === 'control' && stoppedCount ? `${LABELS[key]} · ${stoppedCount}` : LABELS[key]}
          variant={key === active ? 'secondary' : 'ghost'}
          onPress={() => goToSection(router, { key, active })}
          style={styles.button}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: 5,
  },
  button: {
    flex: 1,
  },
})
