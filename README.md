# ClamMac

macOS biztonsági alkalmazás a [ClamAV](https://www.clamav.net/) motorra építve.
Electron + TypeScript + React + Tailwind + shadcn/ui. Részletes terv: [docs/TERV.md](docs/TERV.md).

## Funkciók

- **Szkennelés**: gyors / teljes / egyéni, drag & drop az ablakba
- **Valós idejű védelem**: figyelt mappák (alapból `~/Downloads`) automatikus szkennelése
- **Karantén**: XOR-ártalmatlanított tárolás, visszaállítás / végleges törlés
- **Szignatúra-frissítés**: freshclam automatikusan + kézzel, frissítési napló
- **Ütemezés**: időzített gyors szkennelés, periodikus DB-frissítés
- **Előzmények**: szkennelési napló találatokkal
- **Menüsor (tray)**: állapot, gyorsműveletek, háttérben futás bezárás után

## Architektúra

Az app saját `clamd` daemont indít (a bundle-ből vagy Homebrew-ból) és Unix socketen
beszél vele a clamd protokollal (`zSCAN`, `zINSTREAM`, `zRELOAD`, …). A GPLv2-es ClamAV
külön processzként fut — az app kódja független marad.

- `electron/main/` — main process: `services/clamd-manager` (daemon életciklus),
  `clamd-client` (socket protokoll), `scan-orchestrator`, `watcher`, `quarantine`,
  `freshclam`, `scheduler`; zod-validált IPC router (`ipc.ts`)
- `electron/preload/` — sandboxolt preload, típusos `window.api`
  (⚠️ csak `@shared/channels`-t importálhat, node modult — pl. zod-ot — nem!)
- `shared/` — közös típusok (`types.ts`), zod sémák (`ipc.ts`), csatornanevek (`channels.ts`)
- `src/` — React renderer, shadcn/ui komponensek (`components/ui/`), oldalak (`pages/`)

Felhasználói adatok: `~/Library/Application Support/clammac/` (db, karantén, konfigok, naplók).

## Fejlesztés

Előfeltétel: Node 22+, és fejlesztéshez `brew install clamav` (a binárisfeloldás
a Homebrew-t is megtalálja).

```sh
npm install
npm run dev        # HMR fejlesztői mód
npm start          # build + futtatás
npm run typecheck
```

Az első indításkor az app automatikusan letölti a szignatúra-adatbázist (~120 MB).

⚠️ Ha VS Code-ból / más Electron-alapú eszközből indítod és az app `TypeError: ... requestSingleInstanceLock`
hibával elszáll: a környezet `ELECTRON_RUN_AS_NODE=1`-et örökít. Indítsd így:
`env -u ELECTRON_RUN_AS_NODE npm start`.

## Csomagolás

```sh
npm run fetch-clamav   # ClamAV binárisok + dylib-ek másolása resources/clamav/<arch>/ alá
npm run package        # electron-builder --mac (dmg + zip)
```

Aláíráshoz/notarizáláshoz állítsd be a szokásos `CSC_*` / `APPLE_*` env változókat,
és kapcsold be a `notarize` opciót az `electron-builder.yml`-ben.

## Teszt

EICAR tesztfájllal (68 bájt, ártalmatlan):

```sh
printf '%s' 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > ~/Downloads/eicar-test.txt
```

A valós idejű védelem pár másodpercen belül karanténba teszi és értesítést küld.

## Licenc

Az alkalmazás MIT; a ClamAV® (GPLv2, Cisco Systems) különálló processzként fut.
A ClamMac kiegészítő védelmi réteg, nem helyettesíti a macOS beépített védelmeit
(Gatekeeper, XProtect, MRT).

Ikon- és logócsere — ide tedd a fájlokat
Mit cserélsz	Fájl	Formátum
Tray (menüsor) ikon	resources/icons/trayTemplate.png + trayTemplate@2x.png	16×16 és 32×32 PNG, csak fekete + átlátszó pixelek (a macOS színezi), a Template név kötelező
Dock ikon (dev futtatás)	resources/icons/icon.png	512×512 vagy 1024×1024 PNG
App/DMG ikon (csomagolt)	build/icon.png	1024×1024 PNG — az electron-builder generálja belőle az .icns-t
App-on belüli logó (sidebar brand-blokk)	src/assets/logo.svg vagy .png	SVG a legjobb (skálázódik); ha bedobod, bekötöm a pajzs helyére
Egyik helyen sincs még fájl, most minden beépített fallbackről megy (lucide pajzs, emoji tray). Ahogy bemásolod őket, szólj, és bekötöm ami kézi munkát igényel (a sidebar-logó az egyetlen, ami kódmódosítást kér).