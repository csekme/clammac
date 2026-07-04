import { create } from 'zustand'
import type {
  AppStatus,
  Detection,
  DbStatus,
  EngineStatus,
  ScanProgress,
  ScanRecord,
  Settings
} from '@shared/types'

export type Page = 'dashboard' | 'scan' | 'quarantine' | 'history' | 'updates' | 'settings'

interface AppState {
  loaded: boolean
  page: Page
  engine: EngineStatus | null
  db: DbStatus | null
  settings: Settings | null
  activeScan: ScanProgress | null
  lastScan: ScanRecord | null
  quarantineCount: number
  realtimeDetections: Detection[]
  scanLog: string[]
  scanLogId: string | null
  setPage: (page: Page) => void
  init: () => Promise<void>
  refresh: () => Promise<void>
  patchSettings: (patch: Partial<Settings>) => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  loaded: false,
  page: 'dashboard',
  engine: null,
  db: null,
  settings: null,
  activeScan: null,
  lastScan: null,
  quarantineCount: 0,
  realtimeDetections: [],
  scanLog: [],
  scanLogId: null,

  setPage: (page) => set({ page }),

  init: async () => {
    window.api.onEvent((event) => {
      switch (event.type) {
        case 'engine-status':
          set({ engine: event.payload })
          break
        case 'db-status':
          set({ db: event.payload })
          break
        case 'scan-progress': {
          const done = ['done', 'cancelled', 'error'].includes(event.payload.status)
          set({ activeScan: done ? null : event.payload })
          if (done) void get().refresh()
          break
        }
        case 'scan-log': {
          const { scanId, lines } = event.payload
          const fresh = get().scanLogId !== scanId
          const merged = fresh ? lines : [...get().scanLog, ...lines]
          set({ scanLogId: scanId, scanLog: merged.slice(-1000) })
          break
        }
        case 'settings-changed':
          set({ settings: event.payload })
          break
        case 'quarantine-changed':
          set({ quarantineCount: event.payload.count })
          break
        case 'realtime-detection':
          set({ realtimeDetections: [event.payload, ...get().realtimeDetections].slice(0, 20) })
          break
        case 'update-log':
          void get().refresh()
          break
        case 'navigate':
          set({ page: event.payload.page })
          break
      }
    })
    await get().refresh()
    set({ loaded: true })
    console.info('[ClamMac] UI ready')
  },

  refresh: async () => {
    const status: AppStatus = await window.api.getStatus()
    set({
      engine: status.engine,
      db: status.db,
      settings: status.settings,
      activeScan: status.activeScan,
      lastScan: status.lastScan,
      quarantineCount: status.quarantineCount
    })
  },

  patchSettings: async (patch) => {
    const next = await window.api.setSettings(patch)
    set({ settings: next })
  }
}))
