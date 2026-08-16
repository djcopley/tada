import type { ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../design/ThemeContext'
import { radius, space } from '../../design/tokens'

/** Window-coordinate frame of the control that opened the menu (see `measureInWindow`). */
export type MenuAnchor = { x: number; y: number; width: number; height: number }

type Props = {
  visible: boolean
  onClose: () => void
  children: ReactNode
  /** Where to open: just under this frame (above it when there's no room), left-aligned to it.
   * Without an anchor the menu sits at the top-left of the screen (the ⌘K switcher). */
  anchor?: MenuAnchor | null
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
export function Menu({ visible, onClose, children, anchor, style, testID }: Props) {
  const { colors, shadow } = useTheme()
  const insets = useSafeAreaInsets()
  const { height, width } = useWindowDimensions()
  // Below the status bar/notch, and never taller than the screen: a long list (many workspaces)
  // scrolls inside the card instead of running off the bottom with no way to reach the tail.
  const topMost = insets.top + space.md
  const bottomLimit = height - insets.bottom - space.lg
  let top = topMost
  let left: number = space.lg
  let maxHeight = bottomLimit - top
  if (anchor) {
    // Under the trigger when at least a few rows fit there, otherwise above it; clamped so a
    // trigger near the right edge still gets a fully visible menu.
    const menuWidth = Math.min(MENU_WIDTH, width * 0.92)
    left = Math.max(space.sm, Math.min(anchor.x, width - menuWidth - space.sm))
    const below = anchor.y + anchor.height + space.xs
    if (bottomLimit - below >= MIN_ANCHORED_HEIGHT) {
      top = below
      maxHeight = bottomLimit - top
    } else {
      // Above: as tall as the room permits, bottom edge just over the trigger.
      maxHeight = Math.max(MIN_ANCHORED_HEIGHT, anchor.y - space.xs - topMost)
      top = Math.max(topMost, anchor.y - space.xs - maxHeight)
    }
  }

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
          { top, left, maxHeight, backgroundColor: colors.overlay, borderColor: colors.borderStrong },
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

const MENU_WIDTH = 320
const MIN_ANCHORED_HEIGHT = 160

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    width: MENU_WIDTH,
    maxWidth: '92%',
    borderRadius: radius.card,
    borderWidth: 1,
    padding: space.sm,
  },
})
