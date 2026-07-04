/**
 * Offline knowledge base for ClamAV signature names.
 * Names follow a Platform.Category.Family-ID scheme (e.g. Win.Trojan.Agent-123,
 * PUA.Win.Tool.Packed-456) — we translate the parts into human explanations.
 */

export type SigSeverity = 'malware' | 'pua' | 'heuristic' | 'test'

export interface SignatureInfo {
  severity: SigSeverity
  /** short badge label */
  label: string
  /** one-sentence summary */
  summary: string
  /** extra explanations (platform, category, advice) */
  notes: string[]
}

const PLATFORMS: Record<string, string> = {
  win: 'Windows-célpontú kód — macOS-en közvetlenül nem fut, de továbbküldve (e-mail, pendrive, megosztás) Windows-gépeket fertőzhet.',
  osx: 'macOS-célpontú kártevő — közvetlen veszélyt jelent erre a gépre.',
  macos: 'macOS-célpontú kártevő — közvetlen veszélyt jelent erre a gépre.',
  unix: 'Unix/Linux-célpontú kód.',
  multios: 'Több operációs rendszeren is működőképes kód.',
  andr: 'Android-célpontú kártevő.',
  doc: 'Office-dokumentumba ágyazott (tipikusan makró alapú) fenyegetés — megnyitáskor aktiválódhat.',
  xls: 'Excel-dokumentumba ágyazott (makró) fenyegetés.',
  pdf: 'PDF-be ágyazott exploit vagy rosszindulatú tartalom.',
  js: 'JavaScript alapú fenyegetés — böngészőben vagy szkriptmotorban futhat.',
  html: 'HTML alapú fenyegetés — jellemzően adathalász vagy átirányító oldal.',
  java: 'Java alapú kód — bármely platformon futhat, ahol van Java.',
  email: 'E-mailben terjedő fenyegetés.',
  legacy: 'Régi, archív szignatúra.'
}

const CATEGORIES: Record<string, { label: string; text: string }> = {
  trojan: {
    label: 'Trójai',
    text: 'Hasznos programnak álcázza magát; a háttérben adatot lophat, hátsó kaput nyithat vagy további kártevőt tölthet le.'
  },
  virus: {
    label: 'Vírus',
    text: 'Más programokat megfertőzve terjedő, önsokszorozó kód.'
  },
  worm: {
    label: 'Féreg',
    text: 'Önállóan, felhasználói beavatkozás nélkül terjedő kártevő (hálózaton, megosztásokon át).'
  },
  ransomware: {
    label: 'Zsarolóvírus',
    text: 'Titkosítja a fájlokat, és váltságdíjat követel a visszaállításért. Az egyik legveszélyesebb kategória.'
  },
  adware: {
    label: 'Adware',
    text: 'Kéretlen reklámokat jelenít meg, böngésző-beállításokat módosíthat; inkább bosszantó, mint pusztító.'
  },
  spyware: {
    label: 'Kémprogram',
    text: 'Titokban figyeli a tevékenységet: billentyűleütések, jelszavak, böngészési adatok kerülhetnek ki.'
  },
  keylogger: {
    label: 'Keylogger',
    text: 'Billentyűleütéseket rögzít — jelszavak és bizalmas adatok megszerzésére.'
  },
  exploit: {
    label: 'Exploit',
    text: 'Szoftverhibát kihasználó kód — jellemzően a rendszerbe való bejutás első lépése.'
  },
  downloader: {
    label: 'Letöltő',
    text: 'Feladata további kártevők letöltése és telepítése a fertőzött gépre.'
  },
  dropper: {
    label: 'Dropper',
    text: 'Más kártevőt „csomagol ki” és telepít a rendszerre.'
  },
  phishing: {
    label: 'Adathalász',
    text: 'Megtévesztő tartalom, amely jelszavak, bankkártya- vagy személyes adatok kicsalására készült.'
  },
  coinminer: {
    label: 'Kriptobányász',
    text: 'A gép erőforrásain titokban kriptovalutát bányászik — lassulást és magas fogyasztást okoz.'
  },
  miner: {
    label: 'Kriptobányász',
    text: 'A gép erőforrásain titokban kriptovalutát bányászik — lassulást és magas fogyasztást okoz.'
  },
  backdoor: {
    label: 'Hátsó kapu',
    text: 'Távoli, jogosulatlan hozzáférést biztosít a támadónak a géphez.'
  },
  rootkit: {
    label: 'Rootkit',
    text: 'Mélyen a rendszerbe fészkelve rejti el magát és más kártevőket.'
  },
  macro: {
    label: 'Makróvírus',
    text: 'Office-dokumentumok makróiban terjedő kártevő — a dokumentum megnyitásakor aktiválódhat.'
  },
  packed: {
    label: 'Tömörített/obfuszkált',
    text: 'Gyanúsan tömörített vagy elrejtett tartalmú bináris. Kártevők gyakran használják, de legitim szoftvereknél (védett/obfuszkált alkalmazások, játékok, fejlesztői eszközök) is előfordul — magas a hamis pozitív esélye.'
  },
  tool: {
    label: 'Eszköz',
    text: 'Önmagában nem kártevő: rendszer- vagy hackereszköz (pl. jelszó-visszafejtő, távoli adminisztráció), amelyet rosszindulatúan is lehet használni. Fejlesztői környezetben tipikusan hamis pozitív.'
  },
  agent: {
    label: 'Generikus',
    text: 'Generikus családnév — a motor ismert kártevő-mintázatot talált, konkrétabb besorolás nélkül.'
  },
  malware: {
    label: 'Kártevő',
    text: 'Általános kártevő-besorolás.'
  }
}

export function signatureInfo(signature: string): SignatureInfo {
  const sig = signature.trim()
  const lower = sig.toLowerCase()

  if (lower.includes('eicar')) {
    return {
      severity: 'test',
      label: 'Tesztfájl',
      summary: 'Az EICAR szabványos, ártalmatlan tesztminta — a víruskereső működésének ellenőrzésére szolgál.',
      notes: ['Nyugodtan törölhető; semmilyen kárt nem okoz.']
    }
  }

  if (lower.startsWith('heuristics.')) {
    const rest = sig.slice('Heuristics.'.length)
    return {
      severity: 'heuristic',
      label: 'Heurisztika',
      summary:
        'Heurisztikus találat: a fájl gyanús mintázatot mutat, de nem egyezik konkrét ismert kártevővel.',
      notes: [
        `Részlet: ${rest}`,
        'A heurisztikus találatoknál nagyobb a hamis pozitív esélye — érdemes a fájlt VirusTotalon ellenőrizni.'
      ]
    }
  }

  const isPua = lower.startsWith('pua.')
  const parts = (isPua ? sig.slice(4) : sig).split('.')
  const notes: string[] = []

  const platformKey = parts[0]?.toLowerCase()
  const platform = PLATFORMS[platformKey]
  if (platform) notes.push(platform)

  let category: (typeof CATEGORIES)[string] | undefined
  for (const part of parts.slice(1)) {
    const key = part.split('-')[0].toLowerCase()
    if (CATEGORIES[key]) {
      category = CATEGORIES[key]
      break
    }
  }
  if (category) notes.push(`${category.label}: ${category.text}`)

  if (isPua) {
    return {
      severity: 'pua',
      label: 'PUA',
      summary:
        'Potenciálisan nemkívánatos alkalmazás (PUA) — nem klasszikus kártevő. Gyakran fejlesztői eszközök, obfuszkált binárisok vagy reklámprogramok kapják ezt a jelzést.',
      notes: [
        ...notes,
        'A ClamMac a PUA-találatokat nem teszi automatikusan karanténba. Ha a fájl ismert, megbízható szoftver része (pl. IDE, SDK), vedd fel a kizárások közé, vagy kapcsold ki a PUA-detektálást a Beállításokban.'
      ]
    }
  }

  return {
    severity: 'malware',
    label: category?.label ?? 'Kártevő',
    summary:
      category?.text ??
      'A motor ismert kártevő-szignatúrával való egyezést talált. A fájlt ne nyisd meg és ne futtasd.',
    notes: [
      ...notes,
      'Javaslat: hagyd karanténban, vagy töröld véglegesen. Ha biztosan hamis pozitív, a SHA-256 alapján ellenőrizd VirusTotalon, és jelentsd a ClamAV-nak.'
    ]
  }
}
