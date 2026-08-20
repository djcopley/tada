import { repairInsets } from '../src/design/webSafeArea'

const NONE = { top: 0, bottom: 0, left: 0, right: 0 }

// Measured in the running app on an iPhone 16 Pro (iOS 26), launched from the home screen. The
// insets describe an 874pt-tall view; the view is really 812pt and flush to the top, so the
// bottom 62pt of the screen is not ours.
const IPHONE_16_PRO = { standalone: true, screenHeight: 874, innerHeight: 812, screenY: 0 }
const REPORTED = { ...NONE, top: 62, bottom: 34 }

describe('repairInsets', () => {
  it('drops a bottom inset the uncovered strip already clears', () => {
    // 62pt of screen sits below the view, so the home indicator is nowhere near our last pixel.
    expect(repairInsets(REPORTED, IPHONE_16_PRO).bottom).toBe(0)
  })

  it('clears the status bar and the scroll edge effect below it', () => {
    // iOS reports the 62pt status bar honestly; the effect that blurs content for another ~28pt
    // below it is not reported anywhere, so it is added on.
    expect(repairInsets(REPORTED, IPHONE_16_PRO).top).toBe(90)
  })

  it('floors the top when iOS reports no inset at all', () => {
    // What a page installed without a manifest measured: the status bar is composited over us
    // regardless, so the withheld height is the padding we need, plus the same feather.
    expect(repairInsets(NONE, IPHONE_16_PRO).top).toBe(90)
  })

  it('subtracts only as far as zero', () => {
    const bigBottom = { ...NONE, top: 62, bottom: 120 }
    expect(repairInsets(bigBottom, IPHONE_16_PRO).bottom).toBe(58)
  })

  it('leaves a browser tab alone', () => {
    const tab = { ...IPHONE_16_PRO, standalone: false }
    expect(repairInsets(REPORTED, tab)).toBe(REPORTED)
  })

  it('leaves consistent insets untouched, preserving identity', () => {
    const covered = { ...IPHONE_16_PRO, innerHeight: 874 }
    expect(repairInsets(REPORTED, covered)).toBe(REPORTED)
  })

  it('bails when the withheld strip is above us rather than below', () => {
    // screenY > 0 means the view was offset down instead of shortened, and both corrections would
    // be backwards.
    expect(repairInsets(REPORTED, { ...IPHONE_16_PRO, screenY: 62 })).toBe(REPORTED)
  })

  it('ignores a gap too large to be a status bar', () => {
    // A rotation caught mid-measure: screen.height stays portrait while innerHeight is landscape.
    expect(repairInsets(REPORTED, { ...IPHONE_16_PRO, innerHeight: 402 })).toBe(REPORTED)
  })
})
