import type { ReactNode } from 'react'
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { Button } from './Button'

type Props = {
  visible: boolean
  title: string
  onClose: () => void
  children?: ReactNode
  /** Confirm button; omit for informational dialogs. */
  confirm?: {
    label: string
    onPress: () => void
    destructive?: boolean
    disabled?: boolean
    loading?: boolean
    testID?: string
  }
  cancelLabel?: string
  testID?: string
}

/**
 * Small centered dialog for create/confirm flows — replaces ad-hoc modals and Alert.alert.
 *
 * Two keyboard rules, both learned from the New ticket dialog on iOS: the body scrolls inside a
 * height-capped card so a growing multiline field can never push the confirm button off-screen,
 * and a tap on the scrim dismisses the keyboard first, closing the dialog only once it is down —
 * so reaching for "somewhere else to tap" never silently throws away what you typed.
 */
export function Dialog({ visible, title, onClose, children, confirm, cancelLabel = 'Cancel', testID }: Props) {
  const { colors, shadow } = useTheme()

  const onScrimPress = () => {
    if (Keyboard.isVisible()) {
      Keyboard.dismiss()
      return
    }
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable
          testID={testID ? `${testID}-scrim` : undefined}
          accessibilityLabel="Close"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
          onPress={onScrimPress}
        />
        <View
          testID={testID}
          style={[
            styles.card,
            { backgroundColor: colors.overlay, borderColor: colors.borderStrong },
            shadow.lifted,
          ]}
        >
          <Text style={[type.title, { color: colors.text }]}>{title}</Text>
          <ScrollView
            testID={testID ? `${testID}-body` : undefined}
            style={styles.bodyScroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            bounces={false}
          >
            {children}
          </ScrollView>
          <View style={styles.actions}>
            <Button variant="ghost" label={cancelLabel} onPress={onClose} small />
            {confirm ? (
              <Button
                variant={confirm.destructive ? 'destructive' : 'primary'}
                label={confirm.label}
                onPress={confirm.onPress}
                disabled={confirm.disabled}
                loading={confirm.loading}
                small
                testID={confirm.testID}
              />
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    // Shrink rather than overflow once the keyboard eats the available height — the actions row
    // below stays pinned and tappable.
    flexShrink: 1,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: space.xl,
    gap: space.lg,
  },
  bodyScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  body: {
    gap: space.lg,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
})
