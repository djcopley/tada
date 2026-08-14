import type { ReactNode } from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../design/ThemeContext'

type Props = {
  children: ReactNode
  /** Edges to pad with safe-area insets. Top defaults on because most screens own their header. */
  edges?: ('top' | 'bottom')[]
  style?: ViewStyle
  testID?: string
}

/** Themed screen container: background color + safe-area padding. */
export function Screen({ children, edges = ['top'], style, testID }: Props) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  return (
    <View
      testID={testID}
      style={[
        styles.root,
        {
          backgroundColor: colors.bg,
          paddingTop: edges.includes('top') ? insets.top : 0,
          paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
