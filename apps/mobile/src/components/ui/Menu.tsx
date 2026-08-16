import type { ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../design/ThemeContext'
import { radius, space } from '../../design/tokens'

type Props = {
  visible: boolean
  onClose: () => void
  children: ReactNode
  style?: ViewStyle
  testID?: string
}

/** Floating overlay card on `--surface-overlay` — powers the workspace switcher and the small
 * `▾` dropdown triggers (agent/model pickers, etc). Tap the scrim or press Escape-equivalent
 * (onRequestClose) to dismiss.
 *
 * No entrance animation: RN-web's `Modal` fades in by animating `opacity` on the wrapper that
 * contains both the scrim *and* this card, which — for the ~250ms of the transition — composites
 * the card's otherwise-opaque `overlay` surface at fractional alpha over whatever is underneath
 * (nav rail, board cards, …), reading as a see-through panel. Rendering instantly keeps the
 * surface opaque from the first frame, matching the artboard's snap-open menus. */
export function Menu({ visible, onClose, children, style, testID }: Props) {
  const { colors, shadow } = useTheme()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  // Below the status bar/notch, and never taller than the screen: a long list (many workspaces)
  // scrolls inside the card instead of running off the bottom with no way to reach the tail.
  const top = insets.top + space.md
  const maxHeight = height - top - insets.bottom - space.lg

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable
        testID={testID ? `${testID}-scrim` : undefined}
        accessibilityLabel="Close"
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
        onPress={onClose}
      />
      <View
        testID={testID}
        style={[
          styles.menu,
          { top, maxHeight, backgroundColor: colors.overlay, borderColor: colors.borderStrong },
          shadow.lifted,
          style,
        ]}
      >
        <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    left: space.lg,
    width: 320,
    maxWidth: '92%',
    borderRadius: radius.card,
    borderWidth: 1,
    padding: space.sm,
  },
})
