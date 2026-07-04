import { useEffect, useMemo, useState } from 'react'
import { Globe, ShieldAlert, RefreshCw, Trash2, Loader2, CheckCircle2 } from 'lucide-react'
import type { NetworkConnection } from '@shared/types'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatDate } from '@/lib/utils'

export default function NetworkPage(): React.JSX.Element {
  const { settings, connections, networkAlerts, feedStatus, patchSettings } = useAppStore()
  const [filter, setFilter] = useState('')

  // belépéskor azonnali lista (nem várunk az első poll-eseményre)
  useEffect(() => {
    void window.api.listConnections().then((c) => useAppStore.setState({ connections: c }))
  }, [])

  const groups = useMemo(() => groupByProcess(connections, filter), [connections, filter])
  const monitorOn = settings?.networkMonitorEnabled ?? false

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Hálózat</h1>

      {/* riasztások */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {networkAlerts.length === 0 ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-destructive" />
            )}
            Hálózati riasztások
            {networkAlerts.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-muted-foreground"
                onClick={() => {
                  void window.api.clearNetworkAlerts()
                  useAppStore.setState({ networkAlerts: [] })
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Törlés
              </Button>
            )}
          </CardTitle>
          <CardDescription>
            Riasztás, ha egy folyamat ismert kártevő-infrastruktúrához (botnet C2) kapcsolódik.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {networkAlerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nincs riasztás — egyetlen folyamat sem kapcsolódott ismert kártevő-címhez.
            </p>
          ) : (
            <ScrollArea className="max-h-72 rounded-md border">
              <div className="divide-y">
                {networkAlerts.map((a) => (
                  <div key={a.id} className="space-y-0.5 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{a.connection.process}</span>
                      <span className="text-xs text-muted-foreground">PID {a.connection.pid}</span>
                      <Badge variant="destructive">{a.malware ?? categoryLabel(a.category)}</Badge>
                      <Badge variant="outline">{a.feed}</Badge>
                      {a.blocked && <Badge variant="success">blokkolva</Badge>}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {formatDate(a.at)}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">
                      → {a.connection.remoteIp}:{a.connection.remotePort} (
                      {a.connection.protocol.toUpperCase()})
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* élő kapcsolatok */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-primary" />
            Élő kapcsolatok
            <span className="font-normal text-muted-foreground">
              {connections.length > 0 && `${connections.length}`}
            </span>
            <div className="ml-auto w-48">
              <Input
                placeholder="Szűrés (app, IP, port)…"
                className="h-8"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          </CardTitle>
          <CardDescription>
            {monitorOn
              ? '5 másodpercenként frissül. Csak a kimenő, távoli címhez tartozó kapcsolatok látszanak.'
              : 'A hálózati megfigyelés ki van kapcsolva — a Beállításokban kapcsolhatod be.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!monitorOn ? (
            <Button onClick={() => void patchSettings({ networkMonitorEnabled: true })}>
              Megfigyelés bekapcsolása
            </Button>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {filter ? 'Nincs a szűrésre illeszkedő kapcsolat.' : 'Nincs aktív távoli kapcsolat.'}
            </p>
          ) : (
            <ScrollArea className="max-h-96 rounded-md border">
              <div className="divide-y">
                {groups.map((g) => (
                  <div key={`${g.process}-${g.pid}`} className="px-3 py-2">
                    <p className="text-sm font-medium">
                      {g.process}{' '}
                      <span className="text-xs font-normal text-muted-foreground">
                        PID {g.pid} · {g.conns.length} kapcsolat
                      </span>
                    </p>
                    <div className="mt-1 space-y-0.5">
                      {g.conns.map((c, i) => (
                        <p
                          key={i}
                          className="flex items-center gap-2 font-mono text-xs text-muted-foreground"
                        >
                          <span className="w-10 uppercase">{c.protocol}</span>
                          <span>
                            {c.remoteIp}:{c.remotePort}
                          </span>
                          {c.state && <span className="text-muted-foreground/60">{c.state}</span>}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* feed státusz */}
      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-4 text-sm">
          <div className="text-muted-foreground">
            Threat-feedek (abuse.ch Feodo · ThreatFox · CINS Army · Blocklist.de · ET):{' '}
            {(feedStatus?.entryCount ?? 0).toLocaleString('hu-HU')} ismert kártevő-IP
            {feedStatus?.updatedAt ? ` · frissítve ${formatDate(feedStatus.updatedAt)}` : ''}
            {feedStatus?.error && (
              <span className="block text-xs text-warning">Hiba: {feedStatus.error}</span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={feedStatus?.updating}
            onClick={() => void window.api.updateFeeds()}
          >
            {feedStatus?.updating ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Frissítés
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function categoryLabel(category: string): string {
  return category === 'c2'
    ? 'botnet C2'
    : category === 'attacker'
      ? 'támadó IP'
      : category === 'compromised'
        ? 'kompromittált gép'
        : 'rosszindulatú cím'
}

interface ProcessGroup {
  process: string
  pid: number
  conns: NetworkConnection[]
}

function groupByProcess(connections: NetworkConnection[], filter: string): ProcessGroup[] {
  const q = filter.trim().toLowerCase()
  const filtered = q
    ? connections.filter(
        (c) =>
          c.process.toLowerCase().includes(q) ||
          c.remoteIp.includes(q) ||
          String(c.remotePort).includes(q)
      )
    : connections
  const map = new Map<string, ProcessGroup>()
  for (const c of filtered) {
    const key = `${c.process}|${c.pid}`
    const group = map.get(key) ?? { process: c.process, pid: c.pid, conns: [] }
    group.conns.push(c)
    map.set(key, group)
  }
  return [...map.values()].sort(
    (a, b) => b.conns.length - a.conns.length || a.process.localeCompare(b.process)
  )
}
