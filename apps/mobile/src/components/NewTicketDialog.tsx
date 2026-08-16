import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { useTheme } from '../design/ThemeContext'
import { space, type } from '../design/tokens'
import { Dialog } from './ui/Dialog'
import { Input } from './ui/Input'

type Props = {
  visible: boolean
  onClose: () => void
  /** Called with the trimmed title and description; the caller owns the mutation. */
  onCreate: (fields: { title: string; description: string }) => void
  pending?: boolean
  /** One-line hint under the title, e.g. which workspace the ticket goes to. */
  hint?: string
  testID?: string
}

/**
 * The one "New ticket" dialog — Control, the Board header and the Backlog column's "Add a
 * ticket" all open this so the brief (title + description, what the agent reads) is asked for
 * up front instead of only being editable after the fact on the ticket screen. Field state
 * lives here and resets on close; Enter in the title submits.
 */
export function NewTicketDialog({ visible, onClose, onCreate, pending = false, hint, testID = 'new-ticket-dialog' }: Props) {
  const { colors } = useTheme()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const reset = () => {
    setTitle('')
    setDescription('')
  }
  const close = () => {
    reset()
    onClose()
  }
  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed || pending) return
    onCreate({ title: trimmed, description: description.trim() })
    reset()
  }

  return (
    <Dialog
      visible={visible}
      title="New ticket"
      onClose={close}
      testID={testID}
      confirm={{
        label: 'Create ticket',
        onPress: submit,
        disabled: pending || title.trim().length === 0,
        loading: pending,
        testID: 'new-ticket-confirm',
      }}
    >
      {hint ? <Text style={[type.caption, { color: colors.textMuted }]}>{hint}</Text> : null}
      <Input
        testID="new-ticket-title-input"
        label="Title"
        placeholder="What should the agent do?"
        autoFocus
        returnKeyType="next"
        blurOnSubmit={false}
        onSubmitEditing={submit}
        value={title}
        onChangeText={setTitle}
      />
      <Input
        testID="new-ticket-description-input"
        label="Description"
        placeholder="Context, constraints, definition of done — the agent reads this."
        multiline
        value={description}
        onChangeText={setDescription}
        containerStyle={styles.description}
        style={styles.descriptionInput}
      />
    </Dialog>
  )
}

const styles = StyleSheet.create({
  description: {
    marginTop: space.sm,
  },
  descriptionInput: {
    minHeight: 96,
  },
})
