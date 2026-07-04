import { createHash, randomBytes, randomUUID } from 'crypto'
import { readFileSync, writeFileSync, unlinkSync, statSync, existsSync, mkdirSync } from 'fs'
import { join, dirname, basename } from 'path'
import { homedir } from 'os'
import type { QuarantineItem, RestoreResult } from '@shared/types'
import { appDirs } from './paths'
import { JsonStore } from './json-store'
import { events } from './events'

interface StoredItem extends QuarantineItem {
  /** hex key used to de/obfuscate the payload */
  key: string
}

/**
 * Quarantine: files are moved into a 0700 directory and XOR-obfuscated with a
 * random per-file key, so they are inert (not executable, not re-detected by
 * scans/Spotlight) but perfectly restorable.
 */
export class QuarantineService {
  private store: JsonStore<StoredItem[]>

  constructor() {
    this.store = new JsonStore(join(appDirs().userData, 'quarantine.json'), [])
  }

  list(): QuarantineItem[] {
    return this.store.get().map(({ key: _key, ...item }) => item)
  }

  count(): number {
    return this.store.get().length
  }

  private payloadPath(id: string): string {
    return join(appDirs().quarantine, `${id}.qtn`)
  }

  quarantine(originalPath: string, signature: string, origin: string): QuarantineItem {
    const data = readFileSync(originalPath)
    const size = statSync(originalPath).size
    const sha256 = createHash('sha256').update(data).digest('hex')
    const key = randomBytes(32)
    const id = randomUUID()

    writeFileSync(this.payloadPath(id), xor(data, key), { mode: 0o600 })
    unlinkSync(originalPath)

    const item: StoredItem = {
      id,
      originalPath,
      signature,
      size,
      sha256,
      quarantinedAt: Date.now(),
      origin,
      key: key.toString('hex')
    }
    this.store.set([item, ...this.store.get()])
    this.notifyChanged()
    const { key: _key, ...pub } = item
    return pub
  }

  restore(id: string): RestoreResult {
    const item = this.store.get().find((i) => i.id === id)
    if (!item) throw new Error('Quarantine item not found')
    const payload = this.payloadPath(id)
    if (!existsSync(payload)) throw new Error('Quarantine payload missing')

    const data = xor(readFileSync(payload), Buffer.from(item.key, 'hex'))

    // Prefer the original location; if it's not writable (e.g. a protected
    // /Applications bundle -> EPERM/EACCES) fall back to ~/Downloads so the
    // restore still succeeds and the user can move the file back manually.
    let target = item.originalPath
    if (existsSync(target)) target = `${target}.restored-${Date.now()}`
    let fellBack = false
    try {
      writeFileSync(target, data, { mode: 0o600 })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOENT' && code !== 'EROFS') throw err
      fellBack = true
      const dir = join(homedir(), 'Downloads', 'ClamMac-visszaallitva')
      mkdirSync(dir, { recursive: true })
      target = join(dir, basename(item.originalPath))
      if (existsSync(target)) target = join(dir, `${Date.now()}-${basename(item.originalPath)}`)
      writeFileSync(target, data, { mode: 0o600 })
    }

    unlinkSync(payload)
    this.store.set(this.store.get().filter((i) => i.id !== id))
    this.notifyChanged()
    return { restoredPath: target, fellBack, originalPath: item.originalPath }
  }

  remove(id: string): void {
    const item = this.store.get().find((i) => i.id === id)
    if (!item) throw new Error('Quarantine item not found')
    const payload = this.payloadPath(id)
    if (existsSync(payload)) unlinkSync(payload)
    this.store.set(this.store.get().filter((i) => i.id !== id))
    this.notifyChanged()
  }

  private notifyChanged(): void {
    events.broadcast({ type: 'quarantine-changed', payload: { count: this.count() } })
  }
}

function xor(data: Buffer, key: Buffer): Buffer {
  const out = Buffer.allocUnsafe(data.length)
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length]
  return out
}
