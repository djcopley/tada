import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native'
import { ApiError, TadaClient } from '../src/api/client'
import { Button, Input, Screen } from '../src/components/ui'
import { useConnection } from '../src/ConnectionContext'
import { buildTheme, ThemeContext } from '../src/design/ThemeContext'
import { day, fonts, space, type } from '../src/design/tokens'

type CheckLine = { text: string; muted: boolean }

export default function Connect() {
  const { connect } = useConnection()
  const router = useRouter()
  // Connect always renders in the light "paper day" palette — this is the one screen that
  // ignores the stored night/day scheme. A local ThemeContext override (rather than reading
  // useTheme() here) means the shared Input/Button primitives below also resolve day colors,
  // without ever flipping the persisted scheme other screens see.
  const colors = day
  const dayTheme = useMemo(() => buildTheme('day'), [])

  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [checks, setChecks] = useState<CheckLine[]>([])

  const onConnect = async () => {
    setError(null)
    setChecks([])
    setConnecting(true)
    try {
      const client = new TadaClient({ baseUrl, token })
      // /health is auth-exempt on the server, so it only proves the server
      // is reachable — it can't catch a bad token. /status is an
      // authenticated route; a 401 there means the token itself is wrong.
      const health = await client.health()
      setChecks([{ text: `✓ server reachable · v${health.version}`, muted: false }])

      const status = await client.status()
      const names = status.workspaces
      const workspacesLine =
        names.length > 0
          ? `✓ ${names.length} workspace${names.length === 1 ? '' : 's'} found — ${names.join(', ')}`
          : '✓ connected — no workspaces yet'
      const hasAgentKeys = status.agents.some((a) => a.available)
      const agentsLine = hasAgentKeys
        ? '✓ agent keys present on the server'
        : '— no agent keys on the server yet'

      setChecks([
        { text: `✓ server reachable · v${health.version}`, muted: false },
        { text: workspacesLine, muted: false },
        { text: agentsLine, muted: !hasAgentKeys },
      ])

      // Missing agent keys don't block the connection — the server is reachable and the
      // token is valid; the user can add keys later.
      await connect({ baseUrl, token })
      router.replace('/workspaces')
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Invalid token' : 'Could not reach server')
    } finally {
      setConnecting(false)
    }
  }

  return (
    <ThemeContext.Provider value={dayTheme}>
      <Screen testID="connect-screen" edges={['top', 'bottom']} style={{ backgroundColor: colors.ground }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.body}
        >
          <View style={styles.column}>
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
                    <Text
                      key={line.text}
                      style={[type.monoSmall, { color: line.muted ? colors.textFaintSolid : colors.okText }]}
                    >
                      {line.text}
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
          </View>
        </KeyboardAvoidingView>
      </Screen>
    </ThemeContext.Provider>
  )
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.xxl,
  },
  // Artboard is a ~460px column (tada-build.dc.html #connect) — desktop/web widths otherwise
  // stretch the form the full viewport width. Mobile stays full-width since 460 exceeds phone
  // screens and `maxWidth` is a no-op there.
  column: {
    width: '100%',
    maxWidth: 460,
    gap: space.xxxl,
  },
  wordmark: {
    gap: space.md,
  },
  wordmarkText: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 30,
    lineHeight: 30,
    letterSpacing: -0.5,
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
