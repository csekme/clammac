import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs'
import { join, dirname } from 'path'

/** Tiny atomic JSON file store (write to temp + rename). */
export class JsonStore<T> {
  private data: T

  constructor(
    private file: string,
    defaults: T
  ) {
    this.data = defaults
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'))
        if (Array.isArray(defaults)) {
          if (Array.isArray(parsed)) this.data = parsed as T
        } else {
          this.data = { ...defaults, ...parsed }
        }
      } catch {
        // corrupt file -> fall back to defaults
      }
    }
  }

  get(): T {
    return this.data
  }

  set(next: T): void {
    this.data = next
    const tmp = join(dirname(this.file), `.${Date.now()}.tmp`)
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  update(patch: Partial<T>): T {
    this.set({ ...this.data, ...patch })
    return this.data
  }
}
