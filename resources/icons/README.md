# Ikonok

Ide (PNG formátumban — a nativeImage SVG-t nem tud betölteni):

| Fájl | Méret | Mire |
|---|---|---|
| `trayTemplate.png` | 16×16 | Menüsor (tray) ikon — **template**: csak fekete + átlátszó pixelek; a macOS színezi világos/sötét módhoz. A `Template` utótag kötelező. |
| `trayTemplate@2x.png` | 32×32 | Ugyanaz Retinára (az Electron automatikusan párosítja) |
| `icon.png` | 512×512 vagy 1024×1024 | Dock ikon fejlesztői futtatáskor |

A **csomagolt app ikonja** külön megy: tegyél egy 1024×1024-es `icon.png`-t a `build/`
mappába — az electron-builder abból generálja az `.icns`-t.

Az **app-on belüli (sidebar) logó** pedig a `src/assets/logo.svg` (vagy `.png`) —
részletek a `src/assets/README.md`-ben. Mindegyik helyen fallback van: amíg a
fájl hiányzik, a beépített pajzs/emoji jelenik meg, és a kép megjelenésekor
(újrabuild/újraindítás után) magától érvénybe lép.

SVG-ből PNG-k macOS-en (ha van `rsvg-convert` vagy `inkscape`), pl.:

```sh
rsvg-convert -w 16 -h 16 tray.svg -o trayTemplate.png
rsvg-convert -w 32 -h 32 tray.svg -o trayTemplate@2x.png
rsvg-convert -w 1024 -h 1024 app.svg -o ../../build/icon.png
sips -z 512 512 ../../build/icon.png --out icon.png
```

Ha nincsenek meg a fájlok, az app emoji-feliratos tray-jel és az alap Electron
ikonnal fut — semmi nem törik.
