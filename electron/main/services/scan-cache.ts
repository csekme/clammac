import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { appDirs } from './paths'

const MAX_ENTRIES = 200_000
const FLUSH_DEBOUNCE_MS = 5_000

interface CacheFile {
  /** signature DB + detection settings the entries were scanned with */
  key: string
  /** path -> [size, mtimeMs] */
  entries: Record<string, [number, number]>
}

/**
 * Clean-file cache: a file whose path+size+mtime matched a previous clean scan
 * is skipped. Entries are only valid for one cache key — the daily DB version
 * plus every setting that changes what clamd would detect — so a signature
 * update or a stricter setting silently invalidates everything.
 */
export class ScanCache {
  private file: string
  private key = ''
  private entries = new Map<string, [number, number]>()
  private dirty = false
  private flushTimer: NodeJS.Timeout | null = null

  constructor() {
    this.file = join(appDirs().userData, 'scan-cache.json')
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as CacheFile
        if (parsed && typeof parsed.key === 'string' && parsed.entries) {
          this.key = parsed.key
          this.entries = new Map(Object.entries(parsed.entries))
        }
      }
    } catch {
      // corrupt cache -> start empty
    }
  }

  /** Ensure the cache matches the current DB/settings key; mismatch clears it. */
  prepare(key: string): void {
    if (this.key === key) return
    this.key = key
    if (this.entries.size > 0) {
      this.entries.clear()
      this.markDirty()
    }
  }

  size(): number {
    return this.entries.size
  }

  has(path: string, size: number, mtimeMs: number): boolean {
    const e = this.entries.get(path)
    return e !== undefined && e[0] === size && e[1] === mtimeMs
  }

  addClean(path: string, size: number, mtimeMs: number): void {
    if (this.entries.size >= MAX_ENTRIES && !this.entries.has(path)) {
      // drop the oldest insertions (Map preserves order) to make room
      const drop = Math.max(1, Math.floor(MAX_ENTRIES / 20))
      for (const key of this.entries.keys()) {
        this.entries.delete(key)
        if (this.entries.size <= MAX_ENTRIES - drop) break
      }
    }
    this.entries.set(path, [size, mtimeMs])
    this.markDirty()
  }

  remove(path: string): void {
    if (this.entries.delete(path)) this.markDirty()
  }

  clear(): void {
    if (this.entries.size === 0) return
    this.entries.clear()
    this.markDirty()
  }

  private markDirty(): void {
    this.dirty = true
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_DEBOUNCE_MS)
  }

  /** Atomic write (temp + rename), debounced via markDirty, forced at scan end. */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (!this.dirty) return
    this.dirty = false
    const data: CacheFile = { key: this.key, entries: Object.fromEntries(this.entries) }
    try {
      const tmp = join(dirname(this.file), '.scan-cache.tmp')
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 })
      renameSync(tmp, this.file)
    } catch {
      // cache persistence is best-effort; next scan just re-scans
    }
  }
}
