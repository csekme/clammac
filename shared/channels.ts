/**
 * IPC channel names — deliberately zod-free: this module is imported by the
 * sandboxed preload, which can only require 'electron' and node builtins.
 */
export const EVENT_CHANNEL = 'app:event'

export const IPC = {
  getStatus: 'app:get-status',
  startScan: 'scan:start',
  cancelScan: 'scan:cancel',
  listQuarantine: 'quarantine:list',
  restoreQuarantine: 'quarantine:restore',
  deleteQuarantine: 'quarantine:delete',
  listHistory: 'history:list',
  clearHistory: 'history:clear',
  listUpdateLog: 'update:log',
  runUpdate: 'update:run',
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  choosePaths: 'dialog:choose-paths',
  startEngine: 'engine:start',
  stopEngine: 'engine:stop',
  revealPath: 'shell:reveal',
  quickActionStatus: 'quick-action:status',
  installQuickAction: 'quick-action:install',
  uninstallQuickAction: 'quick-action:uninstall'
} as const
