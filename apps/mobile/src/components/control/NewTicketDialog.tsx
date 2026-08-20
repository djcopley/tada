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
  /** Called with the trimmed title, brief, where the ticket lands and any repo tags; the caller
   * owns the mutation. */
  onCreate: (fields: {
    title: string
    description: string
    column: NewTicketLanding
    repoTags: string[]
  }) => void
  pending?: boolean
  /** The board's selected repo, if any — the new ticket is tagged for it so it shows up on that
   * filtered board straight away. Tap the chip to drop the tag. */
  repo?: string | null
  testID?: string
}

/**
 * The one "New ticket" dialog — Control, the Board header and the Backlog column's "Add a
 * ticket" all open this. Title and brief, and still no repo *picker*: the only tag it can set is
 * the repo the board is already filtered to (`repo`), so a card you make while looking at a repo
 * lands on that board instead of vanishing until a run touches something. Everything else is
 * still evidence — the run tags the ticket with whatever repos it touches.
 * "Lands in" defaults to backlog; queued starts when a slot frees. Field state lives here and
 * resets on close; Enter in the title submits.
 */
export function NewTicketDialog({
  visible,
  onClose,
  onCreate,
  pending = false,
  repo = null,
  testID = 'new-ticket-dialog',
}: Props) {
  const { colors } = useTheme()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [column, setColumn] = useState<NewTicketLanding>('backlog')
  const [tagRepo, setTagRepo] = useState(true)

  const reset = () => {
    setTitle('')
    setDescription('')
    setColumn('backlog')
    setTagRepo(true)
  }
  const close = () => {
    reset()
    onClose()
  }
  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed || pending) return
    onCreate({
      title: trimmed,
      description: description.trim(),
      column,
      repoTags: repo && tagRepo ? [repo] : [],
    })
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
      {repo ? (
        <Pressable
          testID="new-ticket-repo-tag"
          accessibilityRole="button"
          accessibilityState={{ selected: tagRepo }}
          accessibilityLabel={tagRepo ? `Tagged ${repo} — tap to remove` : `Tag ${repo}`}
          onPress={() => setTagRepo((on) => !on)}
          style={[
            styles.repoChip,
            {
              borderColor: tagRepo ? colors.borderStrong : colors.borderSubtle,
              backgroundColor: tagRepo ? colors.controlBgHover : 'transparent',
            },
          ]}
        >
          <Text style={[type.monoCaps, { color: tagRepo ? colors.text : colors.textFaintSolid }]}>{repo}</Text>
        </Pressable>
      ) : null}
      <Text style={[type.caption, styles.note, { color: colors.textFaintSolid }]}>
        {repo
          ? tagRepo
            ? `Tagged ${repo}, so it shows on that board right away. Tap the tag to drop it. The run adds tags for whatever repos it touches.`
            : `Untagged — it won't show on the ${repo} board until a run touches that repo.`
          : 'No repo picker — the agent works out of your folder and tags the ticket with whatever repos the run touches.'}
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
  repoChip: {
    alignSelf: 'flex-start',
    marginTop: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderWidth: 1,
    borderRadius: radius.full,
  },
  note: {
    marginTop: space.sm,
  },
})
