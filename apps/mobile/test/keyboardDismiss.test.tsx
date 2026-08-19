import { fireEvent, render, screen } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { Keyboard, Platform, Text } from 'react-native'
import { Dialog } from '../src/components/ui/Dialog'
import { Input } from '../src/components/ui/Input'
import { ThemeProvider } from '../src/design/ThemeContext'

const wrap = (node: ReactNode) => render(<ThemeProvider>{node}</ThemeProvider>)

describe('Input — iOS keyboard dismissal', () => {
  it('gives a multiline field a Done bar that dismisses the keyboard', async () => {
    if (Platform.OS !== 'ios') return
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {})
    await wrap(<Input testID="brief" multiline value="" onChangeText={() => {}} />)

    await fireEvent.press(screen.getByTestId('brief-done'))

    expect(dismiss).toHaveBeenCalled()
    dismiss.mockRestore()
  })

  it('leaves single-line fields alone — their return key already closes the keyboard', async () => {
    await wrap(<Input testID="title" value="" onChangeText={() => {}} />)
    expect(screen.queryByTestId('title-done')).toBeNull()
  })
})

describe('Dialog — keyboard escape hatch', () => {
  it('scrolls its body so a grown field cannot push the confirm button out of reach', async () => {
    await wrap(
      <Dialog visible title="New ticket" onClose={() => {}} testID="d" confirm={{ label: 'Create', onPress: () => {} }}>
        <Text>body</Text>
      </Dialog>,
    )
    expect(screen.getByTestId('d-body')).toBeTruthy()
    expect(screen.getByTestId('d-body').props.keyboardShouldPersistTaps).toBe('handled')
    expect(screen.getByText('Create')).toBeTruthy()
  })

  it('first scrim tap drops the keyboard and keeps what you typed; the next one closes', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {})
    const visible = jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true)
    const onClose = jest.fn()
    await wrap(
      <Dialog visible title="New ticket" onClose={onClose} testID="d">
        <Text>body</Text>
      </Dialog>,
    )

    await fireEvent.press(screen.getByTestId('d-scrim'))
    expect(dismiss).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    visible.mockReturnValue(false)
    await fireEvent.press(screen.getByTestId('d-scrim'))
    expect(onClose).toHaveBeenCalled()

    dismiss.mockRestore()
    visible.mockRestore()
  })
})
