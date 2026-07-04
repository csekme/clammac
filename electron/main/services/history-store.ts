import { join } from 'path'
import type { ScanRecord } from '@shared/types'
import { appDirs } from './paths'
import { JsonStore } from './json-store'

const MAX_RECORDS = 200

export class HistoryStore {
  private store: JsonStore<ScanRecord[]>

  constructor() {
    this.store = new JsonStore(join(appDirs().userData, 'history.json'), [])
  }

  list(): ScanRecord[] {
    return this.store.get()
  }

  last(): ScanRecord | null {
    return this.store.get()[0] ?? null
  }

  add(record: ScanRecord): void {
    this.store.set([record, ...this.store.get()].slice(0, MAX_RECORDS))
  }

  clear(): void {
    this.store.set([])
  }
}
