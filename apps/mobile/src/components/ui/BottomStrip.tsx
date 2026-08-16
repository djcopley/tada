import { useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space } from '../../design/tokens'
import { goToSection } from '../../nav'
import { Button } from './Button'

export type BottomStripKey = 'control' | 'board' | 'memory'

type Props = {
  active: BottomStripKey
  /** Scopes Board/Memory; Control is always cross-workspace. */
  workspaceId?: number
  testID?: string
}

const LABELS: Record<BottomStripKey, string> = { control: 'Control', board: 'Board', memory: 'Memory' }

/** Mobile's segmented Control/Board/Memory row — the recessed-well counterpart to the web Rail. */
export function BottomStrip({ active, workspaceId, testID }: Props) {
  const router = useRouter()
  const { colors } = useTheme()

  const hrefFor = (key: BottomStripKey): string =>
    key === 'control' || workspaceId === undefined ? '/workspaces' : `/workspaces/${workspaceId}/${key}`
  // Board/Memory need a workspace to scope to; without one the segment is inert rather than
  // silently routing back to Control (which used to push a duplicate Control per tap).
  const enabled = (key: BottomStripKey): boolean => key === 'control' || workspaceId !== undefined

  return (
    <View
      testID={testID}
      style={[styles.row, { backgroundColor: colors.recessed, borderColor: colors.borderSubtle }]}
    >
      {(['control', 'board', 'memory'] as const).map((key) => (
        <Button
          key={key}
          testID={`bottom-strip-${key}`}
          label={LABELS[key]}
          variant={key === active ? 'secondary' : 'ghost'}
          disabled={!enabled(key)}
          onPress={() => goToSection(router, { key, active, href: hrefFor(key) })}
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
