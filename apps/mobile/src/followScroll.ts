/**
 * Follow-the-bottom bookkeeping for the live run feed.
 *
 * The feed stays chronological — oldest at the top — because agent narration reads as a sequence.
 * What makes that bearable on a long run is that the viewport sits at the newest line instead of
 * the oldest, the way a terminal or a chat log does. These helpers answer the one question that
 * drives it: is the reader still at the bottom, or have they scrolled up to read history (in
 * which case yanking them back would be hostile)?
 */

export type ScrollMetrics = {
  layoutMeasurement: { height: number }
  contentOffset: { y: number }
  contentSize: { height: number }
}

/**
 * How many pixels short of the true bottom still counts as pinned. Roughly two mono lines of
 * slack, so a fractional layout, a half-visible line, or momentum that stops a few pixels early
 * doesn't silently drop the reader out of follow mode and strand them mid-run.
 */
export const BOTTOM_SLACK = 48

/** Pixels of content below the viewport. Zero or less means there is nothing left to scroll to. */
export function distanceFromBottom(m: ScrollMetrics): number {
  return m.contentSize.height - m.contentOffset.y - m.layoutMeasurement.height
}

export function isAtBottom(m: ScrollMetrics, slack: number = BOTTOM_SLACK): boolean {
  return distanceFromBottom(m) <= slack
}
