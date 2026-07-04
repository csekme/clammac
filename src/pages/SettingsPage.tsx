import { useEffect, useState } from 'react'
import { FolderPlus, X } from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

function Row({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="space-y-0.5">
        <Label>{label}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function QuickActionCard(): React.JSX.Element {
  const [status, setStatus] = useState<{ installed: boolean; available: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api
      .quickActionStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])

  const toggle = async (): Promise<void> => {
    if (!status) return
    setBusy(true)
    try {
      if (status.installed) await window.api.uninstallQuickAction()
      else await window.api.installQuickAction()
      setStatus(await window.api.quickActionStatus())
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Finder integráció</CardTitle>
        <CardDescription>
          Gyorsművelet a Finder jobbklikk-menüjébe: kijelölt fájlok és mappák szkennelése a
          „Szkennelés a ClamMac-kel” menüponttal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button
          variant={status?.installed ? 'outline' : 'default'}
          disabled={!status || busy}
          onClick={() => void toggle()}
        >
          {status?.installed ? 'Gyorsművelet eltávolítása' : 'Gyorsművelet telepítése'}
        </Button>
        {status && !status.available && (
          <p className="text-xs text-muted-foreground">
            A gyorsművelet a becsomagolt (telepített) ClamMac alkalmazást indítja — fejlesztői
            futtatás alatt a clammac:// hivatkozás nem érkezik meg.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export default function SettingsPage(): React.JSX.Element {
  const { settings, patchSettings } = useAppStore()
  const [newExclusion, setNewExclusion] = useState('')

  if (!settings) return <div />

  const addWatchPath = async (): Promise<void> => {
    const paths = await window.api.choosePaths(true)
    if (paths.length === 0) return
    const merged = [...new Set([...settings.watchPaths, ...paths])]
    void patchSettings({ watchPaths: merged })
  }

  const addExclusion = (): void => {
    const value = newExclusion.trim()
    if (!value) return
    setNewExclusion('')
    void patchSettings({ exclusions: [...new Set([...settings.exclusions, value])] })
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Beállítások</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Általános</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Indítás bejelentkezéskor">
            <Switch
              checked={settings.launchAtLogin}
              onCheckedChange={(v) => void patchSettings({ launchAtLogin: v })}
            />
          </Row>
          <Row
            label="Futás a menüsorban bezárás után"
            description="Az ablak bezárása után a védelem a háttérben aktív marad"
          >
            <Switch
              checked={settings.closeToTray}
              onCheckedChange={(v) => void patchSettings({ closeToTray: v })}
            />
          </Row>
          <Row
            label="Dock ikon elrejtése háttérben futáskor"
            description="Bezárt ablaknál csak a menüsor-ikon marad, a Dockból eltűnik az app"
          >
            <Switch
              checked={settings.hideDockInTray}
              onCheckedChange={(v) => void patchSettings({ hideDockInTray: v })}
            />
          </Row>
          <Row label="Értesítések megjelenítése">
            <Switch
              checked={settings.showNotifications}
              onCheckedChange={(v) => void patchSettings({ showNotifications: v })}
            />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Szkennelés</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Row
            label="Fertőzött fájlok automatikus karanténba helyezése"
            description="Kikapcsolva a találatok csak naplózásra kerülnek"
          >
            <Switch
              checked={settings.autoQuarantine}
              onCheckedChange={(v) => void patchSettings({ autoQuarantine: v })}
            />
          </Row>
          <Row label="Archívumok szkennelése" description="zip, dmg, tar, stb. kibontása szkenneléskor">
            <Switch
              checked={settings.scanArchives}
              onCheckedChange={(v) => void patchSettings({ scanArchives: v })}
            />
          </Row>
          <Row
            label="Potenciálisan nemkívánatos programok (PUA)"
            description="Adware, kéretlen eszköztárak jelzése"
          >
            <Switch
              checked={settings.detectPua}
              onCheckedChange={(v) => void patchSettings({ detectPua: v })}
            />
          </Row>
          <Row
            label="Szken-gyorsítótár"
            description="A változatlan, korábban tisztának talált fájlok kihagyása — szignatúra-frissítéskor automatikusan ürül"
          >
            <Switch
              checked={settings.scanCacheEnabled}
              onCheckedChange={(v) => void patchSettings({ scanCacheEnabled: v })}
            />
          </Row>
          <Row
            label="Konzol kimenet szkenneléskor"
            description="Fájlonkénti eredmények (OK / FOUND / ERROR) élő megjelenítése a Szkennelés oldalon"
          >
            <Switch
              checked={settings.verboseScanLog}
              onCheckedChange={(v) => void patchSettings({ verboseScanLog: v })}
            />
          </Row>
          <Row label="Maximális fájlméret (MB)" description="Az ennél nagyobb fájlok kimaradnak">
            <Input
              type="number"
              className="w-24"
              min={1}
              max={4096}
              defaultValue={settings.maxFileSizeMB}
              onBlur={(e) => {
                const v = parseInt(e.target.value, 10)
                if (Number.isFinite(v) && v >= 1 && v <= 4096 && v !== settings.maxFileSizeMB) {
                  void patchSettings({ maxFileSizeMB: v })
                }
              }}
            />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Valós idejű védelem — figyelt mappák</CardTitle>
          <CardDescription>Az itt listázott mappákba érkező új fájlok automatikusan szkennelésre kerülnek.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {settings.watchPaths.map((p) => (
            <div key={p} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span className="truncate font-mono text-xs">{p}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() =>
                  void patchSettings({ watchPaths: settings.watchPaths.filter((x) => x !== p) })
                }
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => void addWatchPath()}>
            <FolderPlus /> Mappa hozzáadása
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kizárások</CardTitle>
          <CardDescription>
            Mappanév (pl. node_modules) vagy abszolút útvonal — ezek kimaradnak minden szkennelésből.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {settings.exclusions.map((ex) => (
              <span
                key={ex}
                className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 font-mono text-xs"
              >
                {ex}
                <button
                  type="button"
                  aria-label={`${ex} kizárás törlése`}
                  title="Kizárás törlése"
                  className="opacity-60 hover:opacity-100"
                  onClick={() =>
                    void patchSettings({ exclusions: settings.exclusions.filter((x) => x !== ex) })
                  }
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="pl. node_modules vagy /Users/…/mappa"
              value={newExclusion}
              onChange={(e) => setNewExclusion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addExclusion()}
            />
            <Button variant="outline" onClick={addExclusion}>
              Hozzáadás
            </Button>
          </div>
        </CardContent>
      </Card>

      <QuickActionCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ütemezés</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Automatikus szignatúra-frissítés" description="Óránkénti gyakoriság">
            <Select
              value={String(settings.updateIntervalHours)}
              onValueChange={(v) => void patchSettings({ updateIntervalHours: parseInt(v, 10) })}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6 óránként</SelectItem>
                <SelectItem value="12">12 óránként</SelectItem>
                <SelectItem value="24">naponta</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Ütemezett gyors szkennelés">
            <Switch
              checked={settings.scheduledScan.enabled}
              onCheckedChange={(v) =>
                void patchSettings({ scheduledScan: { ...settings.scheduledScan, enabled: v } })
              }
            />
          </Row>
          {settings.scheduledScan.enabled && (
            <>
              <Row label="Gyakoriság">
                <Select
                  value={settings.scheduledScan.frequency}
                  onValueChange={(v) =>
                    void patchSettings({
                      scheduledScan: {
                        ...settings.scheduledScan,
                        frequency: v as 'daily' | 'weekly'
                      }
                    })
                  }
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">naponta</SelectItem>
                    <SelectItem value="weekly">hetente (hétfő)</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
              <Row label="Időpont">
                <Input
                  type="time"
                  className="w-32"
                  value={settings.scheduledScan.time}
                  onChange={(e) =>
                    void patchSettings({
                      scheduledScan: { ...settings.scheduledScan, time: e.target.value }
                    })
                  }
                />
              </Row>
            </>
          )}
        </CardContent>
      </Card>

      <Separator />
      <p className="pb-4 text-xs leading-relaxed text-muted-foreground">
        A ClamMac a ClamAV® nyílt forráskódú víruskereső motort használja (GPLv2, Cisco Systems).
        A ClamMac kiegészítő védelmi réteg — nem helyettesíti a macOS beépített védelmeit
        (Gatekeeper, XProtect).
      </p>
    </div>
  )
}
