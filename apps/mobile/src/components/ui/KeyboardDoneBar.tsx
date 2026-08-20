import { type ReactNode, useId } from 'react'
import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { space, type } from '../../design/tokens'

/**
 * iOS gives you no way out of a multiline text field: return types a newline, and there is no
 * hardware back like Android's. So every multiline field docks a "Done" bar above the keyboard.
 * Single-line fields already have a return key that closes it and are left alone.
 *
 * Returns the prop to spread onto the `TextInput` plus the bar to render as its sibling — the
 * pair has to share a generated `nativeID`, which is why this is one hook rather than a component
 * you drop in.
 */
export function useKeyboardDoneBar(
  enabled: boolean,
  testID?: string,
): { inputAccessoryViewID: string | undefined; doneBar: ReactNode } {
  const { colors } = useTheme()
  const nativeID = `keyboard-done-${useId()}`
  // InputAccessoryView is iOS-only; on Android and web it renders nothing useful.
  const on = enabled && Platform.OS === 'ios'

  if (!on) return { inputAccessoryViewID: undefined, doneBar: null }

  return {
    inputAccessoryViewID: nativeID,
    doneBar: (
      <InputAccessoryView nativeID={nativeID}>
        <View style={[styles.bar, { backgroundColor: colors.raised, borderTopColor: colors.borderSubtle }]}>
          <Pressable
            testID={testID ? `${testID}-done` : 'keyboard-done'}
            accessibilityRole="button"
            accessibilityLabel="Dismiss keyboard"
            hitSlop={space.sm}
            onPress={() => Keyboard.dismiss()}
            style={styles.hit}
          >
            <Text style={[type.bodyStrong, { color: colors.liveText }]}>Done</Text>
          </Pressable>
        </View>
      </InputAccessoryView>
    ),
  }
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  hit: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
})
