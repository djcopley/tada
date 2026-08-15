import type { ApiRunEvent } from '@tada/shared'
import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { useTheme } from '../design/ThemeContext'
import { space, type } from '../design/tokens'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringField(payload: unknown, field: string): string | undefined {
  return isRecord(payload) && typeof payload[field] === 'string' ? (payload[field] as string) : undefined
}

/** "09:41" clock stamp for a narration line. */
function timeStamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--'
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Pulls a file path out of a tool call's JSON `inputPreview` — the common shapes across tools
 * (`file_path`, `path`, `filePath`, `notebook_path`). `inputPreview` can be truncated mid-JSON
 * (the server caps its length), so a parse failure just means no path, not an error. */
function pathFromInputPreview(inputPreview: string | undefined): string | undefined {
  if (!inputPreview) return undefined
  try {
    const parsed: unknown = JSON.parse(inputPreview)
    if (!isRecord(parsed)) return undefined
    const candidate = parsed.file_path ?? parsed.path ?? parsed.filePath ?? parsed.notebook_path
    return typeof candidate === 'string' ? candidate : undefined
  } catch {
    return undefined
  }
}

/** Concise narration for a tool call — "editing src/auth/session.ts" when the input names a
 * path, otherwise just the tool's name lowercased, or `null` (skip the line entirely) when
 * there's nothing worth narrating. */
function toolNarration(payload: unknown): string | null {
  const name = stringField(payload, 'name')
  const path = pathFromInputPreview(stringField(payload, 'inputPreview'))
  if (path) {
    const verb = name && /read/i.test(name) ? 'reading' : name && /bash|run|exec/i.test(name) ? 'running' : 'editing'
    return `${verb} ${path}`
  }
  return name ? name.toLowerCase() : null
}

/** The narration text for one run event, or `null` to skip it (an event type this feed doesn't
 * narrate, or a tool call with nothing concise to say). */
export function narrationText(event: ApiRunEvent): string | null {
  switch (event.type) {
    case 'status':
      return stringField(event.payload, 'status') ?? null
    case 'text':
      return stringField(event.payload, 'text') ?? null
    case 'error':
      return stringField(event.payload, 'message') ?? 'error'
    case 'tool_use':
      return toolNarration(event.payload)
    default:
      return null
  }
}

function testIdFor(event: ApiRunEvent): string {
  const kind = event.type === 'tool_use' ? 'tool' : event.type
  return `event-${kind}-${event.id}`
}

/** The pulsing ▮ marking the single most-recent narration line while the run is live —
 * reduced-motion users get a plain static glyph. */
function LiveGlyph({ color }: { color: string }) {
  const reducedMotion = useReducedMotion()
  const opacity = useSharedValue(1)

  useEffect(() => {
    if (reducedMotion) {
      opacity.value = 1
      return
    }
    opacity.value = withRepeat(withSequence(withTiming(0.25, { duration: 700 }), withTiming(1, { duration: 700 })), -1)
    return () => cancelAnimation(opacity)
  }, [reducedMotion, opacity])

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }))

  return <Animated.Text style={[{ color }, style]}>{'▮ '}</Animated.Text>
}

/**
 * The agent's narration, meant to sit directly inside an `<AgentPanel>`: one stamped mono line
 * per event, oldest first. The latest line pulses in live-text while the run is still going;
 * error lines render in fail-text. Raw output lives in the panel's own `rawOutput` prop, not here.
 */
export function EventFeed({ events, live, testID }: { events: ApiRunEvent[]; live: boolean; testID?: string }) {
  const { colors } = useTheme()
  const entries = events
    .map((event) => ({ event, text: narrationText(event) }))
    .filter((entry): entry is { event: ApiRunEvent; text: string } => entry.text !== null)
  const lastIndex = entries.length - 1

  return (
    <View testID={testID} style={styles.list}>
      {entries.map(({ event, text }, index) => {
        const isError = event.type === 'error'
        const isLatestLive = live && !isError && index === lastIndex
        const color = isError
          ? colors.failText
          : isLatestLive
            ? colors.liveText
            : event.type === 'text'
              ? colors.agentText
              : colors.agentTextMuted
        return (
          <Text key={event.id} testID={testIdFor(event)} style={[type.mono, styles.line, { color }]}>
            <Text style={{ color: colors.agentTextMuted }}>{`${timeStamp(event.createdAt)}  `}</Text>
            {isLatestLive ? <LiveGlyph color={colors.liveText} /> : null}
            {isError ? `✕ ${text}` : text}
          </Text>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  list: {
    gap: space.xs,
  },
  line: {
    lineHeight: 22,
  },
})
