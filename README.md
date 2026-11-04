# LAN-Abfahrt 🏖️

Party-Spiel für unsere Freundesgruppe – im Stil von Mario Party / Jackbox:
**Der Fernseher zeigt das Spiel, jedes Handy ist ein Controller.** Kein Controller, keine App nötig – QR-Code scannen und mitspielen.

Aktueller Stand (Prototyp v0.1):

- Lobby auf dem TV mit QR-Code, bis zu 8 Spieler
- Pixel-Avatar-Editor auf dem Handy (Haut, Frisur, Haare, Shirt)
- Der erste Spieler ist **VIP** und startet die Spiele vom Handy aus
- Minispiel **Flunkyball** am Strand:
  - Werfer wischt am Handy nach oben (Länge = Kraft, Richtung = Ziel, Wind beachten)
  - Treffer → das werfende Team tippt auf **TRINKEN**, ein Läufer des anderen Teams tippt auf **LAUFEN**, um die Flasche wieder aufzustellen
  - Wer als Team zuerst ausgetrunken hat, gewinnt

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
server/   index.ts (HTTP + Vite-Middleware), room.ts (Lobby/VIP), flunky.ts (Spiellogik)
shared/   types.ts, avatar.ts, flunky.ts
client/   tv.html + host/  (Phaser-Szenen)
          index.html + controller/ (Handy-UI)
```

Der Server ist die einzige Quelle der Wahrheit: Handys schicken nur Eingaben (`flunky:throw`, `flunky:tap`), der Server berechnet alles und verteilt den Zustand (`state`) an TV und Handys.

## Testen ohne Freunde

Mehrere Browser-Tabs mit `http://localhost:3000/` öffnen (am besten in verschiedenen Profilen/Inkognito, weil die Spieler-ID im `localStorage` liegt) – jeder Tab ist ein Spieler.

## Ideen / Roadmap

- [ ] Spielbrett im Mario-Party-Stil (Urlaubshaus, Würfeln, Felder lösen Minispiele aus)
- [ ] Minispiel „Mord im Ferienhaus“ (Among-Us-artig, geheime Rollen auf dem Handy, Abstimmung)
- [ ] Echte Pixel-Avatare aus Fotos der Freunde
- [ ] Weitere Minispiele: Grill-Duell, Urlaubs-Quiz, Badezimmer-Wettrennen
- [ ] Sounds & Musik
