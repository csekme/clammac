import type { FreshclamService } from './freshclam'
import type { ScanOrchestrator } from './scan-orchestrator'
import type { ClamdManager } from './clamd-manager'
import { getSettings } from './settings-store'

const TICK_MS = 60_000

/**
 * In-app scheduler: periodic signature updates + scheduled scans.
 * (launchd LaunchAgent integration for closed-app runs is a v2 item.)
 */
export class SchedulerService {
  private timer: NodeJS.Timeout | null = null
  private lastScheduledScanDay = ''

  constructor(
    private freshclam: FreshclamService,
    private scanner: ScanOrchestrator,
    private clamd: ClamdManager
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    // first update check shortly after launch
    setTimeout(() => void this.tick(), 5_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    const s = getSettings()

    // signature updates
    const db = this.clamd.getDbStatus(this.freshclam.isRunning())
    const staleMs = s.updateIntervalHours * 3600_000
    if (!db.updating && (!db.present || !db.updatedAt || Date.now() - db.updatedAt > staleMs)) {
      void this.freshclam.update()
    }

    // scheduled scan
    if (!s.scheduledScan.enabled || !db.present) return
    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    if (hhmm !== s.scheduledScan.time) return
    if (s.scheduledScan.frequency === 'weekly' && now.getDay() !== 1) return
    const dayKey = now.toDateString()
    if (this.lastScheduledScanDay === dayKey) return
    this.lastScheduledScanDay = dayKey
    void this.scanner.start('quick', undefined, 'schedule').catch(() => undefined)
  }
}
