import { forwardRef, useState } from 'react'
import { StyleSheet, Text, TextInput, type TextInputProps, View, type ViewStyle } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { fonts, radius, space, type } from '../../design/tokens'

type Props = TextInputProps & {
  label?: string
  error?: string | null
  /** Render the field in the data (mono) face — URLs, tokens, file names. */
  mono?: boolean
  containerStyle?: ViewStyle
}

export const Input = forwardRef<TextInput, Props>(function Input(
  { label, error, mono = false, containerStyle, style, ...rest },
  ref,
) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)

  const borderColor = error ? colors.signalRed : focused ? colors.ink : colors.line

  return (
    <View style={containerStyle}>
      {label ? <Text style={[type.caption, styles.label, { color: colors.inkMuted }]}>{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.inkFaint}
        {...rest}
        onFocus={(e) => {
          setFocused(true)
          rest.onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          rest.onBlur?.(e)
        }}
        style={[
          styles.input,
          mono ? type.mono : type.body,
          {
            color: colors.ink,
            backgroundColor: colors.surface,
            borderColor,
          },
          rest.multiline && styles.multiline,
          style,
        ]}
      />
      {error ? (
        <Text accessibilityRole="alert" style={[type.caption, styles.error, { color: colors.signalRed }]}>
          {error}
        </Text>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  label: {
    marginBottom: space.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontFamily: fonts.monoMedium,
    fontSize: 11,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    minHeight: 46,
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  error: {
    marginTop: space.xs,
  },
})
