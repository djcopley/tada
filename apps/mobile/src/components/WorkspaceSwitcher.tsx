import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useActiveWorkspace, useGlobalMemory, useWorkspaces } from '../api/queries'
import { useTheme } from '../design/ThemeContext'
import { radius, space, type } from '../design/tokens'
import { Icon } from './ui/Icon'
import { Menu } from './ui/Menu'
import { openNewWorkspaceDialog } from './NewWorkspaceDialog'

/** `'memory'` is passed only by the Memory screen's own `▾` trigger — the one place Global is a
 * meaningful destination, since there's no global board, ticket, or run to switch into. Every
 * other trigger (Board, Ticket, Run, Settings, ⌘K) opens with `'nav'`, which hides the row. */
export type SwitcherContext = 'memory' | 'nav'

type Listener = (context: SwitcherContext) => void
const listeners = new Set<Listener>()

/** Opens the one workspace switcher from any `▾` trigger anywhere in the app — mirrors
 * `showToast`'s module-level pub/sub so callers never need the switcher in their own tree.
 * `context` gates the Scope→Global row (see {@link SwitcherContext}); defaults to `'nav'`. */
export function openWorkspaceSwitcher(context: SwitcherContext = 'nav'): void {
  for (const listener of listeners) listener(context)
}

/**
 * One menu behind every `▾`: every workspace with its `N repos · M live` meta, a divider, and
 * `+ New workspace`. Opened with `context: 'memory'`, it also gets a Scope → Global row up top —
 * every other context hides it (see {@link SwitcherContext}). Mounted once near the app root; on
 * web, ⌘K toggles it regardless of which screen is focused (always without the Global row, since
 * the shortcut carries no screen context).
 */
export function WorkspaceSwitcher() {
  const router = useRouter()
  const { colors } = useTheme()
  const [visible, setVisible] = useState(false)
  const [showGlobal, setShowGlobal] = useState(false)
  const { data: workspaces } = useWorkspaces()
  const { data: globalMemory } = useGlobalMemory()
  const { activeWorkspaceId, setActiveWorkspaceId } = useActiveWorkspace()

  useEffect(() => {
    const listener: Listener = (context) => {
      setShowGlobal(context === 'memory')
      setVisible(true)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowGlobal(false)
        setVisible((v) => !v)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const close = () => setVisible(false)

  const selectGlobal = () => {
    close()
    router.push('/memory')
  }

  const selectWorkspace = (id: number) => {
    setActiveWorkspaceId(id)
    close()
    router.push(`/workspaces/${id}/board`)
  }

  const createWorkspace = () => {
    close()
    openNewWorkspaceDialog()
  }

  return (
    <Menu visible={visible} onClose={close} testID="workspace-switcher">
      {showGlobal ? (
        <>
          <SectionLabel>Scope</SectionLabel>
          <Row
            testID="switcher-scope-global"
            label="Global"
            meta={`${globalMemory?.notes.length ?? 0} notes · every run`}
            onPress={selectGlobal}
          />
        </>
      ) : null}

      <SectionLabel>Workspaces</SectionLabel>
      {(workspaces ?? []).map((ws) => (
        <Row
          key={ws.id}
          testID={`switcher-workspace-${ws.id}`}
          label={ws.name}
          meta={`${ws.sourceCount} ${ws.sourceCount === 1 ? 'repo' : 'repos'}`}
          liveCount={ws.runningCount}
          active={ws.id === activeWorkspaceId}
          onPress={() => selectWorkspace(ws.id)}
        />
      ))}

      <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

      <Row testID="switcher-new-workspace" label="New workspace" icon="plus" onPress={createWorkspace} />

      <View style={styles.hint}>
        <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>⌘K to switch</Text>
      </View>
    </Menu>
  )
}

function SectionLabel({ children }: { children: string }) {
  const { colors } = useTheme()
  return (
    <Text style={[type.monoCaps, styles.sectionLabel, { color: colors.textFaintSolid }]}>{children}</Text>
  )
}

function Row({
  testID,
  label,
  meta,
  liveCount,
  active = false,
  icon,
  onPress,
}: {
  testID: string
  label: string
  meta?: string
  liveCount?: number
  active?: boolean
  icon?: 'plus'
  onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        active && { backgroundColor: colors.controlBg },
        pressed && !active && { backgroundColor: colors.raised2 },
      ]}
    >
      <View style={styles.rowGlyph}>
        {active ? (
          <Icon name="check" size={14} color={colors.okText} />
        ) : icon ? (
          <Icon name={icon} size={14} color={colors.textFaintSolid} />
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        style={[type.body, styles.rowLabel, active && type.bodyStrong, { color: colors.text }]}
      >
        {label}
      </Text>
      {meta ? (
        <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>
          {meta}
          {liveCount ? (
            <>
              {' · '}
              <Text style={{ color: colors.liveText }}>{`${liveCount} live`}</Text>
            </>
          ) : null}
        </Text>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  sectionLabel: {
    paddingHorizontal: space.sm + 2,
    paddingTop: space.sm,
    paddingBottom: space.xs,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm + 2,
    borderRadius: radius.control,
  },
  rowGlyph: {
    width: 12,
    alignItems: 'center',
  },
  rowLabel: {
    flex: 1,
  },
  divider: {
    height: 1,
    marginVertical: space.sm,
    marginHorizontal: space.xs,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm + 2 + 12 + space.sm,
    paddingTop: 2,
    paddingBottom: space.sm,
  },
})
