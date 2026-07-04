# ClamMac — Tervezési dokumentum

Full-featured biztonsági (antivírus) alkalmazás macOS-re, a ClamAV motorra építve.
Stack: **Electron + TypeScript + React + Vite + Tailwind + shadcn/ui**.

---

## 1. Célok és scope

| Cél | Leírás |
|---|---|
| On-demand szkennelés | Gyors / teljes / egyéni szkennelés, drag & drop |
| Valós idejű védelem | Figyelt mappák (Letöltések, Asztal, USB) automatikus szkennelése |
| Karantén | Fertőzött fájlok biztonságos izolálása, visszaállítás / törlés |
| Szignatúra-frissítés | freshclam integráció, automatikus + manuális frissítés |
| Ütemezés | Ütemezett szkennelések (napi/heti, launchd-vel is túlélve az app bezárását) |
| Előzmények / riportok | Szkennelési napló, találatok, exportálás |
| Menüsor (tray) app | Állapotjelzés, gyorsműveletek, háttérben futás |
| macOS-natív élmény | Vibrancy, hiddenInset titlebar, dark mode, natív értesítések |

**Nem scope (v1):** kernel-szintű on-access védelem (Endpoint Security system extension — Electronból nem megoldható, Swift helper kellene hozzá; lásd 10. pont), e-mail szkennelés, hálózati tűzfal.

---

## 2. ClamAV integrációs stratégia

### 2.1 Motor: `clamd` daemon + socket protokoll (nem `clamscan`!)

- `clamscan` minden indításkor ~1 GB szignatúra-adatbázist tölt be (~20-40 s) → interaktív appban használhatatlan.
- Ehelyett az app **saját, becsomagolt `clamd` példányt** indít és felügyel (child process), és **Unix domain socketen** beszél vele a clamd protokollal:
  - `zINSTREAM` — fájl streamelése szkennelésre (nem kell fájlrendszer-jogosultság a daemonnak)
  - `zSCAN` / `zCONTSCAN` / `zMULTISCAN` — útvonal-alapú szkennelés (multiscan = párhuzamos)
  - `zSTATS`, `zVERSION`, `zPING` — health-check, verzió
  - `zRELOAD` — adatbázis újratöltése frissítés után
- A protokoll triviális (newline/null-terminated szöveg), **saját TypeScript kliens** írható ~200 sorban — nem kell külső dependency (a létező npm clamd kliensek elavultak).

### 2.2 Binárisok csomagolása

- `clamd`, `freshclam`, `clamdscan` + `libclamav` dylib-ek az app bundle-ben: `Contents/Resources/clamav/<arch>/`
- Buildkor Homebrew-ból (`brew fetch --bottle`) vagy forrásból mindkét architektúrára (arm64 + x86_64); `install_name_tool`-lal relatívvá tett dylib útvonalak.
- Konfig generálás futásidőben: `clamd.conf` és `freshclam.conf` az app írja ki a `~/Library/Application Support/ClamMac/` alá (socket path, DatabaseDirectory, MaxFileSize, stb. a Settings-ből).
- Adatbázis: `~/Library/Application Support/ClamMac/db/` (~300 MB, első indításkor letöltés onboarding-képernyővel).

### 2.3 Licenc (fontos!)

A ClamAV **GPLv2**. Mivel az app **külön processzként, socketen keresztül** használja a változtatás nélküli binárisokat (mere aggregation), az Electron app saját licence szabadon választható. A ClamAV licencszöveget és forráshivatkozást az About képernyőn fel kell tüntetni.

---

## 3. Architektúra

```
┌────────────────────────────── Electron app ──────────────────────────────┐
│                                                                           │
│  Renderer (React + shadcn/ui)          Main process                       │
│  ┌──────────────────────────┐   IPC    ┌───────────────────────────────┐  │
│  │ Dashboard / Scan /       │◄────────►│ IPC router (zod-validált)     │  │
│  │ Quarantine / History /   │ typed,   ├───────────────────────────────┤  │
│  │ Updates / Settings       │ context- │ ClamdManager   (spawn/health) │  │
│  └──────────────────────────┘ Bridge   │ ClamdClient    (socket proto) │  │
│                                        │ ScanOrchestrator (queue, prog)│  │
│  Tray (menüsor)                        │ FreshclamService (update)     │  │
│  ┌──────────────────────────┐          │ WatchService   (chokidar/     │  │
│  │ állapot, quick actions   │          │                 FSEvents)     │  │
│  └──────────────────────────┘          │ QuarantineService             │  │
│                                        │ ScheduleService (cron+launchd)│  │
│                                        │ HistoryStore (better-sqlite3) │  │
│                                        │ NotificationService           │  │
│                                        └──────────┬────────────────────┘  │
└───────────────────────────────────────────────────┼──────────────────────┘
                                          unix socket│  child processes
                                        ┌────────────▼───────────┐
                                        │  clamd      freshclam  │
                                        └────────────────────────┘
```

### 3.1 Main process szolgáltatások

- **ClamdManager** — `clamd` életciklus: spawn app-indításkor (vagy lazy), PING-alapú health-check, crash-restart backoff-fal, graceful shutdown.
- **ClamdClient** — socket kliens; INSTREAM chunkolás (64 KB), timeout, párhuzamossági limit.
- **ScanOrchestrator** — szkennelési feladatsor: fájllista-felderítés (`fast-glob`, exclusion-szűrés), batch-elt MULTISCAN, progress-esemény (fájl/db, aktuális fájl, találatok) streamelése a renderernek, pause/cancel, eredmény perzisztálás.
- **WatchService** — figyelt mappák (`chokidar`, natívan FSEvents-t használ): új/módosult fájl → debounce → INSTREAM szken → találat esetén auto-karantén + értesítés. USB: `/Volumes` figyelése mount-detektáláshoz, opcionális auto-szken.
- **FreshclamService** — `freshclam` futtatása ütemezve (alapból 2×/nap) + kézzel; stdout parse-olása progresshez; siker után `RELOAD` a clamd-nek.
- **QuarantineService** — lásd 5. pont.
- **ScheduleService** — app-on belüli cron (`node-cron`) + opcionálisan `launchd` LaunchAgent generálása (`~/Library/LaunchAgents/com.clammac.scheduler.plist`), hogy a szken akkor is lefusson, ha az app nincs megnyitva (az agent `ClamMac --headless-scan` módban indítja az appot).
- **HistoryStore** — `better-sqlite3`: `scans`, `detections`, `quarantine_items`, `update_log` táblák.

### 3.2 IPC szerződés

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; a preload csak egy típusos API-t exponál (`window.api`).
- Minden csatorna **zod-sémával validált** a main oldalon; közös `shared/ipc.ts` definiálja a request/response/event típusokat (single source of truth, mindkét oldal ebből importál).
- Két minta: `invoke/handle` (parancsok, lekérdezések) + `event push` (scan progress, clamd status, update progress) — `webContents.send` + tray-nek is.

```ts
// shared/ipc.ts (részlet)
export const StartScanReq = z.object({
  type: z.enum(['quick', 'full', 'custom']),
  paths: z.array(z.string()).optional(),
})
export type ScanProgress = {
  scanId: string; scanned: number; total: number;
  currentPath: string; detections: Detection[];
}
```

---

## 4. Fő funkciók részletesen

### 4.1 Szkennelési módok
- **Gyors** — Letöltések, Asztal, Dokumentumok, `/Applications`, futó folyamatok binárisai; ~percek.
- **Teljes** — `$HOME` + `/Applications` + opcionálisan külső kötetek (Full Disk Access szükséges — TCC-onboarding, lásd 10.).
- **Egyéni** — mappa/fájl-választó vagy **drag & drop** bárhova az appban (globális dropzone overlay).
- Beállítható limitek (MaxFileSize, MaxScanSize, archívum-mélység), PUA-detektálás kapcsoló, exclusion-lista (glob).

### 4.2 Valós idejű védelem (user-space on-access)
- Alapértelmezetten a **Letöltések** mappa figyelt; tetszőleges mappa hozzáadható.
- Új fájl → írás-befejezés detektálás (awaitWriteFinish) → INSTREAM szken → fertőzés esetén azonnali karantén + natív értesítés akciógombokkal („Karanténba került: Eicar-Test-Signature — Megnézem / OK").

### 4.3 Frissítések
- freshclam napló + következő frissítés ideje a Dashboardon; „Frissítés most" gomb; szignatúra-verzió (daily.cvd version) megjelenítése; elavult DB (>7 nap) esetén sárga figyelmeztető state az egész appban és a tray-ikonon.

### 4.4 Tray / menüsor
- Template ikon 3 állapottal: védett (✓), figyelmeztetés (DB elavult / clamd nem fut), fertőzés találat.
- Menü: állapot-összefoglaló, Quick Scan, Frissítés, ablak megnyitása, „Indítás bejelentkezéskor" (`app.setLoginItemSettings`), kilépés.
- Beállítható: ablak bezárása = tray-be rejtés (háttérvédelem folytatódik).

---

## 5. Karantén — biztonsági terv

- Hely: `~/Library/Application Support/ClamMac/quarantine/`, `0700` jogosultság.
- A fájl **XOR/AES-CTR-rel torzítva** tárolódik (kulcs a metadata DB-ben) — így a Spotlight/más AV nem indexeli/riasztja, és véletlenül sem futtatható; kiterjesztés `.qtn`.
- Metaadat SQLite-ban: eredeti útvonal, méret, SHA-256, szignatúra-név, dátum, forrás (manuális szken / watcher).
- Műveletek: **visszaállítás** (eredeti helyre, megerősítéssel + újraszkenneléssel), **végleges törlés**, **hamis pozitív jelentése** (ClamAV FP form link).

---

## 6. UI terv (shadcn/ui)

Ablak: `titleBarStyle: 'hiddenInset'` + `vibrancy: 'sidebar'`, bal oldali navigáció, macOS-es tipográfia. Dark mode: `nativeTheme` követése.

| Képernyő | Tartalom | Fő shadcn komponensek |
|---|---|---|
| **Dashboard** | Védelmi állapot hero (zöld/sárga/piros), utolsó szken, DB-verzió és -kor, valós idejű védelem kapcsoló, gyorsgombok | `Card`, `Badge`, `Switch`, `Button`, `Alert` |
| **Szkennelés** | Módválasztó, futó szken: progress + aktuális fájl + élő találatlista, pause/cancel; eredmény-összegző | `Tabs`, `Progress`, `ScrollArea`, `Table`, `AlertDialog` |
| **Karantén** | Elemek táblázata, részlet-panel, visszaállítás/törlés | `DataTable`, `Sheet`, `DropdownMenu`, `AlertDialog` |
| **Előzmények** | Szűrhető szken-napló, találat-részletek, CSV/JSON export | `DataTable`, `Select`, `Popover` (dátumszűrő), `Dialog` |
| **Frissítések** | DB-státusz, frissítési napló, manuális frissítés progress-szel | `Card`, `Progress`, `Accordion` |
| **Beállítások** | Általános (autostart, tray), Szkennelés (limitek, PUA), Valós idejű (figyelt mappák), Kizárások, Ütemezés | `Form` + `react-hook-form` + zod, `Switch`, `Slider`, `Command` |
| **Onboarding** | Első indítás: DB-letöltés progress, Full Disk Access kérés magyarázattal, watcher-mappák kiválasztása | `Dialog` (wizard), `Progress`, `Checkbox` |

Renderer state: **Zustand** (scan/clamd státusz a push-eventekből) + **TanStack Query** (lekérdezések: history, quarantine lista).

---

## 7. Projektstruktúra

```
ClamMac/
├── electron/
│   ├── main/
│   │   ├── index.ts              # bootstrap, ablak+tray, lifecycle
│   │   ├── ipc.ts                # zod-validált router
│   │   └── services/
│   │       ├── clamd-manager.ts
│   │       ├── clamd-client.ts   # socket protokoll (INSTREAM, SCAN…)
│   │       ├── scan-orchestrator.ts
│   │       ├── freshclam.ts
│   │       ├── watcher.ts
│   │       ├── quarantine.ts
│   │       ├── scheduler.ts
│   │       ├── history-store.ts
│   │       └── notifications.ts
│   └── preload/index.ts          # contextBridge → window.api
├── src/                          # renderer (React)
│   ├── pages/{dashboard,scan,quarantine,history,updates,settings}/
│   ├── components/ui/            # shadcn
│   ├── stores/                   # zustand
│   └── lib/
├── shared/                       # ipc típusok + zod sémák, domain modellek
├── resources/clamav/{arm64,x64}/ # binárisok + dylib-ek (build-time)
├── scripts/fetch-clamav.ts       # binárisok beszerzése/patchelése
├── electron-builder.yml
└── build/{entitlements.mac.plist, icons}
```

Tooling: **electron-vite** (main+preload+renderer egy configból, HMR), ESLint + Prettier, Vitest (unit: clamd-client protokoll, quarantine crypto, exclusion-matcher), Playwright (E2E az EICAR tesztfájllal).

---

## 8. Biztonsági követelmények (az app maga)

- `contextIsolation` + `sandbox` + `nodeIntegration:false`; szigorú CSP; `shell.openExternal` allowlist; navigáció blokkolása.
- Minden IPC input zod-validált; útvonal-paraméterek normalizálása + `..` tiltás; a renderer soha nem kap nyers fájlrendszer-hozzáférést.
- clamd socket: user-only jogosultságú tmp könyvtárban, `LocalSocket` mód (nincs TCP port).
- Hardened Runtime + codesign + **notarization** (kötelező, különben a Gatekeeper blokkol); entitlements: csak ami kell (nincs JIT-en kívüli extra).
- Auto-update: `electron-updater` GitHub Releases-ből, aláírt csomagokkal.

---

## 9. Csomagolás és terjesztés

- `electron-builder`: `dmg` + `zip` target, `arch: [arm64, x64]` (a natív libclamav miatt **két külön build**, nem universal — vagy `lipo`-zott universal a binárisokra).
- CI (GitHub Actions, macos-14 + macos-13 runner): build → sign → notarize → release.
- Mac App Store: **nem cél** (sandbox-kompatibilitás a clamd spawn + FDA miatt gyakorlatilag kizárt); terjesztés DMG + Homebrew Cask.

---

## 10. Ismert korlátok, kockázatok

| Kockázat | Kezelés |
|---|---|
| clamd RAM-igény (~1–1.3 GB betöltött DB-vel) | Lazy start + „Motor leállítása tétlenségkor" opció; kommunikálni a Beállításokban |
| Első DB-letöltés ~300 MB | Onboarding progress + CDN mirror választás |
| Full Disk Access nélkül a teljes szken hiányos | TCC-detektálás (próba-olvasás `~/Library/Mail`-re), vezetett engedélykérés (`x-apple.systempreferences:` deeplink) |
| Valódi kernel-szintű on-access védelem hiánya | v2: külön Swift **Endpoint Security system extension** helper (ES entitlement kell az Apple-től) — a terv ezt nem blokkolja, a ScanOrchestrator API-ja kész rá |
| ClamAV detekciós ráta ~ közepes | Őszinte kommunikáció: „kiegészítő védelem"; PUA + unofficial szignatúra-források (pl. SaneSecurity) opcióként |
| GPLv2 | Külön processz + socket (aggregation), attribúció az Aboutban |

---

## 11. Ütemterv (mérföldkövek)

| M | Tartalom | Becslés |
|---|---|---|
| **M0 — Skeleton** | electron-vite + TS + Tailwind + shadcn, IPC-keret, ablak+tray, CI | 1 hét |
| **M1 — Motor** | binárison-csomagolás, ClamdManager + ClamdClient, freshclam, onboarding DB-letöltés | 2 hét |
| **M2 — Szkennelés** | ScanOrchestrator, Scan UI (progress, találatok), drag&drop, History | 2 hét |
| **M3 — Védelem** | Quarantine, WatchService (valós idejű), értesítések, tray-státuszok | 2 hét |
| **M4 — Polish + ship** | Settings, ütemezés + launchd, exportok, sign/notarize, auto-update, E2E (EICAR) | 2 hét |

**MVP = M0–M2** (kb. 5 hét): működő on-demand szkenner frissítéssel és előzményekkel.
