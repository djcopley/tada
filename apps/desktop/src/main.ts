import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  net,
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
