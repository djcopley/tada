import { fireEvent, render, screen } from '@testing-library/react-native'
import { Text, View } from 'react-native'
import { FollowingScroll } from '../src/components/run/FollowingScroll'
import { ThemeProvider } from '../src/design/ThemeContext'
import { BOTTOM_SLACK, distanceFromBottom, isAtBottom } from '../src/followScroll'

const metrics = (y: number, contentHeight = 2000, viewport = 400) => ({
  layoutMeasurement: { height: viewport },
  contentOffset: { y },
  contentSize: { height: contentHeight },
})

describe('isAtBottom', () => {
  test('pinned exactly at the bottom', () => {
    expect(distanceFromBottom(metrics(1600))).toBe(0)
    expect(isAtBottom(metrics(1600))).toBe(true)
  })

  test('a hair off the bottom still counts as pinned', () => {
    expect(isAtBottom(metrics(1600 - (BOTTOM_SLACK - 1)))).toBe(true)
  })

  test('scrolled up past the slack is not pinned', () => {
    expect(isAtBottom(metrics(1600 - (BOTTOM_SLACK + 1)))).toBe(false)
    expect(isAtBottom(metrics(0))).toBe(false)
  })

  test('content shorter than the viewport is always pinned', () => {
    expect(isAtBottom(metrics(0, 120, 400))).toBe(true)
  })
})

const renderScroll = () =>
  render(
    <ThemeProvider>
      <FollowingScroll testID="feed-scroll">
        <View>
          <Text>oldest</Text>
          <Text>newest</Text>
        </View>
      </FollowingScroll>
    </ThemeProvider>,
  )

describe('FollowingScroll', () => {
  test('renders its children and offers no jump pill while pinned to the bottom', async () => {
    await renderScroll()
    expect(screen.getByText('newest')).toBeTruthy()
    expect(screen.queryByTestId('feed-scroll-jump')).toBeNull()
  })

  test('scrolling up to read history offers the jump pill', async () => {
    await renderScroll()
    await fireEvent.scroll(screen.getByTestId('feed-scroll'), { nativeEvent: metrics(0) })
    expect(screen.getByTestId('feed-scroll-jump')).toBeTruthy()
  })

  test('scrolling back down to the bottom retires the pill', async () => {
    await renderScroll()
    await fireEvent.scroll(screen.getByTestId('feed-scroll'), { nativeEvent: metrics(0) })
    expect(screen.getByTestId('feed-scroll-jump')).toBeTruthy()
    await fireEvent.scroll(screen.getByTestId('feed-scroll'), { nativeEvent: metrics(1600) })
    expect(screen.queryByTestId('feed-scroll-jump')).toBeNull()
  })

  test('pressing the pill retires it and resumes following', async () => {
    await renderScroll()
    await fireEvent.scroll(screen.getByTestId('feed-scroll'), { nativeEvent: metrics(0) })
    await fireEvent.press(screen.getByTestId('feed-scroll-jump'))
    expect(screen.queryByTestId('feed-scroll-jump')).toBeNull()
  })
})
