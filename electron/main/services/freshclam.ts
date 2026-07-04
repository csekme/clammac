import { spawn } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'
import type { UpdateLogEntry } from '@shared/types'
import { appDirs } from './paths'
import { JsonStore } from './json-store'
import { events } from './events'
import type { ClamdManager } from './clamd-manager'

export class FreshclamService {
  private running: Promise<UpdateLogEntry> | null = null
  private log: JsonStore<UpdateLogEntry[]>

  constructor(private clamd: ClamdManager) {
    this.log = new JsonStore(join(appDirs().userData, 'update-log.json'), [])
  }

  getLog(): UpdateLogEntry[] {
    return this.log.get()
  }

  isRunning(): boolean {
    return this.running !== null
  }

  /** Run freshclam; resolves with the log entry (never rejects). */
  update(): Promise<UpdateLogEntry> {
    if (this.running) return this.running
    this.running = this.doUpdate().finally(() => (this.running = null))
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
      proc.stdout?.on('data', (d) => (out += d.toString()))
      proc.stderr?.on('data', (d) => (out += d.toString()))
      proc.on('error', (err) => {
        resolve({ at: Date.now(), ok: false, message: String(err) })
      })
      proc.on('exit', (code) => {
        const tail = out.split('\n').filter(Boolean).slice(-6).join('\n')
        // exit 0 = updated or up-to-date; 1 = up-to-date on some builds
        const ok = code === 0 || /is up[ -]to[ -]date|updated/i.test(out)
        resolve({ at: Date.now(), ok, message: tail || `freshclam exited with code ${code}` })
      })
    })

    this.log.set([entry, ...this.log.get()].slice(0, 50))
    events.broadcast({ type: 'update-log', payload: entry })
    await this.clamd.reloadDb()
    return entry
  }
}
