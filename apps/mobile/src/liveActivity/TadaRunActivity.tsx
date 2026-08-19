import type { ActivityAction, LiveActivityProps } from '@tada/shared'
import { Button, Circle, HStack, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import {
  activityBackgroundTint,
  background,
  cornerRadius,
  font,
  foregroundColor,
  frame,
  lineLimit,
  padding,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers'
import { createLiveActivity } from 'expo-widgets'
import { phaseChrome, progressValue, timerBounds, WIDGET_INK } from './chrome'

// Fonts: this app loads IBM Plex Mono and Instrument Sans via @expo-google-fonts/* at JS
// runtime, which cannot register faces for a widget extension target. So the extension never
// asks for those families by name — the agent's voice uses font({ design: 'monospaced' }) and
// the product's voice uses the plain system font(). Don't re-litigate this; it was verified
// against the installed @expo/ui typings and expo-widgets' extension bundling in Task 7.

/** The agent's well: lowercase mono on recessed ink, one line, never two. */
function AgentWell({ line }: { line: string }) {
  return (
    <HStack
      spacing={8}
      modifiers={[
        background(WIDGET_INK.agentSurface),
        cornerRadius(8),
        padding({ top: 9, bottom: 9, leading: 12, trailing: 12 }),
      ]}
    >
      <Text
        modifiers={[
          font({ design: 'monospaced', size: 12 }),
          foregroundColor(WIDGET_INK.agentPrompt),
        ]}
      >
        ▸
      </Text>
      <Text
        modifiers={[
          font({ design: 'monospaced', size: 12 }),
          foregroundColor(WIDGET_INK.agentText),
          lineLimit(1),
        ]}
      >
        {line}
      </Text>
    </HStack>
  )
}

/** Two actions maximum — that is the whole budget for a lock screen. */
function Actions({ runId, actions }: { runId: number; actions: ActivityAction[] }) {
  if (actions.length === 0) return null
  return (
    <HStack spacing={8}>
      {actions.map((action, index) => (
        <Button
          key={`${action.kind}:${action.value ?? action.label}`}
          // `target` is what comes back through addUserInteractionListener; interactions.ts
          // parses it, so the format is a contract between those two files. The run id leads
          // because a terminal card (failed/re-run) can legitimately linger on the lock screen
          // after a *different* run has taken focus — without it, a stale Re-run tap would act on
          // whichever run the client guesses is current instead of the one the card is showing.
          target={`${runId}:${action.kind}:${action.value ?? ''}`}
          modifiers={[
            background(index === 0 ? WIDGET_INK.primaryBg : WIDGET_INK.controlBg),
            cornerRadius(5),
            frame({ maxWidth: Number.POSITIVE_INFINITY, height: 40 }),
          ]}
        >
          <Text
            modifiers={[
              font({ size: 14, weight: index === 0 ? 'semibold' : 'medium' }),
              foregroundColor(index === 0 ? WIDGET_INK.primaryText : WIDGET_INK.text),
            ]}
          >
            {action.label}
          </Text>
        </Button>
      ))}
    </HStack>
  )
}

export const TadaRunActivity = createLiveActivity<LiveActivityProps>('TadaRun', (props) => {
  'widget'
  const chrome = phaseChrome(props.phase)
  const timer = timerBounds(props.startedAt, props.budgetEndsAt)

  const header = (
    <HStack>
      <Text
        modifiers={[
          font({ design: 'monospaced', size: 11 }),
          foregroundColor(WIDGET_INK.textFaint),
        ]}
      >
        {`tada✱ · run ${props.runId}`}
      </Text>
      <Spacer />
      {props.phase === 'working' ? (
        <Text
          timerInterval={timer}
          countsDown={false}
          modifiers={[font({ design: 'monospaced', size: 11 }), foregroundColor(chrome.text)]}
        />
      ) : (
        <Text
          modifiers={[font({ design: 'monospaced', size: 11 }), foregroundColor(chrome.text)]}
        >
          {chrome.label}
        </Text>
      )}
    </HStack>
  )

  const body = (
    <VStack spacing={11} alignment="leading">
      {header}
      <Text
        modifiers={[
          font({ size: 16, weight: 'semibold' }),
          foregroundColor(WIDGET_INK.text),
          lineLimit(2),
        ]}
      >
        {props.title}
      </Text>
      <AgentWell line={props.agentLine} />
      {props.phase === 'working' && props.budgetEndsAt ? (
        <ProgressView
          // The budget consumed — the one honest progress tada has. A run without a budget
          // draws no bar at all rather than a made-up one.
          modifiers={[foregroundColor(WIDGET_INK.live)]}
          value={progressValue(props.startedAt, props.budgetEndsAt)}
        />
      ) : null}
      <Actions runId={props.runId} actions={props.actions} />
    </VStack>
  )

  return {
    banner: (
      <VStack
        modifiers={[
          activityBackgroundTint(WIDGET_INK.raised),
          widgetURL(`tada://runs/${props.runId}`),
          padding({ top: 14, bottom: 13, leading: 15, trailing: 15 }),
        ]}
      >
        {body}
      </VStack>
    ),
    // SwiftUI fills a Shape from its foreground style, not `.background` (which paints behind the
    // view's bounding box) — `CircleProps` has no separate fill prop, so `foregroundColor` is the
    // only modifier that actually colors the dot itself. `background` here would render a white
    // circle on a chrome.dot-colored square instead.
    minimal: <Circle modifiers={[foregroundColor(chrome.dot), frame({ width: 11, height: 11 })]} />,
    compactLeading: (
      <Circle modifiers={[foregroundColor(chrome.dot), frame({ width: 9, height: 9 })]} />
    ),
    compactTrailing:
      props.phase === 'working' ? (
        <Text
          timerInterval={timer}
          countsDown={false}
          modifiers={[font({ design: 'monospaced', size: 12 }), foregroundColor(chrome.text)]}
        />
      ) : (
        <Text
          modifiers={[font({ design: 'monospaced', size: 12 }), foregroundColor(chrome.text)]}
        >
          {chrome.label}
        </Text>
      ),
    expandedCenter: (
      <VStack spacing={11} alignment="leading" modifiers={[widgetURL(`tada://runs/${props.runId}`)]}>
        {header}
        <Text
          modifiers={[
            font({ size: 15, weight: 'semibold' }),
            foregroundColor(WIDGET_INK.text),
            lineLimit(2),
          ]}
        >
          {props.title}
        </Text>
        <AgentWell line={props.agentLine} />
      </VStack>
    ),
    expandedBottom: <Actions runId={props.runId} actions={props.actions} />,
  }
})

export default TadaRunActivity
