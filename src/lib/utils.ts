import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDate(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('hu-HU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatDuration(startedAt: number, finishedAt: number | null): string {
  if (!finishedAt) return '—'
  const s = Math.max(1, Math.round((finishedAt - startedAt) / 1000))
  if (s < 60) return `${s} mp`
  return `${Math.floor(s / 60)} p ${s % 60} mp`
}

export function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}
