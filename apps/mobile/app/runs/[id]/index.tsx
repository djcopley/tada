import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { ApiError } from '../../../src/api/client'
import { useClient } from '../../../src/api/ClientContext'
import { useCancelRun, useNote, useRun } from '../../../src/api/queries'
import { useAppSocket } from '../../../src/api/useAppSocket'
import { useRunEvents } from '../../../src/api/useRunEvents'
import { EventFeed, type LineContextRequest } from '../../../src/components/EventFeed'
import { copyText } from '../../../src/components/run/clipboard'
import { GateCard } from '../../../src/components/run/GateCard'
import { type LineAction, LineMenu } from '../../../src/components/run/LineMenu'
import { AgentLine, AgentPanel, AppHeader, Badge, Button, Dialog, EmptyState, Input, Screen } from '../../../src/components/ui'
import { useNowTick } from '../../../src/control'
import { useTheme } from '../../../src/design/ThemeContext'
import { space, type } from '../../../src/design/tokens'
import { goToControl } from '../../../src/nav'
import {
  isLiveRun,
  linesFrom,
  panelMeta,
  runHeaderBadge,
  runMetaLine,
  terminalLine,
  timeStamp,
} from '../../../src/runActivity'
import { showToast } from '../../../src/toast'

export default function RunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const runId = Number(id)
  if (Number.isNaN(runId)) return <MissingRun />
  return <RunBody runId={runId} />
}

/** Unknown/stale run id (a push notification for a run that has since been cleaned up, a typo in
 * the URL): still a way back, so it isn't a dead end. */
function MissingRun() {
  const router = useRouter()
  return (
    <Screen testID="run-missing">
      <AppHeader title="Run" back backHref="/" />
      <EmptyState
        icon="alert-circle"
        message="This run doesn't exist."
        action={{ label: 'Back to Control', onPress: () => goToControl(router) }}
      />
    </Screen>
  )
}

function RunBody({ runId }: { runId: number }) {
  const router = useRouter()
  const client = useClient()
  const { colors } = useTheme()
  const now = useNowTick(15_000)
  const { data: run, error } = useRun(runId)
  const runMissing = error instanceof ApiError && error.status === 404

  const live = isLiveRun(run?.status)
  const running = run?.status === 'running'
  const held = run?.status === 'held'
  const { events, refetch } = useRunEvents(runId, { live })

  const onRunEvent = useCallback(
    (msg: { runId: number }) => {
      // The WS payload carries no server id, so don't append it directly — refetch through the
      // deduped polling path instead.
      if (msg.runId === runId) void refetch()
    },
    [runId, refetch],
  )
  useAppSocket({ onRunEvent })

  const { data: transcript } = useQuery({
    queryKey: ['transcript', runId],
    queryFn: async () => {
      try {
        return await client.transcript(runId)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return 'No transcript'
        throw err
      }
    },
    refetchInterval: live ? 4000 : false,
  })

  const [confirmVisible, setConfirmVisible] = useState(false)
  const cancel = useCancelRun()
  const note = useNote(run?.ticketId ?? Number.NaN)
  const [noteText, setNoteText] = useState('')
  const noteInput = useRef<TextInput>(null)
  const [lineReq, setLineReq] = useState<LineContextRequest | null>(null)

  const stopRun = () => {
    setConfirmVisible(false)
    cancel.mutate(runId, { onError: () => showToast('Could not stop run') })
  }

  const sendNote = () => {
    const body = noteText.trim()
    if (!body || !run) return
    note.mutate(body, {
      onSuccess: (result) => {
        setNoteText('')
        showToast(result.delivered ? 'note delivered' : 'note saved for the next step')
      },
    })
  }

  const onLineAction = async (action: LineAction) => {
    const req = lineReq
    setLineReq(null)
    if (!req) return
    const stamp = timeStamp(req.line.event.createdAt)
    const report = (ok: boolean) => showToast(ok ? 'copied' : 'copying is not available here')
    switch (action) {
      case 'copy':
        report(await copyText(`${stamp}  ${req.line.text}`))
        break
      case 'copyFrom':
        report(await copyText(linesFrom(events, req.line.event.id)))
        break
      case 'copyLog':
        report(await copyText(transcript ?? linesFrom(events, -1)))
        break
      case 'note':
        setNoteText(`About step ${stamp}: `)
        noteInput.current?.focus()
        break
      case 'stop':
        setConfirmVisible(true)
        break
    }
  }

  if (runMissing) return <MissingRun />

  const badge = runHeaderBadge(run, now)
  const meta = run ? runMetaLine(run.repoTags, run.id) : '—'
  const terminal = terminalLine(run)
  const heldHold = held && run?.hold ? run.hold : null

  return (
    <Screen edges={['top', 'bottom']} testID="run-activity">
      <ScrollView
        testID="run-activity-scroll"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // The note composer sits at the very bottom; without this the keyboard covers it and there
        // is nothing to scroll to. iOS-only prop, ignored elsewhere.
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.headerRow}>
          <Button testID="run-back" variant="ghost" small icon="chevron-left" label="Control" onPress={() => goToControl(router)} />
          <View style={styles.headerTitleBlock}>
            {/* The title is the way to the ticket itself (thread, brief, attempts). */}
            <Text
              testID="run-title"
              accessibilityRole={run ? 'link' : undefined}
              onPress={run ? () => router.push(`/tickets/${run.ticketId}`) : undefined}
              style={[type.title, { color: colors.text }]}
            >
              {run?.ticketTitle ?? '…'}
            </Text>
            <Text testID="run-meta" style={[type.monoSmall, { color: colors.textFaintSolid }]}>
              {meta}
            </Text>
          </View>
          <View style={styles.spacer} />
          {badge ? <Badge testID="run-status-badge" status={badge.status} label={badge.label} /> : null}
          {live ? (
            <Button testID="run-cancel" variant="destructive" icon="x-octagon" label="Stop run" onPress={() => setConfirmVisible(true)} small />
          ) : null}
        </View>

        <AgentPanel
          testID="run-panel"
          header={run ? `run #${run.id}${run.attemptNumber > 1 ? ` · attempt ${run.attemptNumber}` : ''}` : undefined}
          meta={panelMeta(run, now)}
          rawOutput={transcript ?? 'loading transcript…'}
        >
          {events.length === 0 ? (
            <AgentLine muted prompt={false}>
              {live ? 'waiting for the agent to start…' : 'nothing was journaled'}
            </AgentLine>
          ) : (
            <EventFeed
              testID="run-events"
              events={events}
              live={running}
              onLineContext={setLineReq}
              selectedId={lineReq?.line.event.id}
            />
          )}
          {terminal ? (
            <AgentLine
              testID="run-terminal-line"
              prompt={false}
              color={terminal.tone === 'ok' ? colors.okText : terminal.tone === 'error' ? colors.failText : colors.agentTextMuted}
            >
              {terminal.text}
            </AgentLine>
          ) : null}
        </AgentPanel>

        {run && heldHold ? <GateCard run={run} hold={heldHold} ticketId={run.ticketId} /> : null}
        {held ? (
          <Text testID="run-held-copy" style={[type.caption, { color: colors.textFaintSolid }]}>
            Holding freed its slot — the queue kept moving. Approving resumes this run at the front.
          </Text>
        ) : null}

        {live && run ? (
          <>
            <View style={styles.noteRow}>
              <Input
                ref={noteInput}
                testID="note-input"
                containerStyle={styles.noteInputWrap}
                placeholder="Add a note — the agent reads it at its next step"
                value={noteText}
                onChangeText={setNoteText}
                returnKeyType="send"
                onSubmitEditing={sendNote}
              />
              <Button testID="note-send" variant="secondary" small label="Send" loading={note.isPending} onPress={sendNote} />
            </View>
            <Text style={[type.caption, { color: colors.textFaintSolid }]}>
              {"Safe to close — it runs unattended. You'll get a ping when it needs you."}
            </Text>
          </>
        ) : null}
      </ScrollView>

      <LineMenu request={lineReq} onClose={() => setLineReq(null)} onAction={(a) => void onLineAction(a)} canStop={live} />

      <Dialog
        visible={confirmVisible}
        title="Stop run?"
        onClose={() => setConfirmVisible(false)}
        cancelLabel="Keep going"
        confirm={{ label: 'Stop run', destructive: true, onPress: stopRun, testID: 'run-cancel-confirm' }}
      >
        <Text style={[type.body, { color: colors.textMuted }]}>
          This stops the agent and puts the ticket back in backlog. Nothing restarts it until you queue it again.
        </Text>
      </Dialog>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: {
    padding: space.lg,
    gap: space.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  headerTitleBlock: {
    gap: 2,
  },
  spacer: {
    flex: 1,
  },
  noteRow: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
  },
  noteInputWrap: {
    flex: 1,
  },
})
