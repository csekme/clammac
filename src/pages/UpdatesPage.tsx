import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import type { UpdateLogEntry } from '@shared/types'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatDate } from '@/lib/utils'

export default function UpdatesPage(): React.JSX.Element {
  const { db, engine } = useAppStore()
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Frissítési napló</CardTitle>
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
