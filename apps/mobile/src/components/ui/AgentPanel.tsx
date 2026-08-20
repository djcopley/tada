import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'

type Props = {
  children: ReactNode
  /** Uppercase mono header, e.g. "run #4131 · attempt 1". */
  header?: string
  /** Trailing mono meta in the header row, e.g. "live · 12m". */
  meta?: string
  /** Raw transcript tail, shown in a collapsible section below the narration — expanded by
   * default, matching the artboard's live-run panel. */
  rawOutput?: string
  /** Start the raw section collapsed. The run screen sets this: its feed is pinned to the
   * bottom, and an expanded transcript underneath would be what the bottom lands on, pushing
   * the newest narration — the thing you opened the screen for — back out of view. */
  rawStartsCollapsed?: boolean
  style?: ViewStyle
  testID?: string
}

/**
 * The agent's material: everything the agent says sits on recessed dark ink
 * in IBM Plex Mono, identical in both themes. Lines starting with the ▸
 * prompt are drawn by callers via <AgentLine>.
 */
export function AgentPanel({ children, header, meta, rawOutput, rawStartsCollapsed = false, style, testID }: Props) {
  const { colors } = useTheme()
  const [collapsed, setCollapsed] = useState(rawStartsCollapsed)

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
      {rawOutput !== undefined ? (
        <View style={[styles.rawSection, { borderTopColor: colors.agentSurfaceEdge }]}>
          <Pressable
            testID={testID ? `${testID}-raw-toggle` : undefined}
            accessibilityRole="button"
            accessibilityLabel={collapsed ? 'Expand raw output' : 'Collapse raw output'}
            onPress={() => setCollapsed((c) => !c)}
            style={styles.rawHeader}
          >
            <Text style={[type.monoCaps, styles.caps, { color: colors.agentTextMuted }]}>raw output</Text>
            <View style={styles.spacer} />
            <Text style={[type.monoCaps, styles.caps, { color: colors.agentTextMuted }]}>
              {collapsed ? 'expand ▸' : 'collapse ▾'}
            </Text>
          </Pressable>
          {collapsed ? null : (
            <Text testID={testID ? `${testID}-raw-content` : undefined} style={[styles.rawText, { color: colors.agentTextMuted }]}>
              {rawOutput}
            </Text>
          )}
        </View>
      ) : null}
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
  rawSection: {
    marginTop: space.md,
    paddingTop: space.sm + 2,
    borderTopWidth: 1,
    gap: space.xs,
  },
  rawHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rawText: {
    fontSize: 11.5,
    lineHeight: 17,
  },
})
