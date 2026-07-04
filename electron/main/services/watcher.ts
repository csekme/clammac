import chokidar, { FSWatcher } from 'chokidar'
import { promises as fsp } from 'fs'
import type { Detection } from '@shared/types'
import { isPuaSignature } from '@shared/signatures'
import type { ClamdManager } from './clamd-manager'
import type { QuarantineService } from './quarantine'
import type { ScanCache } from './scan-cache'
import { getSettings } from './settings-store'
import { isExcluded, cacheKey } from './scan-orchestrator'
import { events } from './events'
import { notifyRealtimeDetection } from './notifications'

/**
 * User-space real-time protection: watches configured folders (FSEvents via
 * chokidar) and INSTREAM-scans new/changed files.
 */
export class WatchService {
  private watcher: FSWatcher | null = null
  private queue: string[] = []
  private draining = false

  constructor(
    private clamd: ClamdManager,
    private quarantine: QuarantineService,
    private cache: ScanCache
  ) {}

  isEnabled(): boolean {
    return this.watcher !== null
  }

  /** (Re)apply current settings: start, stop or re-scope the watcher. */
  async sync(): Promise<void> {
    const s = getSettings()
    await this.stop()
    if (!s.realtimeEnabled || s.watchPaths.length === 0) return

    this.watcher = chokidar.watch(s.watchPaths, {
      ignoreInitial: true,
      depth: 6,
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
      ignored: (path: string) => isExcluded(path, getSettings().exclusions)
    })
    this.watcher.on('add', (path: string) => this.enqueue(path))
    this.watcher.on('change', (path: string) => this.enqueue(path))
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }

  private enqueue(path: string): void {
    // ignore our own quarantine payloads and partial downloads
    if (/\.(qtn|crdownload|download|part|tmp)$/i.test(path)) return
    if (!this.queue.includes(path)) this.queue.push(path)
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      await this.clamd.start().catch(() => undefined)
      const settings = getSettings()
      const useCache = settings.scanCacheEnabled
      if (useCache) this.cache.prepare(cacheKey(this.clamd, settings))
      let path: string | undefined
      while ((path = this.queue.shift()) !== undefined) {
        if (this.clamd.getStatus().state !== 'running') break
        const stat = await fsp.stat(path).catch(() => null)
        if (!stat || !stat.isFile()) continue
        if (useCache && this.cache.has(path, stat.size, stat.mtimeMs)) continue
        const result = await this.clamd.client
          .scanStream(path)
          .catch(() => ({ path: path!, infected: false, signature: null, error: 'scan failed' }))
        if (!result.infected || !result.signature) {
          if (useCache && !result.error) this.cache.addClean(path, stat.size, stat.mtimeMs)
          continue
        }
        this.cache.remove(path)

        let quarantineId: string | null = null
        // PUA hits are advisory (often false positives on dev tools) — report only
        if (getSettings().autoQuarantine && !isPuaSignature(result.signature)) {
          try {
            quarantineId = this.quarantine.quarantine(path, result.signature, 'watcher').id
          } catch {
            /* file disappeared before quarantine */
          }
        }
        const detection: Detection = {
          path,
          signature: result.signature,
          quarantineId,
          at: Date.now()
        }
        events.broadcast({ type: 'realtime-detection', payload: detection })
        notifyRealtimeDetection(detection)
      }
    } finally {
      this.draining = false
    }
    if (this.queue.length > 0) void this.drain()
  }
}
