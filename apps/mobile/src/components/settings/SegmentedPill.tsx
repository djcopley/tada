import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'

export type SegmentTone = 'neutral' | 'live' | 'fail'

export type Segment<T extends string> = {
  value: T
  label: string
  /** Colour the selected label: `live` for "ask" (orange), `fail` for "never" (red). */
  tone?: SegmentTone
}

type Props<T extends string> = {
  value: T
  segments: Segment<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  testID?: string
}

/** Recessed pill of mutually exclusive choices — Allow / Ask / Never, Backlog / Queued,
 * Push / Off. The selected segment is raised; its label takes the segment's tone. */
export function SegmentedPill<T extends string>({ value, segments, onChange, disabled, testID }: Props<T>) {
  const { colors } = useTheme()
  const toneColor = (tone: SegmentTone | undefined) =>
    tone === 'live' ? colors.liveText : tone === 'fail' ? colors.failText : colors.text
  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      style={[styles.pill, { backgroundColor: colors.recessed, borderColor: colors.borderSubtle }]}
    >
      {segments.map((seg) => {
        const selected = seg.value === value
        return (
          <Pressable
            key={seg.value}
            testID={testID ? `${testID}-${seg.value}` : undefined}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => {
              if (!selected) onChange(seg.value)
            }}
            style={[styles.segment, selected && { backgroundColor: colors.controlBgHover }]}
          >
            <Text
              style={[
                type.caption,
                selected && styles.selectedText,
                { color: selected ? toneColor(seg.tone) : colors.textFaintSolid },
              ]}
            >
              {seg.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    gap: 2,
    padding: 2,
    borderWidth: 1,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  segment: {
    paddingVertical: 4,
    paddingHorizontal: space.md - 1,
    borderRadius: radius.full,
  },
  selectedText: {
    fontWeight: '600',
  },
})
