import { app } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import type { Settings } from '@shared/types'
import { JsonStore } from './json-store'
import { appDirs } from './paths'
import { events } from './events'

export const defaultSettings: Settings = {
  launchAtLogin: false,
  closeToTray: true,
  hideDockInTray: true,
  showNotifications: true,
  realtimeEnabled: true,
  watchPaths: [join(homedir(), 'Downloads')],
  exclusions: ['node_modules', '.git', 'Library/Caches'],
  maxFileSizeMB: 100,
  scanArchives: true,
  detectPua: false,
  autoQuarantine: true,
  scanCacheEnabled: true,
  networkMonitorEnabled: true,
  pfBlocklistEnabled: false,
  hostsProtectionEnabled: false,
  hostsBlockMalware: true,
  hostsBlockTrackers: true,
  hostsCustom: [],
  verboseScanLog: false,
  updateIntervalHours: 12,
  scheduledScan: { enabled: false, frequency: 'daily', time: '12:00' }
}

let store: JsonStore<Settings> | null = null

export function settingsStore(): JsonStore<Settings> {
  if (!store) store = new JsonStore(join(appDirs().userData, 'settings.json'), defaultSettings)
  return store
}

export function getSettings(): Settings {
  return settingsStore().get()
}

export function patchSettings(patch: Partial<Settings>): Settings {
  const next = settingsStore().update(patch)
  if (patch.launchAtLogin !== undefined) {
    app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
  }
  events.broadcast({ type: 'settings-changed', payload: next })
  return next
}
