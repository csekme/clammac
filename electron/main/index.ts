import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { existsSync } from 'fs'
import { join, isAbsolute } from 'path'
import { appDirs, resourcesDir } from './services/paths'
import { createServices, Services } from './services/container'
import { registerIpc } from './ipc'
import { createTray } from './tray'
import { getSettings } from './services/settings-store'
import { events } from './services/events'

let services: Services
let mainWindow: BrowserWindow | null = null
let quitting = false
/** clammac:// URLs that arrived before the services were up (cold start) */
let pendingUrls: string[] = []

/** clammac://scan?path=<enc>&path=<enc> — sent by the Finder Quick Action. */
function handleUrl(url: string): void {
  if (!services) {
    pendingUrls.push(url)
    return
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (parsed.protocol !== 'clammac:' || parsed.host !== 'scan') return
  const paths = parsed.searchParams
    .getAll('path')
    .filter((p) => isAbsolute(p) && existsSync(p))
    .slice(0, 200)
  if (paths.length === 0) return
  showWindow()
  events.broadcast({ type: 'navigate', payload: { page: 'scan' } })
  void services.scanner.start('custom', paths, 'quick-action').catch(() => undefined)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'sidebar',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // close-to-tray behaviour: keep protecting in the background, optionally
  // dropping the Dock icon too (menu bar accessory mode)
  win.on('close', (e) => {
    const s = getSettings()
    if (!quitting && s.closeToTray) {
      e.preventDefault()
      win.hide()
      if (s.hideDockInTray) app.dock?.hide()
    }
  })

  // lock down navigation; external links go to the default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function showWindow(): BrowserWindow {
  if (app.dock && !app.dock.isVisible()) void app.dock.show()
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow()
  mainWindow.show()
  mainWindow.focus()
  return mainWindow
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  // Finder Quick Action entry point; registration only sticks for the packaged
  // app (dev builds would register the bare Electron binary)
  if (app.isPackaged) app.setAsDefaultProtocolClient('clammac')
  app.on('open-url', (e, url) => {
    e.preventDefault()
    handleUrl(url)
  })

  app.whenReady().then(async () => {
    appDirs()
    // dev-time Dock icon (packaged apps get it from build/icon.icns)
    const dockIcon = join(resourcesDir(), 'icons', 'icon.png')
    if (!app.isPackaged && app.dock && existsSync(dockIcon)) {
      app.dock.setIcon(nativeImage.createFromPath(dockIcon))
    }
    services = createServices()
    registerIpc(services)
    createTray(services, showWindow)
    mainWindow = createWindow()

    // boot the protection stack in the background
    void services.clamd.start().catch(() => undefined)
    void services.watcher.sync()
    services.network.sync()
    services.scheduler.start()

    // replay URLs that arrived during cold start
    const queued = pendingUrls.splice(0)
    for (const url of queued) handleUrl(url)
  })

  app.on('activate', () => showWindow())

  // keep running in the tray when all windows are closed
  app.on('window-all-closed', () => {
    if (!getSettings().closeToTray) app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
  })

  app.on('will-quit', (e) => {
    services?.scanCache.flush()
    services?.network.stop()
    if (services?.clamd.getStatus().state === 'running') {
      e.preventDefault()
      void Promise.allSettled([services.watcher.stop(), services.clamd.stop()]).then(() =>
        app.quit()
      )
    }
  })
}
