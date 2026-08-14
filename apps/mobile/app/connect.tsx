import { useRouter } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native'
import { ApiError, TadaClient } from '../src/api/client'
import { Button, Input, Screen } from '../src/components/ui'
import { useConnection } from '../src/ConnectionContext'
import { useTheme } from '../src/design/ThemeContext'
import { fonts, space, type } from '../src/design/tokens'

export default function Connect() {
  const { connect } = useConnection()
  const router = useRouter()
  const { colors } = useTheme()

  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [checks, setChecks] = useState<string[]>([])

  const onConnect = async () => {
    setError(null)
    setChecks([])
    setConnecting(true)
    try {
      const client = new TadaClient({ baseUrl, token })
      // /health is auth-exempt on the server, so it only proves the server
      // is reachable — it can't catch a bad token. listWorkspaces is an
      // authenticated route; a 401 there means the token itself is wrong.
      await client.health()
      setChecks(['✓ server reachable'])
      const workspaces = await client.listWorkspaces()
      setChecks([
        '✓ server reachable',
        workspaces.length > 0
          ? `✓ ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'} found — ${workspaces
              .map((w) => w.name)
              .join(', ')}`
          : '✓ connected — no workspaces yet',
      ])
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
          <Text style={[styles.wordmarkText, { color: colors.text }]}>
            tada
            <Text style={{ color: colors.live }}>✱</Text>
          </Text>
          <Text style={[type.body, styles.tagline, { color: colors.textMuted }]}>
            Tickets in, pull requests out. tada runs against your own server — point it there to begin.
          </Text>
        </View>

        <View style={styles.form}>
          <Input
            testID="base-url-input"
            label="Server address"
            placeholder="https://tada.home-server.dev"
            mono
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={baseUrl}
            onChangeText={setBaseUrl}
          />
          <Input
            testID="token-input"
            label="API token"
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
          {checks.length > 0 && (
            <View style={styles.checks}>
              {checks.map((line) => (
                <Text key={line} style={[type.monoSmall, { color: colors.okText }]}>
                  {line}
                </Text>
              ))}
            </View>
          )}
          {error != null && (
            <Text
              testID="connect-error"
              accessibilityRole="alert"
              style={[type.caption, styles.error, { color: colors.failText }]}
            >
              {error}
            </Text>
          )}
        </View>

        <Text style={[type.caption, styles.footer, { color: colors.textFaintSolid }]}>
          Self-hosted · single user · your keys never leave your box.
        </Text>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: 'center',
    padding: space.xxl,
    gap: space.xxxl,
  },
  wordmark: {
    gap: space.md,
  },
  wordmarkText: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.6,
  },
  tagline: {
    maxWidth: 340,
  },
  form: {
    gap: space.lg,
  },
  checks: {
    gap: space.xs + 1,
  },
  error: {
    textAlign: 'center',
  },
  footer: {
    textAlign: 'center',
  },
})
