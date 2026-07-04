import { useEffect, useState } from 'react'
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Zap,
  HardDrive,
  RefreshCw,
  Loader2,
  Globe
} from 'lucide-react'
import type { FirewallStatus } from '@shared/types'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import ActivityChart from '@/components/ActivityChart'
import { formatDate, formatDuration } from '@/lib/utils'

export default function Dashboard(): React.JSX.Element {
  const {
    engine,
    db,
    settings,
    lastScan,
    activeScan,
    connections,
    networkAlerts,
    feedStatus,
    hostsStatus,
    firewallStatus,
    setPage,
    patchSettings
  } = useAppStore()
  const [localFw, setLocalFw] = useState<FirewallStatus | null>(null)
  // a store firewallStatus eseményre frissül; az induló értéket egyszer lekérjük
  const firewall = firewallStatus ?? localFw

  useEffect(() => {
    window.api
      .getFirewallStatus()
      .then(setLocalFw)
      .catch(() => setLocalFw(null))
  }, [networkAlerts.length, settings?.pfBlocklistEnabled, feedStatus?.entryCount])

  const dbStale = !db?.updatedAt || Date.now() - db.updatedAt > 7 * 24 * 3600_000
  const scanning = activeScan !== null

  type Level = 'ok' | 'warn' | 'bad'
  let level: Level = 'ok'
  let headline = 'A rendszer védett'
  let detail = 'A ClamAV motor fut, a valós idejű védelem aktív.'

  if (engine?.state === 'not-installed') {
    level = 'bad'
    headline = 'ClamAV nem található'
    detail = 'Telepítsd Homebrew-val: brew install clamav — vagy csomagold az apphoz (npm run fetch-clamav).'
  } else if (engine?.state === 'db-missing' || !db?.present) {
    level = 'warn'
    headline = 'Szignatúra-adatbázis szükséges'
    detail = db?.updating
      ? 'Az adatbázis letöltése folyamatban (~300 MB), ez eltarthat pár percig…'
      : 'Az első használat előtt le kell tölteni a vírusadatbázist.'
  } else if (engine?.state === 'error') {
    level = 'bad'
    headline = 'A motor hibára futott'
    detail = engine.error ?? 'Ismeretlen hiba.'
  } else if (engine?.state === 'starting') {
    level = 'warn'
    headline = 'A motor indul…'
    detail = 'A szignatúrák betöltése kb. fél percet vesz igénybe.'
  } else if (engine?.state === 'stopped') {
    level = 'warn'
    headline = 'A motor le van állítva'
    detail = 'Indítsd el a védelemhez.'
  } else if (!settings?.realtimeEnabled) {
    level = 'warn'
    headline = 'Valós idejű védelem kikapcsolva'
    detail = 'Az on-demand szkennelés működik, de az új fájlok nem kerülnek automatikus ellenőrzésre.'
  } else if (dbStale) {
    level = 'warn'
    headline = 'Az adatbázis elavult'
    detail = 'A szignatúrák több mint 7 napja nem frissültek — futtass frissítést.'
  } else if (networkAlerts.length > 0) {
    level = 'warn'
    headline = 'Hálózati riasztás'
    detail =
      networkAlerts.length === 1
        ? `Egy folyamat ismert kártevő-címhez kapcsolódott — nézd meg a Hálózat oldalon.`
        : `${networkAlerts.length} folyamat kapcsolódott ismert kártevő-címhez — nézd meg a Hálózat oldalon.`
  }

  const HeroIcon = level === 'ok' ? ShieldCheck : level === 'warn' ? ShieldAlert : ShieldX
  const heroColor =
    level === 'ok' ? 'text-success' : level === 'warn' ? 'text-warning' : 'text-destructive'

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Áttekintés</h1>

      {/* status hero */}
      <Card>
        <CardContent className="flex items-center gap-5 p-6">
          <HeroIcon className={`h-14 w-14 shrink-0 ${heroColor}`} strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">{headline}</p>
            <p className="text-sm text-muted-foreground">{detail}</p>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            {(engine?.state === 'db-missing' || !db?.present) && (
              <Button onClick={() => void window.api.runUpdate()} disabled={db?.updating}>
                {db?.updating ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                Adatbázis letöltése
              </Button>
            )}
            {engine?.state === 'stopped' && db?.present && (
              <Button onClick={() => void window.api.startEngine()}>Motor indítása</Button>
            )}
            {engine?.state === 'error' && (
              <Button onClick={() => void window.api.startEngine()}>Újrapróbálás</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* quick actions */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="cursor-pointer transition-colors hover:bg-accent/40" onClick={() => setPage('scan')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> Gyors szkennelés
            </CardTitle>
            <CardDescription>Letöltések, Asztal, Dokumentumok és Alkalmazások</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              disabled={scanning || engine?.state === 'not-installed' || !db?.present}
              onClick={(e) => {
                e.stopPropagation()
                setPage('scan')
                void window.api.startScan('quick').catch(() => undefined)
              }}
            >
              {scanning ? 'Szkennelés folyamatban…' : 'Indítás'}
            </Button>
          </CardContent>
        </Card>

        <Card className="cursor-pointer transition-colors hover:bg-accent/40" onClick={() => setPage('scan')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-primary" /> Teljes szkennelés
            </CardTitle>
            <CardDescription>A teljes felhasználói mappa és az alkalmazások</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="secondary"
              disabled={scanning || engine?.state === 'not-installed' || !db?.present}
              onClick={(e) => {
                e.stopPropagation()
                setPage('scan')
                void window.api.startScan('full').catch(() => undefined)
              }}
            >
              Indítás
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* info rows */}
      <Card>
        <CardContent className="space-y-3 p-6 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Valós idejű védelem</span>
            <Switch
              checked={settings?.realtimeEnabled ?? false}
              onCheckedChange={(v) => void patchSettings({ realtimeEnabled: v })}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Motor</span>
            <span>
              {engine?.state === 'running' ? (
                <Badge variant="success">fut</Badge>
              ) : (
                <Badge variant="secondary">{engine?.state ?? '?'}</Badge>
              )}
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Szignatúra-adatbázis</span>
            <span>
              {db?.present
                ? `daily #${db.dailyVersion ?? '?'} · ${formatDate(db.updatedAt)}`
                : 'hiányzik'}
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Utolsó szkennelés</span>
            <span>
              {lastScan
                ? `${formatDate(lastScan.startedAt)} · ${lastScan.scanned} fájl · ${
                    lastScan.detections.length
                  } találat · ${formatDuration(lastScan.startedAt, lastScan.finishedAt)}`
                : 'még nem volt'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* network security */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-primary" /> Hálózati biztonság
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground"
              onClick={() => setPage('network')}
            >
              Részletek
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-6 pt-0 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Hálózati megfigyelés</span>
            <Switch
              checked={settings?.networkMonitorEnabled ?? false}
              onCheckedChange={(v) => void patchSettings({ networkMonitorEnabled: v })}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Hálózati riasztások</span>
            <span>
              {networkAlerts.length === 0 ? (
                <Badge variant="success">nincs</Badge>
              ) : (
                <Badge variant="destructive">{networkAlerts.length} aktív</Badge>
              )}
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Aktív kapcsolatok</span>
            <span className="text-muted-foreground">
              {settings?.networkMonitorEnabled ? `${connections.length} kimenő` : 'kikapcsolva'}
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Kártevő-IP blokkolás</span>
            <span className="flex items-center gap-2">
              {firewall?.pfBlocklistActive ? (
                firewall.pfBlocklistOutdated ? (
                  <>
                    <Badge variant="warning">
                      {firewall.pfBlocklistSize.toLocaleString('hu-HU')} /{' '}
                      {firewall.feedSize.toLocaleString('hu-HU')} IP · elavult
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void window.api.refreshPfBlocklist().then(setLocalFw)}
                    >
                      Frissítés
                    </Button>
                  </>
                ) : (
                  <Badge variant="success">
                    aktív · {firewall.pfBlocklistSize.toLocaleString('hu-HU')} IP
                  </Badge>
                )
              ) : (
                <Badge variant="secondary">kikapcsolva</Badge>
              )}
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Domain-blokk (kártevő/követő)</span>
            <span>
              {hostsStatus?.active ? (
                <Badge variant="success">
                  aktív · {hostsStatus.blockedCount.toLocaleString('hu-HU')} domain
                </Badge>
              ) : (
                <Badge variant="secondary">kikapcsolva</Badge>
              )}
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Kártevő-IP adatbázis</span>
            <span className="text-muted-foreground">
              {feedStatus?.entryCount
                ? `${feedStatus.entryCount.toLocaleString('hu-HU')} IP${
                    feedStatus.updatedAt ? ` · ${formatDate(feedStatus.updatedAt)}` : ''
                  }`
                : 'még nincs letöltve'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 30-day activity */}
      <ActivityChart />
    </div>
  )
}
