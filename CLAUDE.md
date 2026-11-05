# CLAUDE.md – LAN-Abfahrt

Lokales Party-Spiel: TV-Ansicht (Phaser) + Handys als Controller (Browser), verbunden über Socket.IO mit einem Node-Server im Heimnetz.

## Befehle

- `npm run dev` – Server + Vite-Middleware auf Port 3000 (TV: `/tv.html`, Handy: `/`)
- `npm run typecheck` – TypeScript prüfen (vor jedem Commit)
- `npm run build` / `npm start` – Produktiv-Build
- `npm run bots -- 4 --game=murder` – Testspieler; `--party` für eine komplette Party (zum Testen neuer Features immer einmal durchlaufen lassen)
- `npm run test:music` – Tests ohne Browser für Tonhöhenerkennung (Einsingen) und MIDI-Parser

## Architektur-Regeln

- **Server ist autoritativ.** Clients senden nur Eingaben; Spiellogik und Zufall leben in `server/`.
- Gemeinsame Konstanten/Geometrie/Typen gehören nach `shared/` (wird von Server, TV und Handy importiert – keine Node- oder DOM-spezifischen Imports dort, außer Canvas-Zeichenfunktionen).
- Zustand wird komplett als `GameState` gebroadcastet (gedrosselt auf ~25/s in `Room.changed()`).
- Neues Minispiel = Klasse in `server/` die `MiniGame` implementiert (siehe `server/minigame.ts`), neuer `MiniKind` + Eintrag in `MINI_INFO` (`shared/games.ts`, inkl. Pflichtfeld `icon` (Emoji) und optional `inspiredBy` – Vorbild nur als „à la …“-Untertitel, Spiel nie nach dem Original benennen) + in `ARCADE_GROUPS` einsortieren, Zweig in `Room.startMini()`, Phaser-Szene in `client/host/` (in `main.ts` registrieren), Screen-Modul in `client/controller/screens/` (in `controller/main.ts` einhängen) und Bot-Verhalten in `scripts/bots.ts`.
- Minispiele melden ihr Ende über `ctx.finish({ groups, details, subtitle })` – Münzen/Ergebnis-Screen macht der Raum.
- Geheime Infos nur über `privateFor()` → Event `private`, nie in `GameState`.
- Handy-UI: Screens nur neu bauen, wenn sich der Screen-Key ändert (`pickScreen()`), sonst nur Werte updaten – sonst gehen Taps/Wischgesten verloren.
- Phaser-Szenen werden beim Neustart wiederverwendet: Instanzfelder in `create()` zurücksetzen.
- UI-Texte auf Deutsch, Pixel-Look (Font „Press Start 2P“, Welt 480 × 270).
- Musik: Song-Format v2 in `shared/music.ts`, eingebaute Loops in `shared/musicBuiltin.ts`, Synth/Sequencer in `client/music/player.ts` (TV **und** Werkstatt `/musik.html` nutzen denselben). Eigene Songs + Szenen-Zuordnung speichert `server/music.ts` unter `data/music/`; Änderungen gehen per `music:songs`/`music:assign` live an die TVs.
