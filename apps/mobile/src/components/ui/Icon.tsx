import Feather from '@expo/vector-icons/Feather'
import type { ComponentProps } from 'react'
import { useTheme } from '../../design/ThemeContext'

export type IconName = ComponentProps<typeof Feather>['name']

type Props = {
  name: IconName
  size?: number
  color?: string
}

export function Icon({ name, size = 18, color }: Props) {
  const { colors } = useTheme()
  return <Feather name={name} size={size} color={color ?? colors.ink} />
}
