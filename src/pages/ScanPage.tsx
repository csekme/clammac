import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FolderOpen, OctagonX, Radar, CheckCircle2, Terminal } from 'lucide-react'
import { signatureInfo } from '@/lib/signature-info'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { basename, formatDate, formatDuration } from '@/lib/utils'

export default function ScanPage(): React.JSX.Element {
  const { activeScan, lastScan, engine, db, settings, scanLog } = useAppStore()
  const [error, setError] = useState<string | null>(null)

  const canScan = engine?.state !== 'not-installed' && db?.present && !activeScan

  const start = (type: 'quick' | 'full' | 'custom', paths?: string[]): void => {
    setError(null)
    window.api.startScan(type, paths).catch((err) => setError(String(err.message ?? err)))
  }

  const chooseAndScan = async (): Promise<void> => {
    const paths = await window.api.choosePaths()
    if (paths.length > 0) start('custom', paths)
  }

  const pct =
    activeScan && activeScan.total > 0
      ? Math.min(100, Math.round((activeScan.scanned / activeScan.total) * 100))
      : 0

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Szkennelés</h1>

      {!activeScan && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Gyors</CardTitle>
              <CardDescription>Gyakori fertőzési pontok</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" disabled={!canScan} onClick={() => start('quick')}>
                Indítás
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Teljes</CardTitle>
              <CardDescription>Home + Alkalmazások</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant="secondary"
                disabled={!canScan}
                onClick={() => start('full')}
              >
                Indítás
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Egyéni</CardTitle>
              <CardDescription>Mappa vagy fájl kiválasztása</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant="outline"
                disabled={!canScan}
                onClick={() => void chooseAndScan()}
              >
                <FolderOpen /> Tallózás
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {!activeScan && (
        <p className="text-sm text-muted-foreground">
          Tipp: fájlokat és mappákat az ablakba húzva is indíthatsz szkennelést.
        </p>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* active scan */}
      {activeScan && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radar className="h-4 w-4 animate-pulse text-primary" />
              {activeScan.status === 'enumerating'
                ? 'Fájlok összegyűjtése…'
                : `Szkennelés folyamatban — ${pct}%`}
            </CardTitle>
            <CardDescription className="truncate font-mono text-xs">
              {activeScan.currentPath || '…'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={activeScan.status === 'enumerating' ? undefined : pct} />
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {activeScan.scanned} / {activeScan.total || '?'} fájl
                {activeScan.cached > 0 && ` · ${activeScan.cached} gyorsítótárból`}
              </span>
              <span>{activeScan.detections.length} találat</span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void window.api.cancelScan(activeScan.scanId)}
              >
                <OctagonX /> Megszakítás
              </Button>
            </div>
            {activeScan.detections.length > 0 && (
              <DetectionList detections={activeScan.detections} />
            )}
          </CardContent>
        </Card>
      )}

      {/* console output (opt-in via settings) */}
      {settings?.verboseScanLog && scanLog.length > 0 && (activeScan || lastScan) && (
        <ScanConsole lines={scanLog} />
      )}

      {/* last result */}
      {!activeScan && lastScan && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {lastScan.detections.length === 0 ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : (
                <OctagonX className="h-4 w-4 text-destructive" />
              )}
              Utolsó szkennelés eredménye
            </CardTitle>
            <CardDescription>
              {formatDate(lastScan.startedAt)} · {lastScan.scanned} fájl
              {(lastScan.cached ?? 0) > 0 && ` (${lastScan.cached} gyorsítótárból)`} ·{' '}
              {formatDuration(lastScan.startedAt, lastScan.finishedAt)} ·{' '}
              <Badge variant={lastScan.detections.length === 0 ? 'success' : 'destructive'}>
                {lastScan.detections.length} találat
              </Badge>
            </CardDescription>
          </CardHeader>
          {lastScan.detections.length > 0 && (
            <CardContent>
              <DetectionList detections={lastScan.detections} />
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}

function ScanConsole({ lines }: { lines: string[] }): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [lines])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Terminal className="h-4 w-4" /> Konzol
          <span className="ml-auto font-normal text-muted-foreground">{lines.length} sor</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-64 rounded-md bg-zinc-950 dark:bg-black/60">
          <div className="select-text whitespace-pre-wrap break-all p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
            {lines.map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith('FOUND')
                    ? 'text-red-400'
                    : line.startsWith('ERROR')
                      ? 'text-amber-400'
                      : undefined
                }
              >
                {line}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

function DetectionList({
  detections
}: {
  detections: { path: string; signature: string; quarantineId: string | null }[]
}): React.JSX.Element {
  return (
    <ScrollArea className="max-h-80 rounded-md border">
      <div className="divide-y">
        {detections.map((d, i) => (
          <DetectionRow key={`${d.path}-${i}`} detection={d} />
        ))}
      </div>
    </ScrollArea>
  )
}

function DetectionRow({
  detection: d
}: {
  detection: { path: string; signature: string; quarantineId: string | null }
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const info = signatureInfo(d.signature)

  return (
    <div className="px-3 py-2 text-sm">
      <button
        type="button"
        className="flex w-full items-start gap-3 text-left"
        onClick={() => setOpen(!open)}
      >
        <OctagonX
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0',
            info.severity === 'malware' ? 'text-destructive' : 'text-warning'
          )}
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{basename(d.path)}</span>
            <Badge variant={info.severity === 'malware' ? 'destructive' : 'warning'}>
              {info.label}
            </Badge>
            {d.quarantineId ? (
              <Badge variant="secondary">karanténban</Badge>
            ) : (
              <Badge variant="outline">nincs karanténozva</Badge>
            )}
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground" title={d.path}>
            {d.path}
          </p>
          <p className="break-all font-mono text-xs text-muted-foreground/80">{d.signature}</p>
        </div>
        <ChevronDown
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>
      {open && (
        <div className="ml-7 mt-2 space-y-1.5 rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
          <p className="font-medium">{info.summary}</p>
          {info.notes.map((note, i) => (
            <p key={i} className="text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
