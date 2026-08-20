export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** A display's usable area, as reported by Electron's `screen.getAllDisplays()[n].workArea`. */
export type DisplayArea = Bounds

export const DEFAULT_SIZE = { width: 1200, height: 860 }
const MIN_SIZE = { width: 600, height: 480 }

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Reads the saved bounds file. Anything unrecognisable is treated as "no saved bounds". */
export function parseBounds(raw: string | null): Bounds | null {
  if (raw === null) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { x, y, width, height } = value as Record<string, unknown>
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null
  return { x, y, width, height }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function onSomeDisplay(saved: Bounds, displays: DisplayArea[]): boolean {
  // The origin being inside a work area is enough: a window dragged slightly off the edge is
  // still reachable, whereas one whose whole frame is off-screen is not.
  return displays.some(
    (d) => saved.x >= d.x && saved.x < d.x + d.width && saved.y >= d.y && saved.y < d.y + d.height,
  )
}

/**
 * What to hand BrowserWindow at launch. Omitting x/y lets Electron centre the window, which is
 * what we want when the saved position points at a monitor that is no longer attached — otherwise
 * the app opens somewhere the user cannot see or reach it.
 */
export function restoreBounds(
  saved: Bounds | null,
  displays: DisplayArea[],
): { width: number; height: number; x?: number; y?: number } {
  if (!saved) return { ...DEFAULT_SIZE }

  const widest = Math.max(MIN_SIZE.width, ...displays.map((d) => d.width))
  const tallest = Math.max(MIN_SIZE.height, ...displays.map((d) => d.height))
  const size = {
    width: clamp(saved.width, MIN_SIZE.width, widest),
    height: clamp(saved.height, MIN_SIZE.height, tallest),
  }

  if (!onSomeDisplay(saved, displays)) return size
  return { ...size, x: saved.x, y: saved.y }
}
