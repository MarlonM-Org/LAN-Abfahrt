# LAN-Abfahrt 🏖️

Party-Spiel für unsere Freundesgruppe – im Stil von Mario Party / Jackbox:
**Der Fernseher zeigt das Spiel, jedes Handy ist ein Controller.** Kein Controller, keine App nötig – QR-Code scannen und mitspielen.

Aktueller Stand (v0.3):

**Vier Modi** (VIP wählt in der Lobby): **Party-Abfahrt** (Standard), **Arcade**, **Trinkspiel** und **Date Night**.

**Arcade:** Alle Spiele einzeln auswählbar – oder „Zufälliges Spiel“. Nach jeder Runde: „Nächstes Spiel (zufällig)“, „Nochmal“ oder „Spiel auswählen“. Jede Runde bringt Punkte nach Platzierung (10/6/3/1, bei Gemeinschaftsspielen bekommen alle gleich viel), die pro Spielername dauerhaft in `data/arcade.json` gesammelt werden – mit Gesamt-Leaderboard auf dem TV und den eigenen Punkten pro Spiel am Handy. Bots zählen nicht.


- **Lobby** auf dem TV mit QR-Code, bis zu 12 Spieler, Pixel-Avatar-Editor auf dem Handy
- Der erste Spieler ist **VIP** und wählt am Handy, was gespielt wird (und kann jederzeit abbrechen)
- **Spieler entfernen:** Der VIP sieht in der Lobby alle Spieler und kann einzelne (✕ entfernen) oder alle anderen rauswerfen – im laufenden Spiel über den Knopf „Spieler“ oben links, sobald jemand offline ist. Am Laptop öffnet **P** (oder der Knopf „Spieler“ oben links in der TV-Ansicht) dasselbe Panel inkl. „Alle entfernen“ – das geht nur direkt am Laptop (`localhost`). Wer entfernt wurde, kann einfach neu beitreten
- **Offline-Spieler** (Tab zu, WLAN weg) bleiben grau in der Lobby („offline seit 2 min“) und spielen beim nächsten Spiel nicht mit; wer innerhalb von 5 Minuten zurückkommt, ist wieder drin, danach fliegt er automatisch raus (`OFFLINE_KICK_MIN=…` ändert die Frist). Laufende Spiele warten nicht auf Abwesende
- **Party-Modus** (3, 5 oder 8 Runden): Spielbrett „Ferienhaus“ im Mario-Party-Stil
  - Alle würfeln am Handy, Felder geben/nehmen Münzen, `?`-Felder lösen Urlaubs-Ereignisse aus
  - An der **Cocktailbar** wird man beim Vorbeilaufen automatisch 10 Münzen gegen einen Cocktail los
  - Nach jeder Runde ein Minispiel, Münzen nach Platzierung – **Finale: Mord oder Verräter im Ferienhaus** (zufällig, ab 4 Spielern)
  - Wer am Ende die meisten Cocktails hat (bei Gleichstand: Münzen), ist Urlaubs-Champion
- **Minispiele** (auch einzeln spielbar):
  - 🍺 **Flunkyball** – Wischen zum Werfen (Wind beachten), Tippen zum Trinken bzw. Laufen
  - 🗳️ **Wer würde eher …?** – geheim abstimmen, Punkte für die Mehrheit. **Eigene Fragen** können in der Lobby am Handy hinzugefügt werden (gespeichert in `data/questions.json`)
  - 🏖️ **Liegestuhl-Sprint** – Reaktionstest bei Sonnenaufgang, wer zu früh tippt, hat einen Fehlstart
  - ✈️ **Urlaubsflieger** (ab 2 Spielern, kooperativ à la Spaceteam) – jedes Handy ist ein Cockpit mit albernen Knöpfen und Schaltern; die geheime Anweisung oben betrifft meist ein *anderes* Handy, also laut rufen! Erledigte Anweisungen bringen den Flieger von Düsseldorf über Mallorca, Kreta und die Malediven nach Bali, verpasste kosten Treibstoff
  - 🌀 **Kurven-Duell** (2–12 Spieler) – à la „Achtung, die Kurve!“: Am Handy nur LINKS/RECHTS halten, jeder zieht eine Spur – wer Rand oder Spur rammt, ist raus, alle anderen bekommen einen Punkt. Lücken in den Spuren, Power-ups: Turbo, Schnecke (alle anderen langsam), Durch Wände
  - 🪴 **Versteckspiel mit Möbeln** (ab 3 Spielern, à la Prop Hunt) – Verstecker verwandeln sich per Handy in Kühlbox, Topfpflanze, Flamingo-Ring & Co. und rasten ein, die Sucher (1 pro ~4 Spieler, wechselt jede Runde) prüfen verdächtige Möbel. Falsch geprüft = schwindelig, Pfeifen gibt Punkte, verrät aber die Ecke
  - 🏁 **Fallen-Parcours** (ab 2 Spielern, à la Ultimate Chicken Horse) – jede Runde baut jeder am Handy ein Teil (Plattform, Planke, Trampolin, Seeigel, Kokosnuss-Kanone, Ventilator, Eisfläche, Schwebeplattform, Bombe) per Joystick in die Strecke, dann rennen alle gleichzeitig vom Handtuch zur Cocktailbar (Joystick + SPRINGEN, länger drücken = höher, Wandsprung möglich). Ziel 4 P., Erster +2, eigene Falle erwischt jemanden +1 (max. 2) – aber nur, wenn nicht alle und nicht keiner ankommen. Wer zuerst 15 Punkte hat (max. 6 Runden), gewinnt
  - 🏎️ **Kart-Rennen** (2–12 Karts, Verfolger-Kamera im SNES-Mode-7-Look) – drei Runden auf Strandpromenade, Hafen oder Pool-Runde. Bis 4 Spieler: Splitscreen auf dem TV – jeder kann aber am Handy oben in der Mitte (📺 TV / 📱 Handy) auf die eigene Ansicht am Handy umschalten, auch mitten im Rennen; der TV teilt dann für die übrigen neu auf (1 Ansicht = ganzer Schirm), und fährt keiner mehr auf dem TV, zeigt er die Übersicht. Die Wahl merkt sich das Handy für die nächsten Rennen. Ab 5 Spielern rendert jedes Handy seine eigene Ansicht (quer halten) und der TV zeigt die Übersicht. Am Handy: links schwebender Stick (oder – über HTTPS – Kipp-Lenkung), rechts GAS halten, BREMSE (im Stand rückwärts), DRIFT direkt über GAS (Daumen hochrutschen, halten + lenken, Funken blau → orange, loslassen = Mini-Turbo), ITEM oben rechts. Items aus den ?-Boxen: Kokosnuss, Bananenschale, Turbo-Eis und für die Letzten die Möwe, die dem Führenden sein Item klaut
  - 🖍️ **Stille Post mit Bildern** (ab 3 Spielern) – Satz schreiben, reihum malen und beschreiben, dann führt der TV jede Kette vor und alle verteilen Likes. **Eigene Startsätze** lassen sich in der Lobby (Party-Modus) hinzufügen (`data/stillepost.json`)
  - 💬 **Sprüche-Duell** (ab 3 Spielern, à la Quiplash) – Fragen mit Lücke („Der neue Cocktail an der Strandbar heißt ___“) am Handy beantworten; jede Frage bekommen genau zwei Spieler, jeder beantwortet zwei. Danach zeigt der TV Duell für Duell beide Antworten anonym, alle anderen stimmen ab – Autoren, Prozente und Punkte (Stimmen × Runden-Multiplikator) werden aufgedeckt, alle Stimmen für eine Antwort = **ABRÄUMER!**-Bonus. Kein Einfall? Knopf „Sicherheits-Spruch“. Zwei Runden plus Finale (alle dieselbe Frage, je 3 Stimmen). **Eigene Fragen** lassen sich in der Lobby hinzufügen (`data/sprueche.json`)
  - 🕵️ **Urlaubs-Fangen** (ab 3 Spielern, inspiriert von „Mario Chase“) – einer ist der Animateur und auf dem TV **unsichtbar**, nur sein Handy zeigt die ganze Karte. Alle anderen jagen ihn per Joystick durch die Ferienanlage, achten auf kurz aufblitzende Fußspuren und den „warm/kalt“-Ring unter jedem Fänger – und rufen sich zu. Fänger haben einen Sprint, der Animateur eine Ablenkung (falsche Spur). Jeder Runde ein neuer Animateur
  - 🧳 **Wer ist der Tourist?** (ab 4 Spielern, à la Spyfall) – Redespiel: Alle außer dem Touristen sehen am Handy (verdeckte Karte) den geheimen Urlaubsort und eine alberne Rolle dort (Strandbar, Bananenboot, Ballermann-Bude … 34 Orte). Reihum stellt man sich laut Fragen – wer dran ist, tippt am Handy an, wen er fragt, der TV zeigt „Lena fragt Ben“. Jeder darf einmal pro Runde ANKLAGEN (einstimmig → Auflösung), der Tourist kann jederzeit „ICH WEISS ES!“ drücken und den Ort raten. Punkte: Tourist rät richtig +4, entlarvt → Einheimische +1 (Ankläger +2), falscher Verdacht oder Zeit um → Tourist +2. Bis zu 4 Runden à 6–8 Minuten, ab 9 Spielern zwei Touristen
  - 🐺 **Werwölfe im Ferienhaus** (6–12 Spieler, klassisches Werwolf ohne Spielleiter) – der TV erzählt, die Handys verteilen geheime Rollen (verdeckte Karte): Werwölfe (≈ 1 pro 4 Spieler, kennen sich), Seherin, Hexe (ein Heil- und ein Gifttrank) und ab 8 Spielern der Jäger, der sterbend jemanden mitnimmt. **Nacht:** Alle Handys sehen gleich aus und alle tippen – Wölfe einigen sich auf ein Opfer, die Seherin durchschaut jemanden, alle anderen tippen einen Verdacht und zählen Schäfchen; danach braut die Hexe. **Morgen:** Tote werden mit Rolle aufgedeckt. **Tag:** 2–3 Minuten diskutieren (VIP oder Laptop kann abkürzen), dann am Handy abstimmen (Gleichstand = niemand). Tote schauen zu und sehen alle Rollen. Gewinner-Team +3 Punkte, Überleben +1; Entfernte verlassen das Ferienhaus, Offline-Stimmen werden übersprungen
  - 🔪 **Mord im Ferienhaus** (ab 4 Spielern, ab 7 mit zwei Mördern) – geheime Rollen auf dem Handy, Aufgaben in den Räumen, Morde wenn man allein mit jemandem ist, Leichen melden, diskutieren, abstimmen
  - 🏊 **Verräter im Ferienhaus** (ab 4 Spielern, à la „Trouble in Terrorist Town“) – alle laufen per Joystick durchs Ferienhaus. Geheime Verräter (≈ 1 pro 4 Spieler) knocken mit Poolnudel, Wasserpistole und Kokosnuss aus; ab 6 Spielern gibt es einen bekannten Detektiv mit Hut, der an Ausgeknockten die Shirt-Farbe des Täters findet. Verräter haben am Handy einen Shop im Geheimfach (Bananenschale, Tarnumhang, Fake-Funkspruch). 2–3 Runden mit neuen Rollen, Punkte für Sieg, richtige und falsche Knockouts

## Starten

Voraussetzung: [Node.js](https://nodejs.org) 20 oder neuer.

```bash
npm install
npm run dev
```

Dann:

1. **TV-Ansicht** am PC öffnen: <http://localhost:3000/tv.html> (Vollbild mit `F11`)
2. **Handys** im selben WLAN scannen den QR-Code auf dem TV (oder öffnen die angezeigte Adresse)
3. Der VIP drückt am Handy auf „Flunkyball starten“

> **Windows:** Beim ersten Start fragt die Firewall, ob Node.js im Netzwerk erreichbar sein darf → für **private Netzwerke** erlauben, sonst kommen die Handys nicht rein.

Falls der QR-Code die falsche IP-Adresse zeigt (z. B. wegen VPN oder virtueller Netzwerkkarten):

```bash
# PowerShell
$env:PUBLIC_HOST="192.168.178.23"; npm run dev
# macOS/Linux
PUBLIC_HOST=192.168.178.23 npm run dev
```

### HTTPS (für Spiele mit Bewegungssensor)

iPhones geben den Bewegungssensor (Bowling, Boule, Ententeich, Kipp-Lenkung) nur über HTTPS frei. Alles andere läuft weiter über HTTP.

Aufbau (einmalig einrichten):

```
lan-party.ma-und-ma.de                 ──CNAME──▶  lan-abfahrt.dedyn.io          (deSEC, A-Record = Laptop-IP)
_acme-challenge.lan-party.ma-und-ma.de ──CNAME──▶  _acme-challenge.lan-abfahrt.dedyn.io  (für Let's Encrypt)
```

1. **deSEC:** Konto auf [desec.io](https://desec.io) anlegen, eine kostenlose dynDNS-Domain `<name>.dedyn.io` registrieren und unter *Token Management* einen Token erstellen.
2. **Strato:** Für die Subdomain `lan-party` die zwei CNAME-Einträge oben anlegen.
3. **`.env`:** `.env.example` nach `.env` kopieren, `DESEC_ZONE`, `DESEC_TOKEN` und `PUBLIC_DOMAIN` eintragen.
4. `npm run domain` – trägt die Laptop-IP bei deSEC ein und holt das Zertifikat. `npm run domain -- --check` zeigt, wohin die Domain gerade zeigt.

Danach passiert das bei jedem `npm run dev` / `npm start` automatisch: IP eintragen, Zertifikat bei Bedarf erneuern (ab 30 Tage vor Ablauf, dafür braucht der Laptop kurz Internet). Die Handys verbinden sich dann über `https://lan-party.ma-und-ma.de:3443/` – der QR-Code zeigt automatisch diese Adresse. TV und Bots nutzen weiter `http://localhost:3000`.

Ohne deSEC geht es auch manuell: `PUBLIC_DOMAIN` setzen und ein eigenes Zertifikat nach `certs/fullchain.pem` + `certs/privkey.pem` legen.

> **FritzBox:** Der DNS-Rebind-Schutz blockt Domains, die auf eine Heimnetz-IP zeigen. Unter *Heimnetz → Netzwerk → Netzwerkeinstellungen → DNS-Rebind-Schutz* `lan-party.ma-und-ma.de` und `lan-abfahrt.dedyn.io` als Ausnahmen eintragen. In fremden Netzen mit ähnlichem Schutz bleibt nur HTTP (alles außer Bewegungssensor geht trotzdem).

Produktiv-Build (schneller, ohne Dev-Tools): `npm run build` und dann `npm start`.

## Sound

Der TV/Laptop spielt durchgehend 8-Bit-Musik (komplett per WebAudio erzeugt, je nach Szene ein anderer Loop). Browser erlauben Ton erst nach einer Aktion: **einmal in die TV-Ansicht klicken oder eine Taste drücken**. **M** (oder der Knopf „♪ Musik“ in der Lobby) öffnet das **Musik-Menü**: Gesamt-, Musik- und Effektlautstärke, Stumm (wird im Browser gemerkt), Bibliothek zum Vorhören und die Zuordnung „welche Musik läuft wo“ – alles live, ohne Neustart.

### Musik-Werkstatt (`/musik.html`)

Eigene 8-Bit-Loops bauen – mit demselben Synth, der auch auf dem TV spielt: <http://localhost:3000/musik.html> (oder aus dem Musik-Menü heraus).

- **Piano-Roll** für Melodie, Bass und Begleitung (je Kanal Wellenform, Lautstärke, Hüllkurve): Klick setzt eine Note (ziehen = länger), Noten ziehen = verschieben, rechter Rand = Länge, Rechtsklick/Entf = löschen, Umschalt+Klick = mehrere. Die Tonart (Dur/Moll + Grundton) hebt die Skalentöne hervor, „Skalen-Snap“ zieht neue Noten darauf.
- **Schlagzeug-Raster** mit Kick, Snare, HiHat je Sechzehntel (Klick schaltet, Ziehen malt).
- **Transport:** Play/Stopp (Leertaste), Loop, BPM, Swing, 1–16 Takte; Undo/Redo (Strg+Z/Y); Takt kopieren/einfügen/leeren (Strg+C/V, Cursor per Klick auf die Taktleiste).
- **Vorlage laden:** alle eingebauten Loops (nach Stil gefiltert) und die eigenen Songs. Eingebaute lassen sich bearbeiten und unter neuem Namen speichern.
- **Einsingen:** Melodie ins Mikrofon singen oder summen (Einzähler, Metronom, Begleitung wahlweise) – die Tonhöhe wird live als Linie angezeigt (YIN-Erkennung im Worker, Aufnahme über ein AudioWorklet), danach in Noten zerlegt, auf Sechzehntel und wahlweise auf die Tonart gezogen und als Vorschlag im Zielkanal gezeigt → übernehmen oder verwerfen. Braucht `http://localhost` oder HTTPS (Mikrofonzugriff). Die Erkennung stammt aus Marlons [CheatSheet](https://github.com/MarlonM-Org/CheatSheet).
- **MIDI-Import** (.mid aus BeepBox, Bosca Ceoil, …): Spuren für Melodie/Bass/Begleitung/Schlagzeug auswählen (GM-Kanal 10 → Kick/Snare/HiHat), Noten werden auf Sechzehntel gerundet, höchstens 16 Takte. **Export** als JSON oder MIDI.
- **„Auf dem TV“:** Song speichern und direkt einer Szene zuordnen.

**Speicherung:** eigene Songs liegen als JSON (Song-Format v2) in `data/music/<id>.json`, die Zuordnung in `data/music/assign.json` (REST unter `/api/music/…`). Pro Szene (Lobby, Spielbrett, Ergebnisse, jedes Minispiel, „Standard“) kann ein bestimmter Song, ein **Stil** (Party, Action, Chill/Strand, Romantisch, Grusel, Bar, Retro-Arcade, Episch – dann wechseln die Songs dieses Stils reihum) oder Stille eingestellt sein; ohne Zuordnung laufen die eingebauten Loops wie bisher. Tests ohne Browser: `npm run test:music` (Tonhöhen-Pipeline mit synthetischem Gesang, MIDI-Parser).
Beim Rhythmusspiel kommt der Song ebenfalls vom TV/Laptop – TV und Handys gleichen dafür ihre Uhr mit dem Server ab, damit Noten und Musik synchron sind. (Bei Bluetooth-Boxen kann es wegen deren Verzögerung minimal versetzt wirken – dann lieber Laptop-Lautsprecher oder Kabel.)

## Steuerung am Laptop & Handy kurz weg

**Laptop-Steuerung:** Läuft die TV-Ansicht direkt auf dem Laptop (<http://localhost:3000/tv.html>), erscheint bei Mausbewegung unten links ein dezentes Overlay (verschwindet nach ein paar Sekunden wieder):

| Knopf | Taste | Wirkung |
| --- | --- | --- |
| Spiel abbrechen | `Esc` 2× | laufendes Spiel beenden → zurück in die Lobby |
| Weiter | `Enter` / `Leertaste` | wie „Weiter“ des VIP (Ergebnis, Date-Night-Karte, Stille-Post-Vorführung, Diskussion im Mörderspiel) |
| Bots entfernen | – | alle Bots rauswerfen (nur in der Lobby) |
| Spieler (oben links) | `P` | Spielerliste mit online/offline, einzelne Spieler oder „Alle entfernen“ (auch während eines Spiels) |

Der Server nimmt diese Befehle **nur von Verbindungen an, die vom Laptop selbst kommen** (`127.0.0.1` / `::1`). Öffnet jemand `tv.html` am Handy oder über die LAN-IP bzw. die HTTPS-Domain, gibt es kein Overlay und keine Befehle – deshalb die TV-Ansicht am Laptop immer über `localhost` öffnen.

**Handy kurz weg (App gewechselt, Bildschirm aus):** Das Handy verbindet sich beim Zurückkommen automatisch wieder als derselbe Spieler (die Spieler-ID liegt im `localStorage`), ohne den Namen neu einzugeben.

- Der **VIP bleibt 60 Sekunden lang VIP**, auch wenn sein Handy weg ist – so lange wartet z. B. der Ergebnis-Bildschirm auf ihn.
- Ist er länger weg, wird der am längsten verbundene **Mensch** VIP – ein Bot nur, wenn gar kein Mensch mehr verbunden ist.
- Der **Gastgeber** (wer den Raum als Erster betreten hat) bekommt den VIP zurück, sobald er wieder da ist.
- Kann nur noch ein Bot weiterdrücken, schaltet der Server nach ein paar Sekunden selbst weiter (Ergebnis nach 12 s, Date-Night-Karten nach 10 s, Stille-Post-Vorführung nach 5 s) – es bleibt nichts hängen.
- In der Lobby bleiben Menschen 5 Minuten (ausgegraut, „offline seit …“) im Raum, bevor sie automatisch entfernt werden (siehe „Offline-Spieler“ oben). Wer früher weg soll: entfernen (VIP-Handy oder **P** am Laptop).

Zum Testen lassen sich die Zeiten verkürzen: `VIP_GRACE_MS=15000 AUTO_CONTINUE_MS=5000 npm run dev`.

## Auf den Fernseher bringen

Der PC muss nicht am Fernseher stehen – das Bild wird ins Heimnetz gestreamt:

- **Apple TV + Moonlight** (empfohlen): Auf dem PC [Sunshine](https://github.com/LizardByte/Sunshine) installieren, auf dem Apple TV die App *Moonlight*. Dann den Desktop streamen und den Browser mit `tv.html` im Vollbild öffnen.
- **Steam Link** (Apple TV / Smart-TV-App): Browser als Nicht-Steam-Spiel hinzufügen oder einfach den Desktop streamen.
- Alternativ: `http://<PC-IP>:3000/tv.html` direkt im Browser des Smart-TVs öffnen (geht für 2D-Pixel-Grafik oft auch).

Tipp: PC und Apple TV per LAN-Kabel anschließen – dann ist die Verzögerung kaum spürbar.

## Technik

| Teil | Technik |
| --- | --- |
| Server | Node.js, Express, Socket.IO (TypeScript über `tsx`) |
| TV-Ansicht | [Phaser 3](https://phaser.io) – 480 × 270 Pixel-Welt, hochskaliert |
| Handy-Controller | Plain TypeScript + DOM, Vite |
| Gemeinsam | `shared/` – Typen, Avatar-Zeichnung, Flunkyball-Geometrie, Song-Format (`music.ts`) |
| Musik | `client/music/` – Synth + Sequencer (TV und Werkstatt), MIDI-Parser, Tonhöhenerkennung; `client/musik/` – die Werkstatt |

```
server/   index.ts (HTTP + Vite), room.ts (Lobby/VIP/Ablauf), board.ts (Spielbrett),
          minigame.ts (Interface), flunky.ts, wwe.ts, sprint.ts, murder.ts, ttt.ts, questions.ts, …
          (pro Minispiel eine Datei, z. B. kurve.ts, arena.ts, bowling.ts, parcours.ts)
shared/   types.ts (alle Zustände), games.ts (Konstanten, Fragen, Räume), house.ts (Ferienhaus-Grundriss), avatar.ts, flunky.ts, …
client/   tv.html + host/        (Phaser-Szenen pro Phase/Minispiel, music.ts + musicMenu.ts = TV-Musik)
          index.html + controller/ (Handy-UI, ein Modul pro Spiel in screens/)
          musik.html + musik/    (Musik-Werkstatt), music/ (Synth, MIDI, Tonhöhe – geteilt)
scripts/  bots.ts                (Testspieler)
```

Der Server ist die einzige Quelle der Wahrheit: Handys schicken nur Eingaben (`board:roll`, `mini:input`), der Server berechnet alles und verteilt den Zustand (`state`) an TV und Handys. Geheimes (z. B. die Rolle im Mörderspiel) geht per `private` nur an den jeweiligen Spieler.

## Testen ohne Freunde

**Bots direkt am Handy:** Als VIP in der Lobby auf „+ Bot“ tippen – die Bots spielen alles automatisch mit (auch Date Night, Trinkspiel usw.). „Bots entfernen“ wirft sie wieder raus.

**Bots per Terminal:** In einem zweiten Terminal `npm run bots` starten – dann treten 3 Testspieler bei und spielen alles automatisch mit. Du bleibst VIP und steuerst mit deinem Handy.

```bash
npm run bots -- 5                 # 5 Bots
npm run bots -- 4 --party         # Bot startet selbst eine Party (zum Zuschauen am TV)
npm run bots -- 6 --game=murder   # Bot startet direkt ein Einzelspiel
npm run bots -- 2 --date          # komplette Date Night
npm run bots -- 4 --drink         # ein paar Runden Trinkspiel
```

Alternativ mehrere Browser-Tabs mit `http://localhost:3000/` öffnen (verschiedene Profile/Inkognito, weil die Spieler-ID im `localStorage` liegt).

## Controller-Spiele (Handy = Gamepad)

- 🏄 **SUP-Rennen** – zu zweit auf einem Board: einer paddelt links, einer rechts. Links paddeln dreht nach rechts (und umgekehrt); wer ungleichmäßig paddelt, verliert das Gleichgewicht und fällt ins Wasser. Felsen, Bojen und Quallen ausweichen!
- 🧺 **Aufräumen!** – per Joystick am Handy die Figur steuern und das Chaos im Ferienhaus in den Korb des eigenen Teams schieben; „Sprint“ für einen kurzen Speed-Boost (und zum Wegschubsen).
- 💣 **Bomben-Arena** (2–12 Spieler) – Bomberman im Strandgarten: Joystick links, „BOMBE“-Knopf rechts. Kokosnüsse/Wasserbomben legen, Sandburgen, Liegestühle und Kühlboxen sprengen, Power-ups sammeln (+1 Bombe, +1 Reichweite, Flip-Flops = schneller). Wer getroffen wird, ist nass („Platsch!“) und für die Runde raus; nach 60 s kommt die Flut und füllt die Arena von außen. Wer zuerst 2 Runden gewinnt (max. 3 Runden), ist Champion. Testen: `npm run bots -- 8 --game=arena`.
- 🎳 **Strand-Bowling** (ab 2 Spielern) – reihum auf der Bahn an der Strandbar. Am Handy erst die Startposition wählen, dann **„HALTEN & SCHWINGEN“** gedrückt halten, das Handy wie eine Bowlingkugel nach vorn schwingen und am Ende loslassen (Tempo = Schwung, Richtung = Drehung des Handys, Effet = Handgelenk drehen). Ohne HTTPS/Sensor wird die Kugel nach oben **gewischt** (schnell = hart, schräg = Richtung, im Bogen = Effet). Normale Bowling-Wertung inkl. Strike/Spare-Bonus, aber kürzer: bis 3 Spieler 5 Frames, bis 6 Spieler 3, ab 7 Spielern 2.
- 🥥 **Boule am Strand** (2–12 Spieler) – Pétanque im Sand bei Sonnenuntergang. Bis 4 Spieler jeder gegen jeden (2 Spieler: je 3 Kugeln, 3–4 Spieler: je 2), ab 5 Spielern **Team Sonne gegen Team Meer** (1–2 Kugeln pro Person, jedes Team gleich viele). Das Schweinchen (eine kleine Kokosnuss) wird zu Beginn jeder Aufnahme automatisch an eine zufällige Stelle geworfen. Es wirft immer die Seite, die **nicht** am nächsten am Schweinchen liegt. Am Handy **„Legen“** (hoher Bogen, rollt aus) oder **„Schießen“** (flach und hart, räumt Kugeln weg) wählen, dann wie beim Bowling **„HALTEN & SCHWINGEN“** (Schwung = Weite, Drehung = Richtung, Handgelenk = Effet) oder nach oben **wischen**. Die Mini-Karte zeigt die Lage, dazu die nötige Kraft fürs Schweinchen. Nach jeder Aufnahme wird gemessen: Jede eigene Kugel, die näher liegt als die beste gegnerische, gibt einen Punkt. Bis 7 Punkte oder max. 4 Aufnahmen (bei 6 Kugeln pro Seite 3). Testen: `npm run bots -- 6 --game=boule`.
- 🦆 **Ententeich** (ab 2 Spielern) – Duck Hunt in der Urlaubslagune: alle schießen gleichzeitig, jeder hat ein Fadenkreuz in seiner Farbe. Enten (10), Pommes-klauende Möwen (20) und Flamingos (30) treffen, Badegäste auf Schwimmringen lieber nicht (−15). 3 Schuss, dann nach unten wischen (oder „Nachladen“). Schnelle Treffer hintereinander geben Combo-Bonus, 3 Wellen mit immer mehr und schnelleren Vögeln.
  - **Zielen mit Bewegungssensor** (braucht HTTPS): Handy wie eine Lichtpistole halten, Oberkante zum TV, auf die TV-Mitte zielen und „Zentrieren“ tippen.
  - **Ohne HTTPS/Sensor**: Touchpad – wischen bewegt das Fadenkreuz (schnell wischen = weiter).
- 🗼 **Wackelturm** (ab 2 Spielern) – wie Tricky Towers: Jeder stapelt auf seinem eigenen Steg Urlaubsgepäck (Surfbretter, Kühlboxen, Liegestühle, Koffer, Reisetaschen, Cocktailkisten) in Tetris-Formen – mit echter Physik (`matter-js` auf dem Server), der Turm wackelt und kann einstürzen. Am Handy: ◀ ▶ verschieben (halten = wiederholen), ⟳ drehen, ▼ gedrückt halten = schneller fallen; das nächste Teil wird angezeigt. Ins Meer gefallene Teile kosten ein Leben (3 Leben, bei einem Einsturz höchstens eins pro 2 s), danach ist der Turm eingefroren. Wer zuerst das Gipfelkreuz erreicht und den Turm 2 s hält, gewinnt; danach haben die anderen noch 20 s. Nach 2:30 zählt die Höhe. Alle 30 s erwischt den Führenden eine Windböe. Tick-Zeit messen: `TURM_PROF=1 npm run dev`.
- 🥊 **Smash-Arena** (2–8 Spieler) – Plattform-Prügelei à la Smash Bros. mit den eigenen Avataren auf der *Strandbar* (schwebendes Surfbrett) oder der *Pool-Party* (wippender Flamingo). Treffer erhöhen die Prozente, je höher, desto weiter fliegt man – wer über den Rand fliegt, verliert ein Leben (3, ab 6 Spielern 2). Handy: Joystick links (laufen, ▼ ducken/durch Plattformen fallen, Richtung = Schlagvariante), rechts **SCHLAG**, **SPEZIAL** (zufälliges Urlaubs-Item: Flip-Flop-Wurf, Sonnenschirm-Rückstoß, Cocktail-Spritzer, Luftmatratzen-Klatscher, Wasserpistole), **SPRUNG** (zweimal in der Luft) und **SCHILD** (halten). Items: Kokosnuss, Wasserbombe, Erste-Hilfe-Ananas (−30 %). Wer zuletzt steht, gewinnt – nach 3 Minuten zählen Leben, dann Prozente.
- 🔥 **Grill-Chaos** (2–12 Spieler, à la Overcooked) – Gartengrillparty am Ferienhaus: Bestellzettel oben auf dem TV abarbeiten (Maiskolben, Zitronen-Limo, Tofu-Hotdog, Gemüsespieß, Virgin Mojito). Handy: Joystick, **NEHMEN** (aufheben/ablegen/kombinieren) und **AKTION** (halten: am Schneidebrett schnippeln, mit dem Feuerlöscher löschen). Zutaten aus den Kisten holen, schneiden, grillen (nach 5 s gar, 8 s später verbrannt + Feuer!), auf Teller/ins Glas und zur Ausgabe. Schnell servieren gibt Trinkgeld, verpasste Bestellungen kosten Punkte. Bis 6 Spieler kocht ihr gemeinsam um 1–3 Sterne, ab 7 Spielern treten Team Sonne und Team Meer in gespiegelten Küchen gegeneinander an. 3 Minuten. Testen: `npm run bots -- 4 --game=grill`.
- 🥊 **Smash-Arena** (2–12 Spieler) – Plattform-Prügelei à la Smash Bros. mit den eigenen Avataren auf der *Strandbar* (schwebendes Surfbrett) oder der *Pool-Party* (wippender Flamingo). Treffer erhöhen die Prozente, je höher, desto weiter fliegt man – wer über den Rand fliegt, verliert ein Leben (3, ab 6 Spielern 2). Handy: Joystick links (laufen, ▼ ducken/durch Plattformen fallen, Richtung = Schlagvariante), rechts **SCHLAG**, **SPEZIAL** (zufälliges Urlaubs-Item: Flip-Flop-Wurf, Sonnenschirm-Rückstoß, Cocktail-Spritzer, Luftmatratzen-Klatscher, Wasserpistole), **SPRUNG** (zweimal in der Luft) und **SCHILD** (halten). Items: Kokosnuss, Wasserbombe, Erste-Hilfe-Ananas (−30 %). Wer zuletzt steht, gewinnt – nach 3 Minuten zählen Leben, dann Prozente.
- 🤼 **Sumo-Steg** (2–12 Spieler) – alle stehen auf einem Holzsteg im Meer, der nach und nach wegbricht (Planken knacken erst rot, dann sind sie weg). Handy: Joystick links laufen, rechts **REMPELN** (kurzer Sprint, ~1,3 s Abklingzeit). Wer angerempelt wird, rutscht weit weg – wer *während* des eigenen Remplers getroffen wird (Frontalzusammenstoß), fliegt fast doppelt so weit. Wer ins Wasser fällt („PLATSCH!“), dümpelt im Schwimmring und schaut zu; wer zuletzt auf dem Steg steht, gewinnt die Runde. Nach 45 s bricht auch die letzte Insel. Wer zuerst 2 Runden gewinnt (max. 3), ist Steg-Champion; bei Gleichstand zählen Überleben und Schubser. Testen: `npm run bots -- 6 --game=sumo`.
- ⚽ **Auto-Fußball** (2–12 Spieler, à la Rocket League – aber von oben) – Team Sonne gegen Team Meer auf dem Sandplatz neben dem Ferienhaus: kleine Karts in Teamfarbe (mit dem eigenen Avatar-Kopf) schieben einen großen Wasserball ins gegnerische Tor. Gesteuert wird wie beim Kart-Rennen (Handy quer): links schwebender Stick (oder Kipp-Lenkung), rechts **GAS**, **BREMSE** (im Stand rückwärts, in voller Fahrt + lenken = Drift mit Mini-Turbo), **BOOST** direkt über GAS (Daumen hochrutschen; der Tank lädt sich von selbst auf, das kleinere Team lädt schneller) und **HÜPFER** (kurz über andere Autos springen, der Ball fliegt härter). Je schneller man in den Ball fährt, desto weiter fliegt er. Nach jedem Tor „TOR!“ mit Konfetti und Torschütze (auch Eigentore), dann Anstoß mit 3-2-1. Das Feld ist immer gleich groß, die Tore werden mit der Teamgröße breiter (1 gegen 1: 56 px, 6 gegen 6: 76 px). 3 Minuten, bei Gleichstand **Golden Goal** (höchstens 1 Minute, dann Unentschieden). Testen: `npm run bots -- 4 --game=autoball` (kürzeres Spiel: `AFB_MATCH_MS=40000 npm run dev`).
- 🏐 **Strand-Volleyball** (2–12 Spieler, à la Slime Volleyball) – Seitenansicht am Strand bei Sonnenuntergang: **Team Sonne** (links) gegen **Team Meer** (rechts), Netz in der Mitte. Handy: links **◀ ▶** (halten = laufen), rechts **SPRUNG** und – nur in der Luft – **SCHMETTERN** (steiler Ball knapp übers Netz ins gegnerische Feld, ~1,4 s Abklingzeit). Der Ball prallt je nach Trefferpunkt vom Körper ab (wer springt, gibt ihm mehr Schwung), Seitenstangen und Netz werfen ihn zurück. Berührt er den Sand, punktet die andere Seite; wer den Punkt verloren hat, schlägt auf (der Ball schwebt kurz über dem Aufschläger – reinspringen oder fallen lassen). Pro Seite stehen höchstens 3 im Feld (bzw. so viele, wie das kleinere Team hat) – die anderen sitzen auf der Bank und rotieren nach jedem Punkt durch, so kommt jeder dran und ungleiche Teams spielen fair. Bis 7 mit 2 Punkten Vorsprung (spätestens bei 11) oder nach 4 Minuten; Gleichstand nach Ablauf = Golden Point. Testen: `npm run bots -- 8 --game=volley`.

Alle laufen auch im Party-Modus auf dem Spielbrett.

## Trinkspiel

Partyklassiker reihum, ohne Punkte – gezählt werden nur Schlücke (Wasser zählt auch!):
**Wer würde eher …?** (Meistgewählte trinken), **Ich hab noch nie …** (wer es schon getan hat, trinkt – als Einziger doppelt), **Höher oder Tiefer** (falsch geraten = Schluck), **Tick-Tack-Bumm** (Begriff zur Kategorie sagen, Bombe weitergeben – wer sie beim Knall hält, trinkt 3).
Eigene Fragen/Aussagen lassen sich in der Lobby hinzufügen (`data/`).

## Date Night

Für genau 2 Spieler, gemeinsam Herzen sammeln. Version 1: **Unser erstes Date** – Der Abstieg (Jump & Run den Abhang runter), Das erste Gespräch (Rhythmusspiel mit Ton am Handy), Wraps mit Sriracha-Mayo (Zutatenrad), Tanz unter den Sternen (Sternbilder zeichnen).
Alle Texte stehen in `shared/dates.ts` und können frei angepasst werden; neue Versionen kommen dort in `DATE_VERSIONS`.

## Grafik

Alle Grafiken sind prozedurale Pixel-Art im Cozy-Farm-Look (`client/art/`) – keine Bilddateien. Eine Übersicht aller Sprites gibt es im Dev-Modus unter <http://localhost:3000/art.html>.

## Ideen / Roadmap

- [x] Spielbrett im Mario-Party-Stil
- [x] Mord im Ferienhaus, Wer würde eher …?, Liegestuhl-Sprint
- [ ] Echte Pixel-Avatare aus Fotos der Freunde
- [ ] Weitere Minispiele: Sonnencreme-Kartoffel, Grill-Duell, Badezimmer-Rennen, Koffer packen
- [ ] Items auf dem Spielbrett (z. B. „Doppelt würfeln“, „Cocktail klauen“)
- [x] Sounds & Musik (8-Bit-Loops, Musik-Werkstatt mit Einsingen und MIDI-Import)

Ausführliche Spiele-Ideen (Arena, Bewegungssensor, geheime Rollen, Physik …) nach Aufwand sortiert: **[ROADMAP.md](ROADMAP.md)**
