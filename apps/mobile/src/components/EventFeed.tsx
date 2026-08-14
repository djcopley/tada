import type { ApiRunEvent } from '@tada/shared'
import { useEffect, useRef, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../design/ThemeContext'
import { radius, space, type } from '../design/tokens'
import { Icon } from './ui/Icon'

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
  const { colors } = useTheme()
  const status = stringField(event.payload, 'status') ?? jsonPreview(event.payload)
  return (
    <View testID={`event-status-${event.id}`} style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}>
      {/* Visual uppercase only — the payload text itself must stay intact. */}
      <Text style={[type.monoSmall, styles.upper, { color: colors.inkMuted }]}>{status}</Text>
    </View>
  )
}

function TextRow({ event }: { event: ApiRunEvent }) {
  const { colors } = useTheme()
  const text = stringField(event.payload, 'text') ?? jsonPreview(event.payload)
  return (
    <Text testID={`event-text-${event.id}`} style={[type.body, styles.row, { color: colors.ink }]}>
      {text}
    </Text>
  )
}

/** Tool calls render as collapsible mono cards: name up front, input on tap. */
function ToolUseRow({ event }: { event: ApiRunEvent }) {
  const { colors } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const name = stringField(event.payload, 'name') ?? 'tool'
  const inputPreview = stringField(event.payload, 'inputPreview') ?? jsonPreview(event.payload)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Tool call ${name}`}
      onPress={() => setExpanded((v) => !v)}
      style={[styles.toolCard, { backgroundColor: colors.surfaceAlt }]}
    >
      <View style={styles.toolHeader}>
        <Icon name="tool" size={12} color={colors.inkMuted} />
        <Text
          testID={`event-tool-${event.id}`}
          numberOfLines={expanded ? undefined : 1}
          style={[type.mono, styles.toolName, { color: colors.ink }]}
        >
          {`${name}(${inputPreview})`}
        </Text>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.inkFaint} />
      </View>
    </Pressable>
  )
}

function ErrorRow({ event }: { event: ApiRunEvent }) {
  const { colors } = useTheme()
  const message = stringField(event.payload, 'message') ?? jsonPreview(event.payload)
  return (
    <View style={[styles.errorCard, { backgroundColor: colors.signalRedBg }]}>
      <Icon name="alert-triangle" size={14} color={colors.signalRed} />
      <Text testID={`event-error-${event.id}`} style={[type.body, styles.errorText, { color: colors.signalRed }]}>
        {message}
      </Text>
    </View>
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
  const { colors, shadow } = useTheme()
  const listRef = useRef<FlatList<ApiRunEvent>>(null)
  const count = events.length
  const [pinnedToEnd, setPinnedToEnd] = useState(true)

  useEffect(() => {
    if (live && count > 0 && pinnedToEnd) {
      listRef.current?.scrollToEnd({ animated: true })
    }
  }, [count, live, pinnedToEnd])

  return (
    <View style={styles.feed}>
      <FlatList
        testID="event-feed"
        ref={listRef}
        data={events}
        keyExtractor={(event) => String(event.id)}
        renderItem={({ item }) => <EventRow event={item} />}
        onScrollBeginDrag={() => setPinnedToEnd(false)}
        onEndReached={() => setPinnedToEnd(true)}
        onEndReachedThreshold={0.05}
        contentContainerStyle={styles.feedContent}
      />
      {live && !pinnedToEnd && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Jump to latest"
          onPress={() => {
            setPinnedToEnd(true)
            listRef.current?.scrollToEnd({ animated: true })
          }}
          style={[styles.jumpPill, { backgroundColor: colors.ink }, shadow.card]}
        >
          <Icon name="arrow-down" size={14} color={colors.onInk} />
          <Text style={[type.caption, { color: colors.onInk }]}>Latest</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  feed: {
    flex: 1,
  },
  feedContent: {
    paddingBottom: space.xxl,
    gap: space.sm,
  },
  row: {
    marginVertical: 2,
  },
  upper: {
    textTransform: 'uppercase',
  },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  toolCard: {
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  toolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  toolName: {
    flex: 1,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    borderRadius: radius.sm,
    padding: space.sm,
  },
  errorText: {
    flex: 1,
  },
  jumpPill: {
    position: 'absolute',
    bottom: space.lg,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderRadius: radius.full,
  },
})
