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

/** "09:41" clock stamp for an event's mono line. */
function timeStamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--'
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function Stamp({ event }: { event: ApiRunEvent }) {
  const { colors } = useTheme()
  return <Text style={{ color: colors.agentTextMuted }}>{`${timeStamp(event.createdAt)}  `}</Text>
}

function StatusRow({ event }: { event: ApiRunEvent }) {
  const { colors } = useTheme()
  const status = stringField(event.payload, 'status') ?? jsonPreview(event.payload)
  return (
    <Text testID={`event-status-${event.id}`} style={[type.mono, styles.line, { color: colors.agentTextMuted }]}>
      <Stamp event={event} />
      {/* Visual lowercase only — the payload text itself must stay intact. */}
      <Text style={styles.lower}>{status}</Text>
    </Text>
  )
}

function TextRow({ event }: { event: ApiRunEvent }) {
  const { colors } = useTheme()
  const text = stringField(event.payload, 'text') ?? jsonPreview(event.payload)
  return (
    <Text testID={`event-text-${event.id}`} style={[type.mono, styles.line, { color: colors.agentText }]}>
      <Stamp event={event} />
      {text}
    </Text>
  )
}

/** Tool calls are collapsible mono lines: name up front, input on tap. */
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
      style={styles.toolRow}
    >
      <Text
        testID={`event-tool-${event.id}`}
        numberOfLines={expanded ? undefined : 1}
        style={[type.mono, styles.toolName, { color: colors.agentTextMuted }]}
      >
        <Stamp event={event} />
        {`${name}(${inputPreview})`}
      </Text>
      <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.agentTextMuted} />
    </Pressable>
  )
}

function ErrorRow({ event }: { event: ApiRunEvent }) {
  const { colors } = useTheme()
  const message = stringField(event.payload, 'message') ?? jsonPreview(event.payload)
  return (
    <Text testID={`event-error-${event.id}`} style={[type.mono, styles.line, { color: colors.failText }]}>
      <Stamp event={event} />
      {`✕ ${message}`}
    </Text>
  )
}

function EventRow({ event }: { event: ApiRunEvent }) {
  switch (event.type) {
    case 'status':
      return <StatusRow event={event} />
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

/**
 * The agent narrates its run as timestamped mono lines on recessed dark
 * ink — one panel, identical in both themes.
 */
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
    <View
      style={[styles.feed, { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge }]}
    >
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
          style={[styles.jumpPill, { backgroundColor: colors.primaryBg }, shadow.card]}
        >
          <Icon name="arrow-down" size={14} color={colors.primaryText} />
          <Text style={[type.caption, { color: colors.primaryText }]}>Latest</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  feed: {
    flex: 1,
    borderRadius: radius.control,
    borderWidth: 1,
  },
  feedContent: {
    padding: space.lg,
    paddingBottom: space.xxl,
    gap: space.xs,
  },
  line: {
    lineHeight: 22,
  },
  lower: {
    textTransform: 'lowercase',
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  toolName: {
    flex: 1,
    lineHeight: 22,
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
