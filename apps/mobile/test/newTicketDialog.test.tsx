import { fireEvent, render, screen } from '@testing-library/react-native'
import { NewTicketDialog } from '../src/components/NewTicketDialog'

describe('NewTicketDialog', () => {
  test('asks for a title and description and hands both to onCreate', async () => {
    const onCreate = jest.fn()
    await render(<NewTicketDialog visible onClose={() => {}} onCreate={onCreate} />)

    expect(screen.getByTestId('new-ticket-confirm')).toBeDisabled()
    await fireEvent.changeText(screen.getByTestId('new-ticket-title-input'), '  Add dark mode  ')
    await fireEvent.changeText(screen.getByTestId('new-ticket-description-input'), 'Follow the tokens in design/.')
    await fireEvent.press(screen.getByTestId('new-ticket-confirm'))

    expect(onCreate).toHaveBeenCalledWith({ title: 'Add dark mode', description: 'Follow the tokens in design/.' })
  })

  test('Enter in the title submits; an empty title does not', async () => {
    const onCreate = jest.fn()
    await render(<NewTicketDialog visible onClose={() => {}} onCreate={onCreate} />)

    await fireEvent(screen.getByTestId('new-ticket-title-input'), 'submitEditing')
    expect(onCreate).not.toHaveBeenCalled()

    await fireEvent.changeText(screen.getByTestId('new-ticket-title-input'), 'Ship it')
    await fireEvent(screen.getByTestId('new-ticket-title-input'), 'submitEditing')
    expect(onCreate).toHaveBeenCalledWith({ title: 'Ship it', description: '' })
  })
})
