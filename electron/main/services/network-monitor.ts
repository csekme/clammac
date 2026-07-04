import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { join } from 'path'
import type { NetworkAlert, NetworkConnection } from '@shared/types'
import { appDirs } from './paths'
import { JsonStore } from './json-store'
import type { ThreatFeedService } from './threat-feeds'
import { getSettings } from './settings-store'
import { events } from './events'
import { notifyNetworkAlert } from './notifications'

const POLL_MS = 5_000
const MAX_ALERTS = 200

/**
 * F1 — hálózati monitor: lsof-fal pollozza a kimenő kapcsolatokat és a
 * threat-feedekkel egyezteti. Riasztás, nem blokkolás (azt a PF blocklist
 * végzi, ha be van kapcsolva).
 */
export class NetworkMonitor {
  private timer: NodeJS.Timeout | null = null
  private polling = false
  private connections: NetworkConnection[] = []
  private firstSeen = new Map<string, number>()
  /** pid|ip — sessionönként egyszer riasztunk ugyanarra */
  private alerted = new Set<string>()
  private alerts: JsonStore<NetworkAlert[]>
  /** a FirewallService állítja; a riasztás "blocked" jelzéséhez kell */
  isIpBlocked: (ip: string) => boolean = () => false

  constructor(private feeds: ThreatFeedService) {
    this.alerts = new JsonStore(join(appDirs().userData, 'network-alerts.json'), [])
  }

  isRunning(): boolean {
    return this.timer !== null
  }

  /** Beállítás-változáskor hívandó: indít/leállít az aktuális settings szerint. */
  sync(): void {
    const enabled = getSettings().networkMonitorEnabled
    if (enabled && !this.timer) {
      this.timer = setInterval(() => void this.poll(), POLL_MS)
      void this.poll()
    } else if (!enabled && this.timer) {
      this.stop()
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.connections = []
  }

  list(): NetworkConnection[] {
    return this.connections
  }

  listAlerts(): NetworkAlert[] {
    return this.alerts.get()
  }

  clearAlerts(): void {
    this.alerts.set([])
  }

  private async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const raw = await lsof()
      const now = Date.now()
      const seen = new Set<string>()
      const conns: NetworkConnection[] = []
      for (const c of raw) {
        const key = `${c.pid}|${c.protocol}|${c.remoteIp}:${c.remotePort}`
        seen.add(key)
        if (!this.firstSeen.has(key)) this.firstSeen.set(key, now)
        conns.push({ ...c, firstSeen: this.firstSeen.get(key)! })
      }
      for (const key of this.firstSeen.keys()) {
        if (!seen.has(key)) this.firstSeen.delete(key)
      }
      this.connections = conns
      events.broadcast({ type: 'network-connections', payload: conns })
      this.checkFeeds(conns)
    } catch {
      /* lsof hiba (pl. időtúllépés) — következő poll újrapróbálja */
    } finally {
      this.polling = false
    }
  }

  private checkFeeds(conns: NetworkConnection[]): void {
    for (const conn of conns) {
      const hit = this.feeds.match(conn.remoteIp)
      if (!hit) continue
      const dedupeKey = `${conn.pid}|${conn.remoteIp}`
      if (this.alerted.has(dedupeKey)) continue
      this.alerted.add(dedupeKey)
      const alert: NetworkAlert = {
        id: randomUUID(),
        at: Date.now(),
        connection: conn,
        feed: hit.feed,
        category: hit.category,
        indicator: conn.remoteIp,
        malware: hit.malware,
        blocked: this.isIpBlocked(conn.remoteIp)
      }
      this.alerts.set([alert, ...this.alerts.get()].slice(0, MAX_ALERTS))
      events.broadcast({ type: 'network-alert', payload: alert })
      notifyNetworkAlert(alert)
    }
  }
}

type RawConnection = Omit<NetworkConnection, 'firstSeen'>

/**
 * lsof -F géppel olvasható kimenete: p<pid>, c<parancs>, majd fd-nként
 * P<TCP|UDP>, n<local->remote>, TST=<állapot>. Csak a távoli (->) és nem
 * loopback kapcsolatok érdekesek.
 */
function lsof(): Promise<RawConnection[]> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/sbin/lsof',
      ['-nP', '-iTCP', '-iUDP', '-FpcPnT'],
      { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        // lsof nem-nulla kóddal is adhat használható kimenetet (pl. jogosultsági
        // figyelmeztetések más processzeknél) — a stdout számít
        if (err && !stdout) return reject(err)
        resolve(parseLsof(stdout))
      }
    )
  })
}

export function parseLsof(out: string): RawConnection[] {
  const conns: RawConnection[] = []
  const dedupe = new Set<string>()
  let pid = 0
  let proc = ''
  let proto: 'tcp' | 'udp' = 'tcp'
  let name = ''
  let state = ''
  const flush = (): void => {
    if (!name.includes('->')) return
    const remote = name.split('->')[1]
    const m = remote.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/)
    if (!m) return // IPv6 és hostname kihagyva (a feedek IPv4-esek)
    const [, ip, port] = m
    if (ip.startsWith('127.')) return
    const key = `${pid}|${proto}|${ip}:${port}`
    if (dedupe.has(key)) return
    dedupe.add(key)
    conns.push({
      pid,
      process: proc,
      protocol: proto,
      remoteIp: ip,
      remotePort: Number(port),
      state
    })
  }
  for (const line of out.split('\n')) {
    const tag = line[0]
    const value = line.slice(1)
    switch (tag) {
      case 'p':
        flush()
        name = ''
        state = ''
        pid = Number(value)
        break
      case 'c':
        proc = value
        break
      case 'P':
        flush()
        name = ''
        state = ''
        proto = value === 'UDP' ? 'udp' : 'tcp'
        break
      case 'n':
        flush()
        state = ''
        name = value
        break
      case 'T':
        if (value.startsWith('ST=')) state = value.slice(3)
        break
    }
  }
  flush()
  return conns
}
