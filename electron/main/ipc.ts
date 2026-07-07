import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { z } from 'zod'
import {
  IPC,
  StartScanReq,
  ScanIdReq,
  QuarantineIdReq,
  SettingsPatch,
  ChoosePathsReq,
  SetAlfReq
} from '@shared/ipc'
import type { AppStatus } from '@shared/types'
import type { Services } from './services/container'
import { getSettings, patchSettings } from './services/settings-store'
import {
  quickActionInstalled,
  installQuickAction,
  uninstallQuickAction
} from './services/quick-action'

function handle<S extends z.ZodTypeAny>(
  channel: string,
  schema: S,
  fn: (req: z.infer<S>) => unknown | Promise<unknown>
): void {
  ipcMain.handle(channel, async (_event, raw) => {
    const req = schema.parse(raw ?? {})
    return fn(req)
  })
}

const Empty = z.object({}).passthrough()

export function registerIpc(services: Services): void {
  const {
    clamd,
    freshclam,
    scanner,
    quarantine,
    history,
    watcher,
    feeds,
    network,
    firewall,
    hosts
  } = services

  handle(IPC.getStatus, Empty, (): AppStatus => {
    return {
      engine: clamd.getStatus(),
      db: clamd.getDbStatus(freshclam.isRunning()),
      settings: getSettings(),
      lastScan: history.last(),
      activeScan: scanner.getActive(),
      quarantineCount: quarantine.count()
    }
  })

  handle(IPC.startScan, StartScanReq, async (req) => {
    const scanId = await scanner.start(req.type, req.paths)
    return { scanId }
  })

  handle(IPC.cancelScan, ScanIdReq, (req) => {
    scanner.cancel(req.scanId)
  })

  handle(IPC.listQuarantine, Empty, () => quarantine.list())
  handle(IPC.restoreQuarantine, QuarantineIdReq, (req) => quarantine.restore(req.id))
  handle(IPC.deleteQuarantine, QuarantineIdReq, (req) => quarantine.remove(req.id))

  handle(IPC.listHistory, Empty, () => history.list())
  handle(IPC.clearHistory, Empty, () => history.clear())

  handle(IPC.listUpdateLog, Empty, () => freshclam.getLog())
  handle(IPC.clearUpdateLog, Empty, () => freshclam.clearLog())
  handle(IPC.runUpdate, Empty, () => freshclam.update())

  handle(IPC.getSettings, Empty, () => getSettings())
  handle(IPC.setSettings, SettingsPatch, async (patch) => {
    const previous = getSettings()
    const next = patchSettings(patch)
    if (
      patch.realtimeEnabled !== undefined ||
      patch.watchPaths !== undefined ||
      patch.exclusions !== undefined
    ) {
      await watcher.sync()
    }
    if (patch.networkMonitorEnabled !== undefined) network.sync()
    if (patch.pfBlocklistEnabled !== undefined) {
      try {
        await firewall.syncPf()
      } catch (err) {
        // pl. elvetett admin prompt — a kapcsoló visszaáll, a hiba a UI-é
        patchSettings({ pfBlocklistEnabled: previous.pfBlocklistEnabled })
        throw err
      }
    }
    if (
      patch.hostsProtectionEnabled !== undefined ||
      patch.hostsBlockMalware !== undefined ||
      patch.hostsBlockTrackers !== undefined ||
      patch.hostsCustom !== undefined
    ) {
      try {
        await hosts.sync()
      } catch (err) {
        patchSettings({
          hostsProtectionEnabled: previous.hostsProtectionEnabled,
          hostsBlockMalware: previous.hostsBlockMalware,
          hostsBlockTrackers: previous.hostsBlockTrackers,
          hostsCustom: previous.hostsCustom
        })
        throw err
      }
    }
    return getSettings()
  })

  handle(IPC.choosePaths, ChoosePathsReq, async (req) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      properties: req.directoriesOnly
        ? ['openDirectory', 'multiSelections']
        : ['openFile', 'openDirectory', 'multiSelections']
    })
    return result.canceled ? [] : result.filePaths
  })

  handle(IPC.startEngine, Empty, () => clamd.start())
  handle(IPC.stopEngine, Empty, () => clamd.stop())

  handle(IPC.revealPath, z.object({ path: z.string().min(1) }), (req) => {
    shell.showItemInFolder(req.path)
  })

  handle(IPC.quickActionStatus, Empty, () => ({
    installed: quickActionInstalled(),
    // the clammac:// handler only registers for the packaged app
    available: app.isPackaged
  }))
  handle(IPC.installQuickAction, Empty, () => installQuickAction())
  handle(IPC.uninstallQuickAction, Empty, () => uninstallQuickAction())

  handle(IPC.listConnections, Empty, () => network.list())
  handle(IPC.listNetworkAlerts, Empty, () => network.listAlerts())
  handle(IPC.clearNetworkAlerts, Empty, () => network.clearAlerts())
  handle(IPC.feedStatus, Empty, () => feeds.getStatus())
  handle(IPC.updateFeeds, Empty, () => feeds.update())
  handle(IPC.firewallStatus, Empty, () => firewall.getStatus())
  handle(IPC.setAlf, SetAlfReq, (req) => firewall.setAlf(req))
  handle(IPC.refreshPfBlocklist, Empty, () => firewall.refreshPf())

  handle(IPC.hostsStatus, Empty, () => hosts.getStatus())
  handle(IPC.refreshHosts, Empty, () => hosts.refresh())
}
