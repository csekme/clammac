import { useEffect, useMemo, useState } from 'react'
import type { ScanRecord } from '@shared/types'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const DAYS = 30
const W = 600
const H = 132
const PAD_L = 30
const PAD_R = 6
const PAD_T = 10
const PLOT_H = 96
const X_BASE = PAD_T + PLOT_H

interface DayBucket {
  date: Date
  scans: number
  files: number
  detections: number
}

function buildBuckets(records: ScanRecord[]): DayBucket[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const buckets: DayBucket[] = Array.from({ length: DAYS }, (_, i) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (DAYS - 1 - i))
    return { date, scans: 0, files: 0, detections: 0 }
  })
  const first = buckets[0].date.getTime()
  for (const r of records) {
    const day = new Date(r.startedAt)
    day.setHours(0, 0, 0, 0)
    const idx = Math.round((day.getTime() - first) / 86_400_000)
    if (idx < 0 || idx >= DAYS) continue
    buckets[idx].scans++
    buckets[idx].files += r.scanned
    buckets[idx].detections += r.detections.length
  }
  return buckets
}

/** Smallest "clean" axis max at or above the data max. */
function niceMax(max: number): number {
  for (const c of [4, 6, 8, 10, 12, 16, 20, 30, 40, 60, 80, 100]) if (max <= c) return c
  return Math.ceil(max / 100) * 100
}

const dayFmt = new Intl.DateTimeFormat('hu-HU', { month: 'short', day: 'numeric' })

export default function ActivityChart(): React.JSX.Element | null {
  const { lastScan } = useAppStore()
  const [records, setRecords] = useState<ScanRecord[] | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  // re-fetch whenever a scan finishes (lastScan changes on store refresh)
  useEffect(() => {
    window.api
      .listHistory()
      .then(setRecords)
      .catch(() => setRecords([]))
  }, [lastScan?.scanId])

  const buckets = useMemo(() => buildBuckets(records ?? []), [records])
  const hasData = buckets.some((b) => b.scans > 0)
  const yMax = niceMax(Math.max(1, ...buckets.map((b) => b.scans)))

  if (records === null) return null

  const plotW = W - PAD_L - PAD_R
  const band = plotW / DAYS
  const barW = Math.min(24, band * 0.55)
  const yOf = (v: number): number => X_BASE - (v / yMax) * PLOT_H
  const xOf = (i: number): number => PAD_L + i * band + band / 2

  const hovered = hover !== null ? buckets[hover] : null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-baseline gap-3 text-base">
          Aktivitás — elmúlt 30 nap
          <span className="ml-auto flex items-center gap-4 text-xs font-normal text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-primary" /> szkennelés
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive" /> találat
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        {!hasData ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Még nincs szkennelési adat — az első szkennelés után itt jelenik meg az aktivitás.
          </p>
        ) : (
          <div className="relative">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-auto w-full"
              role="img"
              aria-label={`Napi szkennelések és találatok az elmúlt 30 napban, összesen ${buckets.reduce((s, b) => s + b.scans, 0)} szkennelés és ${buckets.reduce((s, b) => s + b.detections, 0)} találat`}
              onMouseLeave={() => setHover(null)}
            >
              {/* hairline gridlines + clean y ticks */}
              {[yMax / 2, yMax].map((v) => (
                <g key={v}>
                  <line
                    x1={PAD_L}
                    x2={W - PAD_R}
                    y1={yOf(v)}
                    y2={yOf(v)}
                    className="stroke-border"
                    strokeWidth={1}
                  />
                  <text
                    x={PAD_L - 6}
                    y={yOf(v) + 3}
                    textAnchor="end"
                    className="fill-muted-foreground"
                    fontSize={9}
                  >
                    {v}
                  </text>
                </g>
              ))}
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={X_BASE}
                y2={X_BASE}
                className="stroke-border"
                strokeWidth={1}
              />

              {/* bars: rounded data-end, square baseline (clip the bottom radius) */}
              {buckets.map(
                (b, i) =>
                  b.scans > 0 && (
                    <path
                      key={i}
                      d={barPath(xOf(i) - barW / 2, yOf(b.scans), barW, X_BASE - yOf(b.scans))}
                      className="fill-primary transition-opacity"
                      opacity={hover === null || hover === i ? 1 : 0.55}
                    />
                  )
              )}

              {/* detection dots above the bar, 2px surface ring */}
              {buckets.map(
                (b, i) =>
                  b.detections > 0 && (
                    <circle
                      key={i}
                      cx={xOf(i)}
                      cy={Math.max(PAD_T + 5, yOf(b.scans) - 9)}
                      r={4.5}
                      className="fill-destructive stroke-card"
                      strokeWidth={2}
                      opacity={hover === null || hover === i ? 1 : 0.55}
                    />
                  )
              )}

              {/* x labels: first / middle / last day */}
              {[0, Math.floor(DAYS / 2), DAYS - 1].map((i) => (
                <text
                  key={i}
                  x={xOf(i)}
                  y={H - 4}
                  textAnchor={i === 0 ? 'start' : i === DAYS - 1 ? 'end' : 'middle'}
                  className="fill-muted-foreground"
                  fontSize={9}
                >
                  {dayFmt.format(buckets[i].date)}
                </text>
              ))}

              {/* full-height hit bands — the target is bigger than the mark */}
              {buckets.map((_, i) => (
                <rect
                  key={i}
                  x={PAD_L + i * band}
                  y={PAD_T}
                  width={band}
                  height={PLOT_H}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              ))}
            </svg>

            {hovered && hover !== null && (
              <div
                className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
                style={{
                  left: `${((PAD_L + (hover + 0.5) * band) / W) * 100}%`,
                  transform:
                    hover < 5
                      ? 'translateX(0)'
                      : hover > DAYS - 6
                        ? 'translateX(-100%)'
                        : 'translateX(-50%)'
                }}
              >
                <p className="mb-1 font-medium">{dayFmt.format(hovered.date)}</p>
                <p className="flex items-center gap-1.5 tabular-nums text-muted-foreground">
                  <span className="h-0.5 w-2.5 rounded-full bg-primary" />
                  <span className="font-semibold text-foreground">{hovered.scans}</span>
                  szkennelés · {hovered.files.toLocaleString('hu-HU')} fájl
                </p>
                <p className="flex items-center gap-1.5 tabular-nums text-muted-foreground">
                  <span className="h-0.5 w-2.5 rounded-full bg-destructive" />
                  <span className="font-semibold text-foreground">{hovered.detections}</span>
                  találat
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Column with a 4px rounded top and a square baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + w - r} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `L ${x + w} ${y + h}`,
    'Z'
  ].join(' ')
}
