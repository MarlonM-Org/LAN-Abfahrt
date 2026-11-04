# CLAUDE.md – LAN-Abfahrt

Lokales Party-Spiel: TV-Ansicht (Phaser) + Handys als Controller (Browser), verbunden über Socket.IO mit einem Node-Server im Heimnetz.

## Befehle

- `npm run dev` – Server + Vite-Middleware auf Port 3000 (TV: `/tv.html`, Handy: `/`)
- `npm run typecheck` – TypeScript prüfen (vor jedem Commit)
- `npm run build` / `npm start` – Produktiv-Build

## Architektur-Regeln

- **Server ist autoritativ.** Clients senden nur Eingaben; Spiellogik und Zufall leben in `server/`.
- Gemeinsame Konstanten/Geometrie/Typen gehören nach `shared/` (wird von Server, TV und Handy importiert – keine Node- oder DOM-spezifischen Imports dort, außer Canvas-Zeichenfunktionen).
- Zustand wird komplett als `GameState` gebroadcastet (gedrosselt auf ~25/s in `Room.changed()`).
- Neues Minispiel = neue Klasse in `server/` (wie `FlunkyGame`), neuer `Phase`-Wert, eine Phaser-Szene in `client/host/` und Screens in `client/controller/main.ts`.
- Handy-UI: Screens nur neu bauen, wenn sich der Screen-Key ändert (`pickScreen()`), sonst nur Werte updaten – sonst gehen Taps/Wischgesten verloren.
- Phaser-Szenen werden beim Neustart wiederverwendet: Instanzfelder in `create()` zurücksetzen.
- UI-Texte auf Deutsch, Pixel-Look (Font „Press Start 2P“, Welt 480 × 270).
