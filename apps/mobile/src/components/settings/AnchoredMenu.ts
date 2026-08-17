import { useRef, useState } from 'react'
import type { View } from 'react-native'
import { measureInWindow } from '../../board/dnd'
import type { MenuAnchor } from '../ui'

/**
 * Menus open at their trigger (measured on press) rather than pinned to the screen top.
 * Measurement is async (a frame on native); if it never comes back (test renderers), the menu
 * opens unanchored rather than not at all.
 */
export function useAnchoredMenu() {
  const triggerRef = useRef<View>(null)
  const [visible, setVisible] = useState(false)
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)

  const open = () => {
    const view = triggerRef.current
    if (!view) {
      setAnchor(null)
      setVisible(true)
      return
    }
    let opened = false
    const show = (rect: MenuAnchor | null) => {
      if (opened) return
      opened = true
      setAnchor(rect)
      setVisible(true)
    }
    void measureInWindow(view).then(show)
    setTimeout(() => show(null), 100)
  }
  const close = () => setVisible(false)

  return { triggerRef, visible, anchor, open, close }
}
