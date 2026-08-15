import type { ApiRun } from '@tada/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { ApiError } from '../../src/api/client'
import { useClient } from '../../src/api/ClientContext'
import { keys, useRun } from '../../src/api/queries'
import { useRunEvents } from '../../src/api/useRunEvents'
import { useWorkspaceSocket } from '../../src/api/useWorkspaceSocket'
import { EventFeed } from '../../src/components/EventFeed'
import { AppHeader, Button, Dialog, EmptyState, Screen, Skeleton, StatusTag } from '../../src/components/ui'
import { useTheme } from '../../src/design/ThemeContext'
import { humanize, runStatusVisual } from '../../src/design/status'
import { fonts, radius, space, type } from '../../src/design/tokens'
import { relativeTime } from '../../src/relativeTime'
import { showToast } from '../../src/toast'

const ACTIVE_RUN_STATUSES: ReadonlySet<ApiRun['status']> = new Set(['queued', 'running'])

export default function RunActivity() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const runId = Number(id)

  if (Number.isNaN(runId)) {
    return (
      <Screen>
        <AppHeader title="Run" back />
        <EmptyState icon="alert-circle" message="This run doesn't exist." />
      </Screen>
    )
  }

  return <RunActivityBody runId={runId} />
}

function RunActivityBody({ runId }: { runId: number }) {
  const client = useClient()
  const qc = useQueryClient()
  const { colors } = useTheme()
  const { data: run } = useRun(runId)

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

  const [confirmVisible, setConfirmVisible] = useState(false)
  const [transcriptVisible, setTranscriptVisible] = useState(false)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [transcriptLoading, setTranscriptLoading] = useState(false)

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

  const toggleTranscript = () => {
    if (transcriptVisible) {
      setTranscriptVisible(false)
      return
    }
    setTranscriptVisible(true)
    if (transcript !== null || transcriptLoading) return
    setTranscriptLoading(true)
    client
      .transcript(runId)
      .then((text) => setTranscript(text))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          setTranscript('No transcript')
        } else {
          setTranscript('Failed to load transcript')
        }
      })
      .finally(() => setTranscriptLoading(false))
  }

  return (
    <Screen edges={['top', 'bottom']} testID="run-activity">
      <AppHeader title={`Run #${runId}`} back />
      <View style={styles.body}>
        <View style={styles.statusRow}>
          <View testID="run-status" style={styles.statusBlock}>
            {run ? (
              <>
                <StatusTag status={runStatusVisual(run.status)} />
                <Text style={[type.caption, { color: colors.textMuted }]}>
                  {`${humanize(run.adapter)} · ${humanize(run.model)} · started ${relativeTime(run.createdAt)}`}
                </Text>
              </>
            ) : (
              <Text style={[type.caption, { color: colors.textFaintSolid }]}>—</Text>
            )}
          </View>
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

        <Button
          testID="transcript-toggle"
          variant="secondary"
          icon="file-text"
          label={transcriptVisible ? 'Hide transcript' : 'View transcript'}
          onPress={toggleTranscript}
          small
          style={styles.transcriptToggle}
        />

        {transcriptVisible && (
          <View
            testID="transcript-panel"
            style={[styles.transcriptPanel, { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge }]}
          >
            {transcriptLoading ? (
              <View testID="transcript-loading" style={styles.transcriptSkeleton}>
                <Skeleton height={12} width="90%" />
                <Skeleton height={12} width="70%" />
                <Skeleton height={12} width="80%" />
              </View>
            ) : (
              <ScrollView style={styles.transcriptScroll} nestedScrollEnabled>
                <Text testID="transcript-text" style={[styles.mono, { color: colors.agentTextMuted }]}>
                  {transcript}
                </Text>
              </ScrollView>
            )}
          </View>
        )}

        <EventFeed events={events} live={live} />

        {live && (
          <Text style={[type.caption, { color: colors.textFaintSolid }]}>
            {"Safe to close — it runs unattended. You'll get a ping when it needs you."}
          </Text>
        )}
      </View>

      <Dialog
        visible={confirmVisible}
        title="Cancel run?"
        onClose={() => setConfirmVisible(false)}
        cancelLabel="Keep running"
        confirm={{
          label: 'Cancel run',
          destructive: true,
          onPress: cancelRun,
          testID: 'run-cancel-confirm',
        }}
      >
        <Text style={[type.body, { color: colors.textMuted }]}>
          This stops the agent working on this run.
        </Text>
      </Dialog>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    padding: space.lg,
    gap: space.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  statusBlock: {
    flex: 1,
    gap: space.xs,
  },
  transcriptToggle: {
    alignSelf: 'flex-start',
  },
  transcriptPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space.md,
    maxHeight: 240,
  },
  transcriptScroll: {
    flexGrow: 0,
  },
  transcriptSkeleton: {
    gap: space.sm,
  },
  mono: {
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
})
