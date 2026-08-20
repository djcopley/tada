import type { ReactNode } from 'react'
import { useCallback, useRef, useState } from 'react'
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { isAtBottom } from '../../followScroll'

/**
 * A scroller that stays stuck to the newest content, like a terminal.
 *
 * It scrolls to the end whenever the content grows *while the reader is already at the bottom*.
 * Scroll up to read history and it lets go — following would fight you — and offers a pill to
 * jump back. Reaching the bottom again by hand resumes following too, so the pill is never the
 * only way out.
 *
 * The first scroll-to-end is unanimated: opening a long run should simply *start* at the newest
 * line, not animate past the whole run's history to get there.
 */
export function FollowingScroll({
  children,
  style,
  contentContainerStyle,
  testID,
}: {
  children: ReactNode
  style?: ViewStyle
  contentContainerStyle?: ViewStyle
  testID?: string
}) {
  const { colors } = useTheme()
  const ref = useRef<ScrollView>(null)
  // Follow state is a ref, not state: it is recomputed on every scroll frame and nothing renders
  // from it directly. Only the pill's visibility — which flips rarely — is state.
  const following = useRef(true)
  const settled = useRef(false)
  const [showJump, setShowJump] = useState(false)

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const atBottom = isAtBottom(e.nativeEvent)
    following.current = atBottom
    setShowJump(!atBottom)
  }, [])

  const onContentSizeChange = useCallback(() => {
    if (!following.current) return
    ref.current?.scrollToEnd({ animated: settled.current })
    settled.current = true
  }, [])

  const jump = useCallback(() => {
    following.current = true
    setShowJump(false)
    ref.current?.scrollToEnd({ animated: true })
  }, [])

  return (
    <View style={[styles.frame, style]}>
      <ScrollView
        ref={ref}
        testID={testID}
        style={styles.scroll}
        contentContainerStyle={contentContainerStyle}
        onScroll={onScroll}
        onContentSizeChange={onContentSizeChange}
        scrollEventThrottle={16}
      >
        {children}
      </ScrollView>
      {showJump ? (
        <View pointerEvents="box-none" style={styles.pillLayer}>
          <Pressable
            testID={testID ? `${testID}-jump` : undefined}
            accessibilityRole="button"
            accessibilityLabel="Jump to the latest activity"
            onPress={jump}
            style={[styles.pill, { backgroundColor: colors.raised, borderColor: colors.live }]}
          >
            <Text style={[type.monoSmall, { color: colors.liveText }]}>{'jump to latest ↓'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  scroll: { flex: 1 },
  pillLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: space.md,
    alignItems: 'center',
  },
  pill: {
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
  },
})
