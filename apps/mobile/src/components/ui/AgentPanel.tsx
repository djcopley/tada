import type { ReactNode } from 'react'
import { StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'

type Props = {
  children: ReactNode
  /** Uppercase mono header, e.g. "run #4131 · attempt 1". */
  header?: string
  /** Trailing mono meta in the header row, e.g. "live · 12m". */
  meta?: string
  style?: ViewStyle
  testID?: string
}

/**
 * The agent's material: everything the agent says sits on recessed dark ink
 * in IBM Plex Mono, identical in both themes. Lines starting with the ▸
 * prompt are drawn by callers via <AgentLine>.
 */
export function AgentPanel({ children, header, meta, style, testID }: Props) {
  const { colors } = useTheme()
  return (
    <View
      testID={testID}
      style={[
        styles.panel,
        { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge },
        style,
      ]}
    >
      {header || meta ? (
        <View style={styles.header}>
          {header ? (
            <Text style={[type.monoCaps, styles.caps, { color: colors.agentTextMuted }]}>{header}</Text>
          ) : null}
          <View style={styles.spacer} />
          {meta ? (
            <Text style={[type.monoCaps, styles.caps, { color: colors.agentTextMuted }]}>{meta}</Text>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  )
}

/** One mono line inside an AgentPanel, with the orange ▸ prompt. */
export function AgentLine({
  children,
  prompt = true,
  muted = false,
  color,
  testID,
}: {
  children: ReactNode
  prompt?: boolean
  muted?: boolean
  /** Override the text color (e.g. liveText for the active step). */
  color?: string
  testID?: string
}) {
  const { colors } = useTheme()
  return (
    <Text
      testID={testID}
      style={[type.mono, styles.line, { color: color ?? (muted ? colors.agentTextMuted : colors.agentText) }]}
    >
      {prompt ? <Text style={{ color: colors.agentPrompt }}>{'▸ '}</Text> : null}
      {children}
    </Text>
  )
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: space.md + 2,
    paddingVertical: space.md - 2,
    gap: space.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.xs,
  },
  spacer: {
    flex: 1,
  },
  caps: {
    textTransform: 'uppercase',
  },
  line: {
    // leading-mono is roomier than sans body.
    lineHeight: 22,
  },
})
