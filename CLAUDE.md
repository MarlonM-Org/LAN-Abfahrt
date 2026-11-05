# CLAUDE.md – LAN-Abfahrt

Lokales Party-Spiel: TV-Ansicht (Phaser) + Handys als Controller (Browser), verbunden über Socket.IO mit einem Node-Server im Heimnetz.

## Befehle

- `npm run dev` – Server + Vite-Middleware auf Port 3000 (TV: `/tv.html`, Handy: `/`)
- `npm run typecheck` – TypeScript prüfen (vor jedem Commit)
- `npm run build` / `npm start` – Produktiv-Build
- `npm run bots -- 4 --game=murder` – Testspieler; `--party` für eine komplette Party (zum Testen neuer Features immer einmal durchlaufen lassen)
- `npm run test:music` – Tests ohne Browser für Tonhöhenerkennung (Einsingen), MIDI-Parser und alle eingebauten Songs (Offline-Rendern: Pegel, Länge, stumme Kanäle, Szenen-Zuordnung); `npm run render:music -- <ordner>` schreibt sie als WAV

## Architektur-Regeln

- **Server ist autoritativ.** Clients senden nur Eingaben; Spiellogik und Zufall leben in `server/`.
- Gemeinsame Konstanten/Geometrie/Typen gehören nach `shared/` (wird von Server, TV und Handy importiert – keine Node- oder DOM-spezifischen Imports dort, außer Canvas-Zeichenfunktionen).
- Zustand wird komplett als `GameState` gebroadcastet (gedrosselt auf ~25/s in `Room.changed()`).
- Neues Minispiel = Klasse in `server/` die `MiniGame` implementiert (siehe `server/minigame.ts`), neuer `MiniKind` + Eintrag in `MINI_INFO` (`shared/games.ts`, inkl. Pflichtfeldern `icon` (Emoji) und `orientation` (`'landscape'` = zwei Daumen wie am Gamepad, `'portrait'` = eine Hand/Sensor/Listen/Text, `'any'` = ein Riesenknopf) und optional `inspiredBy` – Vorbild nur als „à la …“-Untertitel, Spiel nie nach dem Original benennen) + in `ARCADE_GROUPS` einsortieren, Zweig in `Room.startMini()`, Phaser-Szene in `client/host/` (in `main.ts` registrieren), Screen-Modul in `client/controller/screens/` (in `controller/main.ts` einhängen) und Bot-Verhalten in `scripts/bots.ts`.
- Minispiele melden ihr Ende über `ctx.finish({ groups, details, subtitle })` – Münzen/Ergebnis-Screen macht der Raum. Neue Szenen nutzen `Juice`/`sfx` (`client/host/juice.ts`, `client/host/sfx.ts`) statt eigener Partikel/Töne; der 3-2-1-Piep kommt automatisch aus `ui.ts`, Ansagen über `say()` (`client/host/speech.ts`).
- Einzelspiele aus der Lobby (Arcade, Laptop-Auswahl, Einzelspiel-Liste – nicht Spielbrett/Date-Night/Trinkrunde) zählen fürs Leaderboard des Abends (`server/session.ts`, nur im Speicher) und die ewige Tabelle (`server/leaderboard.ts`); im Ergebnis bietet `GameState.nochmal` „Nochmal“ an (Kart: nächste Strecke).
- Geheime Infos nur über `privateFor()` → Event `private`, nie in `GameState`.
- Handy-Ausrichtung: `client/controller/orientation.ts` zeigt Ansage-Karte/Overlay und lockt auf Android – Screens übersteuern bei Bedarf per drittem Tupel-Element (`[key, build, 'any']`). Quer-Spiele bauen auf dem gemeinsamen Querlayout `.lx` (Kopf · `.lx-left` Stick · `.lx-mid` · `.lx-right` Knöpfe, ausgelegt auf 300 px Höhe) und `stickZone()` aus `stick.ts` auf; Halte-Eingaben hören auf `input-reset`, Rückmeldung über `haptic()`.
- Handy-UI: Screens nur neu bauen, wenn sich der Screen-Key ändert (`pickScreen()`), sonst nur Werte updaten – sonst gehen Taps/Wischgesten verloren.
- Phaser-Szenen werden beim Neustart wiederverwendet: Instanzfelder in `create()` zurücksetzen.
- UI-Texte auf Deutsch, Pixel-Look (Font „Press Start 2P“, Welt 480 × 270).
- Musik: Song-Format v2 in `shared/music.ts`, eingebaute Loops in `shared/musicBuiltin.ts`, Synth/Sequencer in `client/music/player.ts` (TV **und** Werkstatt `/musik.html` nutzen denselben). Eigene Songs + Szenen-Zuordnung speichert `server/music.ts` unter `data/music/`; Änderungen gehen per `music:songs`/`music:assign` live an die TVs.

## Status-Seite (Claude-Artefakt) – in JEDER Session pflegen

Marlon verfolgt den Projektstand über ein Claude-Artefakt: **https://claude.ai/artifact/8XRwB1H3bsUUTV5g9dAtmi** (slug `3cefa65c-7b4d-4434-a343-b15cb2c458b5`).

- Quelle der Wahrheit ist `docs/status.json` (in Arbeit, Warteschlange, Abgeschlossen mit PR-Nummer, Feedback pro Spiel, allgemeines Feedback). Spieleliste, Icons und „à la …“ kommen automatisch aus `shared/games.ts`.
- Bei jeder Änderung am Stand (Arbeit begonnen, PR gemergt, neues Feedback von Marlon): `docs/status.json` anpassen (`updated` = aktuelle Zeit), `node scripts/status-page.mjs` ausführen und `docs/status.html` als `index.html` per Artefakt-Tool (`publish_files` mit dem slug oben, `base_version` vorher per `get_artifact` holen) neu veröffentlichen. Änderungen an `docs/status.*` mit committen.
- Feedback-Status pro Spiel: `positiv`, `offen`, `in Arbeit`, `umgesetzt` (ohne Eintrag = „noch kein Feedback“).
