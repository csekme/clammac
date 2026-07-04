import { randomUUID } from 'crypto'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { homedir, cpus } from 'os'
import type { Settings, ScanProgress, ScanType } from '@shared/types'
import { isPuaSignature } from '@shared/signatures'
import type { ClamdManager } from './clamd-manager'
import type { QuarantineService } from './quarantine'
import type { HistoryStore } from './history-store'
import type { ScanCache } from './scan-cache'
import { getSettings } from './settings-store'
import { events } from './events'
import { notifyDetections } from './notifications'

// one worker per clamd connection; clamd.conf MaxThreads is sized to match
const CONCURRENCY = Math.min(8, Math.max(2, cpus().length - 2))
const PROGRESS_INTERVAL_MS = 150
const LOG_FLUSH_LINES = 50
const LOG_FLUSH_MS = 250

/** One scan run: progress is the shared broadcast object, cancelled is run-local. */
interface Run {
  progress: ScanProgress
  cancelled: boolean
  logLines: string[]
  lastLogFlush: number
}

/** Enumerated file with the stats the scan cache keys on. */
interface FileEntry {
  path: string
  size: number
  mtimeMs: number
}

export class ScanOrchestrator {
  private current: Run | null = null

  constructor(
    private clamd: ClamdManager,
    private quarantine: QuarantineService,
    private history: HistoryStore,
    private cache: ScanCache
  ) {}

  /** The in-flight scan, or null — finished runs are not reported as active. */
  getActive(): ScanProgress | null {
    const run = this.current
    if (!run) return null
    const live = run.progress.status === 'running' || run.progress.status === 'enumerating'
    return live ? run.progress : null
  }

  /** Immediate: flips status and broadcasts; workers drain in the background. */
  cancel(scanId: string): void {
    const run = this.current
    if (!run || run.progress.scanId !== scanId) return
    if (run.progress.status !== 'running' && run.progress.status !== 'enumerating') return
    run.cancelled = true
    run.progress.status = 'cancelled'
    this.broadcast(run)
  }

  async start(type: ScanType, customPaths?: string[], origin = 'user'): Promise<string> {
    if (this.getActive()) throw new Error('A scan is already running')
    await this.clamd.start()

    const roots = rootsFor(type, customPaths)
    const run: Run = {
      progress: {
        scanId: randomUUID(),
        type,
        status: 'enumerating',
        scanned: 0,
        total: 0,
        cached: 0,
        currentPath: '',
        detections: [],
        startedAt: Date.now(),
        finishedAt: null,
        error: null
      },
      cancelled: false,
      logLines: [],
      lastLogFlush: 0
    }
    this.current = run
    this.broadcast(run)

    // run in the background; caller gets the scanId immediately
    void this.run(run, roots, origin)
    return run.progress.scanId
  }

  private async run(run: Run, roots: string[], origin: string): Promise<void> {
    const { progress } = run
    try {
      const settings = getSettings()
      const verbose = settings.verboseScanLog
      const maxBytes = settings.maxFileSizeMB * 1024 * 1024
      const useCache = settings.scanCacheEnabled
      if (useCache) this.cache.prepare(cacheKey(this.clamd, settings))

      const files: FileEntry[] = []
      for (const root of roots) {
        if (run.cancelled) break
        await this.enumerate(run, root, settings.exclusions, maxBytes, files)
      }
      progress.total = files.length
      if (!run.cancelled) progress.status = 'running'
      this.broadcast(run)
      if (verbose) this.log(run, `${files.length} fájl a várólistán (${roots.join(', ')})`)

      let lastBroadcast = 0
      let index = 0
      const worker = async (): Promise<void> => {
        while (!run.cancelled) {
          const file = files[index++]
          if (file === undefined) return
          if (useCache && this.cache.has(file.path, file.size, file.mtimeMs)) {
            progress.scanned++
            progress.cached++
            continue
          }
          progress.currentPath = file.path
          const result = await this.scanFile(file.path)
          progress.scanned++
          if (result.infected && result.signature) {
            this.cache.remove(file.path)
            this.handleDetection(run, file.path, result.signature, origin)
            if (verbose) this.log(run, `FOUND   ${result.signature}  ${file.path}`)
          } else if (result.error) {
            if (verbose) this.log(run, `ERROR   ${result.error}  ${file.path}`)
          } else {
            if (useCache) this.cache.addClean(file.path, file.size, file.mtimeMs)
            if (verbose) this.log(run, `OK      ${file.path}`)
          }
          const now = Date.now()
          if (now - lastBroadcast > PROGRESS_INTERVAL_MS) {
            lastBroadcast = now
            this.broadcast(run)
          }
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker))
      if (verbose && progress.cached > 0) {
        this.log(run, `${progress.cached} fájl kihagyva (gyorsítótár: változatlan, korábban tiszta)`)
      }

      progress.status = run.cancelled ? 'cancelled' : 'done'
    } catch (err) {
      progress.status = 'error'
      progress.error = String(err instanceof Error ? err.message : err)
    }
    progress.finishedAt = Date.now()
    progress.currentPath = ''
    this.cache.flush()
    this.flushLog(run, true)
    this.broadcast(run)

    this.history.add({
      scanId: progress.scanId,
      type: progress.type,
      status: progress.status,
      scanned: progress.scanned,
      cached: progress.cached,
      detections: progress.detections,
      startedAt: progress.startedAt,
      finishedAt: progress.finishedAt,
      origin
    })
    if (progress.status === 'done') notifyDetections(progress.detections, origin)
  }

  /**
   * SCAN first (clamd reads the file itself — no data copy), INSTREAM as
   * fallback when clamd can't read the path (permissions, sandbox).
   */
  private async scanFile(
    path: string
  ): Promise<{ infected: boolean; signature: string | null; error: string | null }> {
    try {
      const result = await this.clamd.client.scanPath(path)
      if (!result.error) return result
      return await this.clamd.client.scanStream(path)
    } catch (err) {
      return { infected: false, signature: null, error: String(err) }
    }
  }

  private handleDetection(run: Run, path: string, signature: string, origin: string): void {
    let quarantineId: string | null = null
    // PUA hits are advisory (often false positives on dev tools) — report only
    if (getSettings().autoQuarantine && !isPuaSignature(signature)) {
      try {
        quarantineId = this.quarantine.quarantine(path, signature, origin).id
      } catch {
        // file vanished or unreadable; report the detection without quarantine
      }
    }
    run.progress.detections.push({ path, signature, quarantineId, at: Date.now() })
    this.broadcast(run)
  }

  private async enumerate(
    run: Run,
    root: string,
    exclusions: string[],
    maxBytes: number,
    out: FileEntry[]
  ): Promise<void> {
    if (run.cancelled || isExcluded(root, exclusions)) return
    let stat
    try {
      stat = await fsp.lstat(root)
    } catch {
      return
    }
    if (stat.isSymbolicLink()) return
    if (stat.isFile()) {
      if (stat.size > 0 && stat.size <= maxBytes) {
        out.push({ path: root, size: stat.size, mtimeMs: stat.mtimeMs })
      }
      return
    }
    if (!stat.isDirectory()) return
    let entries
    try {
      entries = await fsp.readdir(root)
    } catch {
      return
    }
    for (const entry of entries) {
      if (run.cancelled) return
      await this.enumerate(run, join(root, entry), exclusions, maxBytes, out)
    }
    if (out.length % 500 === 0) this.broadcast(run)
  }

  private log(run: Run, line: string): void {
    run.logLines.push(line)
    this.flushLog(run, run.logLines.length >= LOG_FLUSH_LINES)
  }

  private flushLog(run: Run, force = false): void {
    if (run.logLines.length === 0) return
    const now = Date.now()
    if (!force && now - run.lastLogFlush < LOG_FLUSH_MS) return
    run.lastLogFlush = now
    events.broadcast({
      type: 'scan-log',
      payload: { scanId: run.progress.scanId, lines: run.logLines.splice(0) }
    })
  }

  private broadcast(run: Run): void {
    events.broadcast({ type: 'scan-progress', payload: { ...run.progress } })
  }
}

/**
 * Cache entries are only comparable if both the signature DB and every
 * detection-relevant setting match the run that produced them.
 */
export function cacheKey(clamd: ClamdManager, s: Settings): string {
  const db = clamd.getDbStatus()
  // VERSION reply is "ClamAV x.y.z/<daily>/<build date>" — only the binary part matters here
  const engine = (clamd.getStatus().version ?? '?').split('/')[0]
  return [
    `daily#${db.dailyVersion ?? '?'}`,
    `engine:${engine}`,
    `pua:${s.detectPua ? 1 : 0}`,
    `arc:${s.scanArchives ? 1 : 0}`,
    `max:${s.maxFileSizeMB}`
  ].join('|')
}

function rootsFor(type: ScanType, customPaths?: string[]): string[] {
  const home = homedir()
  switch (type) {
    case 'quick':
      return [
        join(home, 'Downloads'),
        join(home, 'Desktop'),
        join(home, 'Documents'),
        '/Applications'
      ]
    case 'full':
      return [home, '/Applications']
    case 'custom': {
      if (!customPaths?.length) throw new Error('Custom scan requires at least one path')
      return customPaths
    }
  }
}

export function isExcluded(path: string, exclusions: string[]): boolean {
  return exclusions.some((ex) => {
    if (!ex) return false
    if (ex.startsWith('/')) return path === ex || path.startsWith(ex.endsWith('/') ? ex : ex + '/')
    return path.split('/').includes(ex) || path.includes(`/${ex}/`)
  })
}
