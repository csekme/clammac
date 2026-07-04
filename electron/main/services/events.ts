import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import { EVENT_CHANNEL } from '@shared/ipc'
import type { AppEvent } from '@shared/types'

/** Hub for main->renderer push events; also usable for main-internal subscribers (tray). */
class EventHub extends EventEmitter {
  broadcast(event: AppEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, event)
    }
    this.emit('event', event)
  }
}

export const events = new EventHub()
