import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Radar,
  ShieldAlert,
  Globe,
  History,
  RefreshCw,
  Settings as SettingsIcon,
  Shield
} from 'lucide-react'
import { useAppStore, Page } from '@/stores/app-store'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import Dashboard from '@/pages/Dashboard'
import ScanPage from '@/pages/ScanPage'
import QuarantinePage from '@/pages/QuarantinePage'
import NetworkPage from '@/pages/NetworkPage'
import HistoryPage from '@/pages/HistoryPage'
import UpdatesPage from '@/pages/UpdatesPage'
import SettingsPage from '@/pages/SettingsPage'

// Custom brand logo: drop src/assets/logo.svg (or .png) there and it is picked
// up at the next build — no code change; until then the shield badge renders.
const logoModules = import.meta.glob('./assets/logo.{svg,png}', {
  eager: true,
  query: '?url',
  import: 'default'
})
const customLogoUrl = Object.values(logoModules)[0] as string | undefined

const NAV: { page: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { page: 'dashboard', label: 'Áttekintés', icon: LayoutDashboard },
  { page: 'scan', label: 'Szkennelés', icon: Radar },
  { page: 'quarantine', label: 'Karantén', icon: ShieldAlert },
  { page: 'network', label: 'Hálózat', icon: Globe },
  { page: 'history', label: 'Előzmények', icon: History },
  { page: 'updates', label: 'Frissítések', icon: RefreshCw },
  { page: 'settings', label: 'Beállítások', icon: SettingsIcon }
]

export default function App(): React.JSX.Element {
  const { loaded, page, setPage, init, engine, quarantineCount } = useAppStore()
  const [dropActive, setDropActive] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
      if (e.dataTransfer?.types.includes('Files')) setDropActive(true)
    }
    const onDragLeave = (e: DragEvent): void => {
      if (!e.relatedTarget) setDropActive(false)
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      setDropActive(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const paths = files.map((f) => window.api.getPathForFile(f)).filter(Boolean)
      if (paths.length > 0) {
        setPage('scan')
        void window.api.startScan('custom', paths).catch(() => undefined)
      }
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [setPage])

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <Shield className="mr-2 h-5 w-5 animate-pulse" /> ClamMac indul…
      </div>
    )
  }

  const engineOk = engine?.state === 'running'

  return (
    <div className="flex h-screen">
      {/* sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/30">
        {/* traffic lights live in the top ~30px; brand block on its own row below */}
        <div className="titlebar-drag border-b px-6 pb-4 pt-12">
          <div className="flex items-center gap-3">
            {customLogoUrl ? (
              <img
                src={customLogoUrl}
                alt="ClamMac logó"
                className="h-9 w-9 shrink-0 rounded-[10px] object-contain"
              />
            ) : (
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]',
                  engineOk ? 'bg-success' : 'bg-warning'
                )}
              >
                <Shield
                  className={cn(
                    'h-5 w-5',
                    engineOk ? 'text-success-foreground' : 'text-warning-foreground'
                  )}
                  strokeWidth={2.2}
                />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-tight tracking-tight">ClamMac</p>
              <p className="truncate text-[11px] leading-tight text-muted-foreground">
                {engineOk ? 'Védelem aktív' : 'Figyelem szükséges'}
              </p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ page: p, label, icon: Icon }) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                page === p
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
              {p === 'quarantine' && quarantineCount > 0 && (
                <Badge variant="destructive" className="ml-auto px-1.5 py-0">
                  {quarantineCount}
                </Badge>
              )}
            </button>
          ))}
        </nav>
        <div className="p-4 text-[11px] leading-relaxed text-muted-foreground">
          A ClamAV motorra épül (GPLv2).
          <br />
          clamav.net
        </div>
      </aside>

      {/* content */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="titlebar-drag h-6 w-full" />
        <div className="mx-auto max-w-4xl px-8 pb-10">
          {page === 'dashboard' && <Dashboard />}
          {page === 'scan' && <ScanPage />}
          {page === 'quarantine' && <QuarantinePage />}
          {page === 'network' && <NetworkPage />}
          {page === 'history' && <HistoryPage />}
          {page === 'updates' && <UpdatesPage />}
          {page === 'settings' && <SettingsPage />}
        </div>
      </main>

      {/* drag & drop overlay */}
      {dropActive && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-primary p-12 text-center">
            <Radar className="mx-auto mb-3 h-10 w-10 text-primary" />
            <p className="text-lg font-semibold">Engedd el a szkenneléshez</p>
            <p className="text-sm text-muted-foreground">A fájlok azonnal ellenőrzésre kerülnek</p>
          </div>
        </div>
      )}
    </div>
  )
}
