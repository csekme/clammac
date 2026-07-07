import { spawn } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'
import type { UpdateLogEntry } from '@shared/types'
import { appDirs } from './paths'
import { JsonStore } from './json-store'
import { events } from './events'
import type { ClamdManager } from './clamd-manager'

interface UpdateCheckState {
  lastCheckAt: number | null
  lastOk: boolean | null
}

export class FreshclamService {
  private running: Promise<UpdateLogEntry> | null = null
  private log: JsonStore<UpdateLogEntry[]>
  /** a naplótól függetlenül tárolva, hogy a napló törlése ne indítson új ellenőrzést */
  private state: JsonStore<UpdateCheckState>

  constructor(private clamd: ClamdManager) {
    this.log = new JsonStore(join(appDirs().userData, 'update-log.json'), [])
    this.state = new JsonStore(join(appDirs().userData, 'update-state.json'), {
      lastCheckAt: null,
      lastOk: null
    })
  }

  getLog(): UpdateLogEntry[] {
    return this.log.get()
  }

  clearLog(): void {
    this.log.set([])
  }

  /** When the last check ran — the scheduler decides staleness from this. */
  lastAttempt(): { at: number; ok: boolean } | null {
    const s = this.state.get()
    return s.lastCheckAt === null ? null : { at: s.lastCheckAt, ok: s.lastOk ?? true }
  }

  isRunning(): boolean {
    return this.running !== null
  }

  /** Run freshclam; resolves with the log entry (never rejects). */
  update(): Promise<UpdateLogEntry> {
    if (this.running) return this.running
    this.running = this.doUpdate().finally(() => {
      this.running = null
      // garantált záró státusz: a reloadDb közben lekért getStatus még
      // updating=true-t adhatott, e nélkül a UI gombja beragadna
      events.broadcast({ type: 'db-status', payload: this.clamd.getDbStatus(false) })
    })
    return this.running
  }

  private async doUpdate(): Promise<UpdateLogEntry> {
    const entry = await new Promise<UpdateLogEntry>((resolve) => {
      if (!this.clamd.binaries) {
        resolve({ at: Date.now(), ok: false, message: 'ClamAV binaries not found' })
        return
      }
      events.broadcast({ type: 'db-status', payload: this.clamd.getDbStatus(true) })

      const dirs = appDirs()
      const conf = join(dirs.conf, 'freshclam.conf')
      writeFileSync(
        conf,
        [
          `DatabaseDirectory ${dirs.db}`,
          `UpdateLogFile ${join(dirs.logs, 'freshclam.log')}`,
          'DatabaseMirror database.clamav.net',
          'ScriptedUpdates yes',
          'LogTime yes',
          'Foreground yes'
        ].join('\n') + '\n',
        { mode: 0o600 }
      )

      const proc = spawn(this.clamd.binaries.freshclam, ['--config-file', conf], {
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let out = ''
      let lineBuf = ''
      const consume = (chunk: string): void => {
        out += chunk
        lineBuf += chunk
        // a letöltési folyamatjelzőt \r-rel írja felül a freshclam
        const lines = lineBuf.split(/\r\n|[\r\n]/)
        lineBuf = lines.pop() ?? ''
        const clean = lines.map((l) => l.trimEnd()).filter(Boolean)
        if (clean.length > 0) {
          events.broadcast({ type: 'update-progress', payload: { lines: clean } })
        }
      }
      proc.stdout?.on('data', (d) => consume(d.toString()))
      proc.stderr?.on('data', (d) => consume(d.toString()))
      proc.on('error', (err) => {
        resolve({ at: Date.now(), ok: false, message: String(err) })
      })
      proc.on('exit', (code) => {
        if (lineBuf.trim()) {
          events.broadcast({ type: 'update-progress', payload: { lines: [lineBuf.trimEnd()] } })
        }
        const tail = out.split('\n').filter(Boolean).slice(-6).join('\n')
        // exit 0 = updated or up-to-date; 1 = up-to-date on some builds
        const ok = code === 0 || /is up[ -]to[ -]date|updated/i.test(out)
        resolve({ at: Date.now(), ok, message: tail || `freshclam exited with code ${code}` })
      })
    })

    this.state.set({ lastCheckAt: entry.at, lastOk: entry.ok })
    this.log.set([entry, ...this.log.get()].slice(0, 50))
    events.broadcast({ type: 'update-log', payload: entry })
    await this.clamd.reloadDb()
    return entry
  }
}
