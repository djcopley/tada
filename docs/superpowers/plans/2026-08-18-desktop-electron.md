# tada Desktop (Electron shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@tada/desktop`, an Electron window that runs the existing `@tada/mobile` web build and shows an OS notification when a run stops on you.

**Architecture:** A new pnpm workspace package at `apps/desktop`. The Electron main process serves the Expo static export (`apps/mobile/dist`) over a privileged `app://` scheme and loads `app://tada/`; a sandboxed preload exposes one bridge object (`window.tadaDesktop`) with `notify` and `onOpenRun`. The mobile app gains a capability module that uses that bridge when it exists and does nothing everywhere else. All non-trivial main-process logic lives in pure modules tested with vitest; `main.ts`/`preload.cts` stay thin wiring.

**Tech Stack:** Electron 43, electron-builder 26, TypeScript (NodeNext ESM), vitest (desktop/server/shared), jest + @testing-library/react-native (mobile), Biome.

**Spec:** `docs/superpowers/specs/2026-08-18-desktop-electron-design.md`

## Global Constraints

- Node >= 22 (root `engines`). Local toolchain is Node 24.
- pnpm workspace; packages live under `apps/*` and `packages/*` (`pnpm-workspace.yaml`).
- `apps/desktop` extends `tsconfig.base.json`: `module`/`moduleResolution` **NodeNext**, `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. **Relative imports carry a `.js` extension** (`./bundle.js`) — same rule as `apps/server` and `packages/shared`.
- Biome formats and lints `apps/desktop` automatically (only `apps/mobile` is excluded in `biome.json`): single quotes, no semicolons, 100 columns, 2-space indent. `apps/mobile` uses `eslint-config-expo`.
- Renderer security is non-negotiable: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. A sandboxed preload **must be CommonJS** — hence `preload.cts` → `dist/preload.cjs`.
- No changes to `apps/server` beyond moving `holdPingText` into `@tada/shared` (Task 5). No new server route, no schema change, no migration.
- Design tokens: never introduce a raw hex literal in a mobile component. (No new mobile UI in this plan, but the rule stands.)
- Never add AI attribution to commit messages.
- Commit messages: conventional prefixes as used in the repo (`feat:`, `feat(desktop):`, `refactor:`, `chore:`).

---

### Task 1: Package scaffold and the bundle path resolver

Creates the package and its first pure module: mapping an `app://tada/<path>` request onto a file inside the Expo static export, with a path-traversal guard.

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/vitest.config.ts`
- Create: `apps/desktop/.gitignore`
- Create: `apps/desktop/src/bundle.ts`
- Test: `apps/desktop/test/bundle.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveBundlePath(root: string, pathname: string, isFile: (p: string) => boolean): string | null` — absolute path to serve, or `null` when the request escapes `root`.

- [ ] **Step 1: Create the package manifest**

`apps/desktop/package.json`:

```json
{
  "name": "@tada/desktop",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "electron": "^43.0.0",
    "electron-builder": "^26.0.0",
    "vitest": "^3.0.0"
  }
}
```

`apps/desktop/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src", "test"]
}
```

`apps/desktop/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { passWithNoTests: true },
})
```

`apps/desktop/.gitignore`:

```
dist
release
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: `apps/desktop` resolves; Electron downloads its binary (first install is slow).

- [ ] **Step 3: Write the failing test**

`apps/desktop/test/bundle.test.ts`:

```ts
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { resolveBundlePath } from '../src/bundle.js'

const ROOT = '/bundle'
const files = new Set([
  path.join(ROOT, 'index.html'),
  path.join(ROOT, 'board.html'),
  path.join(ROOT, 'runs', '[id]', 'index.html'),
  path.join(ROOT, '_expo', 'static', 'js', 'app.js'),
])
const isFile = (p: string) => files.has(p)

describe('resolveBundlePath', () => {
  test('serves index.html for the root', () => {
    expect(resolveBundlePath(ROOT, '/', isFile)).toBe(path.join(ROOT, 'index.html'))
  })

  test('serves an exact asset hit', () => {
    expect(resolveBundlePath(ROOT, '/_expo/static/js/app.js', isFile)).toBe(
      path.join(ROOT, '_expo', 'static', 'js', 'app.js'),
    )
  })

  test('serves the .html sibling Expo writes per route', () => {
    expect(resolveBundlePath(ROOT, '/board', isFile)).toBe(path.join(ROOT, 'board.html'))
  })

  test('serves a directory index', () => {
    expect(resolveBundlePath(ROOT, '/runs/[id]', isFile)).toBe(
      path.join(ROOT, 'runs', '[id]', 'index.html'),
    )
  })

  test('falls back to index.html so client-side routes resolve', () => {
    expect(resolveBundlePath(ROOT, '/tickets/42', isFile)).toBe(path.join(ROOT, 'index.html'))
  })

  test('decodes percent-encoded paths', () => {
    expect(resolveBundlePath(ROOT, '/runs/%5Bid%5D', isFile)).toBe(
      path.join(ROOT, 'runs', '[id]', 'index.html'),
    )
  })

  test('rejects a path that escapes the bundle', () => {
    expect(resolveBundlePath(ROOT, '/../../etc/passwd', isFile)).toBeNull()
    expect(resolveBundlePath(ROOT, '/..%2f..%2fetc/passwd', isFile)).toBeNull()
  })

  test('rejects a malformed escape rather than throwing', () => {
    expect(resolveBundlePath(ROOT, '/%E0%A4%A', isFile)).toBeNull()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @tada/desktop exec vitest run test/bundle.test.ts`
Expected: FAIL — cannot resolve `../src/bundle.js`.

- [ ] **Step 5: Write the implementation**

`apps/desktop/src/bundle.ts`:

```ts
import path from 'node:path'

/**
 * Maps an `app://tada/<pathname>` request onto a file inside the Expo static export.
 *
 * Resolution order matters: an exact hit serves assets, `<path>.html` serves the per-route files
 * `expo export --platform web` writes, a directory's `index.html` covers nested routes, and
 * `index.html` is the SPA fallback — without it every expo-router path that was pushed with
 * history.pushState would 404 on reload.
 *
 * `isFile` is injected so the resolution order is testable without a real bundle on disk.
 * Returns null for anything that escapes `root`: `app://tada/../../secret` must never be served.
 */
export function resolveBundlePath(
  root: string,
  pathname: string,
  isFile: (p: string) => boolean,
): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // A malformed escape is a bad request, not a crash in the protocol handler.
    return null
  }

  const relative = decoded.replace(/^\/+/, '')
  const target = path.resolve(root, relative)
  const inside = path.relative(root, target)
  if (inside.startsWith('..') || path.isAbsolute(inside)) return null

  const fallback = path.join(root, 'index.html')
  if (relative === '') return fallback

  for (const candidate of [target, `${target}.html`, path.join(target, 'index.html')]) {
    if (isFile(candidate)) return candidate
  }
  return fallback
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @tada/desktop exec vitest run test/bundle.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Check the whole repo is still green**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS. Fix any Biome complaints with `pnpm format`.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop pnpm-lock.yaml
git commit -m "feat(desktop): scaffold @tada/desktop with the bundle path resolver"
```

---

### Task 2: External-link decision

Where a URL should open: in the window, in the system browser, or nowhere.

**Files:**
- Create: `apps/desktop/src/links.ts`
- Test: `apps/desktop/test/links.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type LinkDecision = 'internal' | 'external' | 'block'` and `linkDecision(url: string, appOrigin: string): LinkDecision`.

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/links.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { linkDecision } from '../src/links.js'

const APP = 'app://tada'
const DEV = 'http://localhost:8081'

describe('linkDecision', () => {
  test('keeps the app itself in the window', () => {
    expect(linkDecision('app://tada/board', APP)).toBe('internal')
    expect(linkDecision('http://localhost:8081/board', DEV)).toBe('internal')
  })

  test('sends other http(s) URLs to the system browser', () => {
    expect(linkDecision('https://github.com/tada/pull/1', APP)).toBe('external')
    expect(linkDecision('http://192.168.1.20:4300/health', APP)).toBe('external')
  })

  test('sends a different origin out even on the same scheme', () => {
    expect(linkDecision('http://localhost:9999/', DEV)).toBe('external')
  })

  test('blocks schemes that are neither the app nor the web', () => {
    expect(linkDecision('file:///etc/passwd', APP)).toBe('block')
    expect(linkDecision('javascript:alert(1)', APP)).toBe('block')
    expect(linkDecision('app://evil/', APP)).toBe('block')
  })

  test('blocks anything unparseable', () => {
    expect(linkDecision('not a url', APP)).toBe('block')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tada/desktop exec vitest run test/links.test.ts`
Expected: FAIL — cannot resolve `../src/links.js`.

- [ ] **Step 3: Write the implementation**

`apps/desktop/src/links.ts`:

```ts
export type LinkDecision = 'internal' | 'external' | 'block'

/**
 * Where a URL belongs. `appOrigin` is the window's own origin — `app://tada` when serving the
 * bundle, the Expo dev server when TADA_DESKTOP_DEV is set.
 *
 * Everything that is not the app itself and not a plain web URL is blocked rather than handed to
 * the OS: `shell.openExternal` will happily launch a `file://` or custom-scheme URL, so a link in
 * a run transcript could otherwise open something on this machine.
 */
export function linkDecision(url: string, appOrigin: string): LinkDecision {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'block'
  }
  if (parsed.origin === appOrigin) return 'internal'
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return 'external'
  return 'block'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tada/desktop exec vitest run test/links.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): decide in-window vs system-browser vs blocked links"
```

---

### Task 3: Window bounds persistence

Remember where the window was; never restore it onto a monitor that is gone.

**Files:**
- Create: `apps/desktop/src/bounds.ts`
- Test: `apps/desktop/test/bounds.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Bounds { x: number; y: number; width: number; height: number }`
  - `interface DisplayArea { x: number; y: number; width: number; height: number }`
  - `const DEFAULT_SIZE: { width: number; height: number }`
  - `parseBounds(raw: string | null): Bounds | null`
  - `restoreBounds(saved: Bounds | null, displays: DisplayArea[]): { width: number; height: number; x?: number; y?: number }`

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/bounds.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { DEFAULT_SIZE, parseBounds, restoreBounds } from '../src/bounds.js'

const MAIN = { x: 0, y: 0, width: 1920, height: 1080 }
const SECOND = { x: 1920, y: 0, width: 1440, height: 900 }

describe('parseBounds', () => {
  test('reads a saved record', () => {
    expect(parseBounds('{"x":10,"y":20,"width":800,"height":600}')).toEqual({
      x: 10,
      y: 20,
      width: 800,
      height: 600,
    })
  })

  test('rejects absent, malformed and incomplete records', () => {
    expect(parseBounds(null)).toBeNull()
    expect(parseBounds('not json')).toBeNull()
    expect(parseBounds('{"x":10,"y":20}')).toBeNull()
    expect(parseBounds('{"x":10,"y":20,"width":"800","height":600}')).toBeNull()
  })
})

describe('restoreBounds', () => {
  test('falls back to the default size with no saved bounds', () => {
    expect(restoreBounds(null, [MAIN])).toEqual(DEFAULT_SIZE)
  })

  test('restores bounds that sit on an attached display', () => {
    const saved = { x: 100, y: 80, width: 1000, height: 700 }
    expect(restoreBounds(saved, [MAIN, SECOND])).toEqual(saved)
  })

  test('drops the position when the display it was on is gone', () => {
    const saved = { x: 2200, y: 100, width: 1000, height: 700 }
    expect(restoreBounds(saved, [MAIN])).toEqual({ width: 1000, height: 700 })
  })

  test('clamps a window larger than every display', () => {
    const saved = { x: 0, y: 0, width: 4000, height: 3000 }
    expect(restoreBounds(saved, [MAIN])).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  test('clamps a window too small to use', () => {
    const saved = { x: 0, y: 0, width: 120, height: 90 }
    expect(restoreBounds(saved, [MAIN])).toEqual({ x: 0, y: 0, width: 600, height: 480 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tada/desktop exec vitest run test/bounds.test.ts`
Expected: FAIL — cannot resolve `../src/bounds.js`.

- [ ] **Step 3: Write the implementation**

`apps/desktop/src/bounds.ts`:

```ts
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
    (d) =>
      saved.x >= d.x && saved.x < d.x + d.width && saved.y >= d.y && saved.y < d.y + d.height,
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tada/desktop exec vitest run test/bounds.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): remember window bounds, clamped to attached displays"
```

---

### Task 4: The Electron shell — main process, preload, dev script

Wires Tasks 1-3 into a runnable window. No new automated tests: this task is thin wiring plus Electron APIs, and it is verified by running it.

**Files:**
- Create: `apps/desktop/src/main.ts`
- Create: `apps/desktop/src/preload.cts`
- Create: `apps/desktop/tsconfig.build.json`
- Modify: `apps/desktop/package.json` (add `dev`, `compile`, and dependencies)
- Modify: `README.md` (a short "Desktop" section)

**Interfaces:**
- Consumes: `resolveBundlePath` (Task 1), `linkDecision` (Task 2), `parseBounds` / `restoreBounds` / `DEFAULT_SIZE` (Task 3).
- Produces: the renderer bridge contract that Task 6 consumes —

```ts
interface TadaDesktopBridge {
  notify(n: { title: string; body: string; runId?: number }): void
  onOpenRun(cb: (runId: number) => void): () => void
}
// available as window.tadaDesktop
```

  and the IPC channel names `tada:notify` (renderer → main) and `tada:open-run` (main → renderer).

- [ ] **Step 1: Add the build tsconfig and scripts**

`apps/desktop/tsconfig.build.json` — the emitting config (the root `tsconfig.json` is `noEmit` for typechecking, and must not try to emit the tests):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

Add to `apps/desktop/package.json` `scripts`:

```json
    "compile": "tsc -p tsconfig.build.json",
    "dev": "concurrently -k -n expo,electron \"pnpm --filter @tada/mobile web\" \"wait-on http://localhost:8081 && pnpm compile && TADA_DESKTOP_DEV=1 electron .\""
```

and to `devDependencies`:

```json
    "concurrently": "^10.0.0",
    "wait-on": "^9.0.0"
```

Run: `pnpm install`

- [ ] **Step 2: Write the preload**

`apps/desktop/src/preload.cts` — `.cts` on purpose: `tsc` emits `dist/preload.cjs`, and a **sandboxed preload must be CommonJS**.

```ts
import { contextBridge, ipcRenderer } from 'electron'

interface DesktopNotification {
  title: string
  body: string
  runId?: number
}

/**
 * The entire surface the renderer gets. Deliberately two functions and no `ipcRenderer` handle:
 * the renderer is the web build, which is also served to browsers, so it must not be able to
 * reach anything here that a browser could not do.
 */
contextBridge.exposeInMainWorld('tadaDesktop', {
  notify(n: DesktopNotification): void {
    ipcRenderer.send('tada:notify', n)
  },
  onOpenRun(cb: (runId: number) => void): () => void {
    const listener = (_event: unknown, runId: number) => cb(runId)
    ipcRenderer.on('tada:open-run', listener)
    return () => {
      ipcRenderer.removeListener('tada:open-run', listener)
    }
  },
})
```

- [ ] **Step 3: Write the main process**

`apps/desktop/src/main.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  net,
  Notification,
  protocol,
  screen,
  shell,
} from 'electron'
import { parseBounds, restoreBounds } from './bounds.js'
import { resolveBundlePath } from './bundle.js'
import { linkDecision } from './links.js'

const DEV = process.env.TADA_DESKTOP_DEV === '1'
const DEV_URL = 'http://localhost:8081'
const APP_ORIGIN = 'app://tada'
const APP_URL = `${APP_ORIGIN}/`
const appOrigin = DEV ? DEV_URL : APP_ORIGIN

/**
 * Must run before app.whenReady(). A *standard, secure* scheme (rather than file://) is what gives
 * the renderer a stable origin — localStorage holds the server connection, and it is keyed by
 * origin — plus a secure context and a working fetch/WebSocket to the tada server.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

/** Packaged: the bundle ships in Resources/web. Dev build: the sibling mobile export. */
function bundleRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.resolve(import.meta.dirname, '../../mobile/dist')
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

const boundsFile = () => path.join(app.getPath('userData'), 'window-bounds.json')

function readSavedBounds(): ReturnType<typeof parseBounds> {
  try {
    return parseBounds(fs.readFileSync(boundsFile(), 'utf8'))
  } catch {
    return null
  }
}

function saveBounds(win: BrowserWindow): void {
  if (win.isMinimized() || win.isFullScreen()) return
  try {
    fs.writeFileSync(boundsFile(), JSON.stringify(win.getNormalBounds()))
  } catch (err) {
    // Losing the window position is not worth failing a quit over.
    console.warn('could not save window bounds', err)
  }
}

function createWindow(): BrowserWindow {
  const displays = screen.getAllDisplays().map((d) => d.workArea)
  const win = new BrowserWindow({
    ...restoreBounds(readSavedBounds(), displays),
    show: false,
    backgroundColor: '#1B1613', // the Ink night ground, so launch doesn't flash white
    title: 'tada',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())
  win.on('close', () => saveBounds(win))

  // A link in a run transcript opens in the user's browser; nothing navigates this window away
  // from tada, and non-web schemes never reach shell.openExternal.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (linkDecision(url, appOrigin) === 'external') void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const decision = linkDecision(url, appOrigin)
    if (decision === 'internal') return
    event.preventDefault()
    if (decision === 'external') void shell.openExternal(url)
  })

  void win.loadURL(DEV ? DEV_URL : APP_URL)
  return win
}

/**
 * Notifications come from the renderer because that is where the socket lives: `useAppSocket`
 * already sees every hold. Clicking one focuses the window and hands the run id back, which the
 * renderer turns into navigation to /runs/<id> — where the hold actions are.
 */
function registerNotifications(getWindow: () => BrowserWindow | null): void {
  ipcMain.on('tada:notify', (_event, raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return
    const { title, body, runId } = raw as Record<string, unknown>
    if (typeof title !== 'string' || typeof body !== 'string') return
    if (!Notification.isSupported()) return

    const notification = new Notification({ title, body })
    notification.on('click', () => {
      const win = getWindow()
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      if (typeof runId === 'number') win.webContents.send('tada:open-run', runId)
    })
    notification.show()
  })
}

void app.whenReady().then(() => {
  if (!DEV) {
    const root = bundleRoot()
    protocol.handle('app', (request) => {
      const file = resolveBundlePath(root, new URL(request.url).pathname, isFile)
      if (!file) return new Response('bad request', { status: 400 })
      return net.fetch(pathToFileURL(file).toString())
    })
  }

  // Roles only: without a menu, macOS silently loses copy/paste/select-all in the renderer.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  )

  let win = createWindow()
  registerNotifications(() => (win.isDestroyed() ? null : win))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm --filter @tada/desktop typecheck && pnpm lint`
Expected: PASS. If Biome reformats, keep its output.

- [ ] **Step 5: Run it against a production-shaped bundle**

```bash
pnpm --filter @tada/mobile exec expo export --platform web
pnpm --filter @tada/desktop compile
pnpm --filter @tada/desktop exec electron .
```

Expected: a window opens on the tada connect screen (or the board, if a connection is already stored — note that this is a **new origin**, so expect `/connect` the first time). Verify by hand:
- Navigating to Board and reloading (View → Reload) keeps you on Board rather than 404ing — that is the SPA fallback working.
- Connecting to a running server loads the board, so CORS and the WebSocket work from `app://tada`.
- Cmd+C / Cmd+V work in the connect screen's text fields.
- Quitting and relaunching restores the window's size and position.

- [ ] **Step 6: Run the dev loop**

Run: `pnpm --filter @tada/desktop dev`
Expected: Expo's web dev server starts, then a window opens on `http://localhost:8081`; editing a mobile screen hot-reloads inside it. Stop with Ctrl+C.

- [ ] **Step 7: Document it**

Add a short "Desktop" section to `README.md` near the mobile instructions, covering `pnpm --filter @tada/desktop dev` and the fact that the desktop app is a client that connects to the same server as the phone.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop README.md pnpm-lock.yaml
git commit -m "feat(desktop): Electron shell serving the web build over app://"
```

---

### Task 5: Share the hold wording, and add the mobile capability module

The phone's notification text moves into `@tada/shared` so the desktop says the same thing, and the mobile app learns to talk to the bridge.

**Files:**
- Create: `packages/shared/src/holds.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/server/src/notify.ts` (remove `holdPingText`, re-export from shared)
- Modify: `apps/server/src/runs/runner.ts:18` (import moves)
- Modify: `apps/server/test/notify.test.ts:4` (import moves)
- Create: `apps/mobile/src/desktop.ts`
- Test: `packages/shared/test/holds.test.ts`
- Test: `apps/mobile/test/desktop.test.ts`

**Interfaces:**
- Consumes: the bridge contract from Task 4 (`window.tadaDesktop`, `notify`, `onOpenRun`).
- Produces:
  - `@tada/shared`: `holdPingText(hold: Hold): string`
  - `apps/mobile/src/desktop.ts`:
    - `interface DesktopNotification { title: string; body: string; runId?: number }`
    - `isDesktop(): boolean`
    - `notifyDesktop(n: DesktopNotification): void`
    - `holdNotification(runId: number, hold: Hold): DesktopNotification`
    - `holdFromRunEvent(event: { type: string; payload: unknown }): Hold | null`
    - `useDesktopOpenRun(): void`

- [ ] **Step 1: Move `holdPingText` into shared**

Create `packages/shared/src/holds.ts` with the function currently in `apps/server/src/notify.ts:40-49`, moved verbatim:

```ts
import type { Hold } from './domain.js'

/** One line naming what stopped the run — the body of every hold ping, on any channel. */
export function holdPingText(hold: Hold): string {
  switch (hold.reason) {
    case 'permission':
      return `wants to: ${hold.ruleTitle} — ${hold.summary}`
    case 'question':
      return hold.question
    case 'time':
      return 'out of time — continue, or stop it'
  }
}
```

Add to `packages/shared/src/index.ts`:

```ts
export * from './holds.js'
```

Delete the function from `apps/server/src/notify.ts` and update its imports so `Hold` is still imported from `@tada/shared`; then fix the two consumers:
- `apps/server/src/runs/runner.ts:18` — `import { ping } from '../notify.js'` plus `holdPingText` from `@tada/shared` (it already imports from there).
- `apps/server/test/notify.test.ts:4` — same split.

Move the `holdPingText` assertions out of `apps/server/test/notify.test.ts:183-196` into a new `packages/shared/test/holds.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { holdPingText } from '../src/holds.js'

describe('holdPingText', () => {
  test('names what stopped the run', () => {
    expect(
      holdPingText({
        reason: 'permission',
        tool: 'Bash',
        summary: 'git push',
        ruleId: 1,
        ruleTitle: 'push to a remote',
        publishes: true,
      }),
    ).toBe('wants to: push to a remote — git push')
    expect(holdPingText({ reason: 'question', question: 'which?', options: [] })).toBe('which?')
    expect(holdPingText({ reason: 'time', budgetMs: 1 })).toContain('out of time')
  })
})
```

- [ ] **Step 2: Verify the move changed no behaviour**

Run: `pnpm typecheck && pnpm --filter @tada/shared test && pnpm --filter @tada/server test`
Expected: PASS.

- [ ] **Step 3: Commit the move on its own**

```bash
git add packages/shared apps/server
git commit -m "refactor: move holdPingText into @tada/shared"
```

- [ ] **Step 4: Write the failing test for the capability module**

`apps/mobile/test/desktop.test.ts`:

```ts
import type { Hold } from '@tada/shared'
import {
  holdFromRunEvent,
  holdNotification,
  isDesktop,
  notifyDesktop,
} from '../src/desktop'

const PERMISSION: Hold = {
  reason: 'permission',
  tool: 'Bash',
  summary: 'git push',
  ruleId: 1,
  ruleTitle: 'push to a remote',
  publishes: true,
}

describe('isDesktop', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).tadaDesktop
  })

  test('is false in a plain browser or on a device', () => {
    expect(isDesktop()).toBe(false)
  })

  test('is true when the Electron preload has exposed the bridge', () => {
    ;(globalThis as Record<string, unknown>).tadaDesktop = {
      notify: () => {},
      onOpenRun: () => () => {},
    }
    expect(isDesktop()).toBe(true)
  })
})

describe('notifyDesktop', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).tadaDesktop
  })

  test('does nothing without a bridge', () => {
    expect(() => notifyDesktop({ title: 'a', body: 'b' })).not.toThrow()
  })

  test('forwards to the bridge', () => {
    const notify = jest.fn()
    ;(globalThis as Record<string, unknown>).tadaDesktop = { notify, onOpenRun: () => () => {} }
    notifyDesktop({ title: 'a', body: 'b', runId: 7 })
    expect(notify).toHaveBeenCalledWith({ title: 'a', body: 'b', runId: 7 })
  })
})

describe('holdFromRunEvent', () => {
  test('reads the hold out of a gate event', () => {
    expect(holdFromRunEvent({ type: 'gate', payload: { kind: 'hold', hold: PERMISSION } })).toEqual(
      PERMISSION,
    )
  })

  test('ignores the other gate kinds and other events', () => {
    expect(holdFromRunEvent({ type: 'gate', payload: { kind: 'resume' } })).toBeNull()
    expect(holdFromRunEvent({ type: 'status', payload: { status: 'running' } })).toBeNull()
    expect(holdFromRunEvent({ type: 'gate', payload: null })).toBeNull()
  })
})

describe('holdNotification', () => {
  test('says which run stopped and why', () => {
    expect(holdNotification(12, PERMISSION)).toEqual({
      title: 'Run #12 stopped on you',
      body: 'wants to: push to a remote — git push',
      runId: 12,
    })
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @tada/mobile exec jest test/desktop.test.ts`
Expected: FAIL — cannot resolve `../src/desktop`.

- [ ] **Step 6: Write the implementation**

`apps/mobile/src/desktop.ts`:

```ts
import type { Hold } from '@tada/shared'
import { holdPingText } from '@tada/shared'
import { useRouter } from 'expo-router'
import { useEffect } from 'react'

export interface DesktopNotification {
  title: string
  body: string
  runId?: number
}

interface DesktopBridge {
  notify(n: DesktopNotification): void
  onOpenRun(cb: (runId: number) => void): () => void
}

/**
 * The bridge the Electron preload exposes (apps/desktop/src/preload.cts). Absent everywhere else —
 * iOS, Android and any browser — which is what makes every function here a no-op off the desktop
 * app. Nothing in this module may become required for the app to work.
 */
function bridge(): DesktopBridge | null {
  const found = (globalThis as { tadaDesktop?: DesktopBridge }).tadaDesktop
  return found ?? null
}

export function isDesktop(): boolean {
  return bridge() !== null
}

export function notifyDesktop(n: DesktopNotification): void {
  bridge()?.notify(n)
}

/**
 * The hold rides in on the same journal event the run screen reads:
 * `{ type: 'gate', payload: { kind: 'hold', hold } }`. `payload` is `unknown` over the wire, so
 * this is where it gets narrowed.
 */
export function holdFromRunEvent(event: { type: string; payload: unknown }): Hold | null {
  if (event.type !== 'gate') return null
  if (typeof event.payload !== 'object' || event.payload === null) return null
  const { kind, hold } = event.payload as Record<string, unknown>
  if (kind !== 'hold') return null
  if (typeof hold !== 'object' || hold === null) return null
  return hold as Hold
}

export function holdNotification(runId: number, hold: Hold): DesktopNotification {
  return { title: `Run #${runId} stopped on you`, body: holdPingText(hold), runId }
}

/**
 * Clicking a desktop notification lands on the run screen, which is where HoldActions renders.
 * A no-op off the desktop app; the subscription is dropped on unmount.
 */
export function useDesktopOpenRun(): void {
  const router = useRouter()
  useEffect(() => {
    const desktop = bridge()
    if (!desktop) return
    return desktop.onOpenRun((runId) => {
      router.push(`/runs/${runId}`)
    })
  }, [router])
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @tada/mobile exec jest test/desktop.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/desktop.ts apps/mobile/test/desktop.test.ts
git commit -m "feat(mobile): desktop bridge capability module"
```

---

### Task 6: Wire the renderer — notify on holds, route on click, hide the push card

The last piece: the running app actually uses the bridge.

**Files:**
- Create: `apps/mobile/src/components/DesktopBridge.tsx`
- Modify: `apps/mobile/app/_layout.tsx` (mount it inside `AppSocketProvider`)
- Modify: `apps/mobile/src/webPush.ts` (`readPushEnv` reports no PushManager under Electron)
- Test: `apps/mobile/test/desktopBridge.test.tsx`
- Test: `apps/mobile/test/pingsCard.test.tsx` (one added case)

**Interfaces:**
- Consumes: `holdFromRunEvent`, `holdNotification`, `notifyDesktop`, `useDesktopOpenRun` (Task 5); `useRunEventListener` from `src/api/AppSocketContext` (existing).
- Produces: `<DesktopBridge />` — renders nothing.

- [ ] **Step 1: Write the failing test**

`apps/mobile/test/desktopBridge.test.tsx`:

```tsx
import { render } from '@testing-library/react-native'
import { DesktopBridge } from '../src/components/DesktopBridge'

const listeners = new Set<(msg: unknown) => void>()

jest.mock('../src/api/AppSocketContext', () => ({
  useRunEventListener: (fn: (msg: unknown) => void) => {
    listeners.add(fn)
  },
}))

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))

const HOLD = {
  reason: 'question' as const,
  question: 'which branch?',
  options: ['main', 'develop'],
}

function emit(msg: unknown): void {
  for (const fn of listeners) fn(msg)
}

describe('DesktopBridge', () => {
  afterEach(() => {
    listeners.clear()
    delete (globalThis as Record<string, unknown>).tadaDesktop
  })

  test('notifies the shell when a run holds', () => {
    const notify = jest.fn()
    ;(globalThis as Record<string, unknown>).tadaDesktop = { notify, onOpenRun: () => () => {} }
    render(<DesktopBridge />)

    emit({ type: 'run_event', runId: 12, event: { type: 'gate', payload: { kind: 'hold', hold: HOLD } } })

    expect(notify).toHaveBeenCalledWith({
      title: 'Run #12 stopped on you',
      body: 'which branch?',
      runId: 12,
    })
  })

  test('stays quiet for events that are not holds', () => {
    const notify = jest.fn()
    ;(globalThis as Record<string, unknown>).tadaDesktop = { notify, onOpenRun: () => () => {} }
    render(<DesktopBridge />)

    emit({ type: 'run_event', runId: 12, event: { type: 'gate', payload: { kind: 'resume' } } })
    emit({ type: 'run_event', runId: 12, event: { type: 'status', payload: { status: 'done' } } })

    expect(notify).not.toHaveBeenCalled()
  })

  test('renders and does nothing without a bridge', () => {
    expect(() => render(<DesktopBridge />)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tada/mobile exec jest test/desktopBridge.test.tsx`
Expected: FAIL — cannot resolve `../src/components/DesktopBridge`.

- [ ] **Step 3: Write the component**

`apps/mobile/src/components/DesktopBridge.tsx`:

```tsx
import { useRunEventListener } from '../api/AppSocketContext'
import { holdFromRunEvent, holdNotification, notifyDesktop, useDesktopOpenRun } from '../desktop'

/**
 * The desktop app's ping channel. Web push does not work in Electron (its Chromium has no push
 * service), so the socket the app already holds is what raises the OS notification — which means
 * desktop pings only fire while the app is running. Renders nothing, and is inert everywhere but
 * the Electron shell.
 */
export function DesktopBridge() {
  useDesktopOpenRun()
  useRunEventListener((msg) => {
    const hold = holdFromRunEvent(msg.event)
    if (hold) notifyDesktop(holdNotification(msg.runId, hold))
  })
  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tada/mobile exec jest test/desktopBridge.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Mount it in the root layout**

In `apps/mobile/app/_layout.tsx`, import it and place it inside `AppSocketProvider` (it needs the run-event bus) — next to `<NavigationTheme>`:

```tsx
              <AppSocketProvider>
                <DesktopBridge />
                <NavigationTheme>
                  <Stack screenOptions={{ headerShown: false }} />
                </NavigationTheme>
              </AppSocketProvider>
```

- [ ] **Step 6: Make the push card honest under Electron**

In `apps/mobile/src/webPush.ts`, `readPushEnv()` must report `hasPushManager: false` when the desktop bridge is present, so `pushUiState` returns `unsupported`. Add the import and the check inside `readPushEnv`, right after the `Platform.OS !== 'web'` guard:

```ts
  // Electron's Chromium exposes PushManager but has no push service behind it: a subscription
  // either fails or silently never delivers. The desktop app pings over its socket instead
  // (src/components/DesktopBridge.tsx), so the card must not offer an Enable button here.
  if (isDesktop()) {
    return { hasPushManager: false, isIos: false, isStandalone: false, permission: 'default' }
  }
```

Add to `apps/mobile/test/pingsCard.test.tsx` a case asserting the card renders its unsupported state when `globalThis.tadaDesktop` is set, following the file's existing rendering pattern, and deleting `globalThis.tadaDesktop` in its `afterEach`.

- [ ] **Step 7: Run the whole suite**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 8: Verify by hand in the shell**

```bash
pnpm --filter @tada/mobile exec expo export --platform web
pnpm --filter @tada/desktop compile
pnpm --filter @tada/desktop exec electron .
```

With a server connected, queue a ticket whose run hits an `ask` rule. Expected: an OS notification appears; clicking it focuses the window and lands on that run's screen with the hold actions showing. Settings → Pings shows push as unsupported.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): raise desktop notifications when a run holds"
```

---

### Task 7: Packaging an unsigned local build

**Files:**
- Create: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/package.json` (add `build`)
- Modify: `README.md` (build instructions in the Desktop section)

**Interfaces:**
- Consumes: `compile` (Task 4), the Expo web export.
- Produces: `apps/desktop/release/mac-arm64/tada.app`.

- [ ] **Step 1: Write the builder config**

`apps/desktop/electron-builder.yml`:

```yaml
appId: dev.tada.desktop
productName: tada
directories:
  output: release
# Only the compiled main/preload and the manifest ship as app files; the renderer is the Expo
# static export, copied into Resources/web where bundleRoot() looks for it when packaged.
files:
  - dist/**
  - package.json
extraResources:
  - from: ../mobile/dist
    to: web
mac:
  target: dir
  category: public.app-category.developer-tools
# Unsigned on purpose: this is a single-user tool built on the machine that runs it. Signing and
# notarization are the first thing to add if the app ever leaves this laptop.
identity: null
```

Add to `apps/desktop/package.json` `scripts`:

```json
    "build": "pnpm --filter @tada/mobile exec expo export --platform web && pnpm compile && electron-builder --config electron-builder.yml"
```

- [ ] **Step 2: Build**

Run: `pnpm --filter @tada/desktop build`
Expected: `apps/desktop/release/mac-arm64/tada.app` exists.

- [ ] **Step 3: Run the packaged app**

Run: `open apps/desktop/release/mac-arm64/tada.app`
Expected: the window opens on the connect screen (or the board), served from `app://tada` out of `Resources/web`. Reloading a deep route still works. This confirms `bundleRoot()`'s packaged branch and `extraResources` agree.

- [ ] **Step 4: Confirm the build output is ignored by git**

Run: `git status --short`
Expected: no `release/` or `dist/` entries (Task 1 added `apps/desktop/.gitignore`).

- [ ] **Step 5: Document and commit**

Extend the README's Desktop section with `pnpm --filter @tada/desktop build` and a note that the result is unsigned, so macOS will warn if it is copied to another machine.

```bash
git add apps/desktop README.md
git commit -m "feat(desktop): package an unsigned local macOS build"
```

---

## Verification

After Task 7, from a clean tree:

```sh
pnpm lint
pnpm typecheck
pnpm test
```

All three pass, and the desktop app runs both from `pnpm --filter @tada/desktop dev` and from the packaged `.app`.
