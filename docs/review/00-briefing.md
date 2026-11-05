# Review-Briefing: LAN-Abfahrt – Spiel-Experience kritisch hinterfragen

Du bist ein unabhängiger Gutachter (Game-Designer + Technik). Marlon (Besitzer) will wissen: **Was ist an den Spielen gut, was schlecht, was kann man verbessern, welche Spiele fehlen noch (z. B. etwas wie Worms), und wie optimiert man das Ding tiefgreifend?** Sei ehrlich und konkret, kein Lob-Sandwich. Schreib auf Deutsch.

## Projekt in Kürze

- Repo: `/home/user/LAN-Abfahrt` (TypeScript). Party-Spiel à la Jackbox / Mario Party für eine Freundesgruppe (bis 12 Spieler) im Heimnetz.
- **TV** = Phaser-3-Szene, Pixel-Welt 480 × 270 hochskaliert, prozedurale Pixel-Art („Cozy-Farm-Look“, Urlaubs-/Ferienhaus-Thema), Font „Press Start 2P“. Code: `client/host/*Scene.ts`, Sprites in `client/art/`.
- **Handy** = Browser-Controller (plain DOM, kein Framework): `client/controller/screens/<kind>.ts`; Bausteine: Joystick, Wisch-/Wurferkennung, Bewegungssensor (nur HTTPS), Zeichenfläche.
- **Server** autoritativ (Node, Socket.IO), ein Minispiel = `server/<kind>.ts` implementiert `MiniGame` (`server/minigame.ts`), Zustand als `GameState` ~25/s gebroadcastet, Physik teils mit matter-js auf dem Server.
- Gemeinsame Konstanten/Typen in `shared/` (`shared/games.ts` = Spieleliste `MINI_INFO`, Kategorien `ARCADE_GROUPS`; `shared/types.ts` = alle Zustände).
- 4 Modi: **Party** (Spielbrett „Ferienhaus“, Würfeln, Münzen, Cocktails, Minispiel pro Runde, Finale = Mord/Verräter), **Arcade** (Spiele einzeln wählen, alle stimmen ab, Punkte/Leaderboard), **Trinkspiel**, **Date Night** (2 Spieler).
- Musik: 8-Bit-Synth, eigene Werkstatt.
- Bots: `server/botclient.ts` spielen jedes Spiel automatisch (nur Testzweck).
- Doku: `README.md` (ausführliche Beschreibung jedes Spiels – unbedingt lesen), `ROADMAP.md` (Ideenliste, teils schon umgesetzt), `docs/status.json` (echtes Feedback von Marlons Gruppe unter `feedback` + `general`, laufende Arbeiten unter `inProgress`).

## Die 42 Spiele (Kind → Titel, Vorbild)

Siehe `shared/games.ts` `MINI_INFO`. Wichtig: **Igel-Krieg (`igel`) ist bereits der Worms-Klon** – bewerte ihn besonders gründlich (`server/igel.ts`, `client/host/IgelScene.ts`, `client/controller/screens/igel.ts`).

## Was Marlon von dir will (Struktur deiner Antwort)

1. **Gesamteindruck** (5–10 Sätze): Was ist die Stärke des Setups, wo liegt das größte Problem?
2. **Spiel für Spiel** (alle 42, kompakt, Tabelle oder Liste): Party-Spaß 1–5, Stärke, Schwäche, 1 konkreter Verbesserungsvorschlag. Urteile aus README-Beschreibung + Code (Server-Datei zeigt Regeln/Balance/Timings, Scene zeigt Präsentation, Screen zeigt Handy-Bedienung). Du musst nicht jede Datei vollständig lesen, aber stichprobenartig schon – gib an, welche du wirklich angeschaut hast.
3. **Querschnitt** – jeweils mit konkreten Beispielen aus dem Code:
   - Game-Feel / „Juice“ (Treffer-Feedback, Screenshake, Partikel, Sound-Cues, Slow-Mo, Kamera), Lesbarkeit auf dem TV mit 12 Spielern (Avatare 16 px groß?), Regelerklärung/Onboarding (versteht ein Neuer das Spiel in 10 s?), Pacing (Spieldauer, Leerlauf, Wartezeiten, Zuschauer-Erlebnis für Ausgeschiedene), Fairness/Balance, Handy-Eingaben (Latenz, Joystick-Präzision, Fat-Finger, Querformat), Robustheit (Reconnect mitten im Spiel).
   - **2D-Look**: Wo ist der Pixel-Look eine Stärke, wo wirkt er „simpel“? Welche Upgrades sind realistisch (mehr Animation-Frames, Partikel, Beleuchtung/Tag-Nacht, Parallax, größere Sprites, 2.5D/Isometrie, höhere Auflösung z. B. 960 × 540, Kamera-Zoom, Shader) und was bringt am meisten pro Aufwand?
   - Meta-Ebene: Party-Modus (Spielbrett zu simpel? Items? Ereignisse?), Arcade/Leaderboard, Progression, Turniere, Teams, Handicap, Highlights/Replays, Statistiken, Sprecher-Ansagen, Achievements, Spielersonderfähigkeiten.
4. **Neue Spiele**: Marlon fragt explizit „so was wie Worms und so“. (a) Wie wird Igel-Krieg wirklich Worms-würdig? (b) 10 weitere neue Spielideen, sortiert nach (Spaß × Passung zu „Handy als Controller“) ÷ Aufwand. Pro Idee: Mechanik in 3 Sätzen, Rolle des Handys (privater Bildschirm / Sensor / Touch / Knöpfe), Spielerzahl, Aufwand S/M/L, warum es die Lücke im aktuellen Portfolio füllt. Berücksichtige, was `docs/status.json` schon in Arbeit/Warteschlange hat (Angeln, Wasserpistolen-Duell, Zauber-Arena, Kings Cup, Kofferpacken, Süßigkeiten-Klau, Spion unter Gästen, Umzugschaos, Wackel-Prügelei) – nicht doppeln, aber gern bewerten.
5. **Top-10-Maßnahmen** nach Wirkung ÷ Aufwand, je mit Aufwand (S = Abend, M = Wochenende, L = mehrere Wochenenden) und erwarteter Wirkung. Trenne „Quick Wins“ von „strukturellen Umbauten“.

## Form

- Markdown, Deutsch, Überschriften wie oben nummeriert. Oben eine Zeile `**Gutachter:** <Modell> / Effort <Stufe>` (wird dir im Auftrag genannt).
- Sei konkret: Dateinamen, Konstanten, Zahlen (z. B. „TTT.ROUND_MS = 180000 ist zu lang, weil …“).
- Schreib das Ergebnis als Datei (Pfad wird dir im Auftrag genannt) und gib am Ende eine 10-Zeilen-Zusammenfassung zurück.

## Nachtrag (Feedback von Marlon, 2026-11-05)

**Handy-Ausrichtung pro Spiel:** Für jedes Spiel soll festgelegt werden, ob das Handy **hochkant** oder **quer** gehalten wird. Das soll (a) am Handy immer klar angezeigt werden (vor Spielstart und als Hinweis, wenn das Handy falsch herum gehalten wird), und (b) das Layout jedes Controller-Screens soll für genau diese Ausrichtung optimiert sein (Knopfgrößen, Joystick-Position, Daumen-Reichweite, nichts außerhalb des sichtbaren Bereichs). Heute kümmern sich nur `kart` und `autoball` explizit um Querformat (`.k3-portrait`-Hinweis, `screen.orientation.lock`), der Rest ist implizit hochkant. Das wird am Ende umgebaut – Bewertung und Empfehlung pro Spiel bitte mitliefern.
