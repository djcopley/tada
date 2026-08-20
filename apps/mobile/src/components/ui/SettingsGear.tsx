import { useRouter } from 'expo-router'
import { Pressable, StyleSheet } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius } from '../../design/tokens'
import { goToSection, type SectionKey } from '../../nav'
import { Icon } from './Icon'

type Props = {
  /** The section currently showing — the gear is lit when that's Settings. */
  active: SectionKey
  /** Strip gets a 44pt touch target; the rail's footer row is denser. */
  size?: 'strip' | 'rail'
  testID?: string
}

/**
 * Settings, in the frame's utility corner: the trailing end of the mobile BottomStrip and the
 * footer of the web Rail. It is a gear rather than a fourth word because Control/Board/Memory are
 * destinations you move between and settings is somewhere you visit — and because a fourth label
 * left every tab on a phone-width strip ellipsised ("Cont…", "Setti…").
 *
 * Still the tabs navigator's settings route, so `active` comes from navigator state and a deep
 * link lights the gear without anyone telling it to.
 */
export function SettingsGear({ active, size = 'strip', testID }: Props) {
  const router = useRouter()
  const { colors } = useTheme()
  const isActive = active === 'settings'

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="Settings"
      accessibilityState={{ selected: isActive }}
      onPress={() => goToSection(router, { key: 'settings', active })}
      hitSlop={size === 'rail' ? 8 : 0}
      style={({ pressed }) => [
        styles.base,
        size === 'rail' ? styles.rail : styles.strip,
        isActive && { backgroundColor: colors.controlBg, borderColor: colors.controlBorder },
        pressed && !isActive && { backgroundColor: colors.raised2 },
      ]}
    >
      <Icon name="settings" size={size === 'rail' ? 15 : 18} color={isActive ? colors.text : colors.textMuted} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    borderRadius: radius.control,
  },
  strip: {
    width: 44,
    alignSelf: 'stretch',
  },
  rail: {
    width: 28,
    height: 24,
    borderRadius: radius.full,
  },
})
