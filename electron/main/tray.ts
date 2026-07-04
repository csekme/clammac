import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { AppEvent } from '@shared/types'
import type { Services } from './services/container'
import { events } from './services/events'
import { resourcesDir } from './services/paths'

/**
 * Menu bar presence. If `resources/icons/trayTemplate.png` exists it is used
 * as a macOS template icon (auto light/dark); otherwise an emoji title is the
 * fallback. Status is appended as a short title suffix next to the icon.
 */
export function createTray(services: Services, showWindow: () => BrowserWindow): Tray {
  const iconPath = join(resourcesDir(), 'icons', 'trayTemplate.png')
  const hasIcon = existsSync(iconPath)
  let image = nativeImage.createEmpty()
  if (hasIcon) {
    image = nativeImage.createFromPath(iconPath)
    image.setTemplateImage(true)
  }
  const tray = new Tray(image)
  tray.setToolTip('ClamMac')

  const render = (): void => {
    const engine = services.clamd.getStatus()
    const db = services.clamd.getDbStatus()
    const stale = !db.updatedAt || Date.now() - db.updatedAt > 7 * 24 * 3600_000
    const active = services.scanner.getActive()
    const scanning = active && (active.status === 'running' || active.status === 'enumerating')

    const healthy = engine.state === 'running' && !stale
    if (hasIcon) {
      tray.setTitle(scanning ? '…' : healthy ? '' : '!')
    } else {
      tray.setTitle(scanning ? '🛡…' : healthy ? '🛡' : '🛡!')
    }

    const statusLabel =
      engine.state === 'running'
        ? scanning
          ? `Szkennelés folyamatban… (${active!.scanned}/${active!.total || '?'})`
          : 'Védelem aktív'
        : engine.state === 'not-installed'
          ? 'ClamAV nincs telepítve'
          : engine.state === 'db-missing'
            ? 'Adatbázis hiányzik'
            : engine.state === 'starting'
              ? 'Motor indul…'
              : 'Motor leállítva'

    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: statusLabel, enabled: false },
        { type: 'separator' },
        {
          label: 'ClamMac megnyitása',
          click: () => showWindow()
        },
        {
          label: 'Gyors szkennelés',
          enabled: !scanning && engine.state !== 'not-installed',
          click: () => void services.scanner.start('quick').catch(() => undefined)
        },
        {
          label: 'Szignatúrák frissítése',
          click: () => void services.freshclam.update()
        },
        { type: 'separator' },
        { label: 'Kilépés', click: () => app.quit() }
      ])
    )
  }

  render()
  events.on('event', (event: AppEvent) => {
    if (['engine-status', 'db-status', 'scan-progress'].includes(event.type)) render()
  })
  return tray
}
