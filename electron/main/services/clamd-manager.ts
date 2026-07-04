import { spawn, ChildProcess } from 'child_process'
import { existsSync, writeFileSync, statSync, openSync, readSync, closeSync, readdirSync } from 'fs'
import { join } from 'path'
import { cpus } from 'os'
import type { DbStatus, EngineStatus } from '@shared/types'
import { appDirs, resolveClamBinaries, ClamBinaries } from './paths'
import { ClamdClient } from './clamd-client'
import { getSettings } from './settings-store'
import { events } from './events'

const START_TIMEOUT_MS = 90_000

export class ClamdManager {
  private proc: ChildProcess | null = null
  private status: EngineStatus = { state: 'stopped', version: null, binaryPath: null, error: null }
  private starting: Promise<void> | null = null
  readonly binaries: ClamBinaries | null
  readonly socketPath: string
  readonly client: ClamdClient

  constructor() {
    this.binaries = resolveClamBinaries()
    this.socketPath = join(appDirs().run, 'clamd.sock')
    this.client = new ClamdClient(this.socketPath)
    if (!this.binaries) {
      this.setStatus({ state: 'not-installed', error: 'ClamAV binaries not found' })
    } else {
      this.setStatus({ binaryPath: this.binaries.clamd })
    }
  }

  getStatus(): EngineStatus {
    return this.status
  }

  private setStatus(patch: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...patch }
    events.broadcast({ type: 'engine-status', payload: this.status })
  }

  getDbStatus(updating = false): DbStatus {
    const db = appDirs().db
    let present = false
    let dailyVersion: number | null = null
    let updatedAt: number | null = null
    try {
      const files = readdirSync(db).filter((f) => /\.(cvd|cld)$/.test(f))
      present = files.some((f) => f.startsWith('main') || f.startsWith('daily'))
      for (const name of ['daily.cld', 'daily.cvd']) {
        const p = join(db, name)
        if (!existsSync(p)) continue
        updatedAt = statSync(p).mtimeMs
        dailyVersion = readCvdVersion(p)
        break
      }
    } catch {
      /* db dir unreadable -> treated as missing */
    }
    return { present, dailyVersion, updatedAt, updating }
  }

  private writeConfig(): string {
    const dirs = appDirs()
    const s = getSettings()
    const conf = join(dirs.conf, 'clamd.conf')
    const lines = [
      `LocalSocket ${this.socketPath}`,
      'FixStaleSocket yes',
      `DatabaseDirectory ${dirs.db}`,
      `LogFile ${join(dirs.logs, 'clamd.log')}`,
      'LogTime yes',
      'Foreground yes',
      `MaxFileSize ${s.maxFileSizeMB}M`,
      `MaxScanSize ${Math.min(s.maxFileSizeMB * 4, 4000)}M`,
      `StreamMaxLength ${s.maxFileSizeMB}M`,
      `ScanArchive ${s.scanArchives ? 'yes' : 'no'}`,
      `DetectPUA ${s.detectPua ? 'yes' : 'no'}`,
      // enough threads for the scan workers plus the watcher's INSTREAM connection
      `MaxThreads ${Math.min(16, Math.max(8, cpus().length))}`,
      'IdleTimeout 300',
      'SelfCheck 3600'
    ]
    writeFileSync(conf, lines.join('\n') + '\n', { mode: 0o600 })
    return conf
  }

  /** Start clamd if not running. Resolves when the daemon answers PING. */
  async start(): Promise<void> {
    if (this.status.state === 'running' && (await this.client.ping())) return
    if (this.starting) return this.starting
    this.starting = this.doStart().finally(() => (this.starting = null))
    return this.starting
  }

  private async doStart(): Promise<void> {
    if (!this.binaries) {
      this.setStatus({ state: 'not-installed', error: 'ClamAV binaries not found' })
      throw new Error('ClamAV binaries not found')
    }
    if (!this.getDbStatus().present) {
      this.setStatus({ state: 'db-missing', error: null })
      throw new Error('Signature database missing — run an update first')
    }

    this.setStatus({ state: 'starting', error: null })
    const conf = this.writeConfig()
    const proc = spawn(this.binaries.clamd, ['--config-file', conf], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.proc = proc
    let stderr = ''
    proc.stderr?.on('data', (d) => (stderr += d.toString()))
    proc.on('exit', (code) => {
      if (this.proc === proc) {
        this.proc = null
        if (this.status.state !== 'stopped') {
          this.setStatus({
            state: 'error',
            error: `clamd exited (code ${code}): ${stderr.slice(-500)}`
          })
        }
      }
    })

    // clamd loads ~1GB of signatures; poll the socket until it responds
    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) break
      if (existsSync(this.socketPath) && (await this.client.ping())) {
        const version = await this.client.version().catch(() => null)
        this.setStatus({ state: 'running', version, error: null })
        return
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    proc.kill('SIGKILL')
    this.setStatus({ state: 'error', error: `clamd failed to start: ${stderr.slice(-500)}` })
    throw new Error(this.status.error ?? 'clamd failed to start')
  }

  async stop(): Promise<void> {
    const proc = this.proc
    this.proc = null
    this.setStatus({ state: 'stopped', version: null, error: null })
    if (!proc) return
    await this.client.shutdown()
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 5000)
      proc.once('exit', () => {
        clearTimeout(t)
        resolve()
      })
    })
  }

  /** Reload signatures after a freshclam update (or start if not yet running). */
  async reloadDb(): Promise<void> {
    events.broadcast({ type: 'db-status', payload: this.getDbStatus() })
    if (this.status.state === 'running') {
      await this.client.reload().catch(() => undefined)
    } else if (this.getDbStatus().present) {
      await this.start().catch(() => undefined)
    }
  }
}

/** CVD/CLD files start with "ClamAV-VDB:<build time>:<version>:..." */
function readCvdVersion(path: string): number | null {
  try {
    const fd = openSync(path, 'r')
    const buf = Buffer.alloc(512)
    readSync(fd, buf, 0, 512, 0)
    closeSync(fd)
    const parts = buf.toString('latin1').split(':')
    const v = parseInt(parts[2] ?? '', 10)
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}
