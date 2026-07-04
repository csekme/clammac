import { ClamdManager } from './clamd-manager'
import { FreshclamService } from './freshclam'
import { QuarantineService } from './quarantine'
import { HistoryStore } from './history-store'
import { ScanCache } from './scan-cache'
import { ScanOrchestrator } from './scan-orchestrator'
import { WatchService } from './watcher'
import { SchedulerService } from './scheduler'

export interface Services {
  clamd: ClamdManager
  freshclam: FreshclamService
  quarantine: QuarantineService
  history: HistoryStore
  scanCache: ScanCache
  scanner: ScanOrchestrator
  watcher: WatchService
  scheduler: SchedulerService
}

export function createServices(): Services {
  const clamd = new ClamdManager()
  const freshclam = new FreshclamService(clamd)
  const quarantine = new QuarantineService()
  const history = new HistoryStore()
  const scanCache = new ScanCache()
  const scanner = new ScanOrchestrator(clamd, quarantine, history, scanCache)
  const watcher = new WatchService(clamd, quarantine, scanCache)
  const scheduler = new SchedulerService(freshclam, scanner, clamd)
  return { clamd, freshclam, quarantine, history, scanCache, scanner, watcher, scheduler }
}
