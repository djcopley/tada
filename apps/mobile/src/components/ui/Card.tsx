import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space } from '../../design/tokens'

type Props = {
  children: ReactNode
  onPress?: () => void
  onLongPress?: () => void
  style?: ViewStyle | ViewStyle[]
  testID?: string
  /** Set when `children` render their own interactive `Button`/`Pressable` controls (e.g. a
   * proposal card's Keep/Dismiss). RN-web maps `accessibilityRole="button"` straight to a DOM
   * `<button>`, so a pressable card wrapping pressable children would nest `<button>` inside
   * `<button>` — invalid HTML that React (rightly) logs a hydration warning for. Cards in this
   * position stay clickable (mouse + `onPress`) but drop the button role/DOM tag; the nested
   * controls keep their own. */
  nestedInteractive?: boolean
}

/** Elevated surface. Pressable when given handlers, static otherwise. */
export function Card({ children, onPress, onLongPress, style, testID, nestedInteractive }: Props) {
  const { colors, shadow } = useTheme()
  const surface = [
    styles.card,
    { backgroundColor: colors.raised, borderColor: colors.borderSubtle },
    shadow.card,
    style,
  ]

  if (!onPress && !onLongPress) {
    return (
      <View testID={testID} style={surface}>
        {children}
      </View>
    )
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole={nestedInteractive ? undefined : 'button'}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [...surface, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: space.lg,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
})
