import type { ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../design/ThemeContext'
import { motion, radius, space } from '../../design/tokens'

type Props = {
  visible: boolean
  onClose: () => void
  children: ReactNode
  testID?: string
}

const SPRING = { damping: 22, stiffness: 260, mass: 0.7 }

/**
 * Bottom sheet with a drag handle: swipe down or tap the scrim to dismiss.
 * Content is measured, not snap-pointed — sheets in this app are short
 * action lists and pickers.
 */
export function Sheet({ visible, onClose, children, testID }: Props) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const translateY = useSharedValue(0)

  const pan = Gesture.Pan()
    .onChange((e) => {
      translateY.value = Math.max(0, translateY.value + e.changeY)
    })
    .onEnd((e) => {
      if (translateY.value > 90 || e.velocityY > 700) {
        translateY.value = withTiming(windowHeight, { duration: motion.base }, () => {
          runOnJS(onClose)()
        })
      } else {
        translateY.value = withSpring(0, SPRING)
      }
    })

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }))

  if (!visible && translateY.value !== 0) translateY.value = 0

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          testID={testID ? `${testID}-scrim` : undefined}
          accessibilityLabel="Close"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
          onPress={onClose}
        />
        <GestureDetector gesture={pan}>
          <Animated.View
            testID={testID}
            style={[
              styles.sheet,
              sheetStyle,
              {
                backgroundColor: colors.surface,
                paddingBottom: insets.bottom + space.lg,
                maxHeight: windowHeight * 0.85,
              },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.line }]} />
            {children}
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: space.sm,
    paddingHorizontal: space.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.full,
    marginBottom: space.md,
  },
})
