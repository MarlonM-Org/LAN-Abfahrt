# LAN-Abfahrt 🏖️

Party-Spiel für unsere Freundesgruppe – im Stil von Mario Party / Jackbox:
**Der Fernseher zeigt das Spiel, jedes Handy ist ein Controller.** Kein Controller, keine App nötig – QR-Code scannen und mitspielen.

Aktueller Stand (v0.3):

**Drei Modi** (VIP wählt in der Lobby): **Party-Abfahrt** (Standard), **Trinkspiel** und **Date Night**.


- **Lobby** auf dem TV mit QR-Code, bis zu 8 Spieler, Pixel-Avatar-Editor auf dem Handy
- Der erste Spieler ist **VIP** und wählt am Handy, was gespielt wird (und kann jederzeit abbrechen)
- **Party-Modus** (3, 5 oder 8 Runden): Spielbrett „Ferienhaus“ im Mario-Party-Stil
  - Alle würfeln am Handy, Felder geben/nehmen Münzen, `?`-Felder lösen Urlaubs-Ereignisse aus
  - An der **Cocktailbar** wird man beim Vorbeilaufen automatisch 10 Münzen gegen einen Cocktail los
  - Nach jeder Runde ein Minispiel, Münzen nach Platzierung – **Finale: Mord im Ferienhaus**
  - Wer am Ende die meisten Cocktails hat (bei Gleichstand: Münzen), ist Urlaubs-Champion
- **Minispiele** (auch einzeln spielbar):
  - 🍺 **Flunkyball** – Wischen zum Werfen (Wind beachten), Tippen zum Trinken bzw. Laufen
  - 🗳️ **Wer würde eher …?** – geheim abstimmen, Punkte für die Mehrheit. **Eigene Fragen** können in der Lobby am Handy hinzugefügt werden (gespeichert in `data/questions.json`)
  - 🏖️ **Liegestuhl-Sprint** – Reaktionstest bei Sonnenaufgang, wer zu früh tippt, hat einen Fehlstart
  - 🔪 **Mord im Ferienhaus** (ab 4 Spielern, ab 7 mit zwei Mördern) – geheime Rollen auf dem Handy, Aufgaben in den Räumen, Morde wenn man allein mit jemandem ist, Leichen melden, diskutieren, abstimmen

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

Produktiv-Build (schneller, ohne Dev-Tools): `npm run build` und dann `npm start`.

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
          minigame.ts (Interface), flunky.ts, wwe.ts, sprint.ts, murder.ts, questions.ts
shared/   types.ts (alle Zustände), games.ts (Konstanten, Fragen, Räume), avatar.ts, flunky.ts
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
- 🎳 **Strand-Bowling** (ab 2 Spielern) – reihum auf der Bahn an der Strandbar. Am Handy erst die Startposition wählen, dann **„HALTEN & SCHWINGEN“** gedrückt halten, das Handy wie eine Bowlingkugel nach vorn schwingen und am Ende loslassen (Tempo = Schwung, Richtung = Drehung des Handys, Effet = Handgelenk drehen). Ohne HTTPS/Sensor wird die Kugel nach oben **gewischt** (schnell = hart, schräg = Richtung, im Bogen = Effet). Normale Bowling-Wertung inkl. Strike/Spare-Bonus, aber kürzer: bis 3 Spieler 5 Frames, bis 6 Spieler 3, ab 7 Spielern 2.

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
