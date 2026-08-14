import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Button, StyleSheet, Text, TextInput, View } from 'react-native'
import { ApiError, TadaClient } from '../src/api/client'
import { useConnection } from '../src/ConnectionContext'

export default function Connect() {
  const { connect } = useConnection()
  const router = useRouter()

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
    <View style={styles.container}>
      <TextInput
        testID="base-url-input"
        style={styles.input}
        placeholder="Server URL"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={baseUrl}
        onChangeText={setBaseUrl}
      />
      <TextInput
        testID="token-input"
        style={styles.input}
        placeholder="Token"
        secureTextEntry
        value={token}
        onChangeText={setToken}
      />
      <Button testID="connect-button" title="Connect" onPress={onConnect} disabled={connecting} />
      {error != null && (
        <Text testID="connect-error" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
    borderRadius: 6,
    padding: 10,
  },
  error: {
    color: 'red',
  },
})
