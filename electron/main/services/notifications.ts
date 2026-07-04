import { Notification } from 'electron'
import type { Detection } from '@shared/types'
import { getSettings } from './settings-store'

function show(title: string, body: string): void {
  if (!getSettings().showNotifications || !Notification.isSupported()) return
  new Notification({ title, body }).show()
}

export function notifyDetections(detections: Detection[], origin: string): void {
  if (detections.length === 0) {
    if (origin === 'user') show('ClamMac — Szkennelés kész', 'Nem található fertőzés.')
    return
  }
  show(
    'ClamMac — Fertőzés találat!',
    detections.length === 1
      ? `${detections[0].signature}\n${detections[0].path}`
      : `${detections.length} fertőzött fájl karanténba került.`
  )
}

export function notifyRealtimeDetection(detection: Detection): void {
  show(
    'ClamMac — Valós idejű védelem',
    `${detection.signature}\n${detection.path}\nA fájl karanténba került.`
  )
}
