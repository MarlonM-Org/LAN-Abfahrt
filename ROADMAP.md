# Roadmap – Spiele-Ideen

Ziel: **Ein Laptop als Host, alle Handys als Controller, alles über das VIP-Menü von LAN-Abfahrt.**
Alle Spiele werden selbst gebaut, mit eigenen Namen, eigener Pixel-Art und unseren Avataren. Keine ROMs, keine Fremd-Grafiken, keine Fremd-Spiele, die nur gestartet werden.
Vorbilder dienen nur als Inspiration fürs Spielprinzip.

**Leitidee:** Das Handy kann mehr als ein Controller. Am besten funktionieren Spiele, die mindestens eins davon nutzen:

- **Privater zweiter Bildschirm:** geheime Rollen, eigene Karte, eigene Hand (wie das Wii-U-Gamepad bei Nintendo Land).
- **Bewegungssensor:** Werfen, Schwingen, Zielen, Lenken (wie die Wii-Remote).
- **Touch:** Zeichnen, Wischen, Tippen.
- **Einfache Eingaben:** Ein Steuerkreuz und 1 bis 2 Knöpfe gehen gut. Präzise Analog-Steuerung über Touch geht schlecht.

Legende: 👥 Spielerzahl · 📱 Rolle des Handys · ⭐ Favorit

---

## 0 · Vorarbeiten (Plattform)

- [ ] **Bis zu 12 Spieler** – `MAX_PLAYERS` in `server/room.ts` hochsetzen, Lobby-/Ergebnis-Layouts und Startpositionen für 12 prüfen
- [ ] **Spielauswahl mit Kategorien** im VIP-Menü (z. B. *Party*, *Arena*, *Sport*, *Geheime Rollen*, *Kreativ*) inkl. Anzeige der Spielerzahl je Spiel (`minPlayers`/`maxPlayers` in `MINI_INFO`)
- [ ] **Wiederverwendbare Handy-Bausteine** in `client/controller/`: virtueller Joystick/Steuerkreuz, A/B-Knöpfe, Wurf-/Schwung-Erkennung, Zeichenfläche
- [ ] **Bewegungssensor freischalten:** iOS gibt `DeviceMotionEvent` nur über HTTPS und nach Nutzer-Tap (`requestPermission()`) frei → HTTPS im Heimnetz einrichten (z. B. mkcert-Zertifikat oder selbst signiert + Hinweis im README)
- [ ] **Vibration** als Feedback (`navigator.vibrate`, auf iOS nicht verfügbar → optional behandeln)
- [ ] **Physik auf dem Server** für Physikspiele: `matter-js` läuft auch in Node, der Server bleibt damit autoritativ
- [ ] **Echtzeit-Eingaben:** Für Arena-Spiele Eingaben als Zustand senden (Richtung + Knöpfe), nicht als Einzel-Events; Server-Tick ~30/s

---

## 1 · Klein (ein Abend bis ein Wochenende)

- [ ] ⭐ **Kurven-Duell** *(Vorbild: Tron / Achtung die Kurve)* – Jeder zieht eine Linie, wer gegen eine Linie fährt, ist raus. Lücken in der Spur, Power-ups (schneller, dünner, durch Wände).
  👥 2–12 · 📱 nur Links/Rechts – ideal für viele Spieler
- [ ] ⭐ **Urlaubsflieger** *(Vorbild: Spaceteam)* – Jeder hat andere Knöpfe/Schalter auf dem Handy („Sonnenschirm ausfahren!“), die Anweisung erscheint aber bei jemand anderem → schreien und koordinieren. Wer zu langsam ist, lässt den Flieger abstürzen.
  👥 3–12 · 📱 eigenes Schaltpult
- [ ] **Sumo-Steg** *(Vorbild: Mario-Party-Minispiele / Fall Guys)* – Auf einem schrumpfenden Steg schubsen, wer ins Meer fällt, ist raus.
  👥 2–12 · 📱 Joystick + Rempel-Knopf
- [ ] **Stille Post mit Bildern** *(Vorbild: Gartic Phone)* – Satz schreiben → nächster zeichnet → nächster beschreibt … am Ende die ganze Kette am TV.
  👥 3–12 · 📱 Zeichenfläche/Tastatur
- [ ] **Sprüche-Duell** *(Vorbild: Quiplash)* – Lustige Antworten auf Fragen schreiben, die anderen stimmen ab. Eigene Fragen wie bei „Wer würde eher …?“.
  👥 3–12 · 📱 Tastatur + Abstimmung
- [ ] **Pixel-Galerie** – Jeder malt zum Thema ein kleines Pixelbild (Avatar-Editor wiederverwenden), Ausstellung am TV, Abstimmung.
  👥 2–12 · 📱 Pixel-Editor
- [ ] **Wer ist der Tourist?** *(Vorbild: Spyfall)* – Alle außer einem kennen den Ort (z. B. „Strandbar“). Reihum Fragen stellen; der Tourist muss den Ort erraten, die anderen ihn entlarven.
  👥 4–12 · 📱 geheime Rolle
- [ ] **Strand-Volleyball** *(Vorbild: Slime Volleyball)* – 2 Teams, ein Sprung-Knopf und laufen.
  👥 2–8 · 📱 Steuerkreuz + Sprung

---

## 2 · Mittel (ein bis zwei Wochenenden)

### Arena
- [ ] ⭐ **Bomben-Arena** *(Vorbild: Bomberman / BombSquad)* – Raster-Arena im Ferienhaus-Look, Kisten sprengen, Power-ups (Reichweite, mehr Bomben, Kicken), Persönliches: Bomben als Wasserbomben/Kokosnüsse.
  👥 2–12 · 📱 Steuerkreuz + Bombe
- [ ] **Bogen-Arena** *(Vorbild: TowerFall)* – Ein Treffer und man ist raus, Pfeile müssen aufgesammelt werden.
  👥 2–8 · 📱 Joystick + Schuss + Sprung
- [ ] **Wasserbomben-/Schneeballschlacht** – Teams, Deckung, Nachladen am Brunnen.
  👥 2–12 · 📱 Joystick + Wurf

### Sport mit Bewegungssensor (Wii-Gefühl)
- [ ] ⭐ **Bowling** *(Vorbild: Wii Sports Bowling)* – Handy wie eine Kugel schwingen, Drall durch Drehen des Handgelenks. Reihum, 10 Frames oder Kurzversion.
  👥 1–12 · 📱 Bewegungssensor
- [ ] **Boule am Strand** – Gleiche Wurfmechanik wie Bowling, passt perfekt zum Urlaub.
  👥 2–12 · 📱 Bewegungssensor
- [x] **Minigolf** – Urlaubs-Minigolf: alle putten gleichzeitig, Zurückziehen wie eine Schleuder oder Putter-Schwung
- [ ] **Darts**
  👥 1–12 · 📱 Bewegungssensor
- [x] **Angeln** – alle angeln gleichzeitig vom Steg: Auswerfen per Schwung/Wischen, Anschlagen beim Biss, Drill mit Spannungsbalken
  👥 2–12 · 📱 Bewegungssensor oder Wischen

### Zielen
- [ ] ⭐ **Ententeich** *(Vorbild: Duck Hunt)* – Mit dem Handy zielen (Bewegungssensor, Fadenkreuz am TV), Enten/Möwen abschießen, Punkte für Trefferserien, keine Badegäste treffen.
  👥 1–8 · 📱 Handy als Zielgerät
- [x] **Wasserpistolen-Duell** – Western-Duell im Garten: auf „ZIEHT!“ warten, Handy hochreißen (oder Touch), zielen und spritzen; Frühstart = Eimer, Schweizer System + Finale
  👥 2–12 · 📱 Bewegungssensor oder Touch

### Physik
- [ ] ⭐ **Wackelturm** *(Vorbild: Tricky Towers)* – Jeder baut seinen eigenen Turm aus fallenden Blöcken (Koffer, Liegestühle, Surfbretter), wer zuerst die Ziellinie erreicht, gewinnt. Gemeine Zauber gegen andere.
  👥 2–4 pro Bildschirm (bei mehr: Turniermodus) · 📱 Drehen/Verschieben/Fallenlassen
- [x] **Kofferpacken** – Gegen die Zeit möglichst viel in den Kofferraum stapeln (mit Physik, Sachen fallen raus).
  👥 2–12 (ab 9 zu zweit pro Auto) · 📱 verschieben/drehen/fallen lassen

### Geheime Rollen & ungleiche Teams (einer gegen alle)
- [ ] ⭐ **Geisterjagd** *(Vorbild: Luigi's Mansion aus Nintendo Land)* – Der Geist ist am TV unsichtbar, sieht sich nur auf dem eigenen Handy. Die anderen leuchten mit Taschenlampen, Vibration verrät seine Nähe.
  👥 3–8 · 📱 privater Bildschirm + Vibration
- [ ] **Urlaubs-Fangen** *(Vorbild: Mario Chase aus Nintendo Land)* – Einer flieht und sieht die ganze Karte auf dem Handy, die Jäger nur den TV.
  👥 3–12
- [x] **Süßigkeiten-Klau** *(Vorbild: Animal Crossing Sweet Day aus Nintendo Land)* – Gruppe sammelt Snacks aus der Minibar, zwei Wächter jagen sie.
  👥 4–12
- [ ] ⭐ **Versteckspiel mit Möbeln** *(Vorbild: Prop Hunt)* – Verstecker verwandeln sich in Gegenstände im Ferienhaus (Topfpflanze, Kühlbox, Flamingo-Schwimmring), Sucher haben begrenzte „Schüsse“. Verstecker sehen auf dem Handy, ob sie gerade angeschaut werden.
  👥 4–12 · 📱 Joystick + Verwandeln/Einrasten
- [ ] ⭐ **Verräter im Ferienhaus** *(Vorbild: Trouble in Terrorist Town)* – Unschuldige, Verräter, Detektiv. Waffen im Haus verteilt, Verräter-Shop auf dem Handy, Detektiv kann Leichen untersuchen. **Als neuer Modus von „Mord im Ferienhaus“ bauen** (Räume, Rollen, Meetings existieren schon).
  👥 5–12 · 📱 geheime Rolle + Shop
- [x] **Spion unter Gästen** – Viele gleich aussehende NPC-Gäste am TV; jeder weiß nur auf seinem Handy, welche Figur er ist. Unauffällig bewegen, andere Spieler entlarven. Mit 12 Spielern großartig.
  👥 3–12 · 📱 privater Bildschirm
- [ ] **Werwolf** – Komplett per Handy, kein Spielleiter nötig.
  👥 6–12

### Rundenbasiert
- [ ] ⭐ **Igel-Krieg** *(Vorbild: Worms)* – Zerstörbare Insel, Teams aus Avataren, Bazooka/Granate/Ninjaseil. Zielen per Wischen, Stärke durch Gedrückthalten. Passt auch mit nur einem Laptop für alle.
  👥 2–8 Teams · 📱 Wischen + Waffenmenü auf dem Handy

---

## 3 · Groß (Projekt für sich)

- [ ] ⭐ **Kart-Rennen** *(Vorbild: Super Mario Kart)* – Zwei Varianten:
  - Draufsicht wie Micro Machines (einfacher, 12 Spieler auf einem Bild)
  - Pseudo-3D/Mode-7 wie auf dem SNES (cooler, aber Splitscreen ab ~4 Spielern schwierig)
  Lenken durch Kippen des Handys, Item-Knopf, Strecken rund ums Ferienhaus.
  👥 2–12 · 📱 Bewegungssensor-Lenkung
- [ ] ⭐ **Smash-Arena** *(Vorbild: Super Smash Bros. / PlayStation All-Stars)* – Schadensprozent, Rauswurf über den Rand, Items. Jeder Avatar bekommt einen Spezialangriff passend zur Person. Spielgefühl und Balance sind der Hauptaufwand.
  👥 2–8 · 📱 Joystick + Angriff + Spezial + Sprung
- [ ] ⭐ **Fallen-Parcours** *(Vorbild: Ultimate Chicken Horse)* – Abwechselnd Fallen/Plattformen auf dem Handy auswählen und platzieren, dann laufen alle gleichzeitig. Punkte, wenn man ins Ziel kommt, aber nicht alle.
  👥 2–8 · 📱 Bau-Phase auf dem Handy, Lauf-Phase mit Steuerkreuz + Sprung
- [ ] **Grill-Chaos** *(Vorbild: Overcooked)* – Gemeinsam Bestellungen der Urlaubs-Grillparty abarbeiten: schnippeln, grillen, Cocktails mixen, servieren.
  👥 2–8 · 📱 Joystick + Aktion
- [ ] **Umzugschaos** *(Vorbild: Moving Out)* – Ferienhaus ausräumen, bevor der Vermieter kommt.
- [x] **Wackel-Prügelei** *(Vorbild: Gang Beasts)* – Labbrige Physik-Figuren, Ziel: andere vom Steg ins Meer schubsen.
- [ ] **Auto-Fußball** *(Vorbild: Rocket League, von oben)* – Kann Fahrphysik mit dem Kart-Rennen teilen.

---

## Vorschlag für die Reihenfolge

1. Vorarbeiten: 12 Spieler, Kategorien im Menü, Joystick-Baustein, HTTPS für Bewegungssensor
2. **Kurven-Duell** + **Urlaubsflieger** (schnelle Erfolge, testen 12 Spieler)
3. **Bomben-Arena** (erste echte Arena, Echtzeit-Eingaben)
4. **Bowling** + **Ententeich** (Bewegungssensor-Grundlage)
5. **Verräter im Ferienhaus** (TTT) + **Versteckspiel mit Möbeln** (Prop Hunt)
6. **Igel-Krieg**, **Wackelturm**
7. Große Brocken: **Kart-Rennen**, **Fallen-Parcours**, **Smash-Arena**

---

## 4 · Umsetzungsplan aus dem Spiel-Review (5. November 2026)

Quelle: **Spiel-Review** (https://claude.ai/artifact/76ucbosiWoyLfWBYx2VBK1), Einzelgutachten in `docs/review/`.
Leitregel: erst, was allen Spielen hilft (Ton, Juice, Ausrichtung, Zuschauer), dann Pacing, dann Spielbrett, dann Igel, dann neue Spiele. Keine weitere Echtzeit-Arena vorher.

### Phase 0 · Fehler und Fairness (S)
- [ ] Fallen-Parcours: `MAX_RUNNERS` 12 (ab 9 Spielern laufen heute immer dieselben 8)
- [ ] Zentrale Gnadenfrist bei Verbindungsverlust (3 s einfrieren/unverwundbar statt sofort raus in Arena, Sumo, Parcours; Kart/Smash nicht als Hindernis/Zielscheibe stehen lassen); Stick nach 700 ms ohne Update auf 0; Wake Lock bei `visibilitychange` erneuern
- [ ] Netz: `Room.changed()` sofort senden (max. alle 40 ms) statt immer 40 ms warten; Spieler + Leaderboard als `meta`-Event nur bei Änderung; `private` nur bei Änderung; `transports: ['websocket']`
- [ ] Punkte nach Spielerzahl (`PLACE_COINS`/`ARCADE_POINTS` → `round(10·(n−Platz)/(n−1))`, Trost-Münze), Startspieler im Brett rotieren, Koop-Münzen für Flieger (Ziel erreicht?) und Grill (Sterne), Sprint-Zeit serverseitig
- [ ] Listen aufräumen: Igel, Turm, Descent, Wrap vom Brett; Date-Spiele aus `ARCADE_RANDOM`; `smash.maxPlayers = 8`; Spieldauer-Klasse (kurz/mittel/lang) fürs Brett; README-Dubletten
- [ ] Pacing: TTT `ROUND_MS` 180 → 100 s und 2 Runden; Golf 5 Bahnen auf dem Brett; Sprüche ab 9 Spielern Runde 1 + Finale; Stille Post max. 6 Kettenschritte; Fangen/Geist ab 7 Spielern zwei Rollenträger

### Phase 1 · Fundament für alle Spiele (M ×3)
- [ ] **Ton + Juice:** `client/host/sfx.ts` (~25 Chiptune-Effekte über den vorhandenen `fxBus`, Panning nach x), `client/host/juice.ts` (shake-Stufen, flash, hitStop, slowMo, zoomPunch, burst mit Partikel-Emitter, float, banner), einheitliches `fx`-Feld im Snapshot; Versteckspiel-Pfeife auf den Synth; Sprecher per `speechSynthesis` (abschaltbar); Iris-Wipe zwischen Szenen; Ergebnis-Reveal mit Auto-Weiter. Zuerst Smash (Hit-Stop), Arena, Sumo, Bogen, Ententeich, Kart, Brett, Ergebnis
- [ ] **Handy-Ausrichtung (Marlons Feedback):** Pflichtfeld `orientation` in `MiniInfo`, `client/controller/orientation.ts` (Ansage vor jedem Spiel, Overlay bei falscher Lage, Android-Lock im Vollbild, Laptop ausgenommen), ein schwebender Stick (`stick.ts`) statt drei, gemeinsames Querlayout `.lx`, `haptic()` mit iPhone-Ersatz (Klick-Ton + Rand-Blitz), Ansage auch am TV. Dann quer: Wasserbomben, Igel, Grill, Fangen, Geist, Verräter, Wackelturm, Versteckspiel; danach Arena, Sumo, Aufräumen, Kurve, Volley, Smash, Bogen
- [ ] **Regelkarte + Zuschauer:** Raum-Phase `intro` mit `MINI_INFO.howTo` (Ziel + 3 Steuer-Piktogramme), Übungsfeld am Handy, „Bereit!“; Emote-Leiste und Wetten für Ausgeschiedene; eine Spielerfarbe pro Abend mit Kürzel; Ergebnis zweispaltig ab 9

### Phase 2 · Look und Bewegung (M ×2)
- [ ] Avatar-Animations-Frames (Laufen, Sprung, Treffer, Jubel, Blinzeln) zentral in `shared/avatar.ts`, Squash & Stretch in `figure()`, Ambient-Bewegung (Wolken, Möwen, Palmen), Parallax in Smash, Igel, Volley, Bogen
- [ ] `SnapBuffer` mit Wiedergabe-Uhr statt bildratenabhängiger Glättung (Hit-Stop, Zeitlupe, Wiederholung „TOR!“ fast gratis), Tick 30 Hz für Plattformer, Render-Auflösung ×2/×4 bei unveränderter Welt, Kamera für Igel, Kart-Regie, Sumo-Finale, Brett-Schwenk
- [ ] Namensschilder entzerren, „Spieler (P)“/„♪ Musik“ nicht über dem HUD, Namen nicht hart kürzen, leere Arenen beleben (Boule, SUP, Golf, Flunky)

### Phase 3 · Party-Modus 2.0
- [ ] (S) Alle würfeln gleichzeitig, Bonus-Cocktails am Ende mit Reveal, letzte zwei Runden doppelt, Finale-Sieg = 2 Cocktails, Brettstand in `data/party.json`, Nachzügler einsteigen lassen, Tageszeit über den Abend
- [ ] (M) Items-Laden (Doppelwürfel, Cocktail-Klau, Taxi zur Bar, Sonnencreme-Schild), Bar-Preisstaffel, eine Abzweigung, Duell-Feld „Teilen oder Klauen“ (Wasserpistolen-Duell, Sprint)
- [ ] (M) Minispiel-Typen 2 gegen 2 und 1 gegen 3, Abend-Statistik und „Titel des Abends“ aus dem `FxLog`, Turnier als Playlist

### Phase 4 · Igel-Krieg → Worms
- [ ] (S) Wind driftet statt neu gewürfelt; Zugzeit 30/20/15 s nach Spielerzahl; Flut pro Runde statt pro Zug; HP 60 ab 8 Spielern; Sudden Death ab 7 Spielern nach 3 min; HP am Zugende herunterzählen; Kamera (Aktiver, Geschoss, Krater); Wind sichtbar (Wolken, Balken, Pfeil im Ziel-Pad); Zuschauer-Sprüche; FEUER-Knopf
- [ ] (M) Modus „Alle gleichzeitig“ ab 7 Spielern; Waffen 4 → 10 (Wasser-Schrotflinte, Möwen-Luftschlag per Minikarte, Böller, Seeigel-Mine, Ananas-Splitterbombe, Paddel, Heilige Ananas, Surfbrett-Brücke); Kisten am Fallschirm; Gaskartuschen; Spieler-Teams; größere Insel
- [ ] (L) Lianen-Seil, Sonnenschirm-Gleiter, Schaufel, Themenkarten, „Schuss des Abends“ als Wiederholung, Igel-Sprüche

### Phase 5 · Portfolio umsteuern (neue Spiele, je S–M)
- [ ] Wer war's? (Who's Who), Schätzkönig (Wits & Wagers), Mäxchen am Pool, Funkfrequenz (Wavelength) – je ein Abend auf dem Sprüche-/WWE-Fluss
- [ ] Dann: Spion unter Gästen (läuft), Montagsmaler live, Strand-Band, Sektkorken (fürs Brett), Lügen-Lexikon, Strandkorb-Scharade, Geheimcode am Pool, Kofferbombe entschärfen, Urlaubs-Wahnsinn (WarioWare)
- [ ] Verräter-Redesign „Stromausfall“ (Sichtbeschränkung mit der Dunkelheits-Technik der Geisterjagd)
- [ ] Gestrichen/zusammengelegt: Wackel-Prügelei, Umzugschaos; Kofferpacken als Wackelturm-Variante
