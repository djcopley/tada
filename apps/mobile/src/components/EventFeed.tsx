import type { ApiRunEvent } from '@tada/shared'
import { useEffect } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
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
import { lineTone, narrationText, timeStamp } from '../runActivity'

// Other screens' "latest agent line" hooks import narrationText from here; keep the export.
export { narrationText }

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

export type EventFeedLine = { event: ApiRunEvent; text: string }

/** A line's context-menu request: right-click on web, long press elsewhere. `anchor` is the
 * pointer position on web (a 1×1 frame) or undefined for a long press. */
export type LineContextRequest = {
  line: EventFeedLine
  anchor?: { x: number; y: number; width: number; height: number }
}

/**
 * The agent's narration, meant to sit directly inside an `<AgentPanel>`: one stamped mono line
 * per event, oldest first. The latest line pulses in live-text while the run is running; hold
 * lines are live-text (the run is alive, waiting on you); errors and never-rules render in
 * fail-text; the done line in sage. Raw output lives in the panel's own `rawOutput` prop, not
 * here. `onLineContext` (right-click / long press) selects the line while a menu is open —
 * `selectedId` draws the live-colour outline the design shows.
 */
export function EventFeed({
  events,
  live,
  onLineContext,
  selectedId,
  testID,
}: {
  events: ApiRunEvent[]
  live: boolean
  onLineContext?: (req: LineContextRequest) => void
  selectedId?: number
  testID?: string
}) {
  const { colors } = useTheme()
  const entries: EventFeedLine[] = events
    .map((event) => ({ event, text: narrationText(event) }))
    .filter((entry): entry is EventFeedLine => entry.text !== null)
  const lastIndex = entries.length - 1

  return (
    <View testID={testID} style={styles.list}>
      {entries.map((entry, index) => {
        const { event, text } = entry
        const tone = lineTone(event)
        const isLatestLive = live && tone !== 'error' && tone !== 'hold' && index === lastIndex
        const color =
          tone === 'error'
            ? colors.failText
            : tone === 'hold' || isLatestLive
              ? colors.liveText
              : tone === 'ok'
                ? colors.okText
                : tone === 'text'
                  ? colors.agentText
                  : colors.agentTextMuted
        const selected = selectedId === event.id
        const webProps =
          Platform.OS === 'web' && onLineContext
            ? {
                onContextMenu: (e: { preventDefault: () => void; nativeEvent?: { pageX?: number; pageY?: number } }) => {
                  e.preventDefault()
                  const x = e.nativeEvent?.pageX ?? 0
                  const y = e.nativeEvent?.pageY ?? 0
                  onLineContext({ line: entry, anchor: { x, y, width: 1, height: 1 } })
                },
              }
            : {}
        return (
          <Pressable
            key={event.id}
            testID={testIdFor(event)}
            onLongPress={onLineContext ? () => onLineContext({ line: entry }) : undefined}
            delayLongPress={400}
            style={[styles.lineWrap, selected && { borderColor: colors.live }]}
            {...(webProps as object)}
          >
            <Text style={[type.mono, styles.line, { color }]}>
              <Text style={{ color: colors.agentTextMuted }}>{`${timeStamp(event.createdAt)}  `}</Text>
              {isLatestLive ? <LiveGlyph color={colors.liveText} /> : null}
              {tone === 'error' && !text.startsWith('✕') ? `✕ ${text}` : text}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  list: {
    gap: space.xs,
  },
  lineWrap: {
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 4,
    marginHorizontal: -5,
    paddingHorizontal: 4,
  },
  line: {
    lineHeight: 22,
  },
})
