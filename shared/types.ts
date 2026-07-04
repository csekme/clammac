export type EngineState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'error'
  | 'db-missing'
  | 'not-installed'

export interface EngineStatus {
  state: EngineState
  version: string | null
  binaryPath: string | null
  error: string | null
}

export interface DbStatus {
  present: boolean
  /** daily.c[lv]d version number, if known */
  dailyVersion: number | null
  updatedAt: number | null
  updating: boolean
}

export interface Detection {
  path: string
  signature: string
  quarantineId: string | null
  at: number
}

export type ScanType = 'quick' | 'full' | 'custom'
export type ScanStatus = 'enumerating' | 'running' | 'done' | 'cancelled' | 'error'

export interface ScanProgress {
  scanId: string
  type: ScanType
  status: ScanStatus
  scanned: number
  total: number
  /** files skipped because an unchanged copy was already scanned clean (scan cache) */
  cached: number
  currentPath: string
  detections: Detection[]
  startedAt: number
  finishedAt: number | null
  error: string | null
}

export interface ScanRecord {
  scanId: string
  type: ScanType
  status: ScanStatus
  scanned: number
  /** absent in records written before the scan cache existed */
  cached?: number
  detections: Detection[]
  startedAt: number
  finishedAt: number | null
  /** 'user' | 'watcher' | 'schedule' | 'quick-action' */
  origin: string
}

export interface RestoreResult {
  restoredPath: string
  /** true if the original location was not writable and we used a fallback dir */
  fellBack: boolean
  originalPath: string
}

export interface QuarantineItem {
  id: string
  originalPath: string
  signature: string
  size: number
  sha256: string
  quarantinedAt: number
  origin: string
}

export interface Settings {
  launchAtLogin: boolean
  closeToTray: boolean
  /** hide the Dock icon while running in the menu bar with no window */
  hideDockInTray: boolean
  showNotifications: boolean
  realtimeEnabled: boolean
  watchPaths: string[]
  exclusions: string[]
  maxFileSizeMB: number
  scanArchives: boolean
  detectPua: boolean
  autoQuarantine: boolean
  /** skip files already scanned clean with the current signature DB (path+size+mtime) */
  scanCacheEnabled: boolean
  /** stream per-file scan results to the UI console */
  verboseScanLog: boolean
  updateIntervalHours: number
  scheduledScan: {
    enabled: boolean
    /** 'daily' | 'weekly' */
    frequency: string
    /** 'HH:MM' */
    time: string
  }
}

export interface UpdateLogEntry {
  at: number
  ok: boolean
  message: string
}

export interface AppStatus {
  engine: EngineStatus
  db: DbStatus
  settings: Settings
  lastScan: ScanRecord | null
  activeScan: ScanProgress | null
  quarantineCount: number
}

/** Push events main -> renderer, multiplexed on one channel */
export type AppEvent =
  | { type: 'engine-status'; payload: EngineStatus }
  | { type: 'db-status'; payload: DbStatus }
  | { type: 'scan-progress'; payload: ScanProgress }
  | { type: 'scan-log'; payload: { scanId: string; lines: string[] } }
  | { type: 'realtime-detection'; payload: Detection }
  | { type: 'update-log'; payload: UpdateLogEntry }
  | { type: 'settings-changed'; payload: Settings }
  | { type: 'quarantine-changed'; payload: { count: number } }
  /** main asks the UI to switch page (e.g. Finder Quick Action started a scan) */
  | { type: 'navigate'; payload: { page: 'dashboard' | 'scan' | 'quarantine' | 'history' | 'updates' | 'settings' } }
