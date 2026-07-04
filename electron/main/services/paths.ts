import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface AppDirs {
  userData: string
  db: string
  quarantine: string
  run: string
  logs: string
  conf: string
}

let dirs: AppDirs | null = null

export function appDirs(): AppDirs {
  if (dirs) return dirs
  const userData = app.getPath('userData')
  dirs = {
    userData,
    db: join(userData, 'db'),
    quarantine: join(userData, 'quarantine'),
    run: join(userData, 'run'),
    logs: join(userData, 'logs'),
    conf: join(userData, 'conf')
  }
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true, mode: 0o700 })
  return dirs
}

/** Static assets (icons): repo `resources/` in dev, Contents/Resources when packaged. */
export function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}

export interface ClamBinaries {
  clamd: string
  freshclam: string
  root: string
}

/**
 * Binary resolution order:
 *  1. bundled payload (Contents/Resources/clamav) — packaged app
 *  2. resources/clamav/<arch> in the repo — after `npm run fetch-clamav`
 *  3. Homebrew (apple silicon + intel prefixes)
 */
export function resolveClamBinaries(): ClamBinaries | null {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const candidates = [
    join(process.resourcesPath ?? '', 'clamav', 'bin'),
    join(app.getAppPath(), 'resources', 'clamav', arch, 'bin'),
    '/opt/homebrew/opt/clamav/bin',
    '/opt/homebrew/opt/clamav/sbin',
    '/usr/local/opt/clamav/bin',
    '/usr/local/opt/clamav/sbin'
  ]
  for (const dir of candidates) {
    const clamd = join(dir, 'clamd')
    if (!existsSync(clamd)) continue
    // freshclam may live in a sibling bin/sbin dir
    for (const fDir of [dir, dir.replace(/sbin$/, 'bin'), dir.replace(/bin$/, 'sbin')]) {
      const freshclam = join(fDir, 'freshclam')
      if (existsSync(freshclam)) return { clamd, freshclam, root: dir }
    }
  }
  return null
}
