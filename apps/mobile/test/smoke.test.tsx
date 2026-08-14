import { render, screen } from '@testing-library/react-native'
import Index from '../app/index'

test('renders placeholder', async () => {
  await render(<Index />)
  expect(screen.getByText('tada')).toBeOnTheScreen()
})
