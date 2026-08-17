import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, type } from '../../design/tokens'
import type { ThemeScheme } from '../../settings'
import { Icon } from './Icon'

type Props = {
  testID?: string
}

const OPTIONS: { scheme: ThemeScheme; icon: 'moon' | 'sun'; label: string }[] = [
  { scheme: 'night', icon: 'moon', label: 'Night watch' },
  { scheme: 'day', icon: 'sun', label: 'Paper day' },
]

/** Recessed icon pill for flipping night watch / paper day, with the active scheme spelled out
 * in mono beside it. The one instance of this control — Rail renders it on every wide screen. */
export function ThemeToggle({ testID }: Props) {
  const { colors, scheme, setScheme } = useTheme()

  return (
    <View style={styles.row}>
      <View
        testID={testID}
        accessibilityRole="radiogroup"
        style={[styles.pill, { backgroundColor: colors.recessed, borderColor: colors.borderSubtle }]}
      >
        {OPTIONS.map((opt) => {
          const selected = opt.scheme === scheme
          return (
            <Pressable
              key={opt.scheme}
              testID={testID ? `${testID}-${opt.scheme}` : undefined}
              accessibilityRole="radio"
              accessibilityLabel={opt.label}
              accessibilityState={{ selected }}
              onPress={() => {
                if (!selected) setScheme(opt.scheme)
              }}
              style={[styles.option, selected && { backgroundColor: colors.controlBgHover }]}
            >
              <Icon name={opt.icon} size={15} color={selected ? colors.text : colors.textFaintSolid} />
            </Pressable>
          )
        })}
      </View>
      <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{scheme}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  pill: {
    flexDirection: 'row',
    gap: 2,
    padding: 2,
    borderWidth: 1,
    borderRadius: radius.full,
  },
  option: {
    width: 28,
    height: 22,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
