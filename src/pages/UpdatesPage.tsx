import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, CheckCircle2, XCircle, Loader2, Terminal, Trash2 } from 'lucide-react'
import type { UpdateLogEntry } from '@shared/types'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatDate } from '@/lib/utils'

export default function UpdatesPage(): React.JSX.Element {
  const { db, engine, updateConsole } = useAppStore()
  const [log, setLog] = useState<UpdateLogEntry[]>([])

  const reload = useCallback(async () => {
    setLog(await window.api.listUpdateLog())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload, db?.updatedAt, db?.updating])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Frissítések</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Szignatúra-adatbázis</CardTitle>
          <CardDescription>
            {db?.present ? (
              <>
                daily #{db.dailyVersion ?? '?'} · frissítve: {formatDate(db.updatedAt)}
              </>
            ) : (
              'Az adatbázis még nincs letöltve (~300 MB).'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button onClick={() => void window.api.runUpdate()} disabled={db?.updating}>
            {db?.updating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {db?.updating ? 'Frissítés folyamatban…' : 'Frissítés most'}
          </Button>
          {engine?.version && (
            <span className="text-sm text-muted-foreground">{engine.version}</span>
          )}
        </CardContent>
      </Card>

      {db?.updating && <UpdateConsole lines={updateConsole} />}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Frissítési napló</CardTitle>
            {log.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void window.api.clearUpdateLog().then(() => reload())
                }
              >
                <Trash2 /> Napló törlése
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <p className="text-sm text-muted-foreground">Még nem futott frissítés.</p>
          ) : (
            <ScrollArea className="max-h-96">
              <div className="space-y-3">
                {log.map((entry, i) => (
                  <div key={i} className="flex gap-3 rounded-md border p-3 text-sm">
                    {entry.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{formatDate(entry.at)}</span>
                        <Badge variant={entry.ok ? 'success' : 'destructive'}>
                          {entry.ok ? 'sikeres' : 'sikertelen'}
                        </Badge>
                      </div>
                      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                        {entry.message}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function UpdateConsole({ lines }: { lines: string[] }): React.JSX.Element {
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
        <ScrollArea className="max-h-64 rounded-md bg-zinc-950 dark:bg-black/60">
          <div className="select-text whitespace-pre-wrap break-all p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
            {lines.length === 0 ? (
              <div className="text-zinc-500">Kapcsolódás a frissítési szerverhez…</div>
            ) : (
              lines.map((line, i) => (
                <div key={i} className={line.startsWith('ERROR') ? 'text-amber-400' : undefined}>
                  {line}
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
