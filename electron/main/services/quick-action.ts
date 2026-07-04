import { spawn, execFileSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'

export const QUICK_ACTION_NAME = 'Szkennelés a ClamMac-kel'

/**
 * Finder Quick Action: an Automator service bundle in ~/Library/Services that
 * URL-encodes the selected files and opens clammac://scan?path=… — handled by
 * the app's protocol handler (see main/index.ts). No Automator needed at
 * install time; we write the .workflow bundle ourselves.
 */

// osascript is the only always-present encoder on macOS (python3 is not guaranteed)
const SHELL_SCRIPT = [
  '[ $# -eq 0 ] && exit 0',
  `q=$(/usr/bin/osascript -l JavaScript -e 'function run(argv){return argv.map(encodeURIComponent).join("&path=")}' "$@")`,
  '/usr/bin/open "clammac://scan?path=$q"'
].join('\n')

function workflowDir(): string {
  return join(homedir(), 'Library', 'Services', `${QUICK_ACTION_NAME}.workflow`)
}

export function quickActionInstalled(): boolean {
  return existsSync(join(workflowDir(), 'Contents', 'document.wflow'))
}

export function installQuickAction(): void {
  const contents = join(workflowDir(), 'Contents')
  mkdirSync(contents, { recursive: true })
  writeFileSync(join(contents, 'Info.plist'), infoPlist(), { mode: 0o644 })
  writeFileSync(join(contents, 'document.wflow'), documentWflow(), { mode: 0o644 })
  enableInContextMenu()
  refreshServices()
}

export function uninstallQuickAction(): void {
  rmSync(workflowDir(), { recursive: true, force: true })
  // the orphaned NSServicesStatus entry is harmless; deleting it would require
  // rewriting the whole dict and risks clobbering other services' toggles
  refreshServices()
}

/**
 * Tick the service's checkbox (System Settings → Keyboard → Services) so the
 * Finder context menu shows it without a manual enable step. Same entry the
 * system writes when the user toggles it by hand. JXA + NSUserDefaults because
 * the `defaults` CLI can't parse dict-add keys with non-ASCII characters.
 */
function enableInContextMenu(): void {
  const script = `
ObjC.import("Foundation")
function run(argv) {
  const json = '{"presentation_modes":{"ContextMenu":1,"FinderPreview":1,"ServicesMenu":1,"TouchBar":1}}'
  const data = $.NSString.alloc.initWithUTF8String(json).dataUsingEncoding($.NSUTF8StringEncoding)
  const entry = $.NSJSONSerialization.JSONObjectWithDataOptionsError(data, $.NSJSONReadingMutableContainers, null)
  const ud = $.NSUserDefaults.alloc.initWithSuiteName("pbs")
  const existing = ud.objectForKey("NSServicesStatus")
  const dict = existing.isNil() ? $.NSMutableDictionary.new : $.NSMutableDictionary.dictionaryWithDictionary(existing)
  dict.setObjectForKey(entry, $(argv[0]))
  ud.setObjectForKey(dict, "NSServicesStatus")
  ud.synchronize
}`
  try {
    execFileSync('/usr/bin/osascript', [
      '-l',
      'JavaScript',
      '-e',
      script,
      `(null) - ${QUICK_ACTION_NAME} - runWorkflowAsService`
    ])
  } catch {
    /* best-effort; the user can still enable it in System Settings */
  }
}

/** Ask pbs to re-scan ~/Library/Services so the menu updates without relogin. */
function refreshServices(): void {
  try {
    spawn('/System/Library/CoreServices/pbs', ['-update'], { stdio: 'ignore' }).on(
      'error',
      () => undefined
    )
  } catch {
    /* best-effort */
  }
}

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function infoPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>NSServices</key>
\t<array>
\t\t<dict>
\t\t\t<key>NSBackgroundColorName</key>
\t\t\t<string>background</string>
\t\t\t<key>NSIconName</key>
\t\t\t<string>NSActionTemplate</string>
\t\t\t<key>NSMenuItem</key>
\t\t\t<dict>
\t\t\t\t<key>default</key>
\t\t\t\t<string>${xml(QUICK_ACTION_NAME)}</string>
\t\t\t</dict>
\t\t\t<key>NSMessage</key>
\t\t\t<string>runWorkflowAsService</string>
\t\t\t<key>NSRequiredContext</key>
\t\t\t<dict>
\t\t\t\t<key>NSApplicationIdentifier</key>
\t\t\t\t<string>com.apple.finder</string>
\t\t\t</dict>
\t\t\t<key>NSSendFileTypes</key>
\t\t\t<array>
\t\t\t\t<string>public.item</string>
\t\t\t</array>
\t\t</dict>
\t</array>
</dict>
</plist>
`
}

function documentWflow(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>AMApplicationBuild</key>
\t<string>528</string>
\t<key>AMApplicationVersion</key>
\t<string>2.10</string>
\t<key>AMDocumentVersion</key>
\t<string>2</string>
\t<key>actions</key>
\t<array>
\t\t<dict>
\t\t\t<key>action</key>
\t\t\t<dict>
\t\t\t\t<key>AMAccepts</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>Container</key>
\t\t\t\t\t<string>List</string>
\t\t\t\t\t<key>Optional</key>
\t\t\t\t\t<true/>
\t\t\t\t\t<key>Types</key>
\t\t\t\t\t<array>
\t\t\t\t\t\t<string>com.apple.cocoa.string</string>
\t\t\t\t\t</array>
\t\t\t\t</dict>
\t\t\t\t<key>AMActionVersion</key>
\t\t\t\t<string>2.0.3</string>
\t\t\t\t<key>AMApplication</key>
\t\t\t\t<array>
\t\t\t\t\t<string>Automator</string>
\t\t\t\t</array>
\t\t\t\t<key>AMParameterProperties</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>COMMAND_STRING</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>CheckedForUserDefaultShell</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>inputMethod</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>shell</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>source</key>
\t\t\t\t\t<dict/>
\t\t\t\t</dict>
\t\t\t\t<key>AMProvides</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>Container</key>
\t\t\t\t\t<string>List</string>
\t\t\t\t\t<key>Types</key>
\t\t\t\t\t<array>
\t\t\t\t\t\t<string>com.apple.cocoa.string</string>
\t\t\t\t\t</array>
\t\t\t\t</dict>
\t\t\t\t<key>ActionBundlePath</key>
\t\t\t\t<string>/System/Library/Automator/Run Shell Script.action</string>
\t\t\t\t<key>ActionName</key>
\t\t\t\t<string>Run Shell Script</string>
\t\t\t\t<key>ActionParameters</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>COMMAND_STRING</key>
\t\t\t\t\t<string>${xml(SHELL_SCRIPT)}</string>
\t\t\t\t\t<key>CheckedForUserDefaultShell</key>
\t\t\t\t\t<true/>
\t\t\t\t\t<key>inputMethod</key>
\t\t\t\t\t<integer>1</integer>
\t\t\t\t\t<key>shell</key>
\t\t\t\t\t<string>/bin/zsh</string>
\t\t\t\t\t<key>source</key>
\t\t\t\t\t<string></string>
\t\t\t\t</dict>
\t\t\t\t<key>BundleIdentifier</key>
\t\t\t\t<string>com.apple.RunShellScript</string>
\t\t\t\t<key>CFBundleVersion</key>
\t\t\t\t<string>2.0.3</string>
\t\t\t\t<key>CanShowSelectedItemsWhenRun</key>
\t\t\t\t<false/>
\t\t\t\t<key>CanShowWhenRun</key>
\t\t\t\t<true/>
\t\t\t\t<key>Category</key>
\t\t\t\t<array>
\t\t\t\t\t<string>AMCategoryUtilities</string>
\t\t\t\t</array>
\t\t\t\t<key>Class Name</key>
\t\t\t\t<string>RunShellScriptAction</string>
\t\t\t\t<key>InputUUID</key>
\t\t\t\t<string>${randomUUID().toUpperCase()}</string>
\t\t\t\t<key>Keywords</key>
\t\t\t\t<array>
\t\t\t\t\t<string>Shell</string>
\t\t\t\t\t<string>Script</string>
\t\t\t\t\t<string>Unix</string>
\t\t\t\t</array>
\t\t\t\t<key>OutputUUID</key>
\t\t\t\t<string>${randomUUID().toUpperCase()}</string>
\t\t\t\t<key>UUID</key>
\t\t\t\t<string>${randomUUID().toUpperCase()}</string>
\t\t\t\t<key>UnlocalizedApplications</key>
\t\t\t\t<array>
\t\t\t\t\t<string>Automator</string>
\t\t\t\t</array>
\t\t\t\t<key>arguments</key>
\t\t\t\t<dict/>
\t\t\t\t<key>isViewVisible</key>
\t\t\t\t<integer>1</integer>
\t\t\t</dict>
\t\t</dict>
\t</array>
\t<key>connectors</key>
\t<dict/>
\t<key>workflowMetaData</key>
\t<dict>
\t\t<key>applicationBundleID</key>
\t\t<string>com.apple.finder</string>
\t\t<key>applicationBundleIDsByPath</key>
\t\t<dict>
\t\t\t<key>/System/Library/CoreServices/Finder.app</key>
\t\t\t<string>com.apple.finder</string>
\t\t</dict>
\t\t<key>applicationPath</key>
\t\t<string>/System/Library/CoreServices/Finder.app</string>
\t\t<key>applicationPaths</key>
\t\t<array>
\t\t\t<string>/System/Library/CoreServices/Finder.app</string>
\t\t</array>
\t\t<key>inputTypeIdentifier</key>
\t\t<string>com.apple.Automator.fileSystemObject</string>
\t\t<key>outputTypeIdentifier</key>
\t\t<string>com.apple.Automator.nothing</string>
\t\t<key>presentationMode</key>
\t\t<integer>15</integer>
\t\t<key>processesInput</key>
\t\t<false/>
\t\t<key>serviceApplicationBundleID</key>
\t\t<string>com.apple.finder</string>
\t\t<key>serviceApplicationPath</key>
\t\t<string>/System/Library/CoreServices/Finder.app</string>
\t\t<key>serviceInputTypeIdentifier</key>
\t\t<string>com.apple.Automator.fileSystemObject</string>
\t\t<key>serviceOutputTypeIdentifier</key>
\t\t<string>com.apple.Automator.nothing</string>
\t\t<key>serviceProcessesInput</key>
\t\t<false/>
\t\t<key>systemImageName</key>
\t\t<string>NSTouchBarSearchTemplate</string>
\t\t<key>useAutomaticInputType</key>
\t\t<false/>
\t\t<key>workflowTypeIdentifier</key>
\t\t<string>com.apple.Automator.servicesMenu</string>
\t</dict>
</dict>
</plist>
`
}
