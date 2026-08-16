import type { ApiRun } from '@tada/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { ApiError } from '../../src/api/client'
import { useClient } from '../../src/api/ClientContext'
import { keys, useNudge, useRun, useWorkspace } from '../../src/api/queries'
import { useRunEvents } from '../../src/api/useRunEvents'
import { useWorkspaceSocket } from '../../src/api/useWorkspaceSocket'
import { AgentLine, AgentPanel, AppHeader, Badge, Button, Dialog, EmptyState, Input, Screen } from '../../src/components/ui'
import { EventFeed } from '../../src/components/EventFeed'
import { elapsedLabel, useNowTick } from '../../src/control'
import { useTheme } from '../../src/design/ThemeContext'
import { space, type } from '../../src/design/tokens'
import { goToControl } from '../../src/nav'
import { runHeaderBadge, runMetaLine } from '../../src/runActivity'
import { showToast } from '../../src/toast'

const ACTIVE_RUN_STATUSES: ReadonlySet<ApiRun['status']> = new Set(['queued', 'running'])

export default function RunActivity() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const runId = Number(id)

  if (Number.isNaN(runId)) return <MissingRun />

  return <RunActivityBody runId={runId} />
}

/** Unknown/stale run id (a push notification for a run that has since been cleaned up, a typo in
 * the URL): still a way back, so it isn't a dead end. */
function MissingRun() {
  const router = useRouter()
  return (
    <Screen testID="run-missing">
      <AppHeader title="Run" back backHref="/workspaces" />
      <EmptyState
        icon="alert-circle"
        message="This run doesn't exist."
        action={{ label: 'Back to Control', onPress: () => goToControl(router) }}
      />
    </Screen>
  )
}

function RunActivityBody({ runId }: { runId: number }) {
  const router = useRouter()
  const client = useClient()
  const qc = useQueryClient()
  const { colors } = useTheme()
  const now = useNowTick(15_000)
  const { data: run, isError: runMissing } = useRun(runId)
  const { data: workspace } = useWorkspace(run?.workspaceId)

  const live = run ? ACTIVE_RUN_STATUSES.has(run.status) : false
  const { events, refetch } = useRunEvents(runId, { live })

  useWorkspaceSocket(run?.workspaceId, {
    onRunEvent: (msg) => {
      // The WS payload carries no server id, so don't append it directly —
      // that produced a synthetic-id row duplicating the one the next poll
      // fetched with its real id. Trigger an immediate refetch instead; it
      // goes through the same dedupe-by-server-id path as the 2s poll.
      if (msg.runId === runId) void refetch()
    },
  })

  const { data: transcript } = useQuery({
    queryKey: ['transcript', runId],
    queryFn: async () => {
      try {
        return await client.transcript(runId)
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return 'No transcript'
        throw error
      }
    },
    refetchInterval: live ? 4000 : false,
  })

  const [confirmVisible, setConfirmVisible] = useState(false)
  const nudge = useNudge(runId)
  const [nudgeNote, setNudgeNote] = useState('')

  const cancelRun = () => {
    setConfirmVisible(false)
    // client.cancelRun is a plain client call, not a react-query mutation,
    // so it never reaches the global mutation error handler — show the
    // toast here instead of leaving a failure silent.
    void client
      .cancelRun(runId)
      .then(() => qc.invalidateQueries({ queryKey: keys.run(runId) }))
      .catch(() => showToast('Could not cancel run'))
  }

  const sendNudge = () => {
    const note = nudgeNote.trim()
    if (!note) return
    nudge.mutate(note, {
      onSuccess: (result) => {
        setNudgeNote('')
        if (!result.delivered) showToast('note saved for the next attempt')
      },
    })
  }

  if (runMissing) return <MissingRun />

  const badge = runHeaderBadge(run, live, now)
  const metaLine = run ? runMetaLine(workspace?.name ?? '—', workspace?.sources[0]?.name, run.attemptNumber) : '—'
  const running = run?.status === 'running'
  const panelMeta = running ? `live · ${elapsedLabel(run?.startedAt, now)}` : (badge?.label ?? '—')

  return (
    <Screen edges={['top', 'bottom']} testID="run-activity">
      <ScrollView testID="run-activity-scroll" contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Button
            testID="run-back"
            variant="ghost"
            small
            icon="chevron-left"
            label="Control"
            onPress={() => goToControl(router)}
          />
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
            <Text testID="run-meta" style={[type.monoSmall, styles.metaText, { color: colors.textFaintSolid }]}>
              {metaLine}
            </Text>
          </View>
          <View style={styles.spacer} />
          {badge ? <Badge testID="run-status-badge" status={badge.status} label={badge.label} /> : null}
          {live && (
            <Button
              testID="run-cancel"
              variant="destructive"
              icon="x-octagon"
              label="Stop run"
              onPress={() => setConfirmVisible(true)}
              small
            />
          )}
        </View>

        <AgentPanel
          testID="run-panel"
          header={run ? `run #${run.id} · attempt ${run.attemptNumber}` : undefined}
          meta={panelMeta}
          rawOutput={transcript ?? 'loading transcript…'}
        >
          {events.length === 0 ? (
            <AgentLine muted prompt={false}>
              {'waiting for the agent to start…'}
            </AgentLine>
          ) : (
            <EventFeed testID="run-events" events={events} live={live} />
          )}
        </AgentPanel>

        {/* A nudge needs a running agent to hear it (the server 404s otherwise). */}
        {running && (
          <>
            <View style={styles.nudgeRow}>
              <Input
                testID="nudge-input"
                containerStyle={styles.nudgeInputWrap}
                placeholder="Nudge with a note — the agent sees it between steps"
                value={nudgeNote}
                onChangeText={setNudgeNote}
                returnKeyType="send"
                onSubmitEditing={sendNudge}
              />
              <Button testID="nudge-send" variant="secondary" small label="Send" loading={nudge.isPending} onPress={sendNudge} />
            </View>
            <Text style={[type.caption, { color: colors.textFaintSolid }]}>
              {"Safe to close — it runs unattended. You'll get a ping when it needs you."}
            </Text>
          </>
        )}
      </ScrollView>

      <Dialog
        visible={confirmVisible}
        title="Stop run?"
        onClose={() => setConfirmVisible(false)}
        cancelLabel="Keep running"
        confirm={{
          label: 'Stop run',
          destructive: true,
          onPress: cancelRun,
          testID: 'run-cancel-confirm',
        }}
      >
        <Text style={[type.body, { color: colors.textMuted }]}>This stops the agent working on this run.</Text>
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
  metaText: {
    marginTop: 1,
  },
  spacer: {
    flex: 1,
  },
  nudgeRow: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
  },
  nudgeInputWrap: {
    flex: 1,
  },
})
