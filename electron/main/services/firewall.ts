import { execFile } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'
import type { FirewallStatus } from '@shared/types'
import { appDirs } from './paths'
import { JsonStore } from './json-store'
import type { ThreatFeedService } from './threat-feeds'
import { getSettings } from './settings-store'
import { events } from './events'

const SOCKETFILTERFW = '/usr/libexec/ApplicationFirewall/socketfilterfw'
/**
 * A rendszer pf.conf-ja tartalmaz egy `anchor "com.apple/*"` bejegyzést, ezért
 * egy ez alá töltött anchor a főszabálysor módosítása nélkül kiértékelődik.
 */
const PF_ANCHOR = 'com.apple/250.ClamMacBlocklist'

interface PfState {
  active: boolean
  size: number
  loadedAt: number | null
}

/**
 * F2 — blokkolás a rendszer beépített eszközeivel:
 *  - ALF (Application Firewall): bejövő védelem be/ki + stealth (root a set-hez)
 *  - PF anchor: a threat-feedek IP-inek kimenő/bejövő blokkolása (root)
 * A root-műveletek osascript admin prompton át futnak, fix parancskészlettel.
 */
export class FirewallService {
  private pfState: JsonStore<PfState>

  constructor(private feeds: ThreatFeedService) {
    this.pfState = new JsonStore<PfState>(join(appDirs().userData, 'firewall-state.json'), {
      active: false,
      size: 0,
      loadedAt: null
    })
  }

  isIpBlocked(ip: string): boolean {
    return this.pfState.get().active && this.feeds.match(ip) !== null
  }

  async getStatus(): Promise<FirewallStatus> {
    const [alfEnabled, stealthEnabled] = await Promise.all([
      alfQuery('--getglobalstate'),
      alfQuery('--getstealthmode')
    ])
    const pf = this.pfState.get()
    const feedSize = this.feeds.getStatus().entryCount
    return {
      alfEnabled,
      stealthEnabled,
      pfBlocklistActive: pf.active,
      pfBlocklistSize: pf.size,
      // csak akkor "elavult", ha a feed érdemben (>0) nagyobb a betöltött táblánál
      pfBlocklistOutdated: pf.active && feedSize > pf.size,
      feedSize
    }
  }

  /** ALF be/ki + stealth egyetlen admin prompttal. */
  async setAlf(opts: { enabled?: boolean; stealth?: boolean }): Promise<FirewallStatus> {
    const cmds: string[] = []
    if (opts.enabled !== undefined) {
      cmds.push(`${SOCKETFILTERFW} --setglobalstate ${opts.enabled ? 'on' : 'off'}`)
    }
    if (opts.stealth !== undefined) {
      cmds.push(`${SOCKETFILTERFW} --setstealthmode ${opts.stealth ? 'on' : 'off'}`)
    }
    if (cmds.length > 0) {
      await runAsAdmin(cmds.join(' && '), 'A ClamMac a macOS tűzfalát állítja be.')
    }
    return this.broadcastStatus()
  }

  /**
   * A settings.pfBlocklistEnabled érvényre juttatása. Betöltéskor a friss
   * feed-IP-kből épül a tábla; kikapcsoláskor az anchor kiürül. Hibát dob
   * (pl. a felhasználó elveti az admin promptot) — a hívó kezeli.
   */
  async syncPf(): Promise<FirewallStatus> {
    const want = getSettings().pfBlocklistEnabled
    if (want) {
      const ips = this.feeds.allIps()
      if (ips.length === 0) throw new Error('A threat-feed lista üres — futtass feed-frissítést előbb')
      const rules = [
        `table <clammac_block> persist { ${ips.join(', ')} }`,
        'block drop out quick to <clammac_block>',
        'block drop in quick from <clammac_block>',
        ''
      ].join('\n')
      const rulesFile = join(appDirs().conf, 'pf-blocklist.conf')
      writeFileSync(rulesFile, rules, { mode: 0o644 })
      await runAsAdmin(
        `/sbin/pfctl -a '${PF_ANCHOR}' -f '${rulesFile}' && (/sbin/pfctl -e || true)`,
        'A ClamMac az ismert kártevő-IP-k blokkolását kapcsolja be (PF tűzfal).'
      )
      this.pfState.set({ active: true, size: ips.length, loadedAt: Date.now() })
    } else if (this.pfState.get().active) {
      await runAsAdmin(
        `/sbin/pfctl -a '${PF_ANCHOR}' -F all`,
        'A ClamMac a kártevő-IP blokkolást kapcsolja ki.'
      )
      this.pfState.set({ active: false, size: 0, loadedAt: null })
    }
    return this.broadcastStatus()
  }

  /** A PF blocklist újratöltése a friss feed-IP-kkel (egyetlen admin prompt). */
  async refreshPf(): Promise<FirewallStatus> {
    if (!this.pfState.get().active) return this.getStatus()
    return this.syncPf()
  }

  private async broadcastStatus(): Promise<FirewallStatus> {
    const status = await this.getStatus()
    events.broadcast({ type: 'firewall-status', payload: status })
    return status
  }
}

/**
 * A socketfilterfw kimenete flag-enként más szöveg:
 *   --getglobalstate  → "Firewall is enabled. (State = 1)" / "disabled. (State = 0)"
 *   --getstealthmode  → "Firewall stealth mode is on" / "… is off"
 */
function alfQuery(flag: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    execFile(SOCKETFILTERFW, [flag], { timeout: 5_000 }, (err, stdout) => {
      if (err) return resolve(null)
      const out = stdout.toLowerCase()
      if (out.includes('disabled') || out.includes('state = 0') || / off\b/.test(out)) {
        return resolve(false)
      }
      if (
        out.includes('enabled') ||
        out.includes('state = 1') ||
        out.includes('state = 2') ||
        / on\b/.test(out)
      ) {
        return resolve(true)
      }
      resolve(null)
    })
  })
}

/**
 * Fix parancs futtatása admin jogosultsággal (macOS jelszó-prompt). Szándékosan
 * nem általános sudo-helper: csak az e modulban összeállított parancsok futnak.
 */
function runAsAdmin(command: string, prompt: string): Promise<void> {
  const script = `do shell script "${escapeAppleScript(command)}" with prompt "${escapeAppleScript(prompt)}" with administrator privileges`
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout: 120_000 }, (err, _out, stderr) => {
      if (!err) return resolve()
      const msg = String(stderr || err.message)
      reject(
        new Error(
          /user cancell?ed/i.test(msg) ? 'A művelethez rendszergazdai jóváhagyás kell' : msg.slice(0, 300)
        )
      )
    })
  })
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
