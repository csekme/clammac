import type { FreshclamService } from './freshclam'
import type { ScanOrchestrator } from './scan-orchestrator'
import type { ClamdManager } from './clamd-manager'
import type { ThreatFeedService } from './threat-feeds'
import type { HostsProtection } from './hosts-protection'
import { getSettings } from './settings-store'

const TICK_MS = 60_000
const FEED_MAX_AGE_MS = 12 * 3600_000
/** sikertelen frissítés után ennyi idővel próbálkozunk újra */
const FAIL_RETRY_MS = 15 * 60_000

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
    private clamd: ClamdManager,
    private feeds: ThreatFeedService,
    private hosts: HostsProtection
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

    // signature updates — a db mtime-ját a freshclam nem frissíti, ha a tükrön
    // nincs újabb adat, ezért az utolsó *ellenőrzés* idejét is számítani kell,
    // különben a tick percenként újraindítaná a frissítést
    const db = this.clamd.getDbStatus(this.freshclam.isRunning())
    const staleMs = s.updateIntervalHours * 3600_000
    const last = this.freshclam.lastAttempt()
    const checkedAt = Math.max(db.updatedAt ?? 0, last?.at ?? 0)
    const dueMs = last && !last.ok ? Math.min(staleMs, FAIL_RETRY_MS) : staleMs
    if (!db.updating && Date.now() - checkedAt > dueMs) {
      void this.freshclam.update()
    }

    // threat-feed frissítés (csak ha a hálózati funkciók bármelyike aktív)
    if (
      (s.networkMonitorEnabled || s.pfBlocklistEnabled) &&
      this.feeds.isStale(FEED_MAX_AGE_MS) &&
      !this.feeds.getStatus().updating
    ) {
      void this.feeds.update()
    }

    // domain-feed frissítés (letöltés; a /etc/hosts újraírása user-akció marad)
    if (
      s.hostsProtectionEnabled &&
      this.hosts.feedAgeMs() > FEED_MAX_AGE_MS &&
      !this.hosts.getStatus().updating
    ) {
      void this.hosts.updateFeeds()
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
