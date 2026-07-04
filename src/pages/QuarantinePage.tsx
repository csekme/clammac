import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert, Undo2, Trash2, CheckCircle2, AlertTriangle, FolderOpen } from 'lucide-react'
import type { QuarantineItem } from '@shared/types'
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { basename, formatBytes, formatDate } from '@/lib/utils'
import { signatureInfo } from '@/lib/signature-info'

type Notice =
  | { kind: 'error'; message: string }
  | { kind: 'success'; message: string; revealPath?: string }

export default function QuarantinePage(): React.JSX.Element {
  const [items, setItems] = useState<QuarantineItem[]>([])
  const [confirm, setConfirm] = useState<{ action: 'restore' | 'delete'; item: QuarantineItem } | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const quarantineCount = useAppStore((s) => s.quarantineCount)

  const reload = useCallback(async () => {
    setItems(await window.api.listQuarantine())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload, quarantineCount])

  const execute = async (): Promise<void> => {
    if (!confirm) return
    const { action, item } = confirm
    setBusy(true)
    try {
      if (action === 'restore') {
        const result = await window.api.restoreQuarantine(item.id)
        setNotice(
          result.fellBack
            ? {
                kind: 'success',
                message: `Az eredeti hely nem írható, ezért a fájl ide került: ${result.restoredPath}`,
                revealPath: result.restoredPath
              }
            : {
                kind: 'success',
                message: `Visszaállítva: ${result.restoredPath}`,
                revealPath: result.restoredPath
              }
        )
      } else {
        await window.api.deleteQuarantine(item.id)
        setNotice({ kind: 'success', message: `Véglegesen törölve: ${basename(item.originalPath)}` })
      }
      setConfirm(null)
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      const message = raw.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '')
      setNotice({ kind: 'error', message })
      setConfirm(null)
    } finally {
      setBusy(false)
      void reload()
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Karantén</h1>

      {notice && (
        <Card className={notice.kind === 'error' ? 'border-destructive' : 'border-success'}>
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            {notice.kind === 'error' ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            )}
            <p className="min-w-0 flex-1 break-words">{notice.message}</p>
            {notice.kind === 'success' && notice.revealPath && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => void window.api.revealPath(notice.revealPath!)}
              >
                <FolderOpen /> Megjelenítés
              </Button>
            )}
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setNotice(null)}>
              Bezárás
            </Button>
          </CardContent>
        </Card>
      )}

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
            <ShieldAlert className="h-8 w-8" />
            <p>A karantén üres.</p>
            <p className="text-sm">A fertőzött fájlok automatikusan ide kerülnek, ártalmatlanított formában.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>Fájl</TableHead>
                <TableHead className="w-44">Szignatúra</TableHead>
                <TableHead className="w-20">Méret</TableHead>
                <TableHead className="w-36">Dátum</TableHead>
                <TableHead className="w-60 text-right">Műveletek</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <p className="truncate font-medium" title={basename(item.originalPath)}>
                      {basename(item.originalPath)}
                    </p>
                    <p
                      className="truncate font-mono text-xs text-muted-foreground"
                      title={item.originalPath}
                    >
                      {item.originalPath}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-0.5">
                      <Badge
                        variant={
                          signatureInfo(item.signature).severity === 'malware'
                            ? 'destructive'
                            : 'warning'
                        }
                      >
                        {signatureInfo(item.signature).label}
                      </Badge>
                      <p className="break-all font-mono text-xs text-muted-foreground">
                        {item.signature}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatBytes(item.size)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(item.quarantinedAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirm({ action: 'restore', item })}
                      >
                        <Undo2 /> Visszaállítás
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setConfirm({ action: 'delete', item })}
                      >
                        <Trash2 /> Törlés
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === 'restore' ? 'Fájl visszaállítása?' : 'Végleges törlés?'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {confirm?.action === 'restore' ? (
                  <>
                    <p>
                      A(z) <span className="break-all font-mono">{confirm?.item.originalPath}</span>{' '}
                      fájl visszakerül az eredeti helyére.
                    </p>
                    <p>
                      Jelzés: <span className="break-all font-mono">{confirm?.item.signature}</span>
                    </p>
                    {confirm && (
                      <p className="text-xs">{signatureInfo(confirm.item.signature).summary}</p>
                    )}
                    <p>Csak akkor állítsd vissza, ha meggyőződtél róla, hogy hamis pozitív.</p>
                    {confirm?.item.originalPath.includes('.app/') && (
                      <p className="text-xs text-warning">
                        Az eredeti hely egy alkalmazáscsomag (.app), amely gyakran csak olvasható.
                        Ha oda nem sikerül írni, a fájl a Letöltések/ClamMac-visszaallitva mappába
                        kerül, ahonnan kézzel (adminjogosultsággal) másolhatod vissza.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p>
                      A(z){' '}
                      <span className="font-mono">
                        {confirm?.item && basename(confirm.item.originalPath)}
                      </span>{' '}
                      fájl véglegesen törlődik a karanténból. Ez a művelet nem vonható vissza.
                    </p>
                    {confirm && (
                      <p className="text-xs">{signatureInfo(confirm.item.signature).summary}</p>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Mégse</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className={confirm?.action === 'delete' ? 'bg-destructive hover:bg-destructive/90' : ''}
              onClick={(e) => {
                e.preventDefault()
                void execute()
              }}
            >
              {busy ? 'Folyamatban…' : confirm?.action === 'restore' ? 'Visszaállítás' : 'Törlés'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
