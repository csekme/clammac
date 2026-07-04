import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { EVENT_CHANNEL, IPC } from '@shared/channels'
import type {
  AppEvent,
  AppStatus,
  QuarantineItem,
  RestoreResult,
  ScanRecord,
  Settings,
  UpdateLogEntry
} from '@shared/types'

const api = {
  getStatus: (): Promise<AppStatus> => ipcRenderer.invoke(IPC.getStatus),

  startScan: (type: 'quick' | 'full' | 'custom', paths?: string[]): Promise<{ scanId: string }> =>
    ipcRenderer.invoke(IPC.startScan, { type, paths }),
  cancelScan: (scanId: string): Promise<void> => ipcRenderer.invoke(IPC.cancelScan, { scanId }),

  listQuarantine: (): Promise<QuarantineItem[]> => ipcRenderer.invoke(IPC.listQuarantine),
  restoreQuarantine: (id: string): Promise<RestoreResult> =>
    ipcRenderer.invoke(IPC.restoreQuarantine, { id }),
  deleteQuarantine: (id: string): Promise<void> => ipcRenderer.invoke(IPC.deleteQuarantine, { id }),

  listHistory: (): Promise<ScanRecord[]> => ipcRenderer.invoke(IPC.listHistory),
  clearHistory: (): Promise<void> => ipcRenderer.invoke(IPC.clearHistory),

  listUpdateLog: (): Promise<UpdateLogEntry[]> => ipcRenderer.invoke(IPC.listUpdateLog),
  runUpdate: (): Promise<UpdateLogEntry> => ipcRenderer.invoke(IPC.runUpdate),

  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(IPC.setSettings, patch),

  choosePaths: (directoriesOnly?: boolean): Promise<string[]> =>
    ipcRenderer.invoke(IPC.choosePaths, { directoriesOnly }),

  startEngine: (): Promise<void> => ipcRenderer.invoke(IPC.startEngine),
  stopEngine: (): Promise<void> => ipcRenderer.invoke(IPC.stopEngine),
  revealPath: (path: string): Promise<void> => ipcRenderer.invoke(IPC.revealPath, { path }),

  quickActionStatus: (): Promise<{ installed: boolean; available: boolean }> =>
    ipcRenderer.invoke(IPC.quickActionStatus),
  installQuickAction: (): Promise<void> => ipcRenderer.invoke(IPC.installQuickAction),
  uninstallQuickAction: (): Promise<void> => ipcRenderer.invoke(IPC.uninstallQuickAction),

  /** Resolve a dropped File to its filesystem path (drag & drop scan). */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  onEvent: (cb: (event: AppEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: AppEvent): void => cb(event)
    ipcRenderer.on(EVENT_CHANNEL, listener)
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
