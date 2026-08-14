import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
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

/** Small centered dialog for create/confirm flows — replaces ad-hoc modals and Alert.alert. */
export function Dialog({ visible, title, onClose, children, confirm, cancelLabel = 'Cancel', testID }: Props) {
  const { colors, shadow } = useTheme()

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable
          accessibilityLabel="Close"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
          onPress={onClose}
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
          {children}
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
    borderRadius: radius.card,
    borderWidth: 1,
    padding: space.xl,
    gap: space.lg,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
})
