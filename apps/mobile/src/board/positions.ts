/**
 * Computes a fractional position for a ticket inserted between two
 * neighboring positions (or at an end of the list). Used by move/reorder
 * so inserts don't require renumbering the whole column.
 */
export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1
  if (after === undefined) return (before as number) + 1
  if (before === undefined) return after - 1
  return (before + after) / 2
}
