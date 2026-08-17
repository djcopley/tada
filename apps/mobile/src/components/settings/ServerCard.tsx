import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { TadaClient } from '../../api/client'
import { useConnection } from '../../ConnectionContext'
import { useTheme } from '../../design/ThemeContext'
import { type } from '../../design/tokens'
import { maskToken } from '../../settingsScreen'
import { showToast } from '../../toast'
import { Button, Dialog, Input } from '../ui'
import { SettingsRow, SettingsSection } from './SettingsSection'

/** Server: where the app points and the token it uses. Disconnect sends you back to Connect;
 * Replace swaps the token in place after verifying it against the server. */
export function ServerCard() {
  const { colors } = useTheme()
  const { connection, connect, disconnect } = useConnection()
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [showReplace, setShowReplace] = useState(false)
  const [newToken, setNewToken] = useState('')
  const [replacing, setReplacing] = useState(false)

  const closeReplace = () => {
    setShowReplace(false)
    setNewToken('')
  }

  const handleReplace = async () => {
    const trimmed = newToken.trim()
    if (!trimmed || !connection) return
    setReplacing(true)
    try {
      // Validate the new token against the server before persisting it — an unauthenticated
      // route wouldn't catch a typo'd token.
      await new TadaClient({ baseUrl: connection.baseUrl, token: trimmed }).status()
      await connect({ baseUrl: connection.baseUrl, token: trimmed })
      closeReplace()
    } catch {
      showToast('Could not verify the new token')
    } finally {
      setReplacing(false)
    }
  }

  const host = connection?.baseUrl.replace(/^https?:\/\//, '') ?? '—'

  return (
    <SettingsSection title="Server" testID="settings-server">
      <SettingsRow>
        <Text style={[type.caption, styles.label, { color: colors.text }]}>Server</Text>
        <View style={[styles.dot, { backgroundColor: colors.ok }]} />
        <Text numberOfLines={1} testID="server-host" style={[type.monoSmall, styles.shrink, { color: colors.textMuted }]}>
          {host}
        </Text>
        <View style={styles.flex1} />
        <Button testID="disconnect-button" variant="destructive" small label="Disconnect" onPress={() => setConfirmDisconnect(true)} />
      </SettingsRow>
      <SettingsRow last>
        <Text style={[type.caption, styles.label, { color: colors.text }]}>API token</Text>
        <Text testID="masked-token" numberOfLines={1} style={[type.monoSmall, styles.shrink, { color: colors.textMuted }]}>
          {connection ? maskToken(connection.token) : '—'}
        </Text>
        <View style={styles.flex1} />
        <Button testID="open-replace-token" variant="secondary" small label="Replace" onPress={() => setShowReplace(true)} />
      </SettingsRow>

      <Dialog
        visible={confirmDisconnect}
        title="Disconnect from server?"
        onClose={() => setConfirmDisconnect(false)}
        confirm={{
          label: 'Disconnect',
          destructive: true,
          onPress: () => {
            setConfirmDisconnect(false)
            void disconnect()
          },
          testID: 'disconnect-confirm',
        }}
      >
        <Text style={[type.body, { color: colors.textMuted }]}>
          {"You'll be sent back to the connect screen. Nothing on the server is touched."}
        </Text>
      </Dialog>

      <Dialog
        visible={showReplace}
        title="Replace API token"
        onClose={closeReplace}
        testID="replace-token-dialog"
        confirm={{
          label: 'Replace',
          onPress: () => void handleReplace(),
          disabled: replacing || newToken.trim().length === 0,
          loading: replacing,
          testID: 'replace-token-confirm',
        }}
      >
        <Input testID="replace-token-input" label="API token" mono secureTextEntry autoFocus value={newToken} onChangeText={setNewToken} />
      </Dialog>
    </SettingsSection>
  )
}

const styles = StyleSheet.create({
  label: { fontWeight: '500', width: 70 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  flex1: { flex: 1 },
  shrink: { flexShrink: 1 },
})
