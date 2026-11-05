**Gutachter:** Claude Opus / Effort hoch (Schwerpunkt: Handy-Ausrichtung + Controller-Ergonomie pro Spiel)

# Handy-Ausrichtung & Controller-Ergonomie – Gutachten für alle 41 Spiele

**Wirklich gelesen:** `shared/games.ts` (MINI_INFO), `client/index.html`, `client/controller/core.ts`, `main.ts`, `style.css` (komplett, inkl. aller `@media`-Blöcke), `motion.ts`, `tilt.ts`, `throwInput.ts`, `aim.ts`, `golfPutt.ts` (Kopf), `bowlingThrow.ts`, `dartsThrow.ts`. Screens vollständig: `controller.ts`, `flunky.ts`, `wwe.ts`, `sprint.ts`, `sumo.ts`, `murder.ts`, `drink.ts`, `date.ts`, `flieger.ts`, `kurve.ts`, `bowling.ts`, `igel.ts` (aktiver Zug). Templates und Eingabelogik: `enten.ts`, `kart.ts` (Kopf, Vollbild/Lock, Template), `autoball.ts` (Kopf), `darts.ts`, `golf.ts` (Putten), `boule.ts`, `ttt.ts`, `verstecken.ts`, `parcours.ts`, `turm.ts`, `smash.ts`, `bogen.ts`, `wasser.ts`, `volley.ts`, `fangen.ts`, `geist.ts`, `grill.ts`, `stillepost.ts`, `tourist.ts`, `sprueche.ts`, `pixel.ts`, `werwolf.ts`, `board.ts`, `lobby.ts`. Dazu für das TV-Intro `client/host/BoardScene.ts` (`renderIntro`), `client/host/main.ts` (Szenenwechsel), `client/tv.html`, `server/board.ts` (INTRO_MS), `scripts/status-page.mjs` (Parser für MINI_INFO) und `docs/status.json`.

## 0. Befund in fünf Sätzen

1. **Ausdrücklich quer sind heute nur `kart` und `autoball`**: `.k3-portrait`-Hinweis („Dreh dein Handy quer!“, `style.css:650/657/696`) plus `tryFullscreen()` → `screen.orientation.lock('landscape')` (`kart.ts:101-116`). Beim Kart gibt es den Hinweis nur in der Handy-Ansicht (`.k3-phone .k3-portrait`). Im TV-Splitscreen ist hochkant erlaubt.
2. **`smash` und `bogen` sind „egal“**: Sie haben einen eigenen Block `@media (orientation: landscape) and (max-height: 520px)` (`style.css` ~800 und ~839), aber weder einen Hinweis noch einen Lock. Das Querlayout funktioniert also, man muss es nur selbst entdecken.
3. **Alle anderen 37 sind stillschweigend hochkant gebaut**. Die Größen hängen an `vh`, die Sticks haben feste px (`.stick-pad` 180 px, `.ws-sticks` 158 px, `.gr-controls` 168 px), alles steht in Spalten übereinander. Quer bricht das Layout praktisch überall: Die Seite fängt an zu scrollen, und dabei gehen Gesten verloren.
4. Drei Hochkant-Layouts sind schon **heute auf schmalen Handys kaputt**. Die Inhaltsbreite bei 360 px Android ist 360 − 2·(8 Body + 4 Rahmen + 14 Padding) = **308 px**. Wasser braucht 2 × 158 + 8 = 324 px, Grill hat eine Stick-Spalte von (308 − 10)/2 = 149 px für einen 168-px-Stick, Arena eine von 149 px für einen 150-px-Stick. Diese Spiele gehören ohnehin quer.
5. Die **Sensor-Spiele hängen an der Hochkant-Haltung**. `aim.ts` rechnet die Neigung über `beta` („Oberkante zeigt auf den TV“). Im Querformat tauschen beta und gamma die Rolle. Bowling, Darts und Golf normieren die Wischkraft auf die Padhöhe (`swipeToThrow(pts, pad.clientHeight)`, `flunky.ts:68`). Außerdem kann ein Schwung das Auto-Rotate auslösen: `throwInput.ts` wertet dann bei `pointercancel` vorzeitig aus (`release` hängt an `pointercancel`), und der Wurf wird schwach. Diese Spiele müssen also hochkant **gesperrt** werden, nicht nur hochkant empfohlen.

Faustregel unten: **Zwei Daumen (Stick + Knöpfe, links/rechts halten) → quer wie ein Gamepad.** Eine Hand, Sensor-Schwung, Lichtpistole, Listen, Text, quadratisches Malen → **hochkant**. Ein einzelner Riesenknopf → **egal**.

Ergebnis: **18 × quer, 20 × hochkant, 3 × egal.**

---

## 1. Tabelle: alle 41 Spiele

Legende „Heute“: **impl.** = es gibt keinen Hinweis, keine Orientation-Media-Query und keinen `orientation.lock`, das Layout ist einfach für hochkant gebaut. Aufwand **S** = ein Abend (Flag + CSS), **M** = ein Wochenende (Layout umbauen, schwebender Stick).

| Kind | Titel | Eingabeart | Heute angenommen (Beleg) | Empfohlen + Begründung | Konkrete Layout-Änderungen | Aufw. |
|---|---|---|---|---|---|---|
| `flunky` | Flunkyball | Wischen (Wurf) + Tipp-Spam (Trinken/Laufen) | hochkant impl.; Kraft = `-dy/(pad.clientHeight*0.9)`, quer wäre die Kraftskala eine andere | **hochkant (gesperrt)**: eine Hand, langer vertikaler Wischweg | `.swipe-pad` bis knapp über den unteren Rand ziehen, Teambadge und Wind in eine Kopfzeile. Bier-Meter nach oben, TRINKEN/LAUFEN in die untere Daumenzone. VIP-„Abbrechen“ raus aus dem Bereich unten | S |
| `wwe` | Wer würde eher …? | Tippen-Liste (Spieler-Grid) | hochkant impl. | **hochkant**: Liste, ab 9 Spielern 3 Spalten | Frage als Kopf fixieren (`position: sticky`), nur das Grid scrollt | S |
| `sprint` | Liegestuhl-Sprint | 1 Reaktionsknopf | hochkant impl. (`.big-btn.sun` 68vh) | **egal**: ein Daumen, keine Nachteile in beiden Lagen | `min-height: 68vh` → `flex: 1`, dann füllt der Knopf jede Lage. Kein Hinweis-Overlay | S |
| `murder` | Mord im Ferienhaus | Raum-Grid, Tipp-Aufgabe, Rolle halten, Abstimmen-Liste | hochkant impl. | **hochkant**: geheime Rolle dicht am Körper, Listen | TIPPEN (22vh) ganz nach unten. AUSSCHALTEN/LEICHE MELDEN erscheinen heute **direkt unter** TIPPEN, beim Tipp-Spam droht ein Fehlgriff: mit ≥ 24 px Abstand über den Räumen platzieren oder 300 ms halten lassen | S |
| `descent` | Der Abstieg | 1 Sprungknopf | hochkant impl. | **egal**: ein Knopf | `.big-btn.jump` per `flex: 1` statt 52vh | S |
| `rhythm` | Das erste Gespräch | 2 Spurknöpfe + fallende Noten (Canvas 240×300) | hochkant (`aspect-ratio: 240/300`) | **hochkant**: vertikale Notenbahn, beide Daumen unten | `.lane` 16vh → 22vh und ganz unten. Canvas mit `max-height: calc(100svh - …)`, damit Bahn und Knöpfe ohne Scrollen passen | S |
| `wrap` | Wraps mit Sriracha-Mayo | Drehrad + GREIFEN | hochkant impl. | **hochkant**: eine Hand, Timing | GREIFEN in die Daumenzone unten, Rezeptleiste oben | S |
| `stars` | Tanz unter den Sternen | Zeichnen (Stern zu Stern) auf 3:2-Canvas | hochkant impl., Canvas nur ~330×220 px | **egal (quer bringt Fläche)**: Das 3:2-Canvas wird quer bei Kopfzeile als Seitenspalte etwa 450×300 (+85 %), gezeichnet wird mit dem Finger der zweiten Hand | `@media (orientation: landscape)`: Infos (Name, Hinweis, x/y Linien) in eine schmale linke Spalte, Canvas `height: calc(100svh - 24px)` | S |
| `nhie` | Ich hab noch nie … | 2 große Antwortknöpfe | hochkant impl. | **hochkant**: Glas in der anderen Hand | keine Änderung nötig, Knöpfe sitzen schon unten | S |
| `hilo` | Höher oder Tiefer | 2 Knöpfe (▲ oben / ▼ unten) | hochkant impl. | **hochkant**: Knopfreihenfolge = Richtung | keine | S |
| `bomb` | Tick-Tack-Bumm | 1 Knopf WEITERGEBEN | hochkant impl. | **hochkant**: einhändig | Knopf unten auf `flex: 1` | S |
| `sup` | SUP-Rennen | 1 Paddel-Knopf (Team) / 2 (solo), je 50vh | hochkant impl. | **hochkant**: im Team eine Hand, ein Knopf | Balance-Leiste und Fortschritt oben, Paddel bis zum unteren Rand | S |
| `tidy` | Aufräumen! | Joystick (180 px, fest) + SPRINT **darunter** | hochkant impl.: Stick und Knopf in einer Spalte, **ein** Daumen muss springen | **quer**: zwei Daumen, Stick links, Sprint rechts | `.lx`-Grundlayout (s. Abschnitt 2). Kopfzeile 28 px (Team · Zeit · Punkte), links schwebender Stick, SPRINT rechts unten ~40 % Höhe | S |
| `flieger` | Urlaubsflieger | Cockpit-Panel (Tasten, Schalter, Segmentwahl) | hochkant (`grid-auto-rows: minmax(110px,1fr)`, quer 3 Reihen × 110 > Höhe) | **hochkant**: Lesen und gezieltes Antippen, zweite Hand frei | Anweisung bleibt oben. Status (Etappe/Sprit) wandert in die Kopfzeile, Panel bekommt die ganze Resthöhe | S |
| `kurve` | Kurven-Duell | LINKS / RECHTS halten (2 × 58vh) | hochkant impl. | **quer**: Daumen ruhen an den Rändern wie Schultertasten. Hochkant müssen sie zur Mitte, die Hand verkrampft | Beide Knöpfe als volle Bildhälften (`height: 100%`). Farbe, Runde und Status als schmale Leiste oben in der Mitte | S |
| `arena` | Bomben-Arena | Joystick (150 px) + BOMBE nebeneinander | hochkant impl. (2 Spalten à 149 px bei 360 px → Stick ragt über) | **quer**: Bomberman = Gamepad | Kopf (Avatar, Runde, Stats) als Zeile, links schwebender Stick, BOMBE rechts unten ~120 × 100 px | S |
| `bowling` | Strand-Bowling | Sensor-Schwung (halten → schwingen → loslassen) oder Wischen, Startpositions-Leiste | hochkant impl. Wischkraft auf Padhöhe normiert. Rotation im Schwung → `pointercancel` → vorzeitige Auswertung | **hochkant (gesperrt, Android `lock('portrait')`)**: Handy wie Kugel in einer Hand | Startleiste oben, Schwungknopf (46vh) in der Daumenzone unten. Die Rangliste im Zuschau-Screen darf scrollen | S |
| `enten` | Ententeich | Lichtpistole (Sensor alpha/beta) oder Touchpad + SCHUSS | hochkant impl. `aim.ts`: „Oberkante zeigt auf den TV“, Neigung = beta. Quer wird die Neigung zu gamma, das Zielen geht nicht mehr | **hochkant (gesperrt im Sensormodus)**. Im Touchpad-Modus per Screen-Override `any` | SCHUSS-Fläche ganz unten (Daumen), „Zentrieren/Touchpad“ oben klein, damit man es nicht versehentlich trifft | S |
| `ttt` | Verräter im Ferienhaus | Joystick + ANGRIFF/BENUTZEN + Rolle halten + Geheimfach-Shop | hochkant impl. (Stick oben, 2 Knöpfe 15vh, darunter Rolle/Fach) | **quer**: 3-Minuten-Echtzeit-Action mit zwei Daumen | Stick links, ANGRIFF groß rechts unten, BENUTZEN schräg darüber. Rolle 👁 und Fach 🔒 als kleine Tabs oben rechts, Shop als Sheet über der Mitte, das bei ANGRIFF zugeht | M |
| `verstecken` | Versteckspiel mit Möbeln | Joystick + 3 Knöpfe (Versteck) / 1 (Sucher) | hochkant impl. (`.vs-controls` 2 Spalten, Stick 150 px) | **quer** | Stick links. Rechts ein Daumenbogen: EINRASTEN groß (Hauptaktion), VERWANDELN oben, PFEIFEN innen. Möbelvorschau und Hinweis in der Kopfzeile | M |
| `parcours` | Fallen-Parcours | Kartenwahl (Liste) → Platzieren (Stick + DREHEN/PLATZIEREN) → Lauf (Stick + SPRINGEN) | hochkant; **Querformat schon in Arbeit** (`status.json`: `fix/parcours-quer`) | **quer** in allen Phasen | Karten als 3 Spalten nebeneinander. Bau: Stick links, DREHEN/PLATZIEREN rechts. Lauf: Stick (nur x) links, SPRINGEN rechts unten groß. Zurück oben links | M |
| `kart` | Kart-Rennen | schwebender Stick / Kippen + GAS/BREMSE/DRIFT/ITEM | **quer**: `.k3-portrait` (nur `.k3-phone`), `lock('landscape')` in `tryFullscreen()` | **quer** ✓ (Vorbild-Layout) | `.k3-portrait` durch das zentrale Overlay ersetzen. TV-Split-Hochkant als Override `any` behalten. Bei Rennende kein `leaveFullscreen()` mehr, Vollbild bleibt die ganze Session | S |
| `turm` | Wackelturm | ◀ DREHEN ▶ + FALLEN (Halten mit Auto-Wiederholung) | hochkant impl. (`.turm-pad` 46vh + `.drop` 15vh) | **quer**: Tetris-Gamepad, links schieben, rechts drehen/fallen | Links ◀ ▶ nebeneinander unten, rechts DREHEN über FALLEN. Mitte: Leben, „Nächstes“, Meldung | M |
| `igel` | Igel-Krieg | Waffen-Grid + Ziel-Pad (ziehen = Winkel/Kraft) + ◀ SPRUNG ▶ + Fertig | hochkant impl. (`.ig-pad` min 34vh, Lauf-Knöpfe darunter) | **quer**: Worms = links bewegen, rechts zielen | Links Waffen 2×3 und darunter ◀ SPRUNG ▶, rechts das Ziel-Pad (≈ 60 % Breite, volle Höhe). „Fertig“ oben rechts. Zuschau-Screen: Minikarte (`aspect-ratio 480/270`) groß | M |
| `smash` | Smash-Arena | schwebende Stick-Zone + 4 runde Knöpfe | **egal**: `@media (orientation: landscape) and (max-height:520px)` vorhanden, kein Hinweis/Lock | **quer** | Das Querlayout zum Standard machen, hochkant nur noch als Notbehelf. „Abbrechen“ sitzt dort schon oben rechts (gut) | S |
| `wasser` | Wasserbomben-Schlacht | Twin-Stick (Laufen + Zielen, Loslassen = Wurf) | hochkant impl. **Kaputt auf 360 px**: 2 × 158 + 8 = 324 > 308 px | **quer (dringend)**: Twin-Stick braucht zwei Daumen an den Rändern | Linke und rechte Hälfte je eine schwebende Stick-Zone, Nässe-Meter und Munition in der Kopfzeile, Hinweis klein in der Mitte | M |
| `stillepost` | Stille Post mit Bildern | Text (Tastatur), Malen (quadratisch), Abstimmen | hochkant (`.sp-canvas width: min(100%, 50vh)`) | **hochkant (Pflicht)**: Tastatur und quadratische Malfläche | Palette und Werkzeuge unter dem Canvas in der Daumenzone. „Fertig!“ mit Abstand **unter** den Werkzeugen und farbig abgesetzt (Fehltipp kostet die Runde) | S |
| `fangen` | Urlaubs-Fangen | Animateur: private Karte 480×256 + Stick + ABLENKUNG. Fänger: Stick + SPRINT + Hitze-Anzeige | hochkant impl.; Karte bei 302–332 px Breite nur **~160–177 px hoch** | **quer**: Karte ~2,2× größer, Stick und Knopf an den Daumen | Animateur: Stick links, Karte mittig (`height: 100%`), ABLENKUNG rechts. Fänger: Hitze mittig groß, Stick links, SPRINT rechts | M |
| `geist` | Geisterjagd | Jäger: Stick + LICHT. Geist: Stick + private Karte 464×242 | hochkant impl.; Geist-Karte bei Breite 330 px nur ~172 px hoch | **quer** | Geist: Karte mittig groß, Stick links, Leben/Status als rechte Spalte. Jäger: Stick links, LICHT (mit Akku) rechts, Gänsehaut-Meter als Kopfzeile | M |
| `grill` | Grill-Chaos | Stick (168 px) + NEHMEN / AKTION (halten) + Bestellleiste + „Du trägst“ | hochkant impl.; **Stick 168 px > Spalte 149 px** (360 px) bzw. 164 px (390 px) | **quer**: Overcooked = Gamepad | Kopfzeile Zeit · Punkte · Bestellungen. Links Stick-Zone, Mitte „Du trägst“ und Hinweis, rechts NEHMEN über AKTION (Daumenbogen) | M |
| `boule` | Boule am Strand | Sensor-Schwung/Wischen + Legen/Schießen + Minikarte 96×150 | hochkant impl. | **hochkant (gesperrt)**: Wurfbewegung, hochformatige Karte | Legen/Schießen oben neben der Karte (wie heute), Wurffläche unten. Keine weiteren Änderungen | S |
| `sumo` | Sumo-Steg | Stick + REMPELN (mit Abklingzeit) | hochkant impl. (`.arena-controls`) | **quer** | wie Arena: Stick links, REMPELN rechts unten, Abklingfüllung bleibt | S |
| `volley` | Strand-Volleyball | ◀ ▶ + SPRUNG/SCHMETTERN (2×2) | hochkant, aber schon wie ein Gamepad (`.vb-pad` 2 Spalten, ◀▶ 52vh) | **quer**: dieselbe Anordnung, nur mit natürlichem Griff | `.vb-left/.vb-right` → `height: 100%`, Kopf (Team/Punkte) als Zeile. Fast nur CSS | S |
| `tourist` | Wer ist der Tourist? | Karte aufdecken, Spielerliste, JA/NEIN | hochkant impl. | **hochkant**: Geheimkarte, Fragen-Listen | ANKLAGEN nicht direkt unter der Liste (Fehltipp), erst nach 500 ms Halten auslösen | S |
| `sprueche` | Sprüche-Duell | Text (Tastatur), Abstimmen | hochkant impl. | **hochkant (Pflicht)**: Tastatur | Prompt oben fixieren, damit die Tastatur ihn nicht wegschiebt | S |
| `pixel` | Pixel-Galerie | Malen 16×16 + Palette/Werkzeuge | hochkant (hat `resize`-Listener) | **hochkant**: quadratisch, Werkzeuge darunter | Werkzeuge (`.px-tools` 36 px hoch) auf 44 px vergrößern (Fat-Finger) | S |
| `bogen` | Bogen-Arena | Stick-Zone (8 Richtungen) + DASH/SCHUSS/SPRUNG | **egal**: Landscape-Media-Query vorhanden | **quer** | wie Smash: die Query wird zum Standard | S |
| `darts` | Darts an der Strandbar | Zielen (Board ziehen) + Sensor-Schnippen/Wischen | hochkant impl. Board-Größe einmalig aus `innerHeight*0.36` (`darts.ts:108`), kein Neuberechnen beim Drehen | **hochkant (gesperrt)**: Dart aufrecht in der Hand | Board oben, Schnell-Ziele (T20/BULL/T19) direkt darunter, Wurffläche unten in der Daumenzone | S |
| `golf` | Urlaubs-Minigolf | Schleuder ziehen auf der Karte / Sensor-Putter | hochkant impl., `fit()` einmalig aus `innerHeight*0.42` (`golf.ts:266`), kein `resize` | **hochkant (gesperrt)**: Putter-Schwung, langer Zieh-Weg | Karte bis `calc(100svh - Kopf - Knopf)`, Modus-Umschalter oben statt unten | S |
| `autoball` | Auto-Fußball | wie Kart (+ BOOST/HÜPFER) | **quer**: `.afb .k3-portrait` immer, Lock via `tryFullscreen` | **quer** ✓ | wie Kart: zentrales Overlay, Vollbild nicht bei Abpfiff verlassen | S |
| `werwolf` | Werwölfe im Ferienhaus | Rolle aufdecken, Nachtaktion, Abstimmen-Liste | hochkant impl. | **hochkant**: Geheimkarte, Listen, viele Spieler | „Jetzt abstimmen“ (VIP) nicht in die Daumenzone der Liste | S |

**Nicht-Spiel-Screens:** `lobby.ts` (Name, Avatar-Editor, Menüs) → **hochkant**, wegen der Texteingabe. `board.ts` (WÜRFELN, Intro) → hochkant, aber ohne Hinweis-Overlay (`nag: false`). Das Brett-Intro ist **der** Ort für die Ausrichtungsansage vor dem Spiel. `results.ts` → hochkant, ohne Hinweis.

**Zusammenfassung:** quer = `tidy, kurve, arena, ttt, verstecken, parcours, kart, turm, igel, smash, wasser, fangen, geist, grill, sumo, volley, bogen, autoball` (18). Egal = `sprint, descent, stars` (3). Hochkant = der Rest (20). Davon **gesperrt** (Sensor oder Tastatur): `flunky, bowling, enten, boule, darts, golf, stillepost, sprueche`.

### Regeln für alle Hochkant-Spiele (gilt für jede Zeile oben)
- **Hauptaktion unten** (Daumenzone, untere 40 %), Status oben. Kein Hauptknopf in der Mitte, der beim Scrollen wandert.
- **VIP-„Abbrechen“ raus aus der Daumenzone.** `.abort { margin-top: auto }` (`style.css:211`) hängt den Knopf heute ans Ende von `#app`, also direkt unter Schwungknopf, Wischfläche und TIPPEN. Besser in jedem Spiel `position: fixed` oben rechts, klein (wie im Querformat bei Smash, `style.css:803`).
- **`.toast` mit `pointer-events: none`**: Er liegt unten in der Mitte (`bottom: 24px`) und kann heute Taps abfangen.
- Größen über `svh` (kleinste Viewport-Höhe) statt `vh`, damit nichts herausrutscht, wenn die Adressleiste erscheint.

---

## 2. Gemeinsame Infrastruktur – Datei für Datei

### 2.1 `shared/games.ts`
```ts
export type PhoneOrientation = 'portrait' | 'landscape' | 'any';
export interface MiniInfo {
  …
  /** Wie das Handy gehalten wird – Pflicht (Overlay, Ansage am TV, Android-Lock) */
  orientation: PhoneOrientation;
}
export const ORIENT_TEXT: Record<PhoneOrientation, string> = {
  landscape: '📱↔ Handy QUER halten', portrait: '📱 Handy hochkant halten', any: '📱 Halte das Handy, wie du magst',
};
```
- Das Feld als **Pflicht** anlegen (wie `icon`), dann erzwingt `Record<MiniKind, MiniInfo>` beim `npm run typecheck`, dass jedes neue Spiel eine Ausrichtung bekommt. In `CLAUDE.md` die Regel „neues Minispiel … Pflichtfeld `icon`“ um „und `orientation`“ ergänzen.
- **Wichtig:** Der Eintrag muss einzeilig bleiben und mit `title:` beginnen, sonst findet ihn der Parser in `scripts/status-page.mjs:13` (`/^\s+(\w+): \{ title: '([^']+)'(.*)$/gm`) nicht mehr. Also `orientation: 'landscape'` hinten anhängen. Optional parst die Status-Seite `/orientation: '(\w+)'/` und zeigt ↔ bzw. ↕ in der Spieleliste.

### 2.2 `client/controller/orientation.ts` (neu) – ein zentraler Baustein
Holt `tryFullscreen`/`leaveFullscreen` aus `screens/kart.ts` heraus und erweitert sie:
```ts
export function deviceOrient(): 'portrait' | 'landscape'   // screen.orientation?.type, Fallback matchMedia
export function setWanted(want: PhoneOrientation, opts: { nag: boolean; kind?: MiniKind }): void
export function onRotate(cb: () => void): () => void       // screen.orientation 'change' + matchMedia 'change'
export function lockIfPossible(): Promise<void>            // nur in Vollbild (Android/Firefox)
```
- **Erkennung über `screen.orientation.type`, nicht über `@media (orientation)`.** Die Media-Query vergleicht nur die Seitenverhältnisse des Viewports. Wenn die Tastatur den Viewport verkleinert (Samsung Internet, Firefox Android, ältere Chrome-Versionen), meldet sie „landscape“, und das Overlay würde mitten in Stille Post über das Textfeld springen. Zusätzlich gilt: Solange `document.activeElement` ein `input`/`textarea` ist, wird nicht gewarnt.
- **Overlay `#orient` (blockierend):** erscheint bei falscher Lage, solange das Spiel läuft. Es zeigt `ORIENT_TEXT`, ein großes Handy-Symbol mit CSS-Drehanimation und nach 3 s den Zusatz „Dreht sich nicht? Ausrichtungssperre im Kontrollzentrum ausschalten 🔒“ (für iPhones). Bei Hochkant-Spielen, die nicht gesperrt sind (z. B. `wwe`), gibt es den kleinen Knopf „Trotzdem so“. Er setzt eine Ausnahme pro Spielinstanz.
- **Vor-Spiel-Karte `#orient-card` (nicht blockierend, `pointer-events: none`):** Wenn sich `mini.kind` ändert, kommt sie 2 s lang (Hochkant-Spiele) bzw. bis zur richtigen Lage + 0,6 s (Quer-Spiele). Inhalt: `icon` · Titel · `ORIENT_TEXT`. So sieht man die Ansage **immer**, ohne dass ein Countdown-Tap verloren geht.
- **Eingaben zurücksetzen:** Beim Einblenden des Overlays feuert `window.dispatchEvent(new Event('input-reset'))`. Sticks senden dann (0,0), Halte-Knöpfe lassen los (`kurve.ts` hat das schon für `blur`, Kart und Igel brauchen es). Sonst läuft eine Figur weiter, während man das Handy dreht.
- **Android-Lock:** Beim ersten `pointerdown` (capture auf `document`) in einem Spiel mit `want !== 'any'` wird einmal `requestFullscreen({ navigationUI: 'hide' })` aufgerufen, danach `screen.orientation.lock(want)`. Das Vollbild **bleibt die ganze Session**; zwischen den Spielen wird nur umgelockt (`lock('portrait')` in Lobby/Brett, `unlock()` bei `any`). Bei `fullscreenchange` → `null` (Zurück-Geste) wird ein Flag gesetzt und beim nächsten Tap erneut versucht. Das löst nebenbei das Problem, dass ein Bowling-Schwung das Display dreht.
- **Desktop und Tablet nicht belästigen:** Bei `matchMedia('(hover:hover) and (pointer:fine)')` oder `Math.min(screen.width, screen.height) > 600` wird nie gewarnt. Laptop-Tests mit `npm run dev` bleiben so ruhig.

### 2.3 `client/index.html`
`<div id="orient" class="orient hidden"></div>` und `<div id="orient-card" class="orient-card hidden"></div>` als **Geschwister** von `#app`, wie `#toast`. `render()` leert `#app` mit `app.innerHTML = ''`; Elemente außerhalb überleben das, und der Screen muss nicht neu gebaut werden (Regel aus `CLAUDE.md`).

### 2.4 `client/controller/core.ts`
- `Screen` optional erweitern: `export type Screen = [key: string, build: Builder, orient?: PhoneOrientation];`. Screen-Module können damit für einzelne Phasen übersteuern (Kart-TV-Split → `'any'`, Enten-Touchpad → `'any'`). Alle bestehenden 2-Tupel kompilieren weiter.
- `tapButton` und Co. bleiben unverändert.

### 2.5 `client/controller/main.ts`
- In `render()` nach `syncVipAbort()` kommt `syncOrientation(screen)`:
  - `phase === 'mini'` und bekannter `kind` → `want = screen[2] ?? MINI_INFO[kind].orientation`. Kein Hinweis (`nag: false`) bei Zuschauen: Keys `spectate`, `watch` sowie `*-over`.
  - Lobby/Brett/Ergebnis → `want = 'portrait'`, `nag: false` (nur Android-Lock, kein Overlay).
  - Merken: `lastKind !== kind` → Vor-Spiel-Karte zeigen.
- `onRotate(() => render())`, damit Updater mit festen Größen nachziehen. Zusätzlich für `darts`/`golf` (Größe einmalig berechnet) bei Rotation `screenKey = ''` setzen und **neu bauen**. Das ist erlaubt, weil beim Drehen niemand tippt.
- Wake-Lock: `requestWakeLock()` heute nur in `join()`. Zusätzlich bei `visibilitychange → visible` und `fullscreenchange` neu anfordern (der Lock fällt beim App-Wechsel weg).

### 2.6 `client/controller/style.css`
- `.orient` / `.orient-card` (Pixel-Look, `--gold` auf dunklem Grund wie `.k3-portrait`).
- **Gemeinsames Querlayout `.lx`** für alle 18 Querspiele (statt 18 eigener Hacks):
  ```css
  #app:has(.lx) { padding: 0; border: 0; box-shadow: none; min-height: 100dvh; }
  .lx { position: fixed; inset: 0; display: grid;
        grid-template: "head head head" 28px "left mid right" 1fr / 42% 1fr 38%;
        padding: 4px max(10px, env(safe-area-inset-right)) max(6px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left)); }
  .lx-head { grid-area: head; display: flex; gap: 10px; font-size: 8px; align-items: center; padding-right: 96px; } /* Platz für Abbrechen */
  .lx-left { grid-area: left; } .lx-mid { grid-area: mid; } .lx-right { grid-area: right; display: grid; align-content: end; gap: 8px; }
  ```
  Body-Padding und App-Rahmen kosten quer heute 2·(8+4+16) = 56 px von ~340 px, also 16 % der Höhe. `.lx` holt das zurück, so wie es `.k3` (`position: fixed; inset: 0`) schon vormacht. Die Seiteneinzüge (Notch) fehlen im Body-Padding heute ganz (`style.css:46` nimmt nur top/bottom).
- `.abort` in allen Spielen oben rechts (`position: fixed; top: calc(6px + env(safe-area-inset-top)); right: calc(8px + env(safe-area-inset-right))`), `.toast { pointer-events: none; }`.
- Die `.k3-portrait`-Regeln (`style.css:650`, `657-658`, `696-697`) und die Elemente in `kart.ts`/`autoball.ts` fallen weg; das zentrale Overlay übernimmt.

### 2.7 `client/controller/stick.ts` (neu) – ein Stick statt drei
Heute gibt es drei Implementierungen: `joystick()` fest mittig (`controller.ts`, R = 60), die schwebende, mitziehende Zone in `smash.ts` (Ring an der Aufsetzstelle) und den Kart-Stick `.k3-stick` (nur x). Daraus wird eine:
```ts
stickZone(zone: HTMLElement, onMove: (x, y) => void, opts?: { axis?: 'x' | 'xy'; radius?: number; trailing?: boolean })
```
- **Schwebend:** Daumen irgendwo in der linken Zone aufsetzen, dort ist die Mitte. Das ist der größte Ergonomie-Gewinn, denn man schaut auf den TV und muss keinen 180-px-Kreis treffen.
- Hört auf `input-reset`. Hält ≥ 24 px Abstand zum Bildschirmrand (Zurück-Wischgeste bei Android und Safari, Home-Indikator).
- Alle Joystick-Spiele (`tidy, arena, sumo, ttt, verstecken, parcours, fangen, geist, grill, wasser`) wechseln von `joystick(q(root,'.stick-area'), …)` auf `stickZone(q(root,'.lx-left'), …)`. Die Signatur von `onMove` bleibt gleich, also **keine Server-Änderung**.

### 2.8 Screens
- `screens/kart.ts`, `screens/autoball.ts`: `tryFullscreen`/`leaveFullscreen` aus `orientation.ts` importieren, `.k3-portrait` entfernen, `leaveFullscreen()` bei `over`/`finished` durch nichts ersetzen (Vollbild bleibt). Im TV-Split `orient: 'any'` als drittes Tupel-Element zurückgeben.
- `screens/board.ts` (Intro, Zeile 17): Unter die Tagline `<p class="orient-line">${ORIENT_TEXT[info.orientation]}</p>` setzen. Das Intro steht `INTRO_MS = 4000` lang (`server/board.ts:6`); genau dann soll man das Handy drehen.
- `screens/lobby.ts` (Arcade-Liste `btn-grid`, Zeile 110 ff.): ↔ hinter Quer-Titel.
- Die übrigen Screens gemäß Tabelle (Spalte „Layout-Änderungen“).

### 2.9 TV
- `client/host/BoardScene.ts` `renderIntro()` (Zeile ~200): `'Schaut auf eure Handys!'` → `info.orientation === 'landscape' ? 'Handys QUER halten! 📱↔' : 'Schaut auf eure Handys!'`. Emoji gehen in diesem Text, `info.icon` wird darüber schon so gerendert.
- **Arcade/Trinkspiel/Date haben kein Brett-Intro.** Deshalb in `client/host/main.ts` im `state`-Handler bei `key !== currentKey` und `s.phase === 'mini'` ein DOM-Banner einblenden: `#orient-tv` in `client/tv.html` (gleicher Stil wie `#sound`), Text `ORIENT_TEXT[...]`, 6 s, dann ausblenden. Das braucht **keine Änderung an den 41 Phaser-Szenen**; die Szenen werden ohnehin in `create()` zurückgesetzt, und ein DOM-Overlay stört das nicht.
- `client/host/arcadePicker.ts` (Kachel, Zeile ~70): kleines ↔-Badge neben `.insp`. Optional dasselbe in `hostControls.ts`.

### 2.10 Was unberührt bleibt
- **`server/*`**: Die Ausrichtung ist reine Darstellung, Spiellogik und Inputs ändern sich nicht. Server-autoritativ bleibt gewahrt.
- **`scripts/bots.ts`**: Die Bots hängen direkt am Socket, ohne DOM. Das neue `MiniInfo`-Feld wird nur clientseitig gelesen. `npm run bots -- 4 --party` muss unverändert durchlaufen, als Gegenprobe dafür, dass keine Server-Schnittstelle angefasst wurde.
- Musik-Werkstatt `/musik.html`: nicht betroffen.

### 2.11 Stufe 2 (optional): „Pseudo-Quer“ für iPhones mit Ausrichtungssperre
Bei iPhones ist die Rotationssperre im Kontrollzentrum oft an, dann dreht Safari nie. Die Lösung: Das `.lx`-Layout im Hochformat per CSS drehen (`width: 100dvh; height: 100dvw; transform: rotate(90deg) translateY(-100%); transform-origin: top left`). `stick.ts` rechnet Pointer-Deltas um: (dx, dy) → (dy, −dx). Vorteil: iPhone-Spieler können die Sperre **an** lassen, was für die Sensor-Spiele sogar besser ist. Es gibt einen Konflikt, den nur diese Variante löst: Querspiele wollen die Sperre aus, Bowling/Darts/Golf wollen sie an. Aktivieren per Knopf im Overlay („Mein Handy dreht nicht“). Aufwand M; Toasts, `confirm()` und die Home-Indikator-Kante (dann seitlich, Stick-Zone fernhalten) beachten.

---

## 3. Die 8 Spiele, bei denen die Umstellung am meisten bringt

Reihenfolge = Gewinn ÷ Aufwand. Alle setzen `stick.ts` + `.lx` (Abschnitt 2.6/2.7) voraus; danach ist jedes Spiel einzeln machbar.

### 1. `wasser` – Wasserbomben-Schlacht (M)
Heute auf 360-px-Handys kaputt (324 > 308 px). Twin-Stick ist das Lehrbuch-Gamepad.
```
┌──────────────────────────────────────────────────────────┐
│ 💦 1:24   NÄSSE ▓▓▓▓░░░   💧💧○        Treffer!  [Abbr.] │
├────────────────────────┬────────┬────────────────────────┤
│                        │        │                        │
│      LAUFEN            │ (frei, │       ZIELEN           │
│   Daumen irgendwo      │ keine  │  Daumen aufsetzen,     │
│   aufsetzen = Mitte    │ Touch- │  ziehen = Richtung +   │
│        ( ◉ )           │ fläche)│  Kraft, loslassen=Wurf │
│                        │        │        ( ◎ )           │
└────────────────────────┴────────┴────────────────────────┘
```
Die Mitte (~12 %) bleibt totes Gebiet, damit sich die Daumen nicht ins falsche Feld verirren. Das Zielen behält den `.aim-ring` als Kraft-Anzeige.

### 2. `igel` – Igel-Krieg (M)
Der Worms-Klon: Links laufen/springen, rechts zielen. Heute steht das Ziel-Pad über den Lauf-Knöpfen, ein Daumen pendelt.
```
┌──────────────────────────────────────────────────────────┐
│ 🦔 Du bist dran · 23 s · Wind >>             [Fertig ✓]  │
├───────────────────────┬──────────────────────────────────┤
│ [Kokos ∞ ][Wasser 2 ] │                                  │
│ [Granat 1][Telep. 1 ] │        ZIEL-PAD                  │
│ [Seil  1 ][Mine   1 ] │   ziehen = Winkel + Kraft        │
│                       │   loslassen = Feuer              │
│ [ ◀ ] [SPRUNG] [ ▶ ]  │        ●───────▶  73 %           │
└───────────────────────┴──────────────────────────────────┘
```
„Fertig“ oben rechts (weg von beiden Daumen). `maxLen()` rechnet schon mit `min(w,h)` des Pads, die Zielgeometrie passt also. Zuschau-Screen: die Minikarte `.ig-map` (480/270) quer in voller Höhe.

### 3. `grill` – Grill-Chaos (M)
Overcooked mit vier Elementen in einer Spalte. Heute ist der Stick breiter als seine Spalte.
```
┌──────────────────────────────────────────────────────────┐
│ 🔥 2:10  ★ 340   [🍔 32s][🌭 18s][🥗 50s][🍢 61s]  [Abbr]│
├──────────────────────┬────────────────┬──────────────────┤
│                      │  DU TRÄGST     │   [ NEHMEN ]     │
│   STICK-ZONE         │  ┌──────┐      │    aufheben      │
│   (schwebend)        │  │ 88×80│ roh  │                  │
│                      │  └──────┘      │   [ AKTION ]     │
│                      │  „Ab auf Grill“│   halten = …     │
└──────────────────────┴────────────────┴──────────────────┘
```

### 4. `fangen` – Urlaubs-Fangen (M)
Der Animateur spielt **nur** über seine private Karte. Quer wird sie ~2,2× größer (≈ 430×230 statt ≈ 300×160).
```
┌──────────────────────────────────────────────────────────┐
│ 🕵️ ANIMATEUR · 0:48 · Runde 2/3      „Fänger nah!“       │
├──────────┬───────────────────────────────────┬───────────┤
│          │                                   │           │
│  STICK   │       PRIVATE KARTE 480×256       │ [ABLEN-   │
│  (Zone)  │      (height: 100 %, pixelated)   │  KUNG]    │
│          │                                   │ falsche   │
│          │                                   │  Spur     │
└──────────┴───────────────────────────────────┴───────────┘
```
Fänger: Mitte = Hitze-Anzeige `.fg-heat` riesig, links Stick, rechts SPRINT.

### 5. `geist` – Geisterjagd (M)
Dieselbe Logik: Die Geister-Karte 464×242 ist hochkant nur ~172 px hoch.
```
┌──────────────────────────────────────────────────────────┐
│ 👻 GEIST · 1:12   ▓▓▓▓▓▓░░ Leben            „Jäger nah“  │
├──────────┬───────────────────────────────────┬───────────┤
│  STICK   │        GEISTER-KARTE 464×242      │ Du = ○    │
│  (Zone)  │                                   │ Gelb=Jäger│
│          │                                   │ Kegel=Licht│
└──────────┴───────────────────────────────────┴───────────┘
 Jäger:   [ Stick ]   GÄNSEHAUT ▓▓▓░ „brrr“   [ LICHT AN ▓▓ Akku ]
```

### 6. `ttt` – Verräter im Ferienhaus (M)
Lange Echtzeit-Runden, zwei Aktionsknöpfe plus geheime Menüs. Das Finale im Party-Modus, also viel Spielzeit.
```
┌──────────────────────────────────────────────────────────┐
│ 🏊 1:52  ♥♥♥  🥢 Poolnudel          [👁 Rolle] [🔒 Fach] │
│ „Ausgeknockter in der Nähe – BENUTZEN untersucht“        │
├───────────────────────────┬──────────────────────────────┤
│                           │              [ BENUTZEN ]    │
│   STICK-ZONE              │                              │
│   (schwebend)             │      [  ANGRIFF  ]           │
│                           │        (groß, rot)           │
└───────────────────────────┴──────────────────────────────┘
```
👁 Rolle bleibt Halten-zum-Zeigen (`roleHold`). 🔒 Fach öffnet ein Sheet über der **linken** Hälfte und schließt bei Stick-Berührung, damit ANGRIFF immer erreichbar bleibt.

### 7. `turm` – Wackelturm (M)
Tetris-artig: Hochkant liegen ◀ DREHEN ▶ in einer Reihe, man drückt mit einem Daumen auf drei Knöpfe.
```
┌──────────────────────────────────────────────────────────┐
│ 🗼 1:05 · Höhe 12 m        ♥♥♡          Nächstes: [▭▭]   │
├────────────────────┬────────────────┬────────────────────┤
│                    │  „Wackelt!“    │    [ DREHEN ⟳ ]    │
│  [  ◀  ] [  ▶  ]   │                │                    │
│   halten = weiter  │                │    [ FALLEN ⬇ ]    │
│                    │                │                    │
└────────────────────┴────────────────┴────────────────────┘
```
`repeatButton()` (260 ms Verzögerung, dann alle 110 ms) bleibt unverändert, nur die CSS-Anordnung ändert sich.

### 8. `verstecken` – Versteckspiel mit Möbeln (M)
Stick plus drei Knöpfe. Hochkant stapeln sie sich rechts in einer 150-px-Spalte.
```
┌──────────────────────────────────────────────────────────┐
│ 🪴 VERSTECKER · 1:30   [🧊 Kühlbox]  „Niemand guckt“      │
├──────────────────────────┬───────────────────────────────┤
│                          │   [VERWANDELN]                │
│   STICK-ZONE             │                [ EINRASTEN ]  │
│                          │   [PFEIFEN]     (groß)        │
└──────────────────────────┴───────────────────────────────┘
 Sucher:  [ Stick ]  „Achte auf Pfiffe!“  [   PRÜFEN   ]
```

**Genauso günstig danach (je S, sobald `stick.ts` und `.lx` existieren):** `arena`, `sumo`, `tidy` (Stick + 1 Knopf), `kurve` und `volley` (nur CSS), `smash` und `bogen` (bestehende Landscape-Query zum Standard machen). `parcours` läuft bereits auf `fix/parcours-quer`. Dort sollte man gleich auf `.lx` + `stick.ts` aufsetzen, statt einen Sonderweg zu bauen.

---

## 4. Risiken

1. **iOS Safari kennt kein `screen.orientation.lock()`**, und auf dem iPhone gibt es kein Element-Vollbild (nur Video; iPad hat Teile). Für iPhone-Spieler bleibt es also beim **Hinweis**, Zwang ist nicht möglich. Dazu kommt die **Rotationssperre im Kontrollzentrum**. Ist sie an (häufig), dreht Safari nie, und das Overlay „quer halten“ verschwindet nicht. Deshalb nach 3 s der 🔒-Zusatztext, und als echte Lösung Stufe 2 (Pseudo-Quer per CSS-Rotation, Abschnitt 2.11).
2. **Android-Lock geht nur im Vollbild**, und Vollbild nur aus einer Nutzergeste. Die Zurück-Geste beendet das Vollbild, dann ist auch der Lock weg. Lösung: bei `fullscreenchange` neu versuchen, Vollbild über die Session halten und nicht pro Spiel betreten/verlassen (heute ruft der Kart bei jedem Rennende `leaveFullscreen()` auf).
3. **Die Adressleiste frisst Höhe.** Chrome Android quer hat ohne Vollbild ~300 statt 360 px (die URL-Leiste kostet ~56 px). Safari iPhone quer hat ~340 px, dazu kommt der Home-Indikator unten (~21 px, `safe-area-inset-bottom`). **Querlayouts auf 300 px Höhe auslegen.** Knöpfe nicht in `vh`, sondern im Grid relativ (`1fr`) bzw. in `svh`. Für iPhones hilft „Zum Home-Bildschirm“: `apple-mobile-web-app-capable` ist in `index.html` schon gesetzt, im Standalone-Modus gibt es keine Browserleisten mehr. Ein Hinweis darauf in der Lobby wäre billig.
4. **`100dvh` ändert sich**, wenn die Leiste ein- und ausfährt. Das Layout springt dann mitten im Spiel. Den Container mit `dvh`, Bedienelemente mit `svh` bzw. Grid-Anteilen bauen. Joystick-Mitten nur bei `pointerdown` messen (machen `joystick()` und `smash.ts` schon richtig). Bei Größen, die einmalig berechnet werden (`darts.ts:108`, `golf.ts:266`), nach Rotation neu bauen.
5. **Tastatur-Spiele sind quer unbrauchbar**: Die Tastatur deckt quer ~60–70 % von 300–340 px ab, das Textfeld ist unsichtbar. `stillepost`, `sprueche` und die Lobby (Name) sind deshalb hart hochkant. Gleichzeitig darf das Overlay **nicht** auf die Tastatur reagieren (s. 2.2: `screen.orientation.type` statt Media-Query und keine Warnung bei fokussiertem Input).
6. **Wake-Lock** gibt es nur über HTTPS (`requestWakeLock` schluckt den Fehler). Er wird heute nur beim Beitritt angefordert und fällt bei jedem App-Wechsel weg, ohne neu angefordert zu werden. Bei Zug-Spielen (Bowling, Igel, Boule) mit Wartezeiten dimmt das Display, die Spieler entsperren erneut, und dabei dreht das Handy. Bei `visibilitychange` neu anfordern.
7. **Sensor-Achsen hängen an der Bildschirmlage.** `tilt.ts` rechnet sauber mit `screenAngle()` (Kart/Autoball). `aim.ts` (beta = Neigung), `bowlingThrow.ts` (gamma/alpha) und `dartsThrow.ts` (alpha) setzen dagegen hochkant voraus. Dreht das Handy im Schwung um, kommt neben den falschen Achsen noch der **`pointercancel` → vorzeitige Auswertung** in `throwInput.ts` dazu. Deshalb Sperre (Android) und Hinweis „Ausrichtungssperre **an**“ für Sensor-Spiele (iOS). Das ist genau der Konflikt aus Punkt 1.
8. **Rand-Gesten im Querformat**: Die Zurück-Wischgeste von Android (beide Ränder) und Safari (linker Rand) liegt genau dort, wo der linke Daumen ruht. Stick-Zonen ≥ 24 px vom Rand halten. Optional `history.pushState` + `popstate`-Wächter, damit ein versehentliches „Zurück“ nicht die Seite verlässt.
9. **Gehaltene Eingaben beim Drehen**: Wer mit dem Daumen auf dem Stick dreht, behält unter Umständen den Pointer-Capture, und die Figur läuft weiter. Deshalb das `input-reset`-Event beim Overlay bzw. bei der Rotation (2.2).
10. **Notch quer**: `env(safe-area-inset-left/right)` wird außer im Kart (`--sl/--sr`) nirgends genutzt; Body-Padding links/rechts ist fest 8 px. Ohne `.lx`-Einzüge liegen Knöpfe unter der Kamera-Aussparung.
11. **Laptop/Tablet-Tests**: Ohne die Ausnahme für `pointer: fine` bzw. Tablets blockiert das Overlay jeden Test im Desktop-Browser. Das Ergebnis wäre, dass das Feature sofort wieder abgeschaltet wird.
