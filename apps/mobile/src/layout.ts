import { useWindowDimensions } from 'react-native'

/** Below this the app is a single mobile column (BottomStrip); at or above it gets the web frame
 * (Rail sidebar). 1000px comfortably fits the 188px Rail plus the widest artboard content. */
export const WIDE_BREAKPOINT = 1000

/** The one responsive switch every screen frame checks. */
export function useLayout(): { wide: boolean } {
  const { width } = useWindowDimensions()
  return { wide: width >= WIDE_BREAKPOINT }
}
