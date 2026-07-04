import { ClamdManager } from './clamd-manager'
import { FreshclamService } from './freshclam'
import { QuarantineService } from './quarantine'
import { HistoryStore } from './history-store'
import { ScanCache } from './scan-cache'
import { ScanOrchestrator } from './scan-orchestrator'
import { WatchService } from './watcher'
import { SchedulerService } from './scheduler'
import { ThreatFeedService } from './threat-feeds'
import { NetworkMonitor } from './network-monitor'
import { FirewallService } from './firewall'
import { HostsProtection } from './hosts-protection'

export interface Services {
  clamd: ClamdManager
  freshclam: FreshclamService
  quarantine: QuarantineService
  history: HistoryStore
  scanCache: ScanCache
  scanner: ScanOrchestrator
  watcher: WatchService
  scheduler: SchedulerService
  feeds: ThreatFeedService
  network: NetworkMonitor
  firewall: FirewallService
  hosts: HostsProtection
}

export function createServices(): Services {
  const clamd = new ClamdManager()
  const freshclam = new FreshclamService(clamd)
  const quarantine = new QuarantineService()
  const history = new HistoryStore()
  const scanCache = new ScanCache()
  const scanner = new ScanOrchestrator(clamd, quarantine, history, scanCache)
  const watcher = new WatchService(clamd, quarantine, scanCache)
  const feeds = new ThreatFeedService()
  const network = new NetworkMonitor(feeds)
  const firewall = new FirewallService(feeds)
  network.isIpBlocked = (ip) => firewall.isIpBlocked(ip)
  const hosts = new HostsProtection()
  const scheduler = new SchedulerService(freshclam, scanner, clamd, feeds, hosts)
  return {
    clamd,
    freshclam,
    quarantine,
    history,
    scanCache,
    scanner,
    watcher,
    scheduler,
    feeds,
    network,
    firewall,
    hosts
  }
}
