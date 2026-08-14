import type { ApiRunEvent } from '@tada/shared'
import { useEffect, useRef } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** `payload` is `unknown` on the wire — render defensively: pull known
 * fields off objects when present, otherwise fall back to a JSON preview
 * so unexpected shapes still show something useful instead of crashing. */
function jsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function stringField(payload: unknown, field: string): string | undefined {
  return isRecord(payload) && typeof payload[field] === 'string' ? (payload[field] as string) : undefined
}

function StatusPill({ event }: { event: ApiRunEvent }) {
  const status = stringField(event.payload, 'status') ?? jsonPreview(event.payload)
  return (
    <View testID={`event-status-${event.id}`} style={styles.pill}>
      <Text style={styles.pillText}>{status}</Text>
    </View>
  )
}

function TextRow({ event }: { event: ApiRunEvent }) {
  const text = stringField(event.payload, 'text') ?? jsonPreview(event.payload)
  return (
    <Text testID={`event-text-${event.id}`} style={styles.bodyText}>
      {text}
    </Text>
  )
}

function ToolUseRow({ event }: { event: ApiRunEvent }) {
  const name = stringField(event.payload, 'name') ?? 'tool'
  const inputPreview = stringField(event.payload, 'inputPreview') ?? jsonPreview(event.payload)
  return (
    <Text testID={`event-tool-${event.id}`} style={styles.mono}>
      {`${name}(${inputPreview})`}
    </Text>
  )
}

function ErrorRow({ event }: { event: ApiRunEvent }) {
  const message = stringField(event.payload, 'message') ?? jsonPreview(event.payload)
  return (
    <Text testID={`event-error-${event.id}`} style={styles.errorText}>
      {message}
    </Text>
  )
}

function EventRow({ event }: { event: ApiRunEvent }) {
  switch (event.type) {
    case 'status':
      return <StatusPill event={event} />
    case 'text':
      return <TextRow event={event} />
    case 'tool_use':
      return <ToolUseRow event={event} />
    case 'error':
      return <ErrorRow event={event} />
    default:
      return null
  }
}

export function EventFeed({ events, live }: { events: ApiRunEvent[]; live: boolean }) {
  const listRef = useRef<FlatList<ApiRunEvent>>(null)
  const count = events.length

  useEffect(() => {
    if (live && count > 0) {
      listRef.current?.scrollToEnd({ animated: true })
    }
  }, [count, live])

  return (
    <FlatList
      testID="event-feed"
      ref={listRef}
      data={events}
      keyExtractor={(event) => String(event.id)}
      renderItem={({ item }) => <EventRow event={item} />}
    />
  )
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#e0f0ff',
    marginVertical: 4,
  },
  pillText: {
    color: '#1565c0',
    fontSize: 12,
    fontWeight: '600',
  },
  bodyText: {
    fontSize: 14,
    marginVertical: 4,
  },
  mono: {
    fontFamily: 'Menlo, monospace',
    fontSize: 12,
    color: '#333',
    marginVertical: 4,
  },
  errorText: {
    fontSize: 13,
    color: '#c62828',
    marginVertical: 4,
  },
})
