import { render, screen } from '@testing-library/react-native'
import { PingsCard } from '../src/components/settings/PingsCard'
import { ThemeProvider } from '../src/design/ThemeContext'

jest.mock('../src/api/queries', () => ({
  usePatchSettings: () => ({ mutate: jest.fn() }),
}))

// useConnection() throws outside a ConnectionProvider, so the card gets a stub client rather than
// the whole provider tree — the row only ever reaches for `client`.
jest.mock('../src/ConnectionContext', () => ({
  useConnection: () => ({
    connection: null,
    client: { sendTestPing: jest.fn(), webPushPublicKey: jest.fn() },
    connect: jest.fn(),
    disconnect: jest.fn(),
  }),
}))

const settings = {
  adapter: 'claude',
  model: 'sonnet',
  effort: 'medium',
  concurrency: 2,
  timeoutMs: 1_800_000,
  pingChannel: 'push' as const,
  repingMs: 3_600_000,
}

describe('PingsCard', () => {
  it('offers the browser opt-in when push is available', async () => {
    jest.spyOn(require('../src/webPush'), 'readPushEnv').mockReturnValue({
      hasPushManager: true,
      isIos: false,
      isStandalone: false,
      permission: 'default',
    })
    await render(
      <ThemeProvider>
        <PingsCard settings={settings as never} />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('web-push-action')).toBeTruthy()
  })

  it('tells an iOS user to install before offering the button', async () => {
    jest.spyOn(require('../src/webPush'), 'readPushEnv').mockReturnValue({
      hasPushManager: true,
      isIos: true,
      isStandalone: false,
      permission: 'default',
    })
    await render(
      <ThemeProvider>
        <PingsCard settings={settings as never} />
      </ThemeProvider>,
    )
    expect(screen.getByText(/Add to Home Screen/i)).toBeTruthy()
    // "before offering the button" is half the claim: the row is there, the button is not.
    expect(screen.getByTestId('web-push-row')).toBeTruthy()
    expect(screen.queryByTestId('web-push-action')).toBeNull()
  })

  it('hides the row entirely when the browser cannot do push', async () => {
    jest.spyOn(require('../src/webPush'), 'readPushEnv').mockReturnValue({
      hasPushManager: false,
      isIos: false,
      isStandalone: false,
      permission: 'default',
    })
    await render(
      <ThemeProvider>
        <PingsCard settings={settings as never} />
      </ThemeProvider>,
    )
    // The row, not just the button: 'needs-install' and 'blocked' also render no button, so
    // asserting on the action alone would pass in states where the row is very much present.
    // getByTestId('settings-pings') is the positive control — without it this whole assertion
    // would also pass against a card that rendered nothing at all.
    expect(screen.queryByTestId('web-push-action')).toBeNull()
    expect(screen.queryByTestId('web-push-row')).toBeNull()
    expect(screen.getByTestId('settings-pings')).toBeTruthy()
  })
})
