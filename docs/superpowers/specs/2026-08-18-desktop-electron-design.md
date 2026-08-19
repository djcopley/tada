# tada desktop — an Electron shell around the web build

A fourth target for the same UI. `@tada/mobile` already builds for web through `react-native-web`
and Expo's static export; the desktop app is that bundle in a window, plus the two things a browser
tab cannot give it — an OS notification when a run stops on you, and a window that remembers where
it was.

It is a **client only**. It connects to a self-hosted tada server the same way the phone does: the
`/connect` screen takes a URL and a bearer token. Nothing spawns a server, nothing manages ports,
nothing in `apps/server` changes.

## Scope

In:

- `apps/desktop` — a new `@tada/desktop` package: Electron main, preload, and packaging.
- A window with the app, a native menu, external links opening in the system browser, window
  bounds remembered across launches.
- OS notifications when a run holds (`permission`, `question`, `time`); clicking one focuses the
  window and opens that ticket.
- An unsigned local build for the developer's own machine.

Out (deliberately, for now):

- Tray / menu-bar presence, `tada://` deep links, auto-update, code signing, notarization, a CI
  release job.
- Any desktop-specific screen or layout. The renderer is the mobile web build, unmodified except
  for the capability module described below.
- Windows and Linux builds. The code is not made platform-specific on purpose, but macOS is the
  only target exercised.

## Why not web push

The PWA reaches the phone through VAPID web push (`apps/mobile/src/webPush.ts`, `public/sw.js`).
That channel **does not exist in Electron**: its Chromium has no push service behind
`PushManager`, so a service-worker subscription either fails or silently never delivers.

The desktop app uses the connection it already has instead. `useAppSocket` holds one WebSocket to
the server and already sees the events that matter; when a run enters a hold, the renderer asks the
main process to show a notification. The consequence is honest and worth stating plainly: **desktop
notifications only fire while the app is running.** For an app you leave open next to your editor
that is the expected behaviour, but it is a real difference from the phone, which is reachable when
the app is closed.

Because of that, the push card in mobile Settings must read `unsupported` under Electron rather
than offering an Enable button that cannot work.

## Architecture

Three pieces, with one direction of dependency: main owns the OS, preload is the only bridge, the
renderer is the existing app.

### Main process — `apps/desktop/src/main.ts`

Owns the window, the protocol, and every OS-facing capability.

**Loading the renderer.** Expo is configured `web.output: "static"` and expo-router navigates with
`history.pushState`, so `file://` is not an option — deep routes 404 and the origin is unstable,
which would strand the connection stored in `localStorage`. Main registers `app` as a privileged
scheme (`standard: true, secure: true, supportFetchAPI: true`) **before** `app.whenReady()`, then
serves `apps/mobile/dist` from `protocol.handle('app', ...)` and loads `app://tada/`. A standard,
secure scheme gives a stable origin (so `localStorage` persists), a secure context, and working
`fetch`/WebSocket to the server. The server needs no change: its CORS is `origin: true`, which
reflects `app://tada` like any other origin, and the only credential is an explicit bearer token.

Request resolution, in order: the exact path, then `<path>.html` (Expo's static export writes one
HTML file per route), then `index.html` as the SPA fallback. Every resolved path is checked to be
inside the bundle directory before it is served — the path-traversal guard from Electron's own
protocol documentation.

In development (`TADA_DESKTOP_DEV=1`) main loads `http://localhost:8081` — the Expo web dev server
— instead, and skips the protocol handler.

**Navigation containment.** `setWindowOpenHandler` returns `{ action: 'deny' }` and opens the URL
with `shell.openExternal`; a `will-navigate` listener cancels any navigation whose origin is not
the app's own. Together these mean a link in a run transcript opens in the system browser and the
window can never end up somewhere that is not tada.

**Window bounds.** Saved to a JSON file under `app.getPath('userData')` on close, clamped to a
currently-attached display on restore (a window remembered on a monitor that is no longer there
must not open off-screen).

**Menu.** A standard application menu built from roles, so copy/paste/select-all/minimise work at
all — an Electron window with no menu silently loses them on macOS.

**Security posture.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The
renderer never touches Node.

### Preload — `apps/desktop/src/preload.ts`

Exposes exactly one object through `contextBridge`, and nothing else — no `ipcRenderer`, no
module access:

```ts
window.tadaDesktop = {
  notify(n: { title: string; body: string; ticketId?: string }): void
  onOpenTicket(cb: (ticketId: string) => void): () => void
}
```

`notify` sends to main, which shows an `electron.Notification`. On click, main focuses the window
and sends the ticket id back down; `onOpenTicket` delivers it and returns an unsubscribe.

### Renderer — the existing mobile web build

One new file in the mobile app, `apps/mobile/src/desktop.ts`: a capability module that is a no-op
everywhere `window.tadaDesktop` is absent, so nothing on iOS, Android or the browser changes.

- `isDesktop()` — presence check.
- `notifyDesktop(n)` — forwards, or does nothing.
- `useDesktopOpenTicket()` — subscribes and routes through `src/nav.ts`.

Wiring: the hold events `useAppSocket` already receives feed `notifyDesktop`; the root layout
mounts `useDesktopOpenTicket` once, next to the other globally-mounted concerns; the push settings
card reports `unsupported` when `isDesktop()`.

## Build and tooling

`tsc` compiles main and preload; `electron-builder` packages. No renderer bundler — Metro already
built it. This is the smallest set of moving parts that produces a runnable app, and main and
preload are small enough that a bundler with HMR would cost more configuration than it saves.
(`electron-vite` and Electron Forge were considered and rejected on that ground; if main grows
substantially, `electron-vite` is the upgrade.)

Scripts on `@tada/desktop`:

| Script | What |
|---|---|
| `dev` | `expo start --web` and Electron pointed at it, with `TADA_DESKTOP_DEV=1` |
| `build` | `expo export --platform web` → `tsc` → `electron-builder`, unsigned |
| `typecheck` | `tsc --noEmit` |
| `test` | vitest |

The root `pnpm -r` scripts pick these up with no change. Biome lints and formats the package
automatically — only `apps/mobile` is excluded from `biome.json`. Like `apps/server` and
`packages/shared`, the package is NodeNext ESM run from source, so **relative imports carry a
`.js` extension**.

## Testing

The logic worth testing does not need Electron, so it lives in plain modules with vitest — the same
split the mobile app uses for `src/control.ts` and friends:

- `bundle.ts` — resolving a request path to a file inside the bundle: exact hit, `.html` sibling,
  `index.html` fallback, and traversal attempts (`../../etc/passwd`, absolute paths) rejected.
- `links.ts` — the decision to keep a URL in-window or hand it to the browser.
- `bounds.ts` — clamping saved bounds to the available displays, including the vanished-monitor
  case.

`main.ts` and `preload.ts` stay thin wiring over those modules and are not tested automatically;
the shell is verified by running it.

## Risks

- **Expo's static export shape is an assumption.** If `expo export --platform web` stops writing
  per-route HTML, the resolution order in `bundle.ts` needs revisiting — it is one function, and
  its tests are the specification.
- **Notifications need the app open.** Stated above; if that turns out to be too weak, the fix is
  a tray presence and, eventually, a background channel — both explicitly out of scope here.
- **Unsigned builds** trip Gatekeeper on any machine but the one that built them. Acceptable for a
  single-user tool; signing is the first thing to add if the app ever leaves this laptop.
