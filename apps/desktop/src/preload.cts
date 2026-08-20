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
