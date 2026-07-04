import { useCallback, useEffect, useState } from 'react'
import { History as HistoryIcon, Trash2 } from 'lucide-react'
import type { ScanRecord } from '@shared/types'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { formatDate, formatDuration } from '@/lib/utils'

const TYPE_LABEL: Record<string, string> = {
  quick: 'gyors',
  full: 'teljes',
  custom: 'egyéni'
}
const STATUS_LABEL: Record<string, string> = {
  done: 'kész',
  cancelled: 'megszakítva',
  error: 'hiba',
  running: 'fut',
  enumerating: 'fut'
}

export default function HistoryPage(): React.JSX.Element {
  const [records, setRecords] = useState<ScanRecord[]>([])
  const lastScan = useAppStore((s) => s.lastScan)

  const reload = useCallback(async () => {
    setRecords(await window.api.listHistory())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload, lastScan])

  const clear = async (): Promise<void> => {
    await window.api.clearHistory()
    void reload()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Előzmények</h1>
        {records.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => void clear()}>
            <Trash2 /> Napló törlése
          </Button>
        )}
      </div>

      {records.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
            <HistoryIcon className="h-8 w-8" />
            <p>Még nincs szkennelési előzmény.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Időpont</TableHead>
                <TableHead>Típus</TableHead>
                <TableHead>Fájlok</TableHead>
                <TableHead>Időtartam</TableHead>
                <TableHead>Állapot</TableHead>
                <TableHead>Találatok</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={r.scanId}>
                  <TableCell className="whitespace-nowrap">{formatDate(r.startedAt)}</TableCell>
                  <TableCell>
                    {TYPE_LABEL[r.type] ?? r.type}
                    {r.origin !== 'user' && (
                      <span className="ml-1 text-xs text-muted-foreground">({r.origin})</span>
                    )}
                  </TableCell>
                  <TableCell>{r.scanned}</TableCell>
                  <TableCell>{formatDuration(r.startedAt, r.finishedAt)}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === 'done' ? 'secondary' : 'outline'}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.detections.length === 0 ? 'success' : 'destructive'}>
                      {r.detections.length}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
