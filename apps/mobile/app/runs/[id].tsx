import type { ApiRun } from '@tada/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { ApiError } from '../../src/api/client'
import { useClient } from '../../src/api/ClientContext'
import { keys, useTicket } from '../../src/api/queries'
import { useRunEvents } from '../../src/api/useRunEvents'
import { EventFeed } from '../../src/components/EventFeed'

const ACTIVE_RUN_STATUSES: ReadonlySet<ApiRun['status']> = new Set(['queued', 'running'])

/**
 * There's no GET /runs/:id route on the server, so this screen locates the
 * run inside its parent ticket's run list instead. That means it needs the
 * ticketId, which the route param alone doesn't carry (only `id`, the run
 * id) — the ticket detail screen's RunRow passes it along as a `ticketId`
 * query param when it navigates here.
 */
export default function RunActivity() {
  const { id, ticketId } = useLocalSearchParams<{ id: string; ticketId: string }>()
  const runId = Number(id)
  const ticketIdNum = Number(ticketId)

  if (Number.isNaN(runId) || Number.isNaN(ticketIdNum)) {
    return (
      <View style={styles.center}>
        <Text>Invalid run</Text>
      </View>
    )
  }

  return <RunActivityBody runId={runId} ticketId={ticketIdNum} />
}

function RunActivityBody({ runId, ticketId }: { runId: number; ticketId: number }) {
  const client = useClient()
  const qc = useQueryClient()
  const { data } = useTicket(ticketId)
  const run = data?.runs.find((r) => r.id === runId)

  const live = run ? ACTIVE_RUN_STATUSES.has(run.status) : false
  const { events } = useRunEvents(runId, { live })

  const [transcriptVisible, setTranscriptVisible] = useState(false)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [transcriptLoading, setTranscriptLoading] = useState(false)

  const cancel = () => {
    Alert.alert('Cancel run?', 'This stops the agent working on this run.', [
      { text: 'Keep running', style: 'cancel' },
      {
        text: 'Cancel run',
        style: 'destructive',
        onPress: () => {
          void client
            .cancelRun(runId)
            .then(() => qc.invalidateQueries({ queryKey: keys.ticket(ticketId) }))
        },
      },
    ])
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
    <View testID="run-activity" style={styles.container}>
      <View style={styles.header}>
        <Text testID="run-status" style={styles.status}>
          {run?.status ?? '—'}
        </Text>
        {live && (
          <Pressable testID="run-cancel" style={styles.cancelButton} onPress={cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        )}
      </View>

      <Pressable testID="transcript-toggle" style={styles.transcriptButton} onPress={toggleTranscript}>
        <Text style={styles.transcriptButtonText}>
          {transcriptVisible ? 'Hide transcript' : 'View transcript'}
        </Text>
      </Pressable>

      {transcriptVisible && (
        <View testID="transcript-panel" style={styles.transcriptPanel}>
          {transcriptLoading ? (
            <Text testID="transcript-loading">Loading…</Text>
          ) : (
            <Text testID="transcript-text" style={styles.mono}>
              {transcript}
            </Text>
          )}
        </View>
      )}

      <View style={styles.feedContainer}>
        <EventFeed events={events} live={live} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  status: {
    fontSize: 18,
    fontWeight: '700',
  },
  cancelButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#c62828',
  },
  cancelText: {
    color: '#fff',
    fontWeight: '600',
  },
  transcriptButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
  },
  transcriptButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  transcriptPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 10,
  },
  mono: {
    fontFamily: 'Menlo, monospace',
    fontSize: 12,
  },
  feedContainer: {
    flex: 1,
  },
})
