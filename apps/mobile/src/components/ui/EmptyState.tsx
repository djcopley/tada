import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { space, type } from '../../design/tokens'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'

type Props = {
  icon: IconName
  message: string
  action?: { label: string; onPress: () => void }
  testID?: string
}

export function EmptyState({ icon, message, action, testID }: Props) {
  const { colors } = useTheme()
  return (
    <View testID={testID} style={styles.root}>
      <View style={[styles.badge, { backgroundColor: colors.raised2 }]}>
        <Icon name={icon} size={22} color={colors.textMuted} />
      </View>
      <Text style={[type.body, styles.message, { color: colors.textMuted }]}>{message}</Text>
      {action ? <Button variant="secondary" label={action.label} onPress={action.onPress} small /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.huge,
    paddingHorizontal: space.xxl,
  },
  badge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    textAlign: 'center',
  },
})
