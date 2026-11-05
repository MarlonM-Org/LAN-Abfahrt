**Gutachter:** Claude Sonnet / Effort mittel

# LAN-Abfahrt – Review der Spiel-Experience

**Wirklich gelesen:** README, ROADMAP, `docs/status.json`, `shared/games.ts`, `server/minigame.ts`, `server/room.ts` (Ablauf, Ergebnisse, `changed()`), `server/board.ts`, `client/controller/style.css` (Kopf/Bausteine), `client/host/ResultsScene.ts`, `client/host/main.ts`, `client/host/textures.ts`.
**Server-Dateien (Regeln/Timings) angesehen:** igel, smash, kart, arena, parcours, kurve, ttt, grill, golf, flieger, sprint, turm, wasser, sumo (Rundenlogik), bogen (Rundenlogik), verstecken (Rollen) – dazu die zugehörigen `shared/*.ts`-Konstanten für volley, autoball, werwolf, sup, tidy.
**Scene + Controller-Screen im Detail (Stichproben per Code-Suche + Leseblöcke):** igel, smash, kart, arena, parcours, kurve, ttt, grill, golf, flieger, werwolf (Screen).
**Nicht gelesen:** alle Trinkspiele, Date-Night, Stille Post, Sprüche, Pixel, Tourist, Murder, Fangen, Geist, Darts, Boule, Bowling, Enten, Volley/Autoball/Bogen (Scene/Screen) – diese Urteile stützen sich auf README + Konstanten + Namen und sind entsprechend vorsichtig.
Hinweis: `MINI_INFO` enthält **41** Spiele, nicht 42 (die Treffer „trap/cloak/radio“ sind Shop-Items in TTT).

---

## 1. Gesamteindruck

Die Stärke des Setups ist die Breite bei sauberer Architektur: ein autoritativer Server, geteilte Physik (`stepKart` läuft auf Server **und** Handy zur Vorhersage), wiederverwendbare Handy-Bausteine (schwebender Joystick `floatingStick`, `holdButton`, Wurferkennung, Zeichenfläche) und ein einheitlicher Look, der sich wie aus einem Guss anfühlt. Für eine Freundesgruppe ist 41 Spiele plus Arcade-Abstimmung ein absurd großer Katalog, die Mischung aus Geheimrollen, Gruppen-Redespielen und Action ist gut, und das „Handy als privater Bildschirm“-Konzept wird in Flieger, Fangen, Geist, Werwolf, TTT wirklich genutzt.

Das größte Problem ist **nicht** fehlender Inhalt, sondern fehlende Verdichtung: Es gibt praktisch **keine Sound-Effekte** (Treffer, Explosion, Münzen, Countdown) – nur die Musikschleife; der einzige SFX-Code ist die Pfeife in `VersteckScene.ts:334` und der Rhythmus-Song. Zusammen mit nur tween-basierten „Partikeln“ (keine Emitter irgendwo im Projekt) und nur einem Screenshake-Aufruf pro Szene wirken viele Spiele mechanisch korrekt, aber „stumm und flach“. Das zweite Problem ist **Pacing bei 8–12 Spielern**: Ausscheide-Spiele (Arena, TTT, Bogen, Sumo, Smash, Igel) lassen Ausgeschiedene minutenlang auf einen „Du schaust zu“-Screen starren. Drittens ist das Spielbrett fast entscheidungslos (ein Würfel, Zufallsfelder), und die Party hängt komplett an der Minispiel-Platzierung (10/6/3/1 – Platz 5–12 bekommen **0 Münzen**). Viertens: 41 Spiele, aber das Onboarding ist Text („Wenn du dran bist: laufen, Waffe wählen, im Zielfeld ziehen …“) – das liest bei Alkohol/Lärm niemand.

---

## 2. Spiel für Spiel

Skala Party-Spaß 1–5 (für eine Gruppe von ~6–12 gemischter Spielerfahrung). „Gelesen“: S = Server, T = TV-Scene, H = Handy-Screen, R = nur README/Konstanten.

| Spiel (kind) | Gel. | Spaß | Stärke | Schwäche | Verbesserung |
|---|---|---|---|---|---|
| 🍺 Flunkyball (flunky) | R | 3 | Echtes Trinkspiel-Gefühl, Wind | Teams-Wartezeit, wenig Skill-Ausdruck | Wurf-Feedback am Handy (Winkel/Kraft anzeigen), Zuschauer-Anfeuern-Knopf |
| 🗳️ Wer würde eher (wwe) | R | 4 | Eigene Fragen, sozial, null Aufwand | Nur 5 Runden, Fragenpool endlich | Geheime Statistik am Ende („Meistgewählter des Abends“) + eigene-Namen-Pointe |
| 🏖️ Liegestuhl-Sprint (sprint) | S | 2 | Sofort verständlich, 3 Runden | **Reaktionszeit kommt vom Handy** (`tap.payload.ms`) → trivial fälschbar; bei 12 Spielern stumpf | Zeit serverseitig aus `goSeq`-Sendezeit minus RTT messen; Punkte-Staffel statt nur 3/2/1 |
| 🔪 Mord im Ferienhaus (murder) | R | 4 | Geheimrolle, Meetings, Leichenfund | Ausgeschiedene warten; TASKS_MS 60 s wirkt knapp für 9 Aufgaben | Geister dürfen weiter Aufgaben machen (wie Among Us) |
| ⛰️ Der Abstieg (descent) | R | 2 | Date-Night-tauglich | Solo-Reaktion, kein Zuschauer-Erlebnis | Nur Date/Co-op belassen, aus Arcade-Random raus |
| 💬 Das erste Gespräch (rhythm) | R | 2 | Süßes Co-op mit Uhr-Sync | Max. 2 Spieler, Bluetooth-Versatz | Nur im Date-Modus; Kalibrierungs-Tap |
| 🌯 Wraps (wrap) | R | 2 | Merk-Spiel, 1 Spieler | Wenig Interaktion | Zwei Spieler gleichzeitig gegeneinander statt solo |
| ✨ Tanz unter den Sternen (stars) | R | 2 | Ruhig, Date | Nischig | Nur Date |
| 🙊 Ich hab noch nie (nhie) | R | 4 | Funktioniert immer | Trinkzwang, Fragenqualität | Eigene Fragen existieren schon → Kategorien („schlimm“, „harmlos“) |
| 🃏 Höher oder Tiefer (hilo) | R | 2 | Schnell | Reiner Zufall | Mit Streak-Einsatz („Doppelt oder nichts“) |
| ⏰ Tick-Tack-Bumm (bomb) | R | 3 | Klassiker, Spannung durch Zünder (15–38 s) | Kategorien-Pool | Kategorien per Handy-Auswahl wählbar |
| 🏄 SUP-Rennen (sup) | S(shared) | 3 | Zwei-Spieler-Boards = Teamchaos, TIME_MS 80 s | 1700 px Länge + Wobble kann frustrieren | Schwierigkeits-Rampe: Wobble anfangs halb |
| 🧺 Aufräumen (tidy) | S(shared) | 3 | 26 Teile, Dash, 60 s – klar | Eher Einzel-Rempeln, kein Teamgefühl | Teams/Körbe farbig + „Klau“-Mechanik |
| ✈️ Urlaubsflieger (flieger) | S,T,H | 5 | Bestes Handy-Konzept des Portfolios: Co-op-Geschrei, Anweisungen pro Cockpit | Tick 200 ms (`TICK_MS=200`) macht Timer ruckelig; `OWN_CHANCE 0.25` heißt: 75 % „rufe dem anderen zu“ – gut, aber bei 12 Spielern ist Lärm unlesbar | Anweisung am TV groß mit Spieler-Namen und Farbe des Ziel-Handys; Absturz-Animation mit Screenshake (6× vorhanden → gut) |
| 🌀 Kurven-Duell (kurve) | S,T,H | 4 | Zwei Tasten, jeder versteht’s in 5 s; Storm nach 25 s verhindert Endlos-Runden | 7 Runden bei 7+ Spielern ≈ 4–5 Min.; Ausgeschiedene schauen zu (Rundendauer bis 55 s); TICK 50 ms = 20 Hz bei Linie 3 px → leichte Treppen | Sofortige „Ghost“-Rolle: Ausgeschiedene dürfen eine Fallen-Lücke/Power-up zuweisen; Kollisions-Sound |
| 💣 Bomben-Arena (arena) | S,T,H | 4 | Bomberman funktioniert; Flut nach 60 s, Ecken-Assist (`ASSIST 0.12`) | **`playerDisconnected` → `kill()`**: Handy sperrt = tot; Runde bis 60 s + Flut, 2 Gewinnrunden (max. 3) = bis 4 Min. mit Wartenden; 25×13 Kacheln à 18 px: 12 Spieler auf 312 Zellen sehr voll | Reconnect-Gnadenfrist (3–5 s) vor `kill`; Tot-Spieler als Geist, die Bomben auf Wunsch „ankicken“ dürfen |
| 🎳 Strand-Bowling (bowling) | R | 3 | Wii-Gefühl | Sensor-Feedback fehlt (Feedback im Status: „in Arbeit“), HTTPS nötig | Wie geplant: Erkennungs-Anzeige am Handy; Drehzahl als Effekt auf TV |
| 🦆 Ententeich (enten) | R | 4 | Echtes positives Feedback („sehr cool“) | Neigen driftet, Kalibrierung | Auto-Nullpunkt beim Countdown-Ende + Zielhilfe |
| 🏊 Verräter (ttt) | S,T,H | 4 | Geheimrolle + Shop; Detektiv; 3 HP | **`ROUND_MS = 180000`, 2–3 Runden = bis 9 Min.** inkl. 9 s Rundenende, tote Spieler schauen mit Text „Psst! Nichts verraten“; als Finale zu lang | ROUND_MS auf 90–120 s, Runden 2; Tote bekommen Spec-Kamera-Wahl + „Orakel“ (dürfen Verräter-Hinweis-Tipp abgeben) |
| 🪴 Versteckspiel (verstecken) | S(Teil) | 4 | Prop-Hunt-Idee ist stark; Pfeifen hat echten Ton | HIDE_MS 25 s wenig; Suchende 1 pro 4 | Sichtbarer Countdown-Ton, Hider dürfen Möbel „zittern“ |
| 🏁 Fallen-Parcours (parcours) | S,T,H | 4 | Ultimate-Chicken-Horse-Prinzip aufgehen; Bauphase `BUILD_MS 15 s` | Round-Dauer ~52 s × bis 6 Runden ≈ 5 min; Bauen per Joystick auf Handy mit 12 Spielern lang; `RUN_MS 25 s` Zeit lief aus (Feedback) | Bei >6 Spielern nur die Hälfte baut pro Runde; Platzieren per Tippen auf Minikarte statt Joystick |
| 🏎️ Kart-Rennen (kart) | S,T,H | 4 | Mode-7/Verfolger-Kamera, Drift-Mini-Turbo, Handy-Vorhersage geteilt; Splitscreen/Handy-Wahl | **Kein Rubber-Banding** (Grep ohne Treffer), 12 Karts: Schlusslichter haben nichts vom Rennen; 3 Runden × bis `AFTER_WINNER_MS 20 s` | Gummiband-Boost für hintere Hälfte + Blitz-Item; Nach Ziel Zuschauer-Kamera |
| 🗼 Wackelturm (turm) | S | 3 | matter-js pro Lane, solide Technik | Feedback: Teile lassen sich nicht heranschieben (in Arbeit); Physik-Last mit 12 Engines | Wie geplant: Raster; bei >6 Spielern Teams à 2 teilen sich einen Turm |
| 🦔 Igel-Krieg (igel) | S,T,H | 3 | Zerstörbares Terrain per Bitmaske (Seed + Kraterliste, genial sparsam), Wind, Flut/Sudden Death | **Siehe Abschnitt 4a:** Nur 4 Waffen, keine Kamera, wenig Wumms, Wartezeit bei 12 Teams ≈ 6 Min. | Worms-Upgrade, s. u. |
| 🥊 Smash-Arena (smash) | S,T,H | 4 | Beeindruckend: Prozent, Hitstun, Schild, Specials, Kamera-Zoom, 4 Screenshake-Typen | Server-Tick 50 ms (20 Hz) + Broadcast 40 ms gedrosselt + WLAN = ~100–150 ms gefühlte Latenz → Plattform-Fighter „matschig“; `TIME_MS 180 s`; 2 Stocks ab 6 Spielern | Client-seitiges Vorhersagen der eigenen Bewegung (Muster `stepKart`), Tick 33 ms; Hitstop (2–4 Frames Freeze) |
| 💦 Wasserbomben-Schlacht (wasser) | S | 4 | Teams, Deckung, Nachladen am Eimer/Schlauch, Pistolen-Powerup | Bei 3 Spielern FFA anders balanciert | Teamfarben stärker am TV; Nass-Ring statt HP-Zahl |
| 🖍️ Stille Post (stillepost) | R | 5 | Bester Lacher-pro-Minute-Wert; Likes | Bei Pausen („hängt, weil einer schläft“) | Pro Schritt Auto-Abgabe mit Strich-Fallback (vermutlich vorhanden – nicht gelesen) |
| 🕵️ Urlaubs-Fangen (fangen) | R | 4 | Asymmetrisch, privater Bildschirm | Animateur unsichtbar = Zuschauer sehen nichts Spannendes | „Fußspuren-Replay“ am Rundenende |
| 👻 Geisterjagd (geist) | R | 4 | Vibration verrät Nähe, Taschenlampen | Lichtkegel-Rendering auf TV | Kegel-Überlappung mit Farbmischung |
| 🔥 Grill-Chaos (grill) | S,T,H | 4 | Overcooked-Kern sitzt: Schnippeln→Grillen→Servieren, Brandgefahr, ab 7 Spielern 2 Teams | `ACT_LATCH_MS 900`: „Aktion halten“ per Latch statt echtem Release → bei Netz-Lag klebt Aktion; 1 Stunde? nein: `TIME_MS 180 s` OK; 6 Spieler in einer Küche à 18-px-Kacheln sind eng | Gedrückt-Halten durch Tipp-Toggle ersetzen oder Latch auf 400 ms; Rezept-Icons groß am TV |
| 🥥 Boule (boule) | R | 3 | Legen oder Schießen = Entscheidung | Sensor-Feedback fehlt | Wie Bowling |
| 🤼 Sumo-Steg (sumo) | S(Teil) | 4 | Schrumpfender Steg (`SHRINK_MS 24 s`), Dash mit Cooldown 1,3 s, Risse | Wartezeit der Ausgeschiedenen bis 45 s je Runde | Verlierer-Mini-Aktion (Möwen werfen) |
| 🏐 Strand-Volleyball (volley) | R | 3 | Teams, Slime-Prinzip | `MATCH_MS 240 s`, 6v6 auf kleinem Feld | Max. 3 pro Seite, Rest rotiert |
| 🧳 Wer ist der Tourist (tourist) | R | 4 | Redespiel mit Karten, 34 Orte | Sitzen alle in einem Raum – nur das Handy zeigt Karte, TV leer | TV als Fragenprotokoll mit Pfeil Frager→Gefragter (vorhanden) |
| 🗯️ Sprüche-Duell (sprueche) | R | 5 | Quiplash-Format mit Abräumer, Multiplikator-Runden | Texteingabe auf Handy ist langsam | Diktierfunktion (Web Speech) optional |
| 🖼️ Pixel-Galerie (pixel) | R | 4 | 16×16 in 75 s, Vernissage | Je 3 Runden ≈ 5 Min | Eine Runde „Schnell“ (45 s) |
| 🏹 Bogen-Arena (bogen) | S(Teil) | 4 | Ein Treffer = raus, Saugnapfpfeile, Dash | `maxPlayers: 8`; Rundenwartezeit | Spec-Modus: Geister dürfen Pfeile nachwerfen |
| 🎯 Darts (darts) | R | 3 | Gleichzeitig werfen = kein Leerlauf | Sensor | Wie Bowling |
| ⛳ Minigolf (golf) | S,T,H | 3 | Gleichzeitig putten (kein Warten!), `HOLE_S 60 s`, `MAX_STROKES 6`, Auto-Putt bei Offline | **7 Bahnen × (6,5 s Intro + 3,2 s Tee + bis 60 s + Karte 6,5 s) ≈ 8–10 Min.**; Bälle kollidieren offenbar nicht → wenig Interaktion | 5 Bahnen im Party-Modus; Ballkollision/Anstoßen als Rache-Element |
| ⚽ Auto-Fußball (autoball) | R | 4 | Rocket-League light, Boost + Hüpfer | 12 Autos auf 480×270 = Pixelbrei; `MATCH_MS 180 s` + 60 s Overtime | Max. 4v4, Rest als Torwart-Rotation |
| 🐺 Werwölfe (werwolf) | S(R)+H | 4 | Ohne Spielleiter, Nachtphase mit identischen Screens (kein Spicken) | ~100 s pro Tag-Nacht-Zyklus, 6–12 Spieler ⇒ 15–25 Min; richtig, dass nicht in `BOARD_KINDS` | Als eigener „Abend-Modus“ promoten, nicht als Minispiel |

(Alle 41 Spiele; die drei übrigen Zeilen entfallen, weil `trap/cloak/radio` Shop-Items sind.)

**Kurzfazit der Tabelle:** Die besten Spaß-pro-Minute-Werte haben Stille Post, Sprüche, Flieger, Kurve, Kart, TTT (wenn gekürzt). Die Wackler sind Solo-/Date-Spiele im Arcade-Random-Topf (`ARCADE_RANDOM` enthält `descent`, `wrap`, `rhythm`, `stars`, die für 1–2 Spieler gedacht sind – bei 8 Spielern zieht eine Zufallswahl sie trotzdem, `fitsPlayers` erlaubt `minPlayers:1`).

---

## 3. Querschnitt

### 3.1 Game-Feel / Juice

- **Sound-Effekte praktisch nicht vorhanden.** `music.ts` exportiert `fxBus`/`setFxVolume`, aber außer `playRhythmSong` und der Pfeife in `VersteckScene.ts:334` (eigener `new AudioContext()`!) ruft keine Szene irgendwas auf. Ein Treffer in Smash, ein Explosions-Krater in Igel, ein Münzgewinn im Board, ein Countdown „3-2-1“ sind **stumm**. Das ist der Hebel Nr. 1: Ein `sfx(name)`-Helfer im vorhandenen Synth (`synth.tone/kick/noise` existieren schon) mit ~20 Presets (hit, boom, coin, tick, win, lose, jump, splash, pop, whoosh) wäre ein Abend Arbeit und verändert alle Spiele.
- **Partikel:** Es gibt keinen einzigen Phaser-Emitter. Die Igel-Explosion (`IgelScene.ts:261-275`) ist Flash + Feuer + Staub-Sprites + Krümel mit einzelnen Tweens – sieht ok aus, skaliert aber nicht (bei 12 Igeln viele Objekte). Ein zentraler `burst(x,y,preset)`-Helfer mit Phaser-Emitter-Manager spart Code und sieht besser aus.
- **Screenshake:** je Szene meist genau 1 Aufruf (`shake=1` in Igel, Arena, TTT, Grill, Kurve …), Smash hat 4 abgestufte (`SmashScene.ts:319-368`, intensitätsabhängig – vorbildlich). Es fehlt **Hitstop/Freeze-Frame** (2–4 Frames beim Treffer), **Slow-Mo** beim letzten Kill (Arena, Bogen, Smash-Finale, Kart-Zielfoto) und **Kamera-Zoom auf den Entscheidungsmoment**. Nur Smash hat überhaupt einen Kamera-Zoom (`cam.zoom`), Igel hat keine Kamera-Verfolgung der Rakete (`grep startFollow/zoom` ohne Treffer) – bei einer Karte, die den ganzen 480×270-Bildschirm füllt, fliegt die Rakete aber auch nicht weit weg; trotzdem: die Mikro-Dramatik („Granate ist 1 s vor dem Platzen“) fehlt.
- **Handy-Haptik:** 36 Dateien nutzen `navigator.vibrate` – gut, aber iOS-Safari unterstützt `vibrate` nicht (die meisten Freunde mit iPhone = null Haptik). Alternative: visuelles Blitzen des Handy-Rands + (nach User-Geste) ein kurzer WebAudio-Klick im Handy.

### 3.2 Lesbarkeit auf dem TV mit 12 Spielern

- Avatare sind **16 × 27 px** (`shared/avatar.ts: AV_W=16, AV_H=27`) in einer 480×270-Welt. Auf 1080p-TV = 4× ⇒ 64×108 px, also gut sichtbar; auf einem Beamer/kleinen Fernseher aus 3 m Entfernung bei 12 Figuren auf einem Bildschirm (Arena 312 Zellen, Autoball, Grill, Volley) wird es eng.
- **Namenslesbarkeit:** `nameTag` mit Press-Start-Font bei 8 px Welt-Größe = 32 px auf FullHD; in Kurve/Kart/Arena sind Spieler eher nur Farben. Gute Maßnahme: überall zusätzlich **Spielerfarbe + Form** (Ring/Hut) – `IGEL_COLORS` mit 12 Farben ist hier gut gelöst, aber „#b6d33a“ gegen „#f2c33a“ (gelb vs. gelbgrün) und „#fdf7ea“ (fast weiß) sind aus 3 m schwer zu trennen.
- `ResultsScene`: `rowH = min(22, floor((236-top)/rows))`, Detailtext auf 16 Zeichen abgeschnitten (`row.detail.slice(0,16)`); bei 12 Zeilen wird rowH ≈ 13 px → Schrift 8 px passt knapp. Podium ab Platz 4 als Seitenlisten ist okay.

### 3.3 Onboarding / Regelerklärung

- Die Regel steht als **Fließtext** auf dem Handy (z. B. `igel.ts`: „Du hast 2 Igel auf der Insel. Wenn du dran bist: laufen, Waffe wählen, im Zielfeld ziehen (Richtung = Winkel, Länge = Kraft) …“), parallel `tagline` am TV. Ein Neuling versteht Kurve/Flieger/Sprint in 10 s, **nicht** Parcours, Igel, Smash (Specials), Grill, TTT-Shop, Golf (Ziehen = Kraft), Kart-Drift.
- Maßnahme: 5-Sekunden-**Demo-Loop** pro Spiel vor dem Countdown (TV zeigt animierte Icons „Joystick → Pfeil → Treffer“) oder wenigstens ein Piktogramm-Streifen mit 3 Bildern. Im Party-Modus (Spiel #3, #4 …) kann der Text nach dem ersten Mal verkürzt werden (merken: „hat dieses Spiel schon erklärt bekommen“).
- Countdown-Zeiten sind kurz (Arena 3 s, Smash 3,5 s, Igel 3,5 s) – ausreichend, wenn man die Regeln kennt, zu wenig für Neue. Kart ist mit 8 s Countdown das Gegenbeispiel (gut gelöst: Ansichtswahl).

### 3.4 Pacing / Zuschauer-Erlebnis

- **Spielzeiten (aus Konstanten):** Kurve ≈ 3–5 Min, Arena bis ~4 Min, TTT 2×180 s (+ je 9 s) ≈ 6–9 Min, Parcours ≈ 5 Min, Golf ≈ 8–10 Min, Igel bis 8 Min (`HARD_CAP_MS 8·60 s`, Sudden Death erst ab 5 Min), Werwolf 15–25 Min. Im **Party-Modus** wird das bei 5–8 Runden schnell ein 60–90-Minuten-Abend nur durch Minispiele – okay – aber Golf/TTT/Igel bremsen. Empfehlung: pro Spiel `partyCapMs` in `MINI_INFO` und Party-Varianten mit gekürzten Konstanten.
- **Ausgeschiedene:** Arena (`ar-dead`), TTT (`ttt-dead`), Smash, Bogen, Sumo, Igel („Du schaust zu“-Screen via `message()`) – das Handy zeigt nur Text. Gutes Muster fehlt: Tote sollten eine **Aufgabe** bekommen (Wetten auf den Sieger = Bonuspunkte, Geister-Interaktion, Emote-Raketen, „Fanclub“-Knopf zum Anfeuern).
- **Board:** `ROLL_IDLE_MS 45 s` Auto-Wurf – gut. Aber 12 Spieler × (900 ms + value×280 ms + 1800 ms) ≈ 12 × ~3,5 s ≈ 40 s reines Zuschauen pro Boardrunde + 4 s Intro.

### 3.5 Fairness / Balance

- **Igel:** Zufälliger Spawn, aber `genTerrain(seed)` ohne Fairness-Check; Wind `sign(w)*|w|^1.3`. Bei ≥5 Spielern 1 Igel pro Team mit 100 HP ⇒ ein Bazooka-Treffer (45) + Fallschaden kann in 3 Zügen töten; wer als Letzter dran ist, hat Nachteil.
- **Board:** `PLACE_COINS [10,6,3,1]` + `ARCADE_POINTS [10,6,3,1]`: bei 12 Spielern gehen 8 leer aus – Matthäus-Effekt. Cocktail (10 Münzen) wird beim Vorbeilaufen gekauft, die Bar springt nach dem Kauf (`moveBar`) – wer früher würfelt, hat Vorteil (Reihenfolge `shuffle(ids)` einmalig fix pro Party!). `turnIdx` startet jede Runde bei 0 → der Erste in `order` hat in jeder Runde den Vorteil, der Bar näher zu kommen.
- **Sprint:** Zeit vom Handy (`Number(p.ms)` mit Clamp 0..`GO_MS`) = cheatbar.
- **Kart:** kein Rubber-Banding → bei 12 Spielern entscheidet Startposition.

### 3.6 Handy-Eingaben

- **Gut:** `floatingStick` (Daumen setzt Mitte, Ring wandert mit, Totzone 18 %, 50-ms-Drosselung, Sofort-Senden bei Richtungswechsel), `holdButton` (Pointer-Capture, Vibrate 8 ms), `tapButton`. `pickScreen`-Regel verhindert Neubau.
- **Latenz:** Server-Tick 50 ms (20 Hz) in fast allen Action-Spielen (Smash, Arena, Parcours, Kurve, TTT, Bogen), Broadcast zusätzlich per `changed()`-Debounce 40 ms. Für Kurve/Arena ok, für Smash/Parcours-Sprung/Bogen (`COYOTE_MS 90`, `JUMP_BUFFER 130`) spürbar. Gegenmittel liegen im Code bereit (Kart: Vorhersage via `stepKart`) – nur dort angewendet.
- **Fat-Finger:** `.ig-left/.ig-right/.ig-jump` Dreier-Leiste und Smash-4-Button-Cluster (`SPEZIAL/SPRUNG/SCHILD/SCHLAG`) – Buttons nah beieinander, keine Querformat-Layouts außer Kart (9 Treffer `orient/landscape`), Parcours (1), Kurve (1), Grill (3). Das Feedback „Querformat“ (status.json) ist also systemisch: **Smash, Bogen, Arena, TTT, Igel haben kein Querformat-Layout.**
- **Igel-Zielfeld:** Ziehen im Pad, Loslassen = Feuer (`release` mit `v.len < 18` Abbruch). Gefahr: versehentliches Feuern beim Loslassen; es gibt einen Abbruch nur durch Zurückziehen unter 18 px. Besser: eigener FEUER-Button oder „zurück zur Mitte = abbrechen“-Zone mit deutlichem Feedback.

### 3.7 Robustheit / Reconnect

- Zustand liegt komplett auf dem Server, Spieler-ID im `localStorage`, `player:join` mit alter ID reattached – gut. VIP-Gnadenfrist 60 s, Bot übernimmt Fortschritt.
- **Aber** `playerDisconnected` ist spielspezifisch: Arena **tötet** den Spieler sofort (`arena.ts:377`), TTT/Kurve stoppen nur die Eingabe (Kurve fährt geradeaus bis zur Wand = Tod), Igel kürzt den Zug auf 1,5 s. Ein Handy, das beim Wischen den Bildschirm sperrt, ist also in Arena/Kurve raus. Einheitliche Regel: 5–8 s Gnadenfrist im `Room`, bevor `playerDisconnected` überhaupt an das Spiel geht.
- Neue Spieler können nur in der Lobby joinen (`'Gerade läuft ein Spiel – du bist ab der nächsten Runde dabei!'`) – ein Nachzügler im Party-Modus wird ausgesperrt, statt zum nächsten Minispiel zu stoßen.

### 3.8 2D-Look

**Stärken:** Das Cozy-Farm-/Urlaubs-Thema ist konsistent (Handy-CSS: Pergament, Holzknöpfe, Press Start 2P; TV: Gras, Holz, Palmen), prozedurale Sprites ersparen Asset-Pipeline, Avatare mit Look-Editor sind persönlich (Freunde erkennen sich) – das ist der größte Identifikations-Hebel. Igel-Terrain per Bitmaske mit Seed ist elegant.

**Wirkt simpel:** (1) Figuren haben vermutlich nur wenige Animationsframes (Walk per Tween auf ein statisches Bild: `figure()` ist `Image` + Schatten-Ellipse); (2) keine Beleuchtung/Tageszeit – die Welt ist immer gleich hell, obwohl Geisterjagd und Werwolf „Nacht“ verkaufen; (3) Hintergründe sind meist statisch gebackene Canvases (`background(this, key, W, H, paint)`), kein Parallax; (4) 480×270 mit `pixelArt:true` und Scale.FIT: auf 4K ok, aber Text in 8 px Press Start 2P wird weich bei nicht ganzzahligem Faktor (FIT skaliert stufenlos → Pixel-Shimmer/ungleiche Pixel auf 1440p-Monitoren).

**Realistische Upgrades – nach Wirkung ÷ Aufwand:**
1. **Ganzzahliges Skalieren / Letterbox** (`Scale.FIT` → eigenes Zoom auf ganzzahlige Faktoren, `roundPixels`): S, sofort schärferes Bild.
2. **Partikel-Helfer + Hitstop + SFX** (siehe 3.1): S–M, größter „Wertigkeits“-Sprung.
3. **Licht/Tint-Layer pro Szene:** ein Multiply-Overlay + weiche Radial-Lichter (Phaser `Lights2D` oder simples `BlendModes.ADD`-Sprite) für Nacht (Geist, Werwolf, Sonnenuntergang im Board, Strandbar): M.
4. **2–4-Frame-Walk-Cycles** für den Avatar (Beinversatz per Canvas aus `drawAvatar`), 2-Frame-Idle (Atmen): M, macht Gewimmel lebendig.
5. **Parallax** (Himmel/Meer/Palmen als 2–3 Ebenen) in Igel, Smash-Stages, Parcours, Board: M.
6. **Kamera-Zoom/Folgen** in Einzelfokus-Momenten (Igel-Schuss, Golf-Putt, Smash-Finale): M.
7. **960×540-Welt:** L bis XL. Alle `shared/*`-Geometrien (Arena `TILE 18`, Igel Terrain 480×270 als `Uint8Array`, Kurve-Arena 468×234) sind in Welt-Pixeln hart verdrahtet; Verdoppelung heißt Terrain 4× Speicher, alle Zeichenfunktionen neu. **Nicht empfohlen**; stattdessen Texte/HUD in Hoch-Auflösung (Overlay-Canvas mit eigener Font) und Sprites bei 480×270 belassen – das ist ein Drittel des Aufwands für 80 % des Effekts.
8. **2.5D/Isometrie** (Kart nutzt schon `client/kart3d`): nur für Spiele mit Tiefe; sonst L ohne klaren Gewinn.
9. **Shader (CRT/Bloom, Wasserwellen):** M, schöne Politur für Lobby/Board/Ergebnis, aber Performance auf alten Laptops prüfen.

### 3.9 Meta-Ebene

- **Party-Modus/Spielbrett:** 24 Felder Ring, 3 Feldtypen (blau +3, rot −3, Event alle 6.), 7 Events. Keine Entscheidung (kein Weg-Gabelung, keine Items, kein Klauen, keine Würfelmanipulation). Fix: Items-Feld („Würfel ×2“, „Münzen klauen“, „Platz tauschen“ gibt es nur als Event), Gabelungen, eine **Minispiel-Wahl-Wette** („Wette 3 Münzen auf dich“), **Comeback-Mechanik** (Letzter bekommt Doppelwurf / Platz 5–12 bekommen 1–2 Münzen als Trost), und **Teamrunden/„Alle gegen einen“-Spiele** als Board-Pool-Typ statt rein FFA.
- **Arcade/Leaderboard:** Punkte 10/6/3/1 pro Name in `data/arcade.json`; „Nochmal + Leaderboard“ in Arbeit. Zusätzlich: Statistiken pro Spiel (Bestzeit Kart, höchste Golf-Runde), „Spieler des Abends“-Auszeichnung.
- **Turniere/Teams/Handicap:** Kein Handicap-System. Einfach: Rating pro Spieler/Spiel → Schwache Spieler bekommen +1 Leben/+10 % Boost (Smash-Prozent, Arena-Startbombe).
- **Highlights/Replays:** Nichts vorhanden. Server hat Fx-Listen (`IgelFx`, `SmashFx`, `KartEvent`) – daraus lässt sich ein „Best-of“-Clip am Ende („Fall des Abends“) bauen, indem man die letzten 5 s Snapshot-Ringpuffer speichert (der Broadcast ist 25/s, ein Ringpuffer von 125 States).
- **Sprecher-Ansagen:** Es gibt Text-Banner, aber keine Stimme. Web-SpeechSynthesis (de-DE) für „Letzte Runde!“, „Vorsicht, Flut!“ ist S und witzig.
- **Achievements / Sonderfähigkeiten:** Smash hat Specials pro Avatar (`SPECIALS[f.special]`) – gut. Übertrag: Party-Passive („Glückspilz: +1 Würfelaugen einmal“) wählbar in Lobby.

---

## 4. Neue Spiele

### 4a. Wie wird Igel-Krieg wirklich Worms-würdig?

**Was schon da ist:** Bitmasken-Terrain mit `carve()`, Seed + Kraterliste (`craters`) statt Terrain-Übertragung (sehr sparsam), Wind, Flut/Sudden Death, Teleport, Schlag, Wasserbomben-Granate, 100-HP-Igel, Rundenfolge pro Team, Fallschaden (`FALL_SAFE 200`, `FALL_DMG 0.12`), Bot-Simulation (`simulateBazooka`).

**Was fehlt (der Worms-Kern ist Waffenvielfalt + Chaos + Kamera + Humor):**
1. **Waffenarsenal:** Aktuell 4 (`WEAPON_ORDER` bazooka, grenade, teleport, punch). Worms lebt von 15+ Waffen. Günstig und passend: **Schrotflinte/Wasserpistole (Hitscan, 2 Schuss)**, **Ninjaseil** (Pendel-Bewegung, Wischen = Richtung; hohes Skill-Potential), **Heilige Handgranate / Banana-Bomb (Splitter)**, **Mine/Sandburg-Falle**, **Luftschlag / Möwen-Angriff** (Tippen auf Karte), **Brücken-/Sandkasten-Baukasten** (Terrain-*Hinzufügen*, `Mask` kann das), **Fallschirm-Bonus**. Pro Waffe ca. 40–60 Zeilen Server + 1 Fx.
2. **Waffenkisten & Vorräte:** Zufallskisten fallen vom Himmel (Muster `Item` in smash), enthalten Waffe/Heilung/Fallen. Ohne Kisten gibt es keine Dynamik im Mittelspiel.
3. **Kamera:** Folgt Projektil, zoomt auf Explosion, schwenkt zum nächsten Igel – derzeit ist alles statisch 480×270. Dazu **Instant-Replay** des Kills (Fx-Log vorhanden).
4. **Sound + Humor:** Igel-Sprüche („Ich hab’s!“, „Autsch!“) als Sprechblase, Todes-Animation (Grabstein/Kreuz → Sonnenschirm), Explosions-Boom, Wind-Rauschen. Aktuell: `K.O.`-Text.
5. **Terrain-Qualität:** Aktuell ein Seed-Generator (`genTerrain`); mehr Biodiversität (Höhlen, Brücken, schwebende Inseln, Treibsand) macht mehr Taktik. Mehrere Karten-Presets pro Spiel (Strand, Hafen, Poolhaus).
6. **Zug-Tempo bei vielen Spielern:** 12 Teams × 30 s (`TURN_MS`) = 6 Min. pro Gesamtrunde. Worms-Lösung: Zug **nur 15–20 s**, Rückzugszeit nach Schuss (`RETREAT_MS 3000` vorhanden), und **Teams** (2 Teams à 6, Reihum Mensch aus Team) – Igel-Kämpfe zwischen 2 Teams sind lesbarer und es gibt keine 5-Minuten-Wartezeit. Alternative: **simultaner Modus** („alle zielen gleichzeitig, Schüsse lösen gleichzeitig aus“) für > 6 Spieler.
7. **Zielen am Handy:** Ziehen=Winkel+Kraft ist gut für Gelegenheitsspieler. Für Feinzielen fehlt **Fadenkreuz am TV** live (Zielpfeil sieht der Zuschauer?) und ein **FEUER**-Button statt Loslassen (Fehlschuss-Risiko). Optional: Gyro-Fein-Zielen.
8. **Dauer:** `SUDDEN_MS 5 min`/`HARD_CAP 8 min` zu lang für Party-Modus; Party-Variante: 3 Min., Flut nach 90 s.

**Rangfolge (Aufwand ↑):** SFX+Kamera-Folgen (S) → 3 neue Waffen (Schrotflinte, Seil, Banane) + Kisten (M) → Teams + 2 Karten (M) → Replay/Highlights (M).

### 4b. 10 neue Spielideen (sortiert nach (Spaß × Handy-Passung) ÷ Aufwand)

Bereits in Arbeit/Queue (nicht doppeln): Angeln, Wasserpistolen-Duell, Zauber-Arena, Kings Cup, Kofferpacken, Süßigkeiten-Klau, Spion unter Gästen, Umzugschaos, Wackel-Prügelei. Bewertung davon: **Spion unter Gästen** (hohe Passung, privater Screen, mit 12 Spielern großartig – priorisieren), **Wasserpistolen-Duell** (S, Sensor, sehr party-tauglich), **Wackel-Prügelei** (Physik-Aufwand L, wenig Neues gegenüber Sumo/Smash – eher streichen), **Umzugschaos** (L, Overcooked-Verwandtschaft zu Grill – niedrig), **Kofferpacken** (Doppelung Turm – niedrig).

1. **„Wer war’s? – Zeichen-Raten ohne Worte“ (Charaden-Pantomime per Sensor)** – Mechanik: Ein Spieler bekommt am Handy einen Begriff (Urlaub/Bar/Strand), muss ihn **mit dem Handy in der Hand** pantomimisch vorspielen; das Team rät laut, der Rater tippt „richtig“. Handy: privater Bildschirm + Neigen für Skip/Richtig (Kopf-hoch-Klassiker). 3–12 Spieler. Aufwand **S**. Lücke: Es gibt noch kein **Körper-/Bewegungs-Partyspiel mit Gruppen-Zurufen**.
2. **„Mehrheit gewinnt“ / Prognose-Wette** – Mechanik: Frage („Wie viele von uns haben schon …?“, „Wer hat die höchste Handyakkuzahl?“); jeder schätzt eine Zahl bzw. wettet auf den Spieler am Handy; Nähe zur Wahrheit gibt Punkte. Handy: Schieberegler/Tipp. 3–12. **S**. Lücke: Kaum Wissens-/Schätzspiel im Portfolio; passt zu WWE-Datenbank („Statistik des Abends“).
3. **„Wurf-Duell Bierpong/Becherwurf“** – Mechanik: Becherpyramide auf TV, Handy = Wurf (`throwInput.ts` existiert), Treffer zwingt Gegner zum Trinken/zum Punkteverlust. Teams, gleichzeitig. Handy: Wurferkennung. 2–12. **S–M**. Lücke: Wurf-Geschicklichkeit mit Team-Rivalität; Flunky ist langsam.
4. **„Ausweichen/Dodgeball-Hof“** – Mechanik: Arena-Dodgeball, 2 Teams, Bälle aufheben und werfen (Wischen), Treffer = raus, Rückkehr wenn Teamkollege fängt. Handy: Joystick + Wisch-Wurf. 4–12. **M**. Lücke: Team-Action mit wenig Wartezeit (Rückkehr-Mechanik löst Zuschauerproblem).
5. **„Reise nach Jerusalem / Stuhlkreis“** – Mechanik: Musik (vorhandene Musik-Engine!) läuft, Stühle (n−1) auf TV; Musik stoppt zufällig → alle tippen/rennen zum freien Stuhl (Joystick-Sprint). Letzter ohne Stuhl raus; Stühle können geschubst werden. 3–12. **S–M** (Rhythmus-/Musik-Sync existiert). Lücke: Musik als Spielmechanik, schnelle Runden, perfekt für 12.
6. **„Heißer Draht / Ruhige Hand“ (Sensor-Ruhe)** – Mechanik: Handy-Gyro muss ruhig gehalten werden, während TV Ablenkungen zeigt (Möwe, Cocktail-Show); wer zittert, verliert Punkte. Handy: reiner Bewegungssensor (Stillhalten). 2–12. **S**. Lücke: Entspannende/Spannungs-Minispiel (Gegenstück zu Chaos-Spielen), Sensor-Nutzung ohne Wisch.
7. **„Sandburg-Bau-Wettbewerb“ (Co-op/Teams, Physik-light)** – Mechanik: Teams stapeln/formen Sandburg-Blöcke aus Menü (Handy = Bausatz), Jury (Vernissage-Vote wie Pixel) bewertet. Handy: Bausatz-Auswahl + Platzieren. 3–12. **M**. Lücke: Kreatives Teamspiel, das **nicht Zeichnen** ist.
8. **„Quiz-Show: Schnellrate (Buzzer)“** – Mechanik: Buzzer-Quiz mit Urlaubs-/Allgemeinwissen, Handy = Buzzer + 4 Antworten, Tempo-Bonus. Fragenpool-Editor existiert bereits (`QuestionStore`). 2–12. **S**. Lücke: Wissen/Tempo; Jackbox-Klassiker (Trivia-Murder-Party-artig mit Strafspiel für Letzte).
9. **„Schnitzeljagd per Kamera / Foto-Challenge“** – Mechanik: Aufgabe („Foto von etwas Rotem“), Handy-Kamera nimmt auf, Gruppe stimmt auf TV für bestes Foto. Handy: Kamera (nur HTTPS vorhanden!). 3–12. **M**. Lücke: reale Welt einbeziehen, Ergebnisse als Erinnerung (Fotoalbum am Ende).
10. **„Fall Guys-Hindernislauf (Lauf-Strecke)“** – Mechanik: Auto-Scroller-Strecke mit Rotoren, Drehbalken, Sprungfeldern; alle laufen (Joystick + Sprung), Top-N qualifizieren sich, Rest scheidet aus. Handy: Joystick/Sprung. 4–12. **L** (Level-Design + Physik). Lücke: Party-Standard-Genre „Massenrennen“, Parcours ist runden-/bau-lastig, nicht „Fall Guys“-schnell.

---

## 5. Top-10-Maßnahmen (Wirkung ÷ Aufwand)

**Quick Wins (S = ein Abend):**
1. **Zentrales SFX-System** (`sfx(name)` auf bestehendem Synth `tone/kick/noise`, ~20 Presets) und Aufruf an Treffer/Explosion/Münzen/Countdown/Win-Lose in allen Szenen. *Wirkung: sehr hoch (alle 41 Spiele wirken sofort wertiger), Aufwand S–M.*
2. **Münz-/Punkte-Staffel für große Gruppen:** `PLACE_COINS`/`ARCADE_POINTS` nach Spielerzahl strecken (z. B. 12 Spieler: 12/9/7/5/4/3/2/1 …), Trost-Münze für Letzte, Startspieler im Board rotieren (`turnIdx` Reihenfolge pro Runde rotieren). *Wirkung: hoch (Fairness, jeder gewinnt etwas), Aufwand S.*
3. **Einheitliche Reconnect-Gnadenfrist** (5–8 s im `Room`, bevor `playerDisconnected` ans Spiel geht; Arena darf nicht sofort `kill`). *Wirkung: hoch bei iPhone-Sperrung, Aufwand S.*
4. **Spielzeiten für Party-Modus kürzen:** TTT `ROUND_MS` 180→100 s, Golf 7→5 Bahnen, Igel `SUDDEN_MS` 5→3 min, Parcours `ROUNDS` 6→4. Per `partyOverrides` in Konstanten. *Wirkung: mittel–hoch (Pacing), Aufwand S.*
5. **Ganzzahliges Skalieren + `roundPixels`** (`main.ts`: FIT → gerundeter Zoom). *Wirkung: mittel (schärferes Bild), Aufwand S.*
6. **Sprint-Reaktion serverseitig messen** + Fairness-Check. *Wirkung: klein–mittel, Aufwand S.*
7. **Ausgeschiedenen-Aufgabe:** Handy-Screen „Anfeuern/Wetten“ für Tote in Arena/TTT/Bogen/Sumo/Smash/Igel (Wette auf den Sieger = Bonuspunkte). *Wirkung: hoch (Wartezeit weg), Aufwand M.*

**Strukturelle Umbauten:**
8. **Juice-Framework:** `fx.burst()` (Phaser-Emitter), Hitstop/Slow-Mo-Helfer, Kamera-Fokus, Sprecher-Ansagen (SpeechSynthesis). *Wirkung: sehr hoch, Aufwand M (Wochenende).*
9. **Igel-Krieg → Worms-Upgrade:** 5–6 Waffen (Schrotflinte, Ninjaseil, Banane, Mine, Luftschlag), Waffenkisten, Teams (2 Teams bei > 6 Spielern), Kamera-Folgen, 2–3 Karten. *Wirkung: hoch (Marlons Wunsch „Worms“), Aufwand M–L.*
10. **Board 2.0 + Onboarding:** Items/Gabelungen/Comeback-Mechanik, Demo-Piktogramme pro Minispiel, einmalige Regel-Merkliste („schon erklärt“). *Wirkung: hoch (Party-Kernschleife), Aufwand L (mehrere Wochenenden).* Dazu Client-Vorhersage (Muster `stepKart`) für Smash/Parcours/Bogen und Querformat-Layouts für Smash/Bogen/Arena/TTT/Igel.
