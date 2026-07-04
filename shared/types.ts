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

export interface HostsEntry {
  host: string
  /** true = blokkolt (0.0.0.0-ra irányítva), false = engedélyezett (kivétel a feedből) */
  block: boolean
}

export interface HostsStatus {
  /** a védelem érvényben van-e a /etc/hosts-ban */
  active: boolean
  /** hány domain van ténylegesen a jelölt blokkban */
  blockedCount: number
  updatedAt: number | null
  updating: boolean
  error: string | null
  /** a letöltött feed-domainek száma (ennyi lenne érvényesítve) */
  feedCount: number
  /** a feed azóta bővült, mint amikor a hosts utoljára íródott */
  outdated: boolean
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
  /** élő kapcsolat-figyelés + threat-feed riasztások (F1) */
  networkMonitorEnabled: boolean
  /** ismert C2/malware IP-k kimenő blokkolása PF anchorral (F2, admin jogot kér) */
  pfBlocklistEnabled: boolean
  /** kártevő/követő domainek blokkolása /etc/hosts-on át (admin jogot kér) */
  hostsProtectionEnabled: boolean
  /** URLhaus kártevő-domain lista */
  hostsBlockMalware: boolean
  /** Hagezi Light — követők és reklámok */
  hostsBlockTrackers: boolean
  /** saját kézi blokk/engedély bejegyzések */
  hostsCustom: HostsEntry[]
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

export interface NetworkConnection {
  pid: number
  process: string
  protocol: 'tcp' | 'udp'
  remoteIp: string
  remotePort: number
  /** ESTABLISHED, SYN_SENT, … — UDP-nél üres */
  state: string
  firstSeen: number
}

export interface NetworkAlert {
  id: string
  at: number
  connection: NetworkConnection
  /** 'feodo' | 'threatfox' | 'cins' | 'blocklist.de' | 'et-compromised' */
  feed: string
  /** mit jelez a feed: 'c2' | 'attacker' | 'compromised' */
  category: string
  /** a feed-bejegyzés, pl. "1.2.3.4:443" */
  indicator: string
  /** malware család, ha a feed adja (ThreatFox) */
  malware: string | null
  /** a PF blocklist épp fogta-e ezt az IP-t */
  blocked: boolean
}

export interface ThreatFeedStatus {
  updatedAt: number | null
  updating: boolean
  entryCount: number
  /** utolsó frissítés hibaüzenete, ha volt */
  error: string | null
}

export interface FirewallStatus {
  /** macOS Application Firewall (bejövő) — null = nem sikerült lekérdezni */
  alfEnabled: boolean | null
  stealthEnabled: boolean | null
  /** a PF blocklist anchor betöltve (app által követett állapot) */
  pfBlocklistActive: boolean
  /** hány IP van épp a blokkolt táblában */
  pfBlocklistSize: number
  /** a threat-feed azóta bővült, mint amikor a PF tábla utoljára betöltődött */
  pfBlocklistOutdated: boolean
  /** a jelenlegi feed mérete (ennyire lehetne frissíteni a blokklistát) */
  feedSize: number
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
  | { type: 'navigate'; payload: { page: 'dashboard' | 'scan' | 'quarantine' | 'network' | 'history' | 'updates' | 'settings' } }
  | { type: 'network-connections'; payload: NetworkConnection[] }
  | { type: 'network-alert'; payload: NetworkAlert }
  | { type: 'feed-status'; payload: ThreatFeedStatus }
  | { type: 'firewall-status'; payload: FirewallStatus }
  | { type: 'hosts-status'; payload: HostsStatus }
