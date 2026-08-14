import { useRouter } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native'
import { ApiError, TadaClient } from '../src/api/client'
import { Button, Input, Screen } from '../src/components/ui'
import { useConnection } from '../src/ConnectionContext'
import { useTheme } from '../src/design/ThemeContext'
import { space, type } from '../src/design/tokens'

export default function Connect() {
  const { connect } = useConnection()
  const router = useRouter()
  const { colors } = useTheme()

  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const onConnect = async () => {
    setError(null)
    setConnecting(true)
    try {
      const client = new TadaClient({ baseUrl, token })
      // /health is auth-exempt on the server, so it only proves the server
      // is reachable — it can't catch a bad token. listWorkspaces is an
      // authenticated route; a 401 there means the token itself is wrong.
      await client.health()
      await client.listWorkspaces()
      await connect({ baseUrl, token })
      router.replace('/workspaces')
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Invalid token' : 'Could not reach server')
    } finally {
      setConnecting(false)
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.body}
      >
        <View style={styles.wordmark}>
          <View style={[styles.wordmarkFlag, { backgroundColor: colors.ink }]}>
            <Text style={[type.display, styles.wordmarkText, { color: colors.onInk }]}>tada</Text>
          </View>
          <Text style={[type.monoSmall, { color: colors.inkMuted }]}>DISPATCH DESK FOR CODING AGENTS</Text>
        </View>

        <View style={styles.form}>
          <Input
            testID="base-url-input"
            label="Server URL"
            placeholder="https://tada.your-tailnet.ts.net"
            mono
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={baseUrl}
            onChangeText={setBaseUrl}
          />
          <Input
            testID="token-input"
            label="Token"
            placeholder="Paste your server token"
            mono
            secureTextEntry
            value={token}
            onChangeText={setToken}
          />
          <Button
            testID="connect-button"
            label="Connect"
            onPress={() => void onConnect()}
            loading={connecting}
          />
          {error != null && (
            <Text
              testID="connect-error"
              accessibilityRole="alert"
              style={[type.caption, styles.error, { color: colors.signalRed }]}
            >
              {error}
            </Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: 'center',
    padding: space.xxl,
    gap: space.huge,
  },
  wordmark: {
    alignItems: 'center',
    gap: space.md,
  },
  wordmarkFlag: {
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderRadius: 4,
  },
  wordmarkText: {
    fontSize: 34,
    lineHeight: 42,
    letterSpacing: 2,
    textTransform: 'lowercase',
  },
  form: {
    gap: space.lg,
  },
  error: {
    textAlign: 'center',
  },
})
