import { z } from 'zod'

export { EVENT_CHANNEL, IPC } from './channels'

export const StartScanReq = z.object({
  type: z.enum(['quick', 'full', 'custom']),
  paths: z.array(z.string().min(1)).max(200).optional()
})
export type StartScanReq = z.infer<typeof StartScanReq>

export const ScanIdReq = z.object({ scanId: z.string().min(1) })

export const QuarantineIdReq = z.object({ id: z.string().min(1) })

export const SettingsPatch = z
  .object({
    launchAtLogin: z.boolean(),
    closeToTray: z.boolean(),
    hideDockInTray: z.boolean(),
    showNotifications: z.boolean(),
    realtimeEnabled: z.boolean(),
    watchPaths: z.array(z.string().min(1)).max(50),
    exclusions: z.array(z.string().min(1)).max(200),
    maxFileSizeMB: z.number().int().min(1).max(4096),
    scanArchives: z.boolean(),
    detectPua: z.boolean(),
    autoQuarantine: z.boolean(),
    scanCacheEnabled: z.boolean(),
    verboseScanLog: z.boolean(),
    updateIntervalHours: z.number().int().min(1).max(168),
    scheduledScan: z.object({
      enabled: z.boolean(),
      frequency: z.enum(['daily', 'weekly']),
      time: z.string().regex(/^\d{2}:\d{2}$/)
    })
  })
  .partial()
export type SettingsPatch = z.infer<typeof SettingsPatch>

export const ChoosePathsReq = z.object({
  directoriesOnly: z.boolean().optional()
})
