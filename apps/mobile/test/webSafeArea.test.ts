import { withheldTopFrom } from '../src/design/webSafeArea'

// iPhone 16 Pro, iOS 26, launched from the home screen: iOS takes the status bar's height out of
// the view but leaves the view's origin at the top of the screen, and reports no safe-area inset.
const IPHONE_16_PRO_STANDALONE = { standalone: true, screenHeight: 874, innerHeight: 812 }

describe('withheldTopFrom', () => {
  it('recovers the height iOS withheld from an installed PWA', () => {
    expect(withheldTopFrom(IPHONE_16_PRO_STANDALONE)).toBe(62)
  })

  it('contributes nothing in a browser tab, where the inset is reported properly', () => {
    expect(withheldTopFrom({ ...IPHONE_16_PRO_STANDALONE, standalone: false })).toBe(0)
  })

  it('contributes nothing when the view already covers the screen', () => {
    expect(withheldTopFrom({ standalone: true, screenHeight: 874, innerHeight: 874 })).toBe(0)
  })

  it('ignores a gap too large to be a status bar rather than pushing the app down', () => {
    // A rotation caught mid-measure: screen.height stays portrait while innerHeight is landscape.
    expect(withheldTopFrom({ standalone: true, screenHeight: 874, innerHeight: 402 })).toBe(0)
  })

  it('ignores a negative gap', () => {
    expect(withheldTopFrom({ standalone: true, screenHeight: 812, innerHeight: 874 })).toBe(0)
  })
})
