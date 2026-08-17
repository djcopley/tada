import type { ApiRun } from '@tada/shared'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import {
  useAnswer,
  useApprove,
  useCancelRun,
  useContinueRun,
  useDeny,
  useMoveTicket,
  useRerun,
} from '../../api/queries'
import { useTheme } from '../../design/ThemeContext'
import { space, type } from '../../design/tokens'
import { showToast } from '../../toast'
import { Button, Checkbox, Dialog, Input } from '../ui'

export const CONTINUE_MS = 30 * 60 * 1000

type Props = {
  run: ApiRun
  ticketId: number
  /** Board-card sized buttons: primary Approve/Continue plus one ghost, nothing else. */
  compact?: boolean
  /** Mobile Control cards: buttons stretch to fill the row. */
  stretch?: boolean
  testID?: string
}

/**
 * The actions for a run that is stopped on you, keyed by *why* it stopped — the same set on
 * every surface (Control card, board card, ticket detail, run screen, context menu):
 *
 *  - permission → Approve · Always allow · Deny with a note · View diff (publish gates only)
 *  - question   → one button per option · Answer with a note…
 *  - time       → Continue +30m · Stop and edit brief · Move to backlog
 *  - failed     → Re-run · Edit brief and re-run · Full log · Move to backlog
 *
 * Approve/deny/answer/continue resume the run in place; re-run is a fresh attempt.
 */
export function HoldActions({ run, ticketId, compact = false, stretch = false, testID }: Props) {
  const router = useRouter()
  const approve = useApprove()
  const deny = useDeny()
  const answer = useAnswer()
  const cont = useContinueRun()
  const cancel = useCancelRun()
  const move = useMoveTicket()
  const rerun = useRerun()
  const [denying, setDenying] = useState(false)
  const [answering, setAnswering] = useState(false)

  const size = compact ? { small: true } : {}
  const btn = stretch ? styles.stretch : undefined

  const stopAndEdit = () => {
    cancel.mutate(run.id, { onSuccess: () => router.push(`/tickets/${ticketId}`) })
  }
  const toBacklog = () => {
    if (run.status === 'failed') move.mutate({ id: ticketId, to: { column: 'backlog' } })
    else cancel.mutate(run.id)
  }

  const hold = run.hold
  if (run.status === 'held' && hold?.reason === 'permission') {
    return (
      <View testID={testID} style={styles.row}>
        <Button
          testID="hold-approve"
          label="Approve"
          variant="primary"
          {...size}
          style={btn}
          loading={approve.isPending && !approve.variables?.alwaysAllow}
          onPress={() => approve.mutate({ runId: run.id })}
        />
        {compact ? (
          <Button testID="hold-deny" label="Deny…" variant="ghost" {...size} style={btn} onPress={() => setDenying(true)} />
        ) : (
          <>
            <Button
              testID="hold-always-allow"
              label="Always allow"
              variant="ghost"
              {...size}
              style={btn}
              loading={approve.isPending && approve.variables?.alwaysAllow === true}
              onPress={() => approve.mutate({ runId: run.id, alwaysAllow: true })}
            />
            <Button testID="hold-deny" label="Deny with a note" variant="ghost" {...size} style={btn} onPress={() => setDenying(true)} />
            {hold.publishes ? (
              <Button
                testID="hold-view-diff"
                label="View diff"
                variant="ghost"
                {...size}
                style={btn}
                onPress={() => router.push(`/runs/${run.id}/diff`)}
              />
            ) : null}
          </>
        )}
        <DenyDialog
          visible={denying}
          onClose={() => setDenying(false)}
          pending={deny.isPending}
          onDeny={(note, saveToMemory) =>
            deny.mutate({ runId: run.id, note, saveToMemory }, { onSuccess: () => setDenying(false) })
          }
        />
      </View>
    )
  }

  if (run.status === 'held' && hold?.reason === 'question') {
    const options = compact ? [] : hold.options
    return (
      <View testID={testID} style={styles.row}>
        {options.map((option) => (
          <Button
            key={option}
            testID={`hold-option-${option}`}
            label={option}
            variant="secondary"
            {...size}
            style={btn}
            loading={answer.isPending && answer.variables?.answer === option}
            onPress={() => answer.mutate({ runId: run.id, answer: option })}
          />
        ))}
        <Button
          testID="hold-answer"
          label={compact ? 'Answer' : options.length ? 'Answer with a note…' : 'Answer…'}
          variant={compact || options.length === 0 ? 'secondary' : 'ghost'}
          {...size}
          style={btn}
          onPress={() => setAnswering(true)}
        />
        <AnswerDialog
          visible={answering}
          question={hold.question}
          onClose={() => setAnswering(false)}
          pending={answer.isPending}
          onAnswer={(text, saveToMemory) =>
            answer.mutate({ runId: run.id, answer: text, saveToMemory }, { onSuccess: () => setAnswering(false) })
          }
        />
      </View>
    )
  }

  if (run.status === 'held' && hold?.reason === 'time') {
    return (
      <View testID={testID} style={styles.row}>
        <Button
          testID="hold-continue"
          label="Continue +30m"
          variant={compact ? 'secondary' : 'primary'}
          {...size}
          style={btn}
          loading={cont.isPending}
          onPress={() => cont.mutate({ runId: run.id, extraMs: CONTINUE_MS })}
        />
        {compact ? (
          <Button testID="hold-stop" label="Stop…" variant="ghost" {...size} style={btn} onPress={stopAndEdit} />
        ) : (
          <>
            <Button testID="hold-stop" label="Stop and edit brief" variant="ghost" {...size} style={btn} onPress={stopAndEdit} />
            <Button testID="hold-backlog" label="Move to backlog" variant="ghost" {...size} style={btn} onPress={toBacklog} />
          </>
        )}
      </View>
    )
  }

  if (run.status === 'failed') {
    return (
      <View testID={testID} style={styles.row}>
        <Button
          testID="hold-rerun"
          label="Re-run"
          variant="secondary"
          {...size}
          style={btn}
          loading={rerun.isPending}
          onPress={() => rerun.mutate(ticketId, { onError: () => showToast('Could not re-run') })}
        />
        {compact ? null : (
          <>
            <Button
              testID="hold-edit-rerun"
              label="Edit brief and re-run"
              variant="ghost"
              {...size}
              style={btn}
              onPress={() => router.push(`/tickets/${ticketId}?edit=1`)}
            />
            <Button testID="hold-log" label="Full log" variant="ghost" {...size} style={btn} onPress={() => router.push(`/runs/${run.id}`)} />
          </>
        )}
        <Button testID="hold-backlog" label="Move to backlog" variant="ghost" {...size} style={btn} onPress={toBacklog} />
      </View>
    )
  }

  return null
}

/** Deny and redirect: the PR isn't opened; the note becomes the agent's next instruction. */
export function DenyDialog({
  visible,
  onClose,
  onDeny,
  pending,
}: {
  visible: boolean
  onClose: () => void
  onDeny: (note: string, saveToMemory: boolean) => void
  pending?: boolean
}) {
  const { colors } = useTheme()
  const [note, setNote] = useState('')
  const [save, setSave] = useState(false)
  return (
    <Dialog
      visible={visible}
      title="Deny and redirect"
      onClose={onClose}
      testID="deny-dialog"
      confirm={{
        label: 'Deny and continue',
        onPress: () => onDeny(note.trim(), save),
        disabled: note.trim().length === 0,
        loading: pending,
        testID: 'deny-confirm',
      }}
    >
      <Text style={[type.caption, { color: colors.textMuted }]}>
        The call is not made. Everything the agent has done stays — your note becomes its next instruction, from this step.
      </Text>
      <Input
        testID="deny-note"
        label="What should it do instead"
        value={note}
        onChangeText={setNote}
        multiline
        autoFocus
        containerStyle={styles.field}
      />
      <Checkbox testID="deny-save" label="Save this note to memory" checked={save} onChange={setSave} />
      <View style={[styles.agentLine, { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge }]}>
        <Text style={[type.monoSmall, { color: colors.agentText }]}>
          <Text style={{ color: colors.agentPrompt }}>{'▸ '}</Text>
          resumes at this step · context kept · no re-clone, no re-run
        </Text>
      </View>
    </Dialog>
  )
}

/** Answer a question the agent asked, in free text. */
export function AnswerDialog({
  visible,
  question,
  onClose,
  onAnswer,
  pending,
}: {
  visible: boolean
  question: string
  onClose: () => void
  onAnswer: (answer: string, saveToMemory: boolean) => void
  pending?: boolean
}) {
  const { colors } = useTheme()
  const [text, setText] = useState('')
  const [save, setSave] = useState(false)
  return (
    <Dialog
      visible={visible}
      title="Answer the agent"
      onClose={onClose}
      testID="answer-dialog"
      confirm={{
        label: 'Answer and continue',
        onPress: () => onAnswer(text.trim(), save),
        disabled: text.trim().length === 0,
        loading: pending,
        testID: 'answer-confirm',
      }}
    >
      <View style={[styles.agentLine, { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge }]}>
        <Text style={[type.monoSmall, { color: colors.agentText }]}>
          <Text style={{ color: colors.agentPrompt }}>{'? '}</Text>
          {question}
        </Text>
      </View>
      <Input testID="answer-note" label="Your answer" value={text} onChangeText={setText} multiline autoFocus containerStyle={styles.field} />
      <Checkbox testID="answer-save" label="Save this answer to memory" checked={save} onChange={setSave} />
    </Dialog>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  stretch: { flex: 1 },
  field: { marginTop: space.md, marginBottom: space.md },
  agentLine: {
    marginTop: space.md,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
})
