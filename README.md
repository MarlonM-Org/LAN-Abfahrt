# LAN-Abfahrt 🏖️

Party-Spiel für unsere Freundesgruppe – im Stil von Mario Party / Jackbox:
**Der Fernseher zeigt das Spiel, jedes Handy ist ein Controller.** Kein Controller, keine App nötig – QR-Code scannen und mitspielen.

Aktueller Stand (v0.3):

**Vier Modi** (VIP wählt in der Lobby): **Party-Abfahrt** (Standard), **Arcade**, **Trinkspiel** und **Date Night**.

**Arcade:** Alle Spiele einzeln auswählbar – oder „Zufälliges Spiel“. Nach jeder Runde: „Nächstes Spiel (zufällig)“, „Nochmal“ oder „Spiel auswählen“. Jede Runde bringt Punkte nach Platzierung (10/6/3/1, bei Gemeinschaftsspielen bekommen alle gleich viel), die pro Spielername dauerhaft in `data/arcade.json` gesammelt werden – mit Gesamt-Leaderboard auf dem TV und den eigenen Punkten pro Spiel am Handy. Bots zählen nicht.


- **Lobby** auf dem TV mit QR-Code, bis zu 8 Spieler, Pixel-Avatar-Editor auf dem Handy
- Der erste Spieler ist **VIP** und wählt am Handy, was gespielt wird (und kann jederzeit abbrechen)
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
  - 🏎️ **Kart-Rennen** (2–12 Karts, von oben) – drei Runden auf Strandpromenade, Hafen oder Pool-Runde. Gas gibt das Kart selbst; gelenkt wird per Touch-Pad oder – über HTTPS – durch Kippen des Handys (Bewegungssensor). BREMSE + Lenken = Drift mit Mini-Turbo, Items aus den ?-Boxen: Kokosnuss, Bananenschale, Turbo-Eis und für die Letzten die Möwe, die dem Führenden sein Item klaut
  - 🖍️ **Stille Post mit Bildern** (ab 3 Spielern) – Satz schreiben, reihum malen und beschreiben, dann führt der TV jede Kette vor und alle verteilen Likes. **Eigene Startsätze** lassen sich in der Lobby (Party-Modus) hinzufügen (`data/stillepost.json`)
  - 🕵️ **Urlaubs-Fangen** (ab 3 Spielern, inspiriert von „Mario Chase“) – einer ist der Animateur und auf dem TV **unsichtbar**, nur sein Handy zeigt die ganze Karte. Alle anderen jagen ihn per Joystick durch die Ferienanlage, achten auf kurz aufblitzende Fußspuren und den „warm/kalt“-Ring unter jedem Fänger – und rufen sich zu. Fänger haben einen Sprint, der Animateur eine Ablenkung (falsche Spur). Jeder Runde ein neuer Animateur
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

Der TV/Laptop spielt durchgehend 8-Bit-Musik (komplett per WebAudio erzeugt, je nach Szene ein anderer Loop). Browser erlauben Ton erst nach einer Aktion: **einmal in die TV-Ansicht klicken oder eine Taste drücken**. **M** schaltet stumm.
Beim Rhythmusspiel kommt der Song ebenfalls vom TV/Laptop – TV und Handys gleichen dafür ihre Uhr mit dem Server ab, damit Noten und Musik synchron sind. (Bei Bluetooth-Boxen kann es wegen deren Verzögerung minimal versetzt wirken – dann lieber Laptop-Lautsprecher oder Kabel.)

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
| Gemeinsam | `shared/` – Typen, Avatar-Zeichnung, Flunkyball-Geometrie |

```
server/   index.ts (HTTP + Vite), room.ts (Lobby/VIP/Ablauf), board.ts (Spielbrett),
          minigame.ts (Interface), flunky.ts, wwe.ts, sprint.ts, murder.ts, ttt.ts, questions.ts, …
          (pro Minispiel eine Datei, z. B. kurve.ts, arena.ts, bowling.ts, parcours.ts)
shared/   types.ts (alle Zustände), games.ts (Konstanten, Fragen, Räume), house.ts (Ferienhaus-Grundriss), avatar.ts, flunky.ts, …
client/   tv.html + host/        (Phaser-Szenen pro Phase/Minispiel)
          index.html + controller/ (Handy-UI, ein Modul pro Spiel in screens/)
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
- [ ] Sounds & Musik

Ausführliche Spiele-Ideen (Arena, Bewegungssensor, geheime Rollen, Physik …) nach Aufwand sortiert: **[ROADMAP.md](ROADMAP.md)**
