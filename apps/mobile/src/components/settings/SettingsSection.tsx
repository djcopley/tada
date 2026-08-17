import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { space, type } from '../../design/tokens'
import { Card } from '../ui'

type Props = {
  title: string
  /** Sans intro copy between the caps label and the card. */
  intro?: ReactNode
  children: ReactNode
  testID?: string
}

/** A settings section: mono caps label, optional intro copy, one Card of rows. */
export function SettingsSection({ title, intro, children, testID }: Props) {
  const { colors } = useTheme()
  return (
    <View style={styles.section} testID={testID}>
      <Text style={[type.monoCaps, styles.title, { color: colors.textFaintSolid }]}>{title}</Text>
      {intro}
      <Card style={styles.card}>{children}</Card>
    </View>
  )
}

/** One row inside a section card, with a hairline under it unless it's the last. */
export function SettingsRow({ children, last = false, testID }: { children: ReactNode; last?: boolean; testID?: string }) {
  const { colors } = useTheme()
  return (
    <View
      testID={testID}
      style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle }]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: space.sm,
    width: '100%',
    maxWidth: 680,
  },
  title: {
    textTransform: 'uppercase',
  },
  card: {
    gap: 0,
    paddingVertical: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingVertical: space.sm + 2,
  },
})
