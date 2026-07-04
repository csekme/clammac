# ClamMac — Tűzfal szolgáltatás tervezési dokumentum (v2 modul)

A TERV.md v1-scope-ja tudatosan kizárta a hálózati tűzfalat. Ez a dokumentum azt
tervezi meg, hogyan kerülhet be fokozatosan úgy, hogy minden fázis önmagában is
használható értéket adjon, és a nagy belépési küszöbű részek (Apple entitlement)
ne blokkolják a többit.

---

## 1. Mit jelent a „tűzfal" macOS-en — a lehetőségek térképe

macOS-en négy, egymástól teljesen különböző technikai szinten lehet „tűzfalazni".
A megoldások nem alternatívák, hanem különböző képességek különböző árakon:

| | Megoldás | Képesség | Jogosultság | Electronból |
|---|---|---|---|---|
| **A** | Kapcsolat-monitor (`nettop`/`lsof` polling) | megfigyelés + riasztás, blokkolás nélkül | nincs | ✅ közvetlenül |
| **B** | macOS beépített Application Firewall (`socketfilterfw`) | **bejövő** kapcsolatok blokkolása apponként, stealth mode | admin (egyszeri prompt) | ✅ helper scripttel |
| **C** | PF packet filter (`pfctl` anchor) | **kimenő** blokkolás IP/port alapján (blocklist) | root helper | ✅ helper scripttel |
| **D** | Network Extension (`NEFilterDataProvider`) | igazi per-app kimenő/bejövő tűzfal, kapcsolatonkénti allow/deny prompt (LuLu / Little Snitch modell) | fizetős Apple Developer fiók + `content-filter-provider` entitlement + Developer ID aláírás + notarizáció | ⚠️ csak natív Swift system extensionnel |

**Kulcsdöntés:** a D-szint (igazi per-app tűzfal) Electronból önmagában nem
megoldható — egy Swift system extension kell az app bundle-be
(`Contents/Library/SystemExtensions/`), amit az app `OSSystemExtensionRequest`-tel
aktivál. Ez ugyanaz a helyzet, mint a TERV.md 10. pontjában az Endpoint
Security: **a MyDevCert self-signed aláírással nem működik**, valódi Developer
ID + Apple által jóváhagyott entitlement kell. Ezért a D fázis opcionális
végállomás, nem előfeltétel.

---

## 2. Javasolt fázisolás

### F1 — Hálózati monitor + threat-intel riasztás (≈1–2 nap, nincs jogosultsági küszöb)

A ClamMac AV-identitásához ez illik a legjobban: nem általános tűzfal, hanem
**„melyik folyamat beszél ismert malware-infrastruktúrával?"** detektor.

- Új main-service: `network-monitor.ts` — 5 mp-enként pollozza a kapcsolatokat:
  `lsof -i -n -P -F` (gépileg parse-olható F-formátum) vagy `nettop -P -L 1 -x`.
  Eredmény: `{pid, processName, appBundle?, protocol, localPort, remoteIp, remotePort, state}`.
- **Blocklist-egyeztetés**: abuse.ch ingyenes feedek (Feodo Tracker C2 IP-lista,
  SSLBL, ThreatFox) — a freshclam-mintára időzítve frissítve (`threat-feeds.ts`,
  JSON a `userData/feeds/` alá, verzió + kor kijelzés a Frissítések oldalon).
- Találatkor: `AppEvent {type:'network-alert'}` + natív értesítés + bekerül egy
  „Hálózati riasztások" listába (History-mintára perzisztálva). A riasztás
  mutatja a folyamatot, a cél-IP-t, a feed-forrást és a first-seen időt.
- Új UI-oldal: **„Hálózat"** — élő kapcsolatlista (folyamatonként csoportosítva,
  kereshető), riasztás-lista, feed-státusz. A meglévő oldal-minta (zustand
  store + events) változtatás nélkül jó hozzá.
- A Dashboard hero-ba bekerül a hálózati státusz („X aktív kapcsolat, 0 riasztás").

Korlát (kimondva a UI-ban is): ez **monitor**, nem blokkoló — de pontosan ez
adja az AV-hez az értéket: a fájl-alapú detekció mellé viselkedés-alapú jelzést.

### F2 — Blokkolás beépített eszközökkel (≈2–3 nap, egyszeri admin prompt)

Két, egymást kiegészítő képesség, mindkettő a rendszer saját tűzfalával:

1. **Application Firewall (ALF) kezelés** — `/usr/libexec/ApplicationFirewall/socketfilterfw`:
   be/ki, stealth mode, appok bejövő blokkolása/engedélyezése. A Beállítások
   kap egy „Tűzfal" szekciót, ami a rendszertűzfal állapotát mutatja és kapcsolja.
2. **PF blocklist anchor** — a F1 threat-feed IP-it egy saját PF anchorba töltjük
   (`com.clammac` anchor, `pfctl -a com.clammac -f -`), így az ismert C2/malware
   IP-k **kimenő irányban ténylegesen blokkolódnak**, folyamattól függetlenül.
   Riasztás helyett/mellett megelőzés. Az anchor önálló, a rendszer PF-szabályait
   nem írja át; app-kilépéskor / kikapcsoláskor flush.

Privilegizált végrehajtás: első körben `osascript … with administrator privileges`
(egyszeri jelszó-prompt műveletenként), később SMJobBless/SMAppService helper, ha
zavaró a prompt. A helper felülete szándékosan minimális és fix parancskészletű
(nem általános root-shell): `alf-status|alf-set|pf-load|pf-flush`.

### F3 — Igazi per-app tűzfal Network Extensionnel (≈2–3 hét + Apple fiók)

Csak akkor, ha a projekt eljut a Developer ID-ig (a DMG-terjesztéshez úgyis
kelleni fog):

- Swift **system extension** (`NEFilterDataProvider`): minden új flow-ról
  eldönti allow/deny/prompt; szabálytár App Group-ban megosztott SQLite/JSON.
- Az Electron app a kezelőfelület: szabálylista, „első kapcsolat" prompt
  (a LuLu-modell), profil (Home/Work), csend-üzemmód.
- Kommunikáció: az extension nem tud közvetlenül az Electronnal beszélni →
  kis Swift CLI bridge (XPC az extension felé, stdin/stdout az Electron felé),
  vagy App Group fájl + fsevents. Ugyanez a bridge-minta jó később az
  Endpoint Security on-access szkennerhez is — érdemes együtt tervezni.
- Feltételek: Apple Developer Program (99 USD/év), `com.apple.developer.networking.networkextension`
  (content-filter-provider) entitlement, notarizáció, felhasználói jóváhagyás
  a Rendszerbeállításokban (első aktiváláskor).

Referencia-implementáció: **LuLu** (Objective-See, nyílt forráskódú) — az
extension-oldali architektúra onnan átvehető mintaként.

---

## 3. Architektúra (F1+F2, a meglévő kódbázisba illesztve)

```
Main process                                    Renderer
┌─────────────────────────────────────┐
│ NetworkMonitor  (lsof poll, 5s)     │──events──► „Hálózat" oldal
│   └─ matcher ◄── ThreatFeedService  │            (kapcsolatok, riasztások)
│                   (abuse.ch, 12h)   │
│ FirewallService                     │──IPC────► Beállítások / „Tűzfal" szekció
│   ├─ alfStatus / alfSet   (ALF)     │
│   └─ pfLoadBlocklist / pfFlush (PF) │
│        └─ privileged-runner         │  (osascript admin, fix parancskészlet)
└─────────────────────────────────────┘
```

- `shared/types.ts`: `NetworkConnection`, `NetworkAlert`, `FirewallStatus`,
  `ThreatFeedStatus`; `AppEvent` bővítés: `network-connections`, `network-alert`,
  `firewall-status`.
- IPC: `network:list`, `network:alerts`, `firewall:status`, `firewall:set`,
  `feeds:update` — a meglévő zod-validált `handle()` mintával.
- Settings bővítés: `networkMonitorEnabled`, `pfBlocklistEnabled`,
  `feedUpdateIntervalHours`, `monitorPollSeconds`.
- A poll csak akkor fut, ha a monitor be van kapcsolva ÉS (ablak látható VAGY
  riasztás-üzemmód aktív) — tray-ben alvó appnál 30 mp-re lassul.

## 4. Adat- és eseménymodell

```ts
interface NetworkConnection {
  pid: number
  process: string          // ps-ből; app bundle név, ha azonosítható
  protocol: 'tcp' | 'udp'
  remoteIp: string
  remotePort: number
  state: string            // ESTABLISHED, SYN_SENT, …
  firstSeen: number
  bytesInOut?: [number, number]  // nettop-ból, ha elérhető
}

interface NetworkAlert {
  id: string
  at: number
  connection: NetworkConnection
  feed: 'feodo' | 'sslbl' | 'threatfox'
  indicator: string        // a feed-bejegyzés (IP / IP:port)
  blocked: boolean         // F2-ben: PF anchor fogta-e
}
```

## 5. Kockázatok és döntési pontok

| Kockázat | Kezelés |
|---|---|
| `lsof` poll CPU-költsége sok kapcsolatnál | 5s alap-intervallum, inkrementális diff, alvó módban 30s; mérés az F1 végén |
| Hamis riasztás (feed false positive) | riasztás ≠ automatikus blokk az F1-ben; feed-forrás + link kijelzése; allowlist |
| PF anchor ütközés (VPN, Little Snitch, céges MDM) | saját anchor, induláskor detektáljuk a meglévő PF-használatot és figyelmeztetünk; kikapcsolható |
| Admin prompt UX (F2) | műveletek batch-elése; SMAppService helper, ha a prompt zavaró |
| F3 entitlement-átfutás (hetek) + éves díj | F3 külön döntési pont, F1–F2 nem függ tőle |
| Fail-open vs fail-closed | mindig fail-open (a ClamMac kiegészítő védelem — hálózatot nem törhet el) |

## 6. Nem-célok

- Nem általános célú tűzfal-GUI (arra ott a Little Snitch/LuLu) — a fókusz a
  **malware-infrastruktúra elleni védelem**, ami az AV-hez illik.
- Nem DNS-szűrő / tartalomszűrő (NEDNSProxy külön entitlement, külön projekt).
- Nem kernel extension (deprecated, nem is engedélyezett már).

## 7. Ütemterv-javaslat

1. **F1** — NetworkMonitor + ThreatFeedService + „Hálózat" oldal + riasztások
2. **F2a** — ALF-kezelés a Beállításokban (kis munka, látványos)
3. **F2b** — PF blocklist anchor (a F1 feed-infrastruktúrájára épül)
4. *(döntési pont: Developer ID beszerzése — a DMG-terjesztés úgyis igényli)*
5. **F3** — NEFilterDataProvider system extension (LuLu-minta), per-app szabályok

---

## 8. Megvalósítás állapota

**F1 + F2 kész (2026-07-04).** Amit implementáltunk:

- `threat-feeds.ts` — abuse.ch Feodo Tracker + ThreatFox feedek (SSLBL a
  gyakorlatban halott, kihagyva); részleges siker is elfogadott, feedenkénti
  méret-guard. Élőben letöltve: ~1900 IP.
- `network-monitor.ts` — `lsof -FpcPnT` 5 mp-es poll, IPv4 távoli kapcsolatok,
  folyamatonkénti dedup, feed-egyeztetés → `network-alert` + natív értesítés.
  A parser élő rendszer-kimeneten tesztelve (0 malformed).
- `firewall.ts` — ALF (`socketfilterfw`) állapot/be-ki/stealth + PF anchor
  (`com.apple/250.ClamMacBlocklist`) a feed-IP-kre; root-műveletek osascript
  admin prompton át, fix parancskészlettel.
- UI: új „Hálózat" oldal (riasztások, folyamatonkénti élő kapcsolatlista,
  feed-státusz) + Beállítások „Tűzfal és hálózat" szekció. Végponti teszt:
  benign IP-t a feedbe injektálva a riasztás végigfutott a natív értesítésig.
- Scheduler: 12h-ás feed-frissítés, ha bármelyik hálózati funkció aktív.

Nyitott / F3-ra halasztva: tényleges per-app allow/deny prompt (Network
Extension), IPv6 kapcsolatok a listában, a PF-refresh admin-prompt nélküli
háttérfrissítése (jelenleg feed-frissítéskor nem tölti újra a PF táblát, hogy
ne ugorjon fel prompt — a felhasználó a kapcsolóval tudja újratölteni).

### 8.1 Kiegészítések (2026-07-04 este, 2. kör)

- **Threat-feed bővítés:** 5 forrás aggregálva (Feodo, ThreatFox, CINS Army,
  Blocklist.de, ET compromised) → ~42 000 egyedi IP a korábbi ~1 900 helyett.
  Kategóriák: c2 / attacker / compromised; a C2-találat (malware-névvel)
  megnyeri a merge-t az általánosabb feed felett.
- **PF-blocklist elavultság-jelzés:** `FirewallStatus.pfBlocklistOutdated` +
  `feedSize`. A Dashboard és a Beállítások jelzi, ha a betöltött PF-tábla
  kisebb a feednél, és egyetlen kattintással (`firewall:refresh-pf`,
  egy admin prompt) újratölthető a friss listával.
- **Domain-védelem (hosts):** `hosts-protection.ts` — URLhaus (kártevő) +
  Hagezi Light (követő/reklám) feedek (~91 700 domain), `0.0.0.0`-ra irányítva
  a `/etc/hosts` `# BEGIN/END ClamMac` jelölt blokkjában. A rendszer sorait
  nem érinti (stripBlock unit-tesztelve); a root-írás osascript admin
  prompton át, temp-fájl + `cp` + DNS-cache flush + egyszeri backup
  (`hosts.system.bak`). Kézi blokk/engedély bejegyzések (allowlist felülírja
  a feedet). Beállítások „Domain-védelem" kártya + Dashboard státusz-sor.
  Korlát a UI-ban kimondva: DoH-t használó böngészők megkerülik.
