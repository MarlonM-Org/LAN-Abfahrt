# Review LAN-Abfahrt: Spiel-Experience

**Gutachter:** Claude Opus / Effort hoch

Stand: Repo `main` @ `047b102` (PR #25), gelesen am 05.11.2026.

**Was ich wirklich angeschaut habe**
- **Vollständig gelesen:** `README.md`, `ROADMAP.md`, `docs/status.json`, `shared/games.ts`, `server/minigame.ts`, `server/room.ts`, `server/board.ts`, `server/leaderboard.ts`, `server/igel.ts`, `shared/igel.ts` (Konstanten und Terrain), `client/host/IgelScene.ts`, `client/controller/screens/igel.ts`, `client/host/ResultsScene.ts`, `client/host/BoardScene.ts`, `client/host/ui.ts`, `client/host/textures.ts`, `client/host/main.ts`, `client/controller/core.ts`, `client/controller/motion.ts`.
- **In großen Teilen gelesen:** `shared/types.ts` (Zustände, `GameState`, `MiniSnapshot`), `client/controller/style.css` (Querformat-Blöcke), `client/controller/throwInput.ts`, `client/controller/main.ts` (Verbindung und Reconnect), `server/murder.ts`, `server/ttt.ts` (Rundenablauf), `client/host/TttScene.ts` (Figuren, Angriffe), `client/host/WerwolfScene.ts`.
- **Gezielt gelesen (Konstanten, Ablauf, Wertung, Intro, Effekte, Handy-Layout):** smash, kart, arena, parcours, kurve, grill, golf, flieger, sumo, bogen, autoball und werwolf, jeweils Server, Scene und Screen. Dazu Murder- und TTT-Screens.
- **Nur Kopfkommentar, Konstanten und Wertung:** alle übrigen Server-Dateien (flunky, sprint, wwe, descent, rhythm, wrap, stars, drinkgames, controllergames, bowling, enten, verstecken, turm, wasser, stillepost, fangen, geist, boule, volley, tourist, sprueche, pixel, darts).
- **Querschnitt per grep über alle 37 Scenes:** Screenshake, Tweens, Partikel, Kamera und Sound. Über alle Screens: `navigator.vibrate`.

> Zur Zählung: `MINI_INFO` hat **41** Einträge, nicht 42. Als Nummer 42 bewerte ich das **Spielbrett** (Party-Modus), weil es das Meta-Spiel um alles herum ist.

---

## 1. Gesamteindruck

Die größte Stärke ist die Plattform, nicht ein einzelnes Spiel. Server-autoritativ, ein Raum, Reconnect über `playerId` im `localStorage`, VIP-Gnadenfrist (`VIP_GRACE_MS = 60 s`), Auto-Weiter ohne Menschen, Bots für jedes Spiel und ein durchgehender Pixel-Stil mit den eigenen Avataren. Dazu 41 Spiele, die fast alle bis 12 Spieler laufen. So eine Plattform haben die meisten Hobby-Projekte nicht. Gut gewählt ist das Muster „alle gleichzeitig“ bei Darts, Minigolf, Ententeich, Kurve und Pixel-Galerie. Genau dort fühlt es sich wie ein echtes Party-Spiel an.

Das größte Problem ist **Breite statt Tiefe und Feedback**. Der TV ist **fast stumm**. Es gibt einen `fxBus` im Synth (`client/music/player.ts`), aber außer der Pfeife in `VersteckScene.ts` und dem Metronom spielt keine Szene einen Soundeffekt ab. Kein „BUMM“, kein Münz-Pling, kein Countdown-Piep. iPhones vibrieren nicht (`navigator.vibrate` gibt es dort nicht), und Marlons Gruppe nutzt iPhones. Für diese Spieler gibt es also **nur visuelles Feedback**, und das besteht aus von Hand getweenten Rechtecken. In keiner einzigen Szene gibt es einen Phaser-Partikel-Emitter, es gibt keinen Hitstop und, außer in Smash, keine Kamera-Arbeit.

Das zweite große Problem ist **Pacing bei vielen Spielern**. Spiele mit Zugreihenfolge sind auf 2 bis 4 Spieler gebaut, sind aber für 12 freigegeben: Igel-Krieg, Bowling, das Spielbrett und Flunkyball. Bei 12 Spielern sitzt jeder die meiste Zeit untätig daneben.

Das dritte Problem ist der **Party-Modus**: Er ist ein reiner Zufallsweg ohne eine einzige Entscheidung.

Wer zuerst Sound, einen gemeinsamen „Juice“-Baukasten, eine einheitliche Anleitung mit „Bereit“ und ein besseres Party-Brett baut, holt mehr Spaß heraus als mit den nächsten fünf neuen Spielen.

---

## 2. Spiel für Spiel

Legende: **Spaß** = Party-Spaß 1–5 (Gruppe mit 6–12 Leuten, gemischt erfahren). **Gesehen**: V = Server, Scene und Screen gelesen. T = teilweise (Konstanten, Ablauf, Effekte). K = nur Konstanten und Wertung.

### Action und Arena

| # | Spiel | Spaß | Stärke | Schwäche | 1 konkreter Vorschlag | Gesehen |
|---|---|---|---|---|---|---|
| 1 | 🌀 **Kurven-Duell** (`kurve`) | **4** | Perfekt für 12: nur LINKS/RECHTS. Kurze Runden (`ROUND_MAX_MS 55 s`, Sturm ab 25 s). Gut: „Du bist **Rot**“ farbig auf dem Handy | Wer raus ist, wartet bis zu 55 s. Power-ups sind nur 3 und ziemlich brav | Power-up „Spiegel“ (Steuerung der anderen 3 s vertauscht) und „Radiergummi“ (löscht alle Spuren). Der Rundensieger bekommt eine Zeitlupe des letzten Crashs | T |
| 2 | 💣 **Bomben-Arena** (`arena`) | **4** | Klassiker, sauberes Raster (`TILE 18`, 25 × 13), die Flut nach 60 s erzwingt das Ende, Spawn-Clearing auch für 12 | Wer nass ist, liest nur „PLATSCH! Zuschauen …“ (`controller.ts`). Bei 12 Spielern ist man oft nach 10 s raus und wartet bis zu 60 s | **Rache-Möwen**: Ausgeschiedene fliegen am Rand entlang und werfen alle 4 s eine Kokosnuss ins Feld (wie die Rache-Karren in Super Bomberman). Wer damit trifft, ist wieder drin | T |
| 3 | 🤼 **Sumo-Steg** (`sumo`) | **4** | Sofort verständlich, `ROUND_MS 45 s`, der Steg bricht weg, Frontal-Rempler-Bonus. Mit 3 Shakes der meiste Juice nach Smash | Nach dem Platsch nur „zuschauen“. Ab 8 Spielern ist die Mitte ein Gewusel ohne Lesbarkeit | Wer im Wasser ist, steuert eine **Welle** (Joystick) und darf 1× pro Runde eine Planke anknacksen | T |
| 4 | 🏹 **Bogen-Arena** (`bogen`) | **4** | TowerFall-Kern gut getroffen: ein Treffer, Pfeile aufsammeln, Wrap-around, Dash fängt Pfeile. `maxPlayers: 8` ist ehrlich | Zielen in 8 Richtungen per Touch-Stick bei 20 Hz Tick (`TICK_MS 50`). Ohne Zeitlupe beim letzten Treffer verpufft der Höhepunkt. Bis zu 6 Runden à 50 s | **Letzter Pfeil der Runde in Zeitlupe** (`this.time.timeScale = 0.3` für 600 ms, Kamera-Zoom auf Ziel) – das Markenzeichen von TowerFall | T |
| 5 | 🥊 **Smash-Arena** (`smash`) | **3** | Technisch das ambitionierteste Spiel: Prozente, Schild, Spezialangriffe, als Einziges mit dynamischer Kamera und Flash beim KO | Prügeln per Touch mit 4 Knöpfen plus Stick ist für Gelegenheitsspieler zäh. Kein Hitstop. Freigegeben für 12 (`MINI_INFO` ohne `maxPlayers`, die README sagt einmal 2–8 und einmal 2–12) auf einer 280 px breiten Hauptplattform | `maxPlayers: 8`, ab 7 Spielern **2-gegen-2-Teams**. Bei Treffern mit hohem Rückstoß 60–120 ms **Hitstop** (Server friert beide Kämpfer ein, TV skaliert sie kurz auf 1,15) | T |
| 6 | 💦 **Wasserbomben-Schlacht** (`wasser`) | **3** | Teams, Nachladen am Eimer und Schlauch, Wasserpistole als Event | Zwei-Stick-Steuerung am Handy ist die schwierigste Eingabe im Portfolio. Fehlt in der README | Zielen automatisieren: Wurf geht auf den nächsten Gegner in Blickrichtung. Am Handy bleibt dann nur Laufen und Werfen | K |
| 7 | 🏎️ **Kart-Rennen** (`kart`) | **4** | Mode-7 mit Vorhersage am Handy (`world.predict`), Drift mit Mini-Turbo, Items nach Platzierung (Möwe für die Letzten), „So fährst du“-Overlay | Komplex für Neue (TV/Handy-Pille, Drift über GAS). Wer mit Handy-Ansicht fährt, schaut nicht mehr auf den TV, das Gemeinschaftsgefühl geht verloren. `COUNTDOWN_MS 8000` | Fertige Fahrer werden **Tribünen-Zuschauer** und dürfen 2 Bananen auf die Strecke werfen. Das „Nochmal als Grand Prix“ aus `inProgress` schnell fertig machen | T |
| 8 | ⚽ **Auto-Fußball** (`autoball`) | **4** | Konfetti beim Tor, Golden Goal, Tore wachsen mit der Teamgröße, kleineres Team lädt schneller Boost (eingebauter Ausgleich) | Draufsicht mit 12 Mini-Karts: Wer bin ich? 3 min plus 7 s Intro | Eigener Wagen: blinkender Ring in der Handy-Rahmenfarbe. **Tor-Replay** der letzten 3 s in Zeitlupe | T |
| 9 | 🏐 **Strand-Volleyball** (`volley`) | **3** | Bank-Rotation (max. 3 pro Seite) ist eine kluge Lösung für 12 und für ungleiche Teams | Slime-Physik bei 20 Hz plus WLAN fühlt sich schwammig an. Bis 7 mit 2 Vorsprung oder 4 min ist lang | `TARGET 5`, `MATCH_MS 150 s`. Ball-Schatten und ein Aufprall-Marker auf dem Sand für bessere Lesbarkeit | K |
| 10 | 🏁 **Fallen-Parcours** (`parcours`) | **4** | Starkes Konzept mit Selbstregulierung („zu leicht“ und „zu schwer“ bringen keine Punkte). Coyote-Time und Sprungpuffer vorhanden | `RUN_MS 25 s` war laut Feedback zu kurz (Fix läuft). Bauphase nur hochkant. Platzieren per Joystick ist fummelig | Platzieren direkt auf einer **Mini-Karte am Handy** antippen und ziehen, statt den Cursor mit dem Joystick zu schieben | T |
| 11 | 🗼 **Wackelturm** (`turm`) | **3** | Echte matter-js-Physik auf dem Server, Windböe gegen den Führenden | Mit 12 Spielern 2 Reihen à 6 Bahnen, ein Block ist auf dem TV nur ca. 4 px groß. Heranschieben klappt nicht (Feedback, Fix läuft) | Die **eigene Bahn groß am Handy** zeigen (privater Bildschirm). Der TV ist dann nur die Übersicht | K |
| 12 | 🦔 **Igel-Krieg** (`igel`) | **3** (bei 2–4 Spielern 4, bei 8+ Spielern 2) | Zerstörbares Terrain, effizient übertragen (Seed plus Kraterliste), Wind, Rückzug, Fallschaden, Minikarte für Zuschauer | Bei 12 Spielern rund 20 s pro Zug, also wartet jeder ca. 4 min. Nach 8 min ist Schluss, eine Bazooka macht max. 45 von 100 HP. Ergebnis: fast jede große Runde endet am Zeitlimit. Nur 4 Waffen | Siehe Abschnitt 4a. Kurz: **Team-Modus ab 5 Spielern** und **Simultan-Zielen** | **V** |
| 13 | 🏖️ **Liegestuhl-Sprint** (`sprint`) | **2** | 30-Sekunden-Lückenfüller, Fehlstart-Regel | Nur 3 Runden Reaktionstest. Die Zeit misst das Handy selbst (`p.ms` aus dem Payload) | **Fake-Signale** (Möwe, Wolke) als Fehlstart-Fallen. Ideal als Duell-Feld auf dem Brett | K |
| 14 | 🍺 **Flunkyball** (`flunky`) | **3** | Trinkritual der Gruppe, Teams, Wind | „Trinken“ und „Laufen“ sind Tipp-Spam (`RUN_TAPS 24`), immer wirft nur einer | Laufen als **Rhythmus-Tippen** (Takt halten statt hämmern). Optionaler **Echt-trinken-Modus**: Das gegnerische Team bestätigt „ausgetrunken“ | K |

### Zielen, Werfen, Sport

| # | Spiel | Spaß | Stärke | Schwäche | 1 konkreter Vorschlag | Gesehen |
|---|---|---|---|---|---|---|
| 15 | 🦆 **Ententeich** (`enten`) | **5** | Bestes Handy-Gefühl im Portfolio (Feedback: „sehr cool“). Alle gleichzeitig, Combo-Bonus, Badegäste geben Minuspunkte, Lag-Ausgleich `LAG_MS 220` | Mit 3 Wellen in ca. 80 s fast zu kurz | Vierte Welle als **Boss**: Riesen-Möwe mit Lebensbalken, alle müssen gemeinsam treffen. Treffer bekommt, wer den letzten Schuss setzt | K |
| 16 | 🎯 **Darts** (`darts`) | **4** | Alle werfen gleichzeitig, „Höchste Punktzahl“ statt 301, letzte Runde zählt doppelt, Wackel-Fadenkreuz | `INTRO_MS 8 s` | Treffer-Callouts **mit Stimme** („TRIPLE ZWANZIG!“, Web Speech API) | K |
| 17 | ⛳ **Minigolf** (`golf`) | **4** | Alle gleichzeitig, Schleuder-Steuerung intuitiv, ehrliche Länge (deshalb nicht auf dem Brett) | Bälle stoßen bewusst nicht zusammen, das kostet Schadenfreude. Pro Loch max. 60 s | **Chaos-Loch** als 7. Bahn: Bälle kollidieren, jeder darf 1× „Windstoß“ auf einen anderen Ball | T |
| 18 | 🎳 **Strand-Bowling** (`bowling`) | **3** | Schwung per Sensor, Wischen als Fallback, verkürzte Frames je nach Spielerzahl | Reihum: Bei 12 Spielern ca. 6 min, aktiv ist man vielleicht 30 s. `BowlingScene` mit nur 2 Tweens, ein Strike wirkt zu wenig | **2–4 Bahnen nebeneinander** und alle werfen gleichzeitig (wie Darts). Strike: Kegel-Partikel, Shake, Jubel-Sound | K |
| 19 | 🥥 **Boule** (`boule`) | **3** | Gute Regelumsetzung, Team-Modus ab 5 | Gleiches Warteproblem wie Bowling, langsam (`AIM_MS 25 s`) | Bei Teams wirft das Team **gleichzeitig**: alle Kugeln einer Seite fliegen nacheinander in einer Animation | K |

### Gemeinsam (Koop)

| # | Spiel | Spaß | Stärke | Schwäche | 1 konkreter Vorschlag | Gesehen |
|---|---|---|---|---|---|---|
| 20 | ✈️ **Urlaubsflieger** (`flieger`) | **5** | Spaceteam-Prinzip ist der stärkste Handy-Mechanismus: privater Bildschirm, Rufen, Chaos. 76 alberne Namen, Schwierigkeit skaliert mit Spielerzahl (`fliegerTarget`) | **Ob man abstürzt oder in Bali landet, ist für die Belohnung egal**: `end()` ruft in beiden Fällen `groupByScore` ohne `coins`-Override auf. Im Party-Modus zählt also nur, wer am meisten Knöpfe gedrückt hat | `coins` nach Ziel: Bali 8 für alle, je Etappe weniger, Absturz 1. Plus +2 für den MVP. Bei Absturz am TV „Notlandung auf …“ mit Zeitlupe | T |
| 21 | 🔥 **Grill-Chaos** (`grill`) | **4** | Overcooked passt gut zu Stick plus 2 Knöpfen, Sterne-Ziel, ab 7 Spielern Team-Duell in gespiegelten Küchen | Regeln in 4 s Countdown (`COUNTDOWN_MS 4000`) mit 4 Zeilen Text. Gemeinsames Kochen wird trotzdem nach **individuellem Beitrag** gewertet (`groupByScore(... contrib)`), das lädt zum Klauen von Aufgaben ein | Die erste Bestellung als **geführtes Tutorial** (Pfeile auf Kiste, Brett, Grill). Koop-Münzen nach Sternen für alle gleich, Beitrag nur als Anzeige | T |
| 22 | 🧺 **Aufräumen!** (`tidy`) | **2** | Einfach, 60 s | Kaum Tiefe, Schieben mit 26 Items ist beliebig | Ausmustern oder als „Umzugschaos“-Prototyp ausbauen (siehe Warteschlange) | K |
| 23 | 🏄 **SUP-Rennen** (`sup`) | **3** | Lustige Abhängigkeit zu zweit, „einer links, einer rechts“ | Zufällige Paare, bei ungerader Zahl unrund | Paare **gegengeschlechtlich oder nach Wahl in der Lobby**, Rempeln zwischen Boards | K |

### Geheime Rollen und asymmetrisch

| # | Spiel | Spaß | Stärke | Schwäche | 1 konkreter Vorschlag | Gesehen |
|---|---|---|---|---|---|---|
| 24 | 🐺 **Werwölfe** (`werwolf`) | **4** | Sehr gut durchdacht: Nachts tippen **alle** (Verdacht, Schäfchen zählen), so verrät niemand seine Rolle durch Tippen. Tote sehen alle Rollen | Lang: ein Zyklus ca. 35 + 15 + 9 + 120–180 + 30 + 9 s, also **12–18 min** pro Spiel. Der TV zeigt Text-Panels ohne Erzähler | **Sprecher per `speechSynthesis`** (deutsche Stimme): „Das Dorf schläft ein …“. Das allein macht den Spielleiter-Ersatz glaubwürdig | T |
| 25 | 🔪 **Mord im Ferienhaus** (`murder`) | **3** | Geheime Rollen auf dem Handy, Tote machen als Geist weiter Aufgaben (gut für Ausgeschiedene) | Aufgaben sind **15× Tippen** (`TASK_TAPS 15`), also reines Hämmern. Der TV zeigt nur Raum-Zähler. Spielerisch ist es ein Menü-Spiel. Als Finale im Party-Modus zu trocken | Je Raum eine echte Mini-Aufgabe (Abwasch = Wischen, Betten = Ecken antippen, Pool = Blätter wegwischen). Am TV ein **Grundriss mit Tür-Geräuschen** | T |
| 26 | 🏊 **Verräter** (`ttt`) | **2** | Shop, Detektiv mit Spurensuche, Fake-Funkspruch: viel Systemtiefe | **Grundproblem: Der gemeinsame TV zeigt alles.** `TttScene.attackFx` zeichnet jeden Poolnudel-Schlag mit Ursprung, über jeder Figur steht ihr Name. Wer angreift, ist sofort für alle enttarnt. Aus der Deduktion wird ein Brawl mit versteckten Teams. Dazu 3 Runden × `ROUND_MS 180 s`, Ausgeknockte warten bis zu 3 min | **Stromausfall-Modus** (Licht-Technik aus `GeistScene` wiederverwenden): Räume ohne Spieler mit Taschenlampe sind dunkel. Angriffe im Dunkeln zeigen nur „BONK!“ ohne Täter. `ROUND_MS` auf 100 s, 2 Runden | T |
| 27 | 🪴 **Versteckspiel mit Möbeln** (`verstecken`) | **4** | Prop Hunt passt hervorragend (Pfeifen für Punkte gegen Risiko). Gefundene werden Zuschauer statt Mitsucher, gut begründet | `HIDE_MS 25 s` plus lange Suche. Gefundene haben nichts zu tun | Gefundene werden **„Möbelrücker“**: einmal pro 20 s ein echtes Möbel verschieben, das verwirrt die Sucher | K |
| 28 | 🕵️ **Urlaubs-Fangen** (`fangen`) | **3** | Asymmetrie mit privater Karte, Warm/Kalt-Ring | `rounds = min(n, MAX_ROUNDS 4)`: Bei 12 Spielern ist nur ein Drittel je Animateur, die Wertung vergleicht aber alle (`WIN_BONUS 20`). Das ist unfair | Bei mehr als 4 Spielern **2 Animateure gleichzeitig**, Punkte nur innerhalb der Rolle vergleichen | K |
| 29 | 👻 **Geisterjagd** (`geist`) | **4** | Luigi's-Mansion-Kern gut übertragen: Licht, Blitz, Erschreckte retten | Gleiches Rollen-Problem wie Fangen: `rounds = min(n, 3)` | Ab 7 Spielern 2 Geister. Vibration ist am iPhone nicht verfügbar, als Ersatz ein **Herzschlag-Ton am Handy** bei Nähe | K |
| 30 | 🧳 **Wer ist der Tourist?** (`tourist`) | **4** | 34 Orte, Ankläger-Bonus, ab 9 Spielern 2 Touristen. Handy sagt „Lena fragt Ben“ | 6–8 min pro Runde, bis 4 Runden. Für stille Gruppen tot | `MAX_ROUNDS 2` als Standard. Bei Stille nach 20 s schlägt der TV eine **Frage-Idee** vor | K |

### Partyklassiker und Kreativ

| # | Spiel | Spaß | Stärke | Schwäche | 1 konkreter Vorschlag | Gesehen |
|---|---|---|---|---|---|---|
| 31 | 🖍️ **Stille Post mit Bildern** (`stillepost`) | **5** | Garantierte Lacher, eigene Startsätze | Bei 12 Spielern 45 + 6 × 70 + 5 × 45 s, also **ca. 11,5 min** malen und schreiben, danach 12 Ketten vorführen | Kettenlänge auf **max. 6 Schritte** begrenzen (die Ketten laufen trotzdem parallel). Vorführung: nur die 6 lustigsten Ketten, vorher per Like gewählt | K |
| 32 | 🗯️ **Sprüche-Duell** (`sprueche`) | **5** | Quiplash 1:1 inklusive ABRÄUMER und Sicherheits-Spruch | Bei 12 Spielern 12 Duelle pro Runde × (20 s Abstimmen + 8 s Auflösung), insgesamt **ca. 15 min** | Ab 9 Spielern nur **Runde 1 und Finale**, oder 2 Duelle gleichzeitig abstimmen lassen | K |
| 33 | 🖼️ **Pixel-Galerie** (`pixel`) | **3** | Vernissage-Inszenierung mit Goldrahmen | 16 × 16 Pixel sind für viele Themen zu grob. 75 s Malzeit ohne Interaktion | **Fälscher-Variante**: Einer bekommt ein anderes Thema und muss es so malen, dass es passt (eingebautes Spyfall-Element) | K |
| 34 | 🗳️ **Wer würde eher …?** (`wwe`) | **4** | Kostet nichts und funktioniert in jeder Gruppe, eigene Fragen | 5 Fragen, danach vorbei. Kein Moment für Rechtfertigung | Nach der Auflösung 10 s **„Verteidigungsrede“**: Der TV zeigt den Gewählten groß mit Countdown | K |
| 35 | 🙊 **Ich hab noch nie …** (`nhie`) | **4** | Trink-Klassiker | Nichts | Passt | K |
| 36 | 🃏 **Höher oder Tiefer** (`hilo`) | **2** | Einfach | Reiner Zufall | Einsatz setzen (1–3 Schlücke), so wird es zur Mutprobe | K |
| 37 | ⏰ **Tick-Tack-Bumm** (`bomb`) | **4** | Laut, chaotisch, analog | Hängt an der Gruppe | Tick-Geräusch am TV, das schneller wird (fehlt komplett, siehe Sound) | K |

### Date Night (im Brett und Arcade mitgenutzt)

| # | Spiel | Spaß | Stärke | Schwäche | 1 konkreter Vorschlag | Gesehen |
|---|---|---|---|---|---|---|
| 38 | ⛰️ **Der Abstieg** (`descent`) | **2** (Brett) / 3 (Date) | Hübsches Date-Kapitel | Steht in `BOARD_KINDS`, ist aber für 2 gebaut. Mit 12 auf dem Brett ist es ein Sprung-Wettrennen ohne Reiz | Aus `BOARD_KINDS` nehmen | K |
| 39 | 💬 **Das erste Gespräch** (`rhythm`) | 3 (Date) | Synchronisation über Server-Uhr, Ton am Handy | Nur Date | ok | K |
| 40 | 🌯 **Wraps** (`wrap`) | **2** | Liebevoll persönlich | Auf dem Brett mit 12 beliebig | Aus `BOARD_KINDS` nehmen | K |
| 41 | ✨ **Sternenhimmel** (`stars`) | 3 (Date) | Ruhig, romantisch | Nur Date | ok | K |

### Meta-Spiel

| # | Spiel | Spaß | Stärke | Schwäche | 1 konkreter Vorschlag | Gesehen |
|---|---|---|---|---|---|---|
| 42 | 🏠 **Spielbrett / Party-Modus** (`board.ts`) | **2** | Robust (Auto-Würfeln nach 45 s, Entfernte werden übersprungen), Cocktails als Ziel | **Null Entscheidungen**: kein Abzweig, keine Items, Cocktail-Kauf automatisch. Ein Ring aus 24 Feldern. Würfeln strikt nacheinander. 7 Ereignisse, alles nur ±Münzen | Siehe 3.6 „Party-Modus 2.0“. Sofort machbar: **alle würfeln gleichzeitig** und **Bonus-Awards am Ende** | **V** |

---

## 3. Querschnitt

### 3.1 Game-Feel / „Juice“

**Befund (grep über alle 37 Scenes):**

| Mittel | Stand |
|---|---|
| **Soundeffekte am TV** | **Praktisch keine.** `client/music/player.ts` hat einen `fxBus` und `setFxVolume`, und das Musikmenü hat sogar einen Effekt-Regler. Aber nur das Metronom nutzt den Bus. Die einzige Szene mit Effekten ist `VersteckScene.ts` (eigener `AudioContext` für die Pfeife). Explosionen in Igel, Tore in Autoball, Strikes, KOs, Münzen, Countdowns: alles stumm. |
| Vibration | Wird in 37 Screen-Dateien genutzt. **Auf iPhones nicht verfügbar** (`navigator.vibrate` fehlt in Safari). Für iPhone-Spieler gibt es am Handy also gar kein haptisches Feedback. |
| Screenshake | In 19 von 37 Szenen. Gut dosiert in Smash (`0.004 + p·0.008`) und Igel (`shake(160, 0.006)`). Fehlt in Kart, Golf, Bowling, Boule, Darts, Werwolf, Ergebnissen und Brett. |
| Partikel | **0 Phaser-Emitter.** Alle „Partikel“ sind einzeln getweente `add.circle`/`add.rectangle`, z. B. `IgelScene.playFx('boom')` mit 5 Puffs und 10 Krümeln. Das sieht ordentlich aus, ist aber pro Szene neu geschrieben, kaum wiederverwendbar und zu sparsam. |
| Hitstop / Zeitlupe | Nirgends (`timeScale` kommt im Host-Code nicht vor). |
| Kamera | Nur Smash zoomt dynamisch (`setZoom(this.cam.z)`). Sonst ist die Welt bei 480 × 270 statisch, Flashes nur in Geist, Drink, Sprint und Murder. |
| Szenenwechsel | Harte Schnitte (`game.scene.stop/start` in `host/main.ts`, keine einzige `fade`-Zeile). |
| Ergebnis-Screen | `ResultsScene.renderList` zeigt alle Zeilen auf einmal ohne Spannung. Animiert sind nur Herzen und Podest. |

**Bewertung:** Es fehlt ein gemeinsamer Baukasten. In `client/host/ui.ts` stehen Text, Panel und Countdown, aber kein `juice.ts`. Deshalb hängt das Spielgefühl davon ab, wie viel Lust beim jeweiligen Spiel übrig war: Smash bekommt 13 Tweens und 4 Shakes, Bowling 2 Tweens.

**Konkret:**
1. `client/host/sfx.ts`: 20 synthetisierte Effekte über den bestehenden `fxBus`, z. B. `boom`, `splash`, `hit`, `ko`, `coin`, `beep`, `go`, `win`, `lose`, `whoosh`, `pop`, `cheer` (Rausch-Burst), `tick`. Da der Synth schon Oszillator und Rauschen kann, ist das ein Abend.
2. `client/host/juice.ts`: `hitstop(ms)`, `shake(p)`, `burst(x, y, palette, n)` (mit einem echten `ParticleEmitter`), `slowmo(ms, scale)`, `popText()`, `zoomPunch()`. Dann in jedem `playFx` 2 bis 3 Zeilen ergänzen.
3. Am Handy: kurzer **Bildschirm-Flash** und ein Ton als Ersatz für Vibration bei Treffern. `client/controller/audio.ts` hat schon `pluck()`, das bisher nur Enten und Date nutzen.

### 3.2 Lesbarkeit auf dem TV mit 12 Spielern

- Avatare sind 16 × 27 px (`AV_W/AV_H`). Bei 1080p (Faktor 4) sind das 64 × 108 echte Pixel, also **groß genug**. Das Problem ist nicht die Größe, sondern die **Unterscheidbarkeit**: `SHIRTS` hat nur **10 Farben** bei bis zu 12 Spielern. Jedes Spiel erfindet seine eigene Farbtabelle (`KURVE.COLORS`, `IGEL_COLORS`, `TURM.COLORS`, `BOGEN_COLORS`, Ersatzfarben in Boule und Darts). Dieselbe Person ist in Kurve „Rot“, in Igel blau und in Bogen orange.
  - **Vorschlag:** pro Abend eine feste **Spielerfarbe** (12 Farben, eindeutig, in der Lobby vergeben), überall gleich: Ring unter der Figur, Namensschild, Rahmenfarbe des Handy-Screens. Mario Party macht genau das.
- Schrift: nur 8, 16 und 24 px „Press Start 2P“. 8 px bei 480er-Auflösung ist am TV gut lesbar. Namen werden aber stark gekürzt (`slice(0, 6)` in TTT, `slice(0, 4)` in der Igel-Leiste ab 5 Teams). Bei „Lena“, „Lea“ und „Leon“ wird es eng.
- Problemfälle: Turm bei 12 (Blöcke ca. 4 px), Autoball und Kart in der Übersicht (12 Mini-Karts), Smash ab 8 (Gewusel auf 280 px).
- Ergebnisse bei 12: `rowH = min(22, floor(164/12)) = 13 px`, die 15 px hohen Porträts überlappen, und `detail.slice(0, 16)` schneidet Infos ab.

### 3.3 Regelerklärung / Onboarding

**Ziel:** Ein Neuer versteht in 10 s, was er tun soll. **Aktuell klappt das in gut der Hälfte der Spiele nicht.**

- Das Brett-Intro (`BoardScene.renderIntro`) zeigt 4 s lang (`INTRO_MS 4000`) Titel und Tagline und dann „Schaut auf eure Handys!“. Kein Wort zur **Steuerung**.
- In den Spielen ist es sehr uneinheitlich:
  - Gut: Kart (Handy-Overlay „So fährst du“ mit Raster), Golf (`INTRO_MS 6500` mit Panel), Parcours (Panel mit 2 Schritten), Autoball (7 s), Darts (8 s), Igel (ausführlicher Handy-Text im Countdown).
  - Dürftig: Arena („Runde 1 – wer zuerst 2 Runden gewinnt!“, der BOMBE-Knopf wird nicht erwähnt), Smash („Hau alle von der Bühne!“ bei 4 Knöpfen und Stick-Richtungen), Sumo und Bogen (3 s Countdown).
  - Zu knapp für die Komplexität: Grill (4 Zeilen in 4 s).
- Es fehlt ein „Bereit“-Check und eine Übungsphase. Wer gerade Getränke holt, verpasst die Regeln.

**Vorschlag:** In `MINI_INFO` die Felder `howTo: [string, string, string]` und `controls: ('stick' | 'tap' | 'swipe' | 'tilt' | 'hold')[]` ergänzen. Ein generischer **Anleitungs-Screen** (TV: 3 Punkte mit Piktogrammen; Handy: dieselben 3 Punkte und ein großer **BEREIT**-Knopf mit „Probier's aus“-Zone) startet, sobald alle bereit sind oder nach 20 s. Beim zweiten Spielen desselben Spiels am Abend nur 5 s. Das ersetzt 41 einzelne Lösungen.

### 3.4 Pacing

Berechnet aus den Konstanten für **12 Spieler**:

| Spiel | Dauer | Leerlauf pro Person | Kommentar |
|---|---|---|---|
| Spielbrett, 1 Runde | ca. 65–75 s Würfeln (12 × [Tap + 900 ms + Ø 3,5 × `STEP_MS 280` + 1800 ms Pause]) + `INTRO_MS 4 s` | **11/12 der Zeit** | Bei 8 Runden ca. 10 min nur Würfeln |
| Igel-Krieg | bis `HARD_CAP_MS 8 min` | ca. 4 min zwischen zwei Zügen | Ca. 2 Züge pro Person, HP 100 gegen max. 45 pro Bazooka: Es entscheidet die Uhr |
| Verräter | 3 × (7 + 180 + 9 s) ≈ 9,8 min (ab 8 Spielern 2 Runden) | Ausgeknockt bis 3 min | `ROUND_MS 180000` ist für ein Party-Minispiel zu lang |
| Werwölfe | 12–18 min | Tote: viele Minuten | Ok als Abend-Event, nicht als Minispiel |
| Sprüche-Duell | ca. 15 min | gering | Ab 9 Spielern zu lang |
| Stille Post | ca. 11,5 min plus Vorführung | gering | Ab 8 Spielern Ketten kürzen |
| Bowling | ca. 6 min | ca. 5,5 min | Reihum ist das Problem |
| Smash | 3 min + 3,5 s | Wer raus ist: bis 2 min | ok bis 8 Spieler |
| Darts / Ententeich / Golf | 4 / 1,5 / 4–7 min | ca. 0 | **Vorbild-Muster** |

**Regeln, die ich festschreiben würde:** Minispiel auf dem Brett höchstens 4 min, Leerlauf pro Spieler höchstens 30 s am Stück. Dafür in `MINI_INFO` ein Feld `boardOk: boolean` oder `estMinutes(n)` ergänzen und in `Board.intro()` filtern. Igel (bis 8 min), Turm, Werwolf und Tourist gehören nicht zufällig aufs Brett, `BOARD_KINDS` enthält aber `igel` und `turm`.

**Was Ausgeschiedene tun:** Fast überall nur ein `message('… zuschauen')`. Rühmliche Ausnahmen sind Mord (Geist macht weiter Aufgaben), Werwolf (Tote sehen alle Rollen), Igel (Minikarte mit HP-Balken) und Geisterjagd (Erschreckte werden gerettet).

**Generischer Fix: Zuschauer-Wetten.** Wer raus ist oder wartet, sieht am Handy „Wer gewinnt die Runde?“ mit Avataren der Überlebenden, richtig getippt gibt +1 Münze oder Punkt. Das braucht pro Spiel nur „wer lebt noch“ und „wer hat die Runde gewonnen“, und beides steht schon in den Snapshots (`alive`, `roundWinner`).

### 3.5 Fairness und Balance

- **Arcade-Punkte** `ARCADE_POINTS = [10, 6, 3, 1]`, unabhängig von Spielerzahl und Dauer:
  - Im 2er-Spiel bekommt der Verlierer 6. Bei 12 Spielern bekommen die Plätze 4 bis 12 je 1.
  - Das Leaderboard **summiert**, wer öfter da ist, steht oben (`Leaderboard.add` zählt nur hoch).
  - Vorschlag: Punkte = `round(10 × (n − Platz) / (n − 1))` und Ranking nach **Schnitt pro Spiel** oder einer einfachen Elo-Wertung. Zusätzlich ein **„Abend-Pokal“** nur für die Sitzung.
- **Party-Münzen** `PLACE_COINS = [10, 6, 3, 1]`: Bei 12 Spielern bekommen 8 Leute pro Minispiel 1 Münze, ein Cocktail kostet 10. Es gibt keinen Aufhol-Mechanismus.
- **Koop-Spiele, die einzeln werten:** Flieger (Ergebnis egal, siehe Tabelle) und Grill (`contrib`). In Arcade zählt `scoreArcade` nur dann als Koop, wenn `groups.length === 1` ist. Flieger und Grill bekommen also 10/6/3/1 nach Beitrag. Das widerspricht der Spielidee.
- **Asymmetrische Rollen** (Fangen `MAX_ROUNDS 4`, Geist `min(n, 3)`): Bei mehr Spielern als Runden ist die Wertung strukturell ungleich.
- **Sprint** misst die Reaktionszeit am Handy (`s.times[id] = p.ms`). Das ist latenzfair, aber nicht server-autoritativ. Unter Freunden ok, die Regel in `CLAUDE.md` bricht es trotzdem.

### 3.6 Meta-Ebene (Party, Arcade, Progression)

**Party-Modus heute:** 24 Felder im Rechteck (`FIELD_POS`), Feldtypen per Modulo (`i % 6 === 3` Ereignis, `i % 5 === 4` rot), ±3 Münzen, 7 Ereignisse, Cocktail-Bar wandert. **Es gibt keine einzige Entscheidung.** Mario Party lebt von Abzweigen, Items, Duellen und Bonus-Sternen.

**Party-Modus 2.0, in Stufen:**
1. **S:** Alle **würfeln gleichzeitig**. Die Bewegungen laufen dann nacheinander im Schnelldurchlauf (`STEP_MS 280 → 160`, Pause `1800 → 700`). Damit spart man ca. 50 s pro Runde.
2. **S:** **Bonus-Awards** vor dem Endstand (je +1 Cocktail): „Minispiel-Star“ (meiste Münzen aus Spielen), „Pechvogel“ (meiste rote Felder), „Wanderer“ (meiste Felder gelaufen). Das ist der dramatischste Moment bei Mario Party und kostet fast nichts.
3. **M:** **Items-Laden** am Handy (Doppelwürfel, Cocktail-Klau, Taxi zur Bar, Sonnencreme-Schild gegen rote Felder) und **2 Abzweige** auf dem Brett.
4. **M:** **Duell-Feld**: Wer auf ein Feld mit einem anderen Spieler kommt, fordert ihn zu einem 20-Sekunden-Duell (Sprint, Wasserpistolen-Duell aus `inProgress`) um 5 Münzen.
5. **M:** **Minispiel-Typen** wie bei Mario Party: Jeder gegen jeden, 2 gegen 2, 1 gegen 3. Die Team-Logik gibt es schon in Flunky, Volley, Autoball, Wasser und Grill.
6. **S:** In den **letzten 2 Runden** zählen Felder doppelt, und der Letzte bekommt ein Gratis-Item.

**Weitere Meta-Ideen, nach Nutzen sortiert:**
- **Sprecher** über Web Speech API (`speechSynthesis`, deutsche Stimme im Browser des Laptops), Aufwand S. „Lena gewinnt!“, „Drei, zwei, eins, LOS!“, Werwolf-Erzähler, Darts-Callouts.
- **Highlights/Replays**, Aufwand M. Der TV puffert die letzten 6 s an Snapshots (er bekommt sie ohnehin) und spielt sie bei KO, Tor oder letztem Treffer in Zeitlupe nochmal ab. Bei Smash, Bogen, Autoball, Igel und Kart ist das reine Clientarbeit.
- **Abend-Statistik**, Aufwand S–M: Auf dem Endbildschirm Kacheln wie „Meiste KOs“, „Längste Siegesserie“, „Lieblingsspiel der Gruppe“. Die Daten liegen größtenteils in `details`.
- **Achievements pro Name**, Aufwand S, in `data/arcade.json`: erster Hole-in-one, Truthahn (3 Strikes), 3 Siege in Folge.
- **Handicap**, Aufwand M: Der Gesamtführende bekommt kleine Nachteile, z. B. Kart-Start hinten, Smash +20 %, 1 Pfeil weniger in Bogen.
- **Turnier und Playlists**, Aufwand M: „Sportabend“ (Darts, Golf, Bowling, Boule) oder „Arena-Cup“ als feste Folge mit Gesamtwertung.
- **Spieler-Sonderfähigkeiten** pro Avatar (aus der ROADMAP): erst nach den obigen Punkten, sonst wird die Balance zu teuer.

### 3.7 Handy-Eingaben

- **Latenz:** Die Action-Spiele ticken mit **20 Hz** (`TICK_MS 50` in Smash, Kart, Bogen, Volley, Arena, Sumo und Autoball). `Room.changed()` drosselt zusätzlich auf 40 ms, und die TVs glätten exponentiell (`v.x += (h.x − v.x) * 0.35–0.6` pro Frame). Zusammen mit WLAN und Moonlight-Stream schätze ich die Zeit von Eingabe bis Bild auf **120–200 ms**. Für Kurve, Sumo und Arena reicht das, für Smash, Bogen und Volley ist es spürbar zäh.
- **Bandbreite (konkreter Fund):** Jeder `state`-Broadcast enthält das **komplette Leaderboard inklusive `perGame`** und die Spielerliste. Mit 15 Namen und 30 gespielten Spielen sind das schon **ca. 20 KB pro Nachricht**. Bei bis zu 25 Nachrichten pro Sekunde an 13 Clients kommen **ca. 6 MB/s WLAN-Last** zusammen, nur für eine Tabelle, die sich im Spiel nie ändert. `new Server(httpServer, {…})` in `server/index.ts` hat keine Kompression. Zusätzlich schickt `changed()` bei jedem Flush jedem Spieler ein `private`-Event, auch wenn es `null` ist. **Fix (S):** Leaderboard nur in Lobby und Ergebnissen mitschicken oder als eigenes Event, `private` nur bei Änderung (Hash vergleichen).
- **Joystick:** Es gibt zwei Implementierungen. `controller.ts → joystick()` ist **fest** (`R = 60`, die Mitte ist die Pad-Mitte) und wird in Arena, Sumo, Grill, TTT, Parcours usw. genutzt. `smash.ts → floatingStick()` ist **schwebend** (der Ring folgt dem Daumen) und wird nur in Smash und Bogen genutzt. Der schwebende Stick ist klar besser, weil man nicht hinschauen muss. Er sollte überall Standard sein.
- **Querformat:** Nur Kart, Autoball, Smash und Bogen haben Querformat-Layouts (`@media (orientation: landscape) and (max-height: 520px)`). Alles andere ist hochkant, Parcours laut Feedback zu Unrecht. Innerhalb eines Abends muss man das Handy ständig drehen.
  - **Regel:** Alle Echtzeit-Spiele mit Stick nutzen dasselbe **Querformat-Gamepad** (Stick links, 1–3 Knöpfe rechts). Text- und Menü-Spiele bleiben hochkant. Beim Wechsel zeigt eine einheitliche Animation „Handy drehen“.
- **Fat-Finger:** Die Knöpfe sind groß (`big-btn`, `--bw: clamp(92px, 26vmin, 132px)`). Abstimmungs-Grids schalten ab 9 Spielern auf 3 Spalten (`playerButtons → many`). Hier ist alles gut gelöst.
- **Sensor:** Sauber gekapselt (`motion.ts`: HTTPS-Prüfung, iOS-`requestPermission` aus dem Tap, Wisch-Fallback, gespeicherte Wahl in `throwInput.ts`). Die „Sensor-Rückmeldung“ (in Arbeit) ist richtig priorisiert.

### 3.8 Robustheit

**Stark:**
- Reconnect über `localStorage`-ID.
- `checkConnection()` bei `visibilitychange`, `focus` und `online` mit Ping-Timeout.
- Wake Lock.
- VIP-Nachfolge mit Gnadenfrist.
- Auto-Weiter, wenn nur Bots da sind.
- `playerDisconnected` in den Spielen: Igel kürzt den Zug auf 1,5 s, das Brett würfelt nach 5 s automatisch.
- Entfernte Spieler bleiben bis zur Lobby im Zustand, damit die Szenen nicht stolpern.

**Lücken:**
- **Server-Neustart oder Absturz = alles weg.** `BOOT_ID` lädt die Clients neu, Brett und Münzen sind verloren. Den `Board`-Zustand nach jeder Runde nach `data/party.json` schreiben und „Party fortsetzen?“ anbieten (S).
- **Neue Spieler mitten in der Party:** `player:join` lehnt ab („ab der nächsten Runde dabei“), das Brett nimmt sie aber nie auf (`gameIds()` filtert auf `board.state.order`). Der Neuankömmling sitzt die ganze Party aus. Vorschlag: Er steigt bei der nächsten Brett-Runde mit Münzen auf Median-Niveau ein.
- **Physik-Spiele ticken über `setInterval(50)`** (`Timers.every`). Bei einem GC-Stopp springt die Simulation. Das ist für Golf, Turm und Smash relevant, wo ein fester Takt mit Akkumulator robuster ist (Golf erwähnt „fester Takt“, das sollte für alle gelten).

---

## 3b. 2D-Look

**Wo der Pixel-Look eine Stärke ist:**
- Konsequent prozedural (`client/art/*`, ohne eine einzige Bilddatei) und warm in der Palette.
- Die **eigenen Avatare** tauchen überall auf: Igel mit Frisur, Schwimmring mit Gesicht, Avatar-Köpfe in Autoball. Das ist der emotionale Kern.
- Technische Glanzstücke: Mode-7-Kart, zerstörbare Igel-Insel mit eingemalten Palmen und Kratern, Vernissage mit Goldrahmen.

**Wo er „simpel“ wirkt:**
- **Animation:** Figuren sind ein statisches Bild in einem Container (`textures.ts → figure()`). Bewegung entsteht über Positions-Tweens und `setAngle`. Igel haben 2 Lauf-Frames (`hedgehog(look, frame)` mit `frame` 0/1). Es gibt kein Squash & Stretch und keine Antizipation.
- **Effekte:** Getweente Kreise und Rechtecke (siehe 3.1). Wenig Licht: nur die Geisterjagd hat Lichtkegel.
- **Text-Panels:** Werwolf, Mord, Tourist und Ergebnisse sind Pergament mit 8-px-Text. Funktional, aber es sieht nach Menü aus und nicht nach Show.
- **Bewegung ruckelt:** Die Welt wird in **480 × 270** gerendert und per CSS hochskaliert (`Scale.FIT`, `pixelArt: true`), Positionen werden gerundet (`Math.round(v.x)`). Bei langsamer Bewegung springen Figuren sichtbar pixelweise.
- **Harte Schnitte** zwischen allen Szenen.

**Upgrades nach Wirkung pro Aufwand:**

| Rang | Upgrade | Aufwand | Wirkung |
|---|---|---|---|
| 1 | **Juice-Toolkit mit echten Partikel-Emittern** (Phaser 3.90 `add.particles`), Hitstop, Zeitlupe, Zoom-Punch | S–M | Sehr hoch, alle Action-Spiele profitieren |
| 2 | **Szenenübergänge** (Iris-Wipe in Pixel-Optik, 300 ms) und eine **animierte Ergebnis-Enthüllung** (Plätze von hinten nach vorn, mit Trommelwirbel) | S | Hoch, wirkt sofort „produziert“ |
| 3 | **Squash & Stretch** für `figure()`: `scaleY 1.15/0.85` bei Sprung und Landung, Wackeln beim Laufen. Zentral in `textures.ts`, damit es überall greift | S | Mittel–hoch |
| 4 | **Höhere interne Auflösung**: Spiel-Canvas 960 × 540 (oder 1920 × 1080), Weltkamera mit `setZoom(2)` bzw. `4`, `roundPixels: false`. Pixel-Art bleibt, Bewegung wird subpixel-weich, HUD und Text können in einer eigenen UI-Kamera schärfer sein. Kamera-Zoom und Kamera-Folgen sind dann möglich (Igel: aktiver Igel in Zoom 1,5, Geschoss folgen) | M | Hoch, aber alle Szenen müssen getestet werden |
| 5 | **Parallax** in Seitenansicht-Spielen (Volley, Smash, Bogen, Igel): 2–3 Ebenen Himmel, Meer und Wolken, die sich mit Kamera oder Zeit bewegen | S je Spiel | Mittel |
| 6 | **Licht** über die Phaser-Light2D-Pipeline oder Overlay-Masken für Nachtspiele (Werwolf-Nacht, Geist, Verstecken, TTT-Stromausfall) | M | Mittel–hoch, auch spielmechanisch (TTT) |
| 7 | **Mehr Animations-Frames** für Avatare: 4-Frame-Laufzyklus und Jubel- und Trauer-Pose, prozedural in `drawAvatar` (Bein- und Arm-Offsets) | M | Mittel |
| 8 | **Tag/Nacht auf dem Brett**: Runde 1 morgens, Finale bei Sonnenuntergang (Farbfilter und andere Deko-Sprites) | S–M | Mittel, gibt dem Abend einen Bogen |
| 9 | Post-FX (Bloom auf Explosionen, Vignette in Werwolf/Geist) über `preFX/postFX` in Phaser 3.90 | S | Gering–mittel, Geschmackssache |
| 10 | 2.5D/Isometrie | L | **Nicht lohnend**. Bricht den Stil und alle Kollisionsmodelle |

---

## 4. Neue Spiele

### 4a. Wie wird Igel-Krieg wirklich Worms-würdig?

Heute ist Igel ein solider **Worms-Prototyp für 2–4 Spieler**. Für die Gruppe mit 8–12 Leuten funktioniert er strukturell nicht (siehe 3.4). In dieser Reihenfolge:

1. **Spielerzahl lösen (Pflicht, M).**
   - **Team-Modus ab 5 Spielern:** 2–4 Teams, jeder steuert **seinen eigenen Igel**, die Züge rotieren nach Team (A1, B1, C1, A2 …). Der Team-HP-Balken entscheidet. Die Strukturen dafür gibt es schon (`teams`, `hogPtr`), heute gilt aber `teams = shuffle(ids)` (1 Spieler = 1 Team).
   - **Alternativ oder zusätzlich „Simultan-Runde“:** Alle zielen gleichzeitig 15 s lang am Handy (Waffe, Winkel, Kraft). Dann löst der TV die Schüsse **nacheinander in Initiative-Reihenfolge** auf, je ca. 3 s mit Kamera auf dem Geschoss. Eine Runde mit 12 Spielern dauert so ca. 50 s, und jeder ist **jede Runde** dran. Ein Party-Spiel muss genau das leisten.
   - Dazu `TURN_MS 30 s → 20 s` und ein **Zug-Timer, der beim ersten Laufen erst startet** (wie in Worms: „Bereit?“-Pause).
2. **Kistenabwürfe (S).** Zwischen Zügen schwebt am Sonnenschirm eine Kiste herab: Waffe, +25 HP oder eine Falle (explodiert). Das ist der wichtigste Worms-Rhythmusgeber: Man läuft zur Kiste, statt nur zu schießen.
3. **Waffenarsenal 4 → 10 (M):**

   | Waffe | Funktion | Vorbild |
   |---|---|---|
   | **Möwen-Luftangriff** | Ziel auf der Minikarte antippen | Airstrike |
   | **Krabbe** | läuft selbst, Knopf = explodieren | Schaf |
   | **Strand-Mine** | bleibt liegen | Mine |
   | **Dynamit-Fackel** | fallen lassen, weglaufen | Dynamit |
   | **Wasserpistole** | 2 Schüsse, kein Bogen, Rückstoß | Schrotflinte |
   | **Surfbrett-Brücke** | Planke platzieren | Girder |
   | **Heilige Ananas** | 1× pro Spiel, riesiger Krater, „Halleluja“-Sound | Heilige Handgranate |
   | **Bananen-Schale** | hüpft und zerfällt in 5 | Bananenbombe |

   Für die Wasserbombe: **Zünder 1–5 s** am Handy wählbar.
4. **Bewegung (M).** Echter **Rückwärts-Salto** (Doppeltipp SPRUNG) und ein **Muschel-Seil light**: Ziel antippen, der Igel schwingt einmal am Seil dorthin. Ein freies Ninja-Seil ist mit Touch zu fummelig.
5. **Inszenierung (M).** Kamera folgt dem Geschoss, Zeitlupe bei Treffern, die ein Team auslöschen. Sprechblasen der Igel beim Zug („Für die Strandbar!“) und **Stimmen per `speechSynthesis`** („Autsch!“, „Tschüss!“ beim Ertrinken). In Worms machen die Stimmen die halbe Faszination aus. Sound für Bazooka, Platsch und Flut fehlt bisher komplett.
6. **Karte (S–M).** Die Insel ist mit 480 × 270 sehr knapp für 12 Igel (`spawnSpots` reduziert den Mindestabstand bis auf 0). Besser eine Welt von 720–960 px Breite mit Kamera. Oder bei mehr als 6 Igeln ein Spawn mit Fallschirm in Wellen.
7. **Zielhilfe (S).** Am Handy die ersten ca. 20 % der Flugbahn gestrichelt anzeigen (Party-Kompromiss), Wind als Pfeil direkt im Ziel-Pad.
8. **Ende (S).** Statt `HARD_CAP_MS 8 min` mit HP-Wertung nach 5 min **Sudden Death mit 1 HP für alle**: Dann zählt jeder Treffer, und das Ende ist ein Showdown statt eines Zeitlimits.

### 4b. 10 weitere neue Spielideen

Sortiert nach (Spaß × Passung zum Handy) ÷ Aufwand. Bewusst **keine weitere Arena**: Es gibt schon Arena, Smash, Sumo, Bogen und Wasser, und die Zauber-Arena ist in Arbeit. Die größten Lücken im Portfolio sind **Raten und Erklären**, **Quiz**, **Bluff mit Mechanik** und **WarioWare-Tempo**.

| # | Idee | Mechanik (3 Sätze) | Rolle des Handys | Spieler | Aufwand | Lücke, die es füllt |
|---|---|---|---|---|---|---|
| 1 | **Strandkorb-Scharade** (à la Heads Up / Activity) | Einer hält das Handy an die Stirn oder erklärt, das Handy zeigt **ihm** oder **den anderen** den Begriff. Nach unten kippen = erraten, nach oben = überspringen. 60 s pro Person, Teams sammeln Punkte | Privater Bildschirm und Kippsensor (Wisch-Fallback) | 4–12 | **S** | Ein Erklär- und Ratespiel gibt es nicht. Der lauteste Spaß pro Code-Zeile |
| 2 | **Montagsmaler live** (à la skribbl.io) | Einer malt am Handy, der TV zeigt die Striche **live**, alle anderen tippen Rate-Wörter. Schnelles Raten gibt mehr Punkte, Buchstaben-Hinweise kommen nach und nach. Jeder malt einmal pro Runde | Zeichenfläche (aus Stille Post wiederverwendet) und Tastatur | 3–12 | **S** | Stille Post ist zeitversetzt, hier ist der Echtzeit-Druck der Spaß |
| 3 | **Fake-Fakten** (à la Fibbage) | Der TV zeigt eine echte, absurde Urlaubs-Tatsache mit Lücke. Jeder schreibt eine glaubwürdige Lüge, dann wählen alle die vermeintlich wahre Antwort. Punkte für Treffer und für jeden, der auf die eigene Lüge reinfällt | Tastatur und Abstimmung (Infrastruktur von `sprueche.ts`) | 3–10 | **S–M** | Bluff mit Text; Lügen-Mechanik, die Quiplash nicht hat |
| 4 | **Urlaubs-Wahnsinn** (à la WarioWare) | Folge von 5-Sekunden-Mikrospielen am Handy: „Schüttel die Sonnencreme!“, „Wisch die Möwe weg!“, „Tippe 7×!“, „Kipp das Glas, ohne zu verschütten!“. Alle gleichzeitig, Tempo steigert sich, 3 Leben. Mit dem Gerüst kann man ständig neue Mini-Aufgaben einhängen | Sensor, Touch und Wischen, das ganze Repertoire | 2–12 | **M** (Gerüst), dann S pro Mikrospiel | Ein Spiel mit hektischem, sofortigem Spaß und null Erklärbedarf. Als Bonusrunde auch ideal auf dem Brett |
| 5 | **Wer kennt wen?** (Freundes-Quiz à la Mr. & Mrs.) | Jeder beantwortet vorab am Handy Fragen über sich („Lieblings-Cocktail?“, „Wovor hast du Angst?“). Dann rät die Gruppe pro Person aus 4 Antworten, eine davon echt, drei von Mitspielern geschrieben. Punkte für richtig Raten und für gute Ablenkungen | Privater Bildschirm, Eingabe und Auswahl | 3–12 | **S–M** | Es gibt **kein einziges Quiz**. Persönliche Fragen passen perfekt zu einer Freundesgruppe |
| 6 | **Liegestuhl-Stopp** (Reise nach Jerusalem) | Musik läuft am TV, alle laufen per Stick um die Liegestühle. Stoppt die Musik, muss jeder auf einen Stuhl, es gibt immer einen zu wenig. Runden à 15–25 s, es gibt Fake-Stopps | Stick und 1 Knopf (Hinsetzen) | 3–12 | **S** | Nutzt den Musik-Synth spielerisch, kurz und sehr lesbar |
| 7 | **Kofferbombe entschärfen** (à la Keep Talking and Nobody Explodes) | Einer sieht am **Handy** den Koffer mit Drähten, Symbolen und Knöpfen. Die anderen haben **je eine Seite der Anleitung** auf ihren Handys. Nur durch Reden wird die Bombe entschärft, Fehler kosten Zeit. Der Entschärfer wechselt jede Runde | Privater Bildschirm: verteiltes Wissen | 2–8 | **M** | Flieger ist Chaos, das hier ist echtes Kommunikations-Koop mit Rollen |
| 8 | **Lügen-Muscheln** (Perudo / Liar's Dice) | Jeder hat 5 Muscheln mit verdeckten Augen am Handy. Reihum wird geboten („vier Dreier“) oder „Lüge!“ gerufen. Wer falsch liegt, verliert eine Muschel | Privater Bildschirm und Gebot | 2–8 | **M** | Mechanischer Bluff, Tourist und Werwolf sind reine Rede-Spiele |
| 9 | **Möwen-Flug** (Fallschirm à la Pilotwings) | Alle fliegen gleichzeitig per **Kippen** als Möwe durch Ringe über der Bucht und landen am Ende auf einem Ziel-Handtuch. Punkte für Ringe und Landegenauigkeit. 60 s, Seitenansicht oder Mode-7 aus dem Kart-Code | Kippsensor, Stick als Fallback | 2–12 | **M** | Ein ruhiges „alle gleichzeitig“-Sensorspiel neben den Enten, ohne Kampf |
| 10 | **Flohmarkt-Auktion** | Der TV zeigt absurde Urlaubs-Souvenirs, deren **geheimer Wert** nur einer kennt (privater Tipp) oder der nach dem Kauf aufgedeckt wird. Alle bieten verdeckt Münzen am Handy, Höchstgebot gewinnt. Am Ende zählt das Vermögen. Im Party-Modus eine natürliche Münzsenke | Privates verdecktes Bieten | 3–12 | **S–M** | Bringt Wirtschaft und Entscheidungen auf das zu passive Brett |

**Bewertung der Ideen aus `docs/status.json`:**

| Idee | Status | Bewertung |
|---|---|---|
| **Angeln** | in Arbeit | Gut für den Sensor, Gefahr „jeder für sich“. Unbedingt einen **gemeinsamen Teich mit Wettbewerb** (Fisch klauen, Riesen-Fisch für alle) einbauen |
| **Wasserpistolen-Duell** | in Arbeit | Kurz und dramatisch. **Ideal als Duell-Feld auf dem Brett** (siehe 3.6). Hohe Priorität |
| **Zauber-Arena** | in Arbeit | Die **sechste Arena**. Würde ich nach hinten schieben oder klar abgrenzen: Teams, Fokus auf Zielsuche statt Präzisionszielen |
| **Kings Cup** | in Arbeit | Passt in den Trinkmodus, Aufwand S. Ok |
| **Kofferpacken** | Warteschlange | Physik wie im Wackelturm. Nur als **Koop-Variante** (alle packen ein Auto) sinnvoll, sonst ein Doppel |
| **Süßigkeiten-Klau** | Warteschlange | Das dritte asymmetrische Fangspiel nach Fangen und Geist. Niedrige Priorität |
| **Spion unter Gästen** | Warteschlange | **Stärkste Idee der Liste**: nutzt den privaten Bildschirm einzigartig und skaliert gut auf 12. Hohe Priorität |
| **Umzugschaos** | Warteschlange | Überschneidet sich mit Grill und Aufräumen. Höchstens als Ersatz für `tidy` |
| **Wackel-Prügelei** | Warteschlange | Aufwand L (Ragdoll-Physik über das Netz), überschneidet sich mit Sumo und Smash. Streichen |

---

## 5. Top-10-Maßnahmen

Nach Wirkung ÷ Aufwand. Aufwand: S = ein Abend, M = ein Wochenende, L = mehrere Wochenenden.

### Quick Wins

| # | Maßnahme | Aufwand | Erwartete Wirkung |
|---|---|---|---|
| 1 | **Soundeffekte am TV.** `client/host/sfx.ts` mit ca. 20 synthetisierten Effekten über den vorhandenen `fxBus`, in alle `playFx`/`onPhase`-Stellen einhängen (Explosion, Platsch, Treffer, KO, Münze, Countdown-Piep, LOS, Sieg-Jingle, Tor, Strike). Dazu Ton und Flash am Handy als Ersatz für Vibration auf iPhones | S–M | **Sehr hoch.** Der größte einzelne Hebel fürs Spielgefühl, besonders für die Leute auf dem Sofa |
| 2 | **Netzlast senken.** `leaderboard` aus dem 25-Hz-`state` nehmen (nur in Lobby und Ergebnissen oder als eigenes Event), `private` nur bei Änderung senden, optional `perMessageDeflate` | S | Hoch: weniger WLAN-Stau, flüssigere Action-Spiele mit 12 Handys |
| 3 | **Einheitlicher Anleitungs- und Bereit-Screen.** `howTo` und `controls` in `MINI_INFO`, generischer TV- und Handy-Screen mit BEREIT-Knopf und Übungszone | S–M | Hoch: Neue verstehen jedes Spiel in 10 s, keine verpassten Regeln |
| 4 | **Sprecher per `speechSynthesis`.** Countdown, Sieger, Werwolf- und Mord-Erzähler, Darts-Callouts, Igel-Stimmen | S | Hoch: Show-Gefühl ohne Assets |
| 5 | **Pacing-Leitplanken.** Party-Brett: gleichzeitig würfeln (`STEP_MS 160`, Pause 700 ms). `BOARD_KINDS` ohne Igel, Turm, Descent und Wrap. TTT `ROUND_MS 180 → 100 s`, 2 Runden. `smash.maxPlayers = 8`. Sprüche und Stille Post ab 9 Spielern kürzen. Koop-Münzen für Flieger und Grill nach Ergebnis (`coins`-Override) | S | Hoch: weniger Leerlauf, fairere Belohnung, Party-Abende werden 20–30 % kürzer bei gleichem Spaß |

### Strukturelle Umbauten

| # | Maßnahme | Aufwand | Erwartete Wirkung |
|---|---|---|---|
| 6 | **Juice-Toolkit und Szenenübergänge** (`client/host/juice.ts`: Partikel-Emitter, Hitstop, Zeitlupe, Zoom-Punch, Squash & Stretch in `figure()`, Iris-Wipe, animierte Ergebnis-Enthüllung) und dann Szene für Szene einsetzen | M | Sehr hoch. Hebt das Gesamtbild von „Prototyp“ auf „Spiel“ |
| 7 | **Zuschauer-Wetten und Ghost-Rollen.** Generisches Tipp-Spiel für Ausgeschiedene (+1 Münze/Punkt). Dazu spezifische Ghost-Mechaniken für Arena (Rache-Möwen), Sumo (Welle), Verstecken (Möbelrücker) und Kart (Tribünen-Bananen) | M | Hoch: Ausscheiden fühlt sich nicht mehr wie Strafe an |
| 8 | **Party-Modus 2.0.** Bonus-Awards (S, zuerst), Duell-Felder mit Wasserpistolen-Duell und Sprint, Items-Laden, 2 Abzweige, Team-Minispiele 2v2 und 1v3, Party-Zustand in `data/party.json` speichern | M–L | Hoch: Der Modus, den Marlon als Standard vorsieht, bekommt echte Entscheidungen und Drama |
| 9 | **Igel-Krieg auf Worms-Niveau** (siehe 4a): Team- und Simultan-Modus, Kisten, 6 neue Waffen, Kamera, Stimmen | M–L | Mittel–hoch: Aus einem 2–4-Spieler-Spiel wird ein Abend-Highlight für 12 |
| 10 | **Render- und Netcode-Upgrade für Action-Spiele.** Interne Auflösung 960 × 540 mit Kamera-Zoom (subpixel-weiche Bewegung, Kamera-Folgen). Server-Tick 20 → 30–60 Hz für Smash, Bogen und Volley. Interpolation auf dem TV mit Server-Zeitstempeln statt exponentiellem Glätten. Einheitliches Querformat-Gamepad mit schwebendem Stick | M–L | Mittel–hoch: präziser, flüssiger, weniger „schwammig“. Erst nach 1 bis 6 angehen |

**Reihenfolge-Empfehlung:** 2 → 1 → 5 → 3 → 4 an zwei Abenden. Danach 6 am Wochenende, dann 8 (Bonus-Awards und gleichzeitiges Würfeln sofort, der Rest später). Neue Spiele erst danach, und dann zuerst **Scharade**, **Montagsmaler live** und **Spion unter Gästen**.

---

### Anhang: Kleinere Funde

- `shared/types.ts`: Die Union `MiniKind` wiederholt `'sup' | 'tidy'` achtmal (Merge-Reste). Harmlos, aber unschön.
- `README.md` führt **Smash-Arena zweimal** mit widersprüchlicher Spielerzahl (2–8 und 2–12). **Geisterjagd** und **Wasserbomben-Schlacht** fehlen in der Spieleliste.
- `PARTY_KINDS` (Einzelspiel-Liste in `screens/lobby.ts`), `BOARD_KINDS`, `ARCADE_RANDOM` und `ARCADE_GROUPS` sind vier handgepflegte Listen derselben 41 Spiele. Neue Spiele landen leicht in einer und fehlen in einer anderen (z. B. fehlen `tourist`, `sprueche` und `werwolf` absichtlich oder unabsichtlich in `ARCADE_RANDOM`). Besser als Flags in `MINI_INFO` (`board`, `random`, `group`).
- `ResultsScene.renderList`: Bei 12 Zeilen ist `rowH = 13 px` kleiner als die Porträthöhe (15 px), die Porträts überlappen. Ab 9 Spielern zweispaltig rendern wie in `BoardScene.renderScores`.
