import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'

export type NewTicketLanding = 'backlog' | 'queued'

type Props = {
  visible: boolean
  onClose: () => void
  /** Called with the trimmed title, brief and where the ticket lands; the caller owns the
   * mutation. */
  onCreate: (fields: { title: string; description: string; column: NewTicketLanding }) => void
  pending?: boolean
  testID?: string
}

/**
 * The one "New ticket" dialog — Control, the Board header and the Backlog column's "Add a
 * ticket" all open this. Title and brief, nothing to configure: there is no repo picker (the
 * agent works out of your folder and tags the ticket with whatever repos the run touches).
 * "Lands in" defaults to backlog; queued starts when a slot frees. Field state lives here and
 * resets on close; Enter in the title submits.
 */
export function NewTicketDialog({ visible, onClose, onCreate, pending = false, testID = 'new-ticket-dialog' }: Props) {
  const { colors } = useTheme()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [column, setColumn] = useState<NewTicketLanding>('backlog')

  const reset = () => {
    setTitle('')
    setDescription('')
    setColumn('backlog')
  }
  const close = () => {
    reset()
    onClose()
  }
  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed || pending) return
    onCreate({ title: trimmed, description: description.trim(), column })
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
        label="Brief — what the agent reads"
        placeholder="Context, constraints, how you'll know it's right."
        multiline
        value={description}
        onChangeText={setDescription}
        containerStyle={styles.description}
        style={styles.descriptionInput}
      />
      <View style={styles.landsRow}>
        <Text style={[type.caption, { color: colors.text }]}>Lands in</Text>
        <View
          testID="new-ticket-lands-in"
          style={[styles.segmented, { backgroundColor: colors.recessed, borderColor: colors.borderSubtle }]}
        >
          {(['backlog', 'queued'] as const).map((key) => {
            const selected = key === column
            return (
              <Pressable
                key={key}
                testID={`new-ticket-lands-${key}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setColumn(key)}
                style={[styles.segment, selected && { backgroundColor: colors.controlBgHover }]}
              >
                <Text style={[type.caption, { color: selected ? colors.text : colors.textFaintSolid }]}>
                  {key === 'backlog' ? 'Backlog' : 'Queued'}
                </Text>
              </Pressable>
            )
          })}
        </View>
        <Text style={[type.monoCaps, styles.landsHint, { color: colors.textFaintSolid }]}>
          queued starts when a slot frees
        </Text>
      </View>
      <Text style={[type.caption, styles.note, { color: colors.textFaintSolid }]}>
        No repo picker — the agent works out of your folder and tags the ticket with whatever repos the run touches.
      </Text>
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
  landsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.md,
  },
  segmented: {
    flexDirection: 'row',
    gap: 2,
    padding: 2,
    borderWidth: 1,
    borderRadius: radius.full,
  },
  segment: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.full,
  },
  landsHint: {
    textTransform: 'none',
  },
  note: {
    marginTop: space.md,
  },
})
