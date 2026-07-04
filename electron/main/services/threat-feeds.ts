import { join } from 'path'
import type { ThreatFeedStatus } from '@shared/types'
import { appDirs } from './paths'
import { JsonStore } from './json-store'
import { events } from './events'

const FETCH_TIMEOUT_MS = 30_000
/** feedenként ennyi bejegyzés fölött valami félrement — védelem a memória ellen */
const MAX_ENTRIES_PER_FEED = 200_000

/** mit jelez a feed: botnet C2, aktív támadó, vagy kompromittált gép */
export type FeedCategory = 'c2' | 'attacker' | 'compromised'

export interface FeedEntry {
  feed: string
  category: FeedCategory
  /** malware család, ha a feed adja */
  malware: string | null
}

interface FeedFile {
  updatedAt: number | null
  /** ip -> entry */
  entries: Record<string, FeedEntry>
}

/** Soronként egy IP, # kommentek — a legtöbb IP-blocklist ilyen. */
function plainIpList(feed: string, category: FeedCategory) {
  return (body: string): Map<string, FeedEntry> => {
    const out = new Map<string, FeedEntry>()
    for (const line of body.split('\n')) {
      const ip = line.trim().split(/\s+/)[0]
      if (!ip || ip.startsWith('#')) continue
      if (isIpv4(ip)) out.set(ip, { feed, category, malware: null })
    }
    return out
  }
}

interface FeedDef {
  name: string
  url: string
  parse: (body: string) => Map<string, FeedEntry>
}

const FEEDS: FeedDef[] = [
  // botnet C2 — magas konfidencia, gyakran malware-névvel
  {
    name: 'feodo',
    url: 'https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt',
    parse: plainIpList('feodo', 'c2')
  },
  {
    // CSV: "first_seen","ioc_id","ip:port","ioc_type",…,"malware_printable"(7),…
    name: 'threatfox',
    url: 'https://threatfox.abuse.ch/export/csv/ip-port/recent/',
    parse: (body) => {
      const out = new Map<string, FeedEntry>()
      for (const line of body.split('\n')) {
        if (!line || line.startsWith('#')) continue
        const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
        const ip = cols[2]?.split(':')[0]
        if (!ip || !isIpv4(ip)) continue
        const malware = cols[7] && cols[7] !== 'None' ? cols[7] : null
        out.set(ip, { feed: 'threatfox', category: 'c2', malware })
      }
      return out
    }
  },
  // aktív támadó IP-k (brute-force, port-scan) — főleg a bejövő PF-blokknál hasznos
  {
    name: 'cins',
    url: 'https://cinsscore.com/list/ci-badguys.txt',
    parse: plainIpList('cins', 'attacker')
  },
  {
    name: 'blocklist.de',
    url: 'https://lists.blocklist.de/lists/all.txt',
    parse: plainIpList('blocklist.de', 'attacker')
  },
  // ismert kompromittált gépek
  {
    name: 'et-compromised',
    url: 'https://rules.emergingthreats.net/blockrules/compromised-ips.txt',
    parse: plainIpList('et-compromised', 'compromised')
  }
]

/**
 * abuse.ch threat-intel feedek: ismert botnet C2 / malware IP-k. A
 * NetworkMonitor riasztáshoz, a FirewallService PF blocklisthez használja.
 */
export class ThreatFeedService {
  private store: JsonStore<FeedFile>
  private entries = new Map<string, FeedEntry>()
  private updating = false
  private lastError: string | null = null

  constructor() {
    this.store = new JsonStore<FeedFile>(join(appDirs().userData, 'threat-feeds.json'), {
      updatedAt: null,
      entries: {}
    })
    this.entries = new Map(Object.entries(this.store.get().entries))
  }

  getStatus(): ThreatFeedStatus {
    return {
      updatedAt: this.store.get().updatedAt,
      updating: this.updating,
      entryCount: this.entries.size,
      error: this.lastError
    }
  }

  match(ip: string): FeedEntry | null {
    return this.entries.get(ip) ?? null
  }

  /** Az összes ismert rossz IP — a PF blocklist ebből épül. */
  allIps(): string[] {
    return [...this.entries.keys()]
  }

  isStale(maxAgeMs: number): boolean {
    const at = this.store.get().updatedAt
    return !at || Date.now() - at > maxAgeMs
  }

  /** Mindkét feed letöltése; részleges siker is siker (a másik feed hibája nem dobja el). */
  async update(): Promise<ThreatFeedStatus> {
    if (this.updating) return this.getStatus()
    this.updating = true
    this.broadcast()
    const errors: string[] = []
    const merged = new Map<string, FeedEntry>()
    try {
      for (const feed of FEEDS) {
        try {
          const res = await fetch(feed.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const parsed = feed.parse(await res.text())
          if (parsed.size > MAX_ENTRIES_PER_FEED) throw new Error('gyanúsan nagy feed, eldobva')
          for (const [ip, entry] of parsed) {
            // a konkrétabb C2-találat (malware-névvel) győz az általánosabb feed felett
            const existing = merged.get(ip)
            if (existing && existing.category === 'c2' && entry.category !== 'c2') continue
            merged.set(ip, entry)
          }
        } catch (err) {
          errors.push(`${feed.name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      // csak akkor írjuk felül a meglévőt, ha legalább az egyik feed lejött
      if (errors.length < FEEDS.length) {
        this.entries = merged
        this.store.set({ updatedAt: Date.now(), entries: Object.fromEntries(merged) })
      }
      this.lastError = errors.length > 0 ? errors.join(' · ') : null
    } finally {
      this.updating = false
      this.broadcast()
    }
    return this.getStatus()
  }

  private broadcast(): void {
    events.broadcast({ type: 'feed-status', payload: this.getStatus() })
  }
}

function isIpv4(s: string): boolean {
  const parts = s.split('.')
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}
