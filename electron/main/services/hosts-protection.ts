import { execFile } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { HostsStatus } from '@shared/types'
import { appDirs } from './paths'
import { JsonStore } from './json-store'
import { getSettings } from './settings-store'
import { events } from './events'

const HOSTS_PATH = '/etc/hosts'
const BEGIN = '# BEGIN ClamMac — kártevő/követő domain-blokk (ne szerkeszd kézzel)'
const END = '# END ClamMac'
const FETCH_TIMEOUT_MS = 40_000
const MAX_DOMAINS = 300_000

interface HostsFeed {
  key: 'malware' | 'trackers'
  url: string
}

const FEEDS: HostsFeed[] = [
  { key: 'malware', url: 'https://urlhaus.abuse.ch/downloads/hostfile/' },
  { key: 'trackers', url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/hosts/light.txt' }
]

interface FeedCache {
  updatedAt: number | null
  /** kategóriánként a domainek */
  malware: string[]
  trackers: string[]
}

interface AppliedState {
  /** hány domaint írtunk utoljára a /etc/hosts-ba */
  count: number
  appliedAt: number | null
}

/**
 * Domain-védelem: kártevő/követő domaineket 0.0.0.0-ra irányít a /etc/hosts
 * jelölt blokkjában. A rendszer meglévő hosts-tartalmát nem érinti — csak a
 * BEGIN/END közti szakaszt cseréli. A root-írás osascript admin prompton át
 * megy: az app egy kész fájlt készít, azt egyetlen paranccsal a helyére másolja.
 */
export class HostsProtection {
  private cache: JsonStore<FeedCache>
  private applied: JsonStore<AppliedState>
  private updating = false
  private lastError: string | null = null

  constructor() {
    this.cache = new JsonStore<FeedCache>(join(appDirs().userData, 'hosts-feeds.json'), {
      updatedAt: null,
      malware: [],
      trackers: []
    })
    this.applied = new JsonStore<AppliedState>(join(appDirs().userData, 'hosts-applied.json'), {
      count: 0,
      appliedAt: null
    })
  }

  /** Az engedélyezett kategóriák + kézi bejegyzések összevont blokk-halmaza. */
  private blockedDomains(): Set<string> {
    const s = getSettings()
    const set = new Set<string>()
    const c = this.cache.get()
    if (s.hostsBlockMalware) for (const d of c.malware) set.add(d)
    if (s.hostsBlockTrackers) for (const d of c.trackers) set.add(d)
    for (const e of s.hostsCustom) if (e.block) set.add(normalizeHost(e.host))
    // kézi engedélyek felülírják a feedeket
    for (const e of s.hostsCustom) if (!e.block) set.delete(normalizeHost(e.host))
    set.delete('')
    return set
  }

  getStatus(): HostsStatus {
    const applied = this.applied.get()
    const feedCount = this.blockedDomains().size
    return {
      active: applied.appliedAt !== null,
      blockedCount: applied.count,
      updatedAt: this.cache.get().updatedAt,
      updating: this.updating,
      error: this.lastError,
      feedCount,
      outdated: applied.appliedAt !== null && feedCount !== applied.count
    }
  }

  feedAgeMs(): number {
    const at = this.cache.get().updatedAt
    return at ? Date.now() - at : Infinity
  }

  /** Csak letöltés (nem ír /etc/hosts-ot) — a scheduler ezt hívja háttérben. */
  async updateFeeds(): Promise<HostsStatus> {
    if (this.updating) return this.getStatus()
    this.updating = true
    this.broadcast()
    const errors: string[] = []
    const next: Partial<Record<HostsFeed['key'], string[]>> = {}
    try {
      for (const feed of FEEDS) {
        try {
          const res = await fetch(feed.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const domains = parseHostsFeed(await res.text())
          if (domains.length > MAX_DOMAINS) throw new Error('gyanúsan nagy lista, eldobva')
          next[feed.key] = domains
        } catch (err) {
          errors.push(`${feed.key}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      const prev = this.cache.get()
      this.cache.set({
        updatedAt: Date.now(),
        malware: next.malware ?? prev.malware,
        trackers: next.trackers ?? prev.trackers
      })
      this.lastError = errors.length > 0 ? errors.join(' · ') : null
    } finally {
      this.updating = false
      this.broadcast()
    }
    return this.getStatus()
  }

  /** A settings.hostsProtectionEnabled érvényre juttatása (admin prompt). */
  async sync(): Promise<HostsStatus> {
    if (getSettings().hostsProtectionEnabled) {
      if (this.cache.get().updatedAt === null) await this.updateFeeds()
      await this.writeBlock(this.blockedDomains())
    } else if (this.applied.get().appliedAt !== null) {
      await this.writeBlock(null)
    }
    return this.broadcastStatus()
  }

  /** Feed-újratöltés + újraírás a friss listával (a „frissítés” gomb). */
  async refresh(): Promise<HostsStatus> {
    await this.updateFeeds()
    if (getSettings().hostsProtectionEnabled) await this.writeBlock(this.blockedDomains())
    return this.broadcastStatus()
  }

  /**
   * A jelölt blokk cseréje a /etc/hosts-ban. `domains === null` → a blokk
   * eltávolítása. A rendszer többi sorát érintetlenül hagyja; a friss tartalmat
   * temp fájlba írjuk, és egyetlen admin paranccsal másoljuk a helyére.
   */
  private async writeBlock(domains: Set<string> | null): Promise<void> {
    let current = ''
    try {
      current = readFileSync(HOSTS_PATH, 'utf8')
    } catch {
      current = ''
    }
    const base = stripBlock(current)
    let next = base
    let count = 0
    if (domains && domains.size > 0) {
      const lines = [BEGIN]
      for (const d of domains) lines.push(`0.0.0.0 ${d}`)
      lines.push(END)
      count = domains.size
      next = base.replace(/\n*$/, '\n') + '\n' + lines.join('\n') + '\n'
    }
    if (next === current) {
      // nincs változás — ne kérjünk feleslegesen admin promptot
      this.applied.set({ count, appliedAt: domains ? Date.now() : null })
      return
    }
    const tmp = join(appDirs().conf, 'hosts.new')
    writeFileSync(tmp, next, { mode: 0o644 })
    const backup = join(appDirs().userData, 'hosts.system.bak')
    await runAsAdmin(
      // biztonsági mentés csak ha még nincs, majd atomikus csere + DNS-cache ürítés
      `[ -f '${backup}' ] || /bin/cp '${HOSTS_PATH}' '${backup}'; /bin/cp '${tmp}' '${HOSTS_PATH}' && /usr/bin/dscacheutil -flushcache; /usr/bin/killall -HUP mDNSResponder || true`,
      domains
        ? 'A ClamMac a kártevő- és követő-domainek blokkolását frissíti (/etc/hosts).'
        : 'A ClamMac eltávolítja a domain-blokkot a /etc/hosts fájlból.'
    )
    this.applied.set({ count, appliedAt: domains ? Date.now() : null })
  }

  private async broadcastStatus(): Promise<HostsStatus> {
    const status = this.getStatus()
    events.broadcast({ type: 'hosts-status', payload: status })
    return status
  }

  private broadcast(): void {
    events.broadcast({ type: 'hosts-status', payload: this.getStatus() })
  }
}

/** hosts-formátum: "0.0.0.0 domain" / "127.0.0.1 domain" / csupasz "domain". */
export function parseHostsFeed(body: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    // IP-prefixes sorból a domain a 2. token; csupasz sorból az 1.
    const host = parts.length >= 2 ? parts[1] : parts[0]
    const d = normalizeHost(host)
    if (!d || d === 'localhost' || d === 'broadcasthost' || seen.has(d)) continue
    if (!isDomain(d)) continue
    seen.add(d)
    out.push(d)
  }
  return out
}

function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
}

function isDomain(s: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)
}

/** A BEGIN/END jelölt blokk (és a körülötte lévő üres sorok) eltávolítása. */
export function stripBlock(content: string): string {
  const beginIdx = content.indexOf(BEGIN)
  if (beginIdx === -1) return content
  const endIdx = content.indexOf(END, beginIdx)
  const after = endIdx === -1 ? content.length : endIdx + END.length
  return (content.slice(0, beginIdx) + content.slice(after)).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

function runAsAdmin(command: string, prompt: string): Promise<void> {
  const script = `do shell script "${esc(command)}" with prompt "${esc(prompt)}" with administrator privileges`
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

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
