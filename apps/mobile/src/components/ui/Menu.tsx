import type { ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
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
 * (onRequestClose) to dismiss. */
export function Menu({ visible, onClose, children, style, testID }: Props) {
  const { colors, shadow } = useTheme()

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        testID={testID ? `${testID}-scrim` : undefined}
        accessibilityLabel="Close"
        style={StyleSheet.absoluteFill}
        onPress={onClose}
      />
      <View
        testID={testID}
        style={[
          styles.menu,
          { backgroundColor: colors.overlay, borderColor: colors.borderStrong },
          shadow.lifted,
          style,
        ]}
      >
        {children}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    top: 64,
    left: space.lg,
    width: 320,
    maxWidth: '92%',
    borderRadius: radius.card,
    borderWidth: 1,
    padding: space.sm,
  },
})
