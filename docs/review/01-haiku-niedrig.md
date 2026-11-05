**Gutachter:** Claude Haiku / Effort niedrig

# Review: LAN-Abfahrt – Bauchgefühl-Check

Hinweis zur Tiefe: Gelesen wurden README.md, ROADMAP.md, docs/status.json, shared/games.ts (vollständig) sowie Teilbereiche von server/igel.ts (1–150), server/smash.ts (1–120), server/kurve.ts (1–120), server/room.ts (1–120), server/board.ts (1–100) und server/murder.ts (1–80). Scenes (`client/host/*`) und Handy-Screens (`client/controller/screens/*`) wurden **nicht** geöffnet, die Bewertungen dort beruhen auf README und Server. Die Spaß-Werte sind Bauchgefühl.

**Zählung:** `MINI_INFO` in `shared/games.ts` enthält **41** Spiele, nicht 42 wie im Briefing. Die Liste unten hat 41 Zeilen.

## 1. Gesamteindruck

Die Architektur ist sauber: Der Server ist autoritativ, geheime Infos gehen nur per `privateFor()`, und das Igel-Terrain wird als Seed plus Kraterliste übertragen statt als Bitmaske, was Bandbreite spart. Die Vielfalt ist beachtlich: vier Modi, 41 Spiele, Sensor-, Touch-, Joystick- und geheime-Rollen-Spiele, dazu Musikwerkstatt. Die Spiele sind konsistent verdrahtet (Ergebnis über `ctx.finish`, Bots pro Spiel).

Das größte Problem ist die Breite statt Tiefe. 41 Spiele mit je eigenem Eingabeschema und eigener Regelerklärung überfordern neue Mitspieler, und die README ist eine Wand aus Fließtext mit Duplikaten. Hinzu kommt: Die Balance lässt sich nur mit Bots und Gruppentests prüfen, und der Party-Modus wirkt dünn (24 Felder, linearer Münzfluss, keine Items). Die Dokumente widersprechen sich teils (siehe Querschnitt).

## 2. Spiel für Spiel

Format: Spaß 1–5 · Stärke · Schwäche · Verbesserung. Gesichtet = Serverdatei angeschaut (Teil).

**Action**
- **flunky** Flunkyball · Spaß 4 · Klassiker, Wischen mit Wind · Wenig Tiefe, Tippen zum Trinken wirkt als Nebenmechanik · Wind sichtbar als Pfeil am Handy.
- **sprint** Liegestuhl-Sprint · Spaß 3 · Kurz, reaktionsbasiert, 3 Runden · Rein Glückssache, Fehlstart oft ungerecht · Fehlstart nicht sofort auslösen, sondern Zeitfenster geben.
- **descent** Der Abstieg (Date/Party) · Spaß 3 · Kurze Jump-and-run-Strecke · Nur Date-Night-Variante bekannt · Mehr Hindernis-Varianten.
- **wrap** Wraps mit Sriracha-Mayo · Spaß 3 · Reihenfolge-Logik, klar verständlich · Wenig Anspruch, Zeitdruck fehlt · Steigende Reihenfolgelänge.
- **sup** SUP-Rennen (Gesichtet nicht) · Spaß 4 · Zweier-Koop mit Ungleichgewicht, witzige Physik laut README · Zwei Spieler je Board, Rest schaut zu · Zuschauer-Anzeige mit Wellen-Animation.
- **tidy** Aufräumen! · Spaß 3 · Einfache Joystick-Steuerung, Team-Korb · Eintönig, Items gleichen sich · Mehr Itemtypen mit Sonderwert (Schwer/Leicht).
- **kurve** Kurven-Duell (Gesichtet) · Spaß 5 · Links/Rechts reicht, skaliert auf 12, Runden 5/6/7 je nach Spielerzahl, Sturm-Modus nach 25 s (STORM_MS) · Runde kann bis 55 s dauern (ROUND_MAX_MS), nur 3 Power-up-Typen · Mehr Power-up-Typen oder Lücken-Hinweis für Anfänger.
- **arena** Bomben-Arena · Spaß 4 · Klassiker, 2–12 Spieler, Flut als Timer · Raster-Arena ohne Gegenspielerinnen-Dynamik außer Bomben · Kisten-Respawn gegen Stillstand.
- **kart** Kart-Rennen · Spaß 5 · Vielfalt (Splitscreen/Handy-Ansicht, Drift, Items), Feedback-Fix bereits umgesetzt · Komplexität hoch, Handy-Ansicht pro Spieler braucht Verbindungsstabilität · Ghost-Lauf für Nochmal-Runden.
- **smash** Smash-Arena (Gesichtet) · Spaß 4 · Items, Prozent-System, Schild/Sprung/Spezial · Spezialangriffs-Hitboxen hardcodiert in `server/smash.ts` (SPECIAL_MOVES), nicht in `shared/` · Hitboxen nach `shared/smash.ts`, Frame-Overlay für Balance.
- **parcours** Fallen-Parcours · Spaß 4 · Bauen und Laufen als Doppelphase, Feedback-Fix offen (kein Zeitlimit) · Ein Spieler mit schlechter Falle wird bestraft, Bau-Phase kann dauern · Bau-Timer sichtbar und kurzer Vorschau-Lauf.
- **wasser** Wasserbomben-Schlacht · Spaß 3 · Wurf-Zielen, Nass-Gefühl · Ohne Bewegung wenig Anreiz · Teamwechsel und Deckungskisten.
- **sumo** Sumo-Steg · Spaß 4 · Fallende Planken als Uhr, klare Regel · Rempel-Hitbox in der Sekunde zu präzise? (nicht geprüft) · Warnton und Plankenfarben-Stufen bereits gut, zusätzlich Slow-Mo beim Rauswurf.
- **bogen** Bogen-Arena (Gesichtet nicht) · Spaß 4 · TowerFall-Tiefe mit Wandsprung und Pfeilaufnahme · Pfeil-Aufsammeln verlangt Präzision am Handy · Zielhilfe mit Richtung-Snap, optional.
- **autoball** Auto-Fußball · Spaß 5 · Teamspiel, Boost-Ökonomie, Golden Goal · Handy quer, Kipp-Lenkung nur über HTTPS · Stick-Empfindlichkeit einstellbar machen.
- **volley** Strand-Volleyball · Spaß 4 · Bank-Rotation macht ungleiche Teams fair · Ballphysik schwer zu lesen bei 12 Spielern · Ball-Schatten am Boden.

**Zielen & Werfen**
- **bowling** Strand-Bowling · Spaß 4 · Wii-Gefühl, Strike/Spare · Sensor-Erkennung ohne Feedback (Feedback-Item in Arbeit) · Erkannte Bewegung am Handy anzeigen (läuft).
- **boule** Boule am Strand · Spaß 4 · Schweinchen-Logik, Legen vs. Schießen · Sensor-Feedback fehlt (in Arbeit) · Wie bowling, dazu Mini-Karte mit Kraftanzeige.
- **darts** Darts an der Strandbar · Spaß 4 · Alle gleichzeitig, live-Tafel, keine 301-Sackgasse · Letzte Runde ×2 verzerrt Ergebnis stark · Letzte Runde ×1.5 statt ×2.
- **golf** Urlaubs-Minigolf · Spaß 4 · Alle gleichzeitig, Physik auf Server · Fester Physik-Takt, 6 Löcher ohne Sensor-Alternative bei Ausfall · Hole-Auswahl als Zufallsbahn zusätzlich.
- **enten** Ententeich · Spaß 5 (Feedback: „sehr cool“) · Gyro-Zielen und Wellen steigern sich gut · Fehlschuss-Strafe nur indirekt · Kurze Combo-Anzeige am TV bei Serien.
- **igel** Igel-Krieg (Gesichtet) · Spaß 4 · Worms-Basis: Maske, Krater, Wind, Waffen, Teams, Sudden Death · Keine Kisten-Abwürfe, Ninjaseil nur im ROADMAP, keine Zeitlupe bei Treffern · siehe Abschnitt 4.
- **turm** Wackelturm · Spaß 4 · Echte Physik, Windböen, Leben · Raster- und Lücken-Fix offen, Fall-Hilfslinie fehlt · Nachbar-Anschlag sichtbar machen (in Arbeit).

**Gemeinsam**
- **rhythm** Das erste Gespräch (Date) · Spaß 3 · Tonhöhe/Takt-Musik-Koppelung, Uhr synchronisiert · Nur 2 Spieler, Date-Night-Nische · Mehr Songs aus der Werkstatt einbinden.
- **stars** Tanz unter den Sternen (Date) · Spaß 3 · Sternbilder verbinden, romantisch · Wenig Wiederspielwert · Zufällige Sternbild-Aufgaben.
- **flieger** Urlaubsflieger · Spaß 5 · Spaceteam-Prinzip, geteilte Ansage, Etappen · Schreien funktioniert nur im selben Raum; Anweisung bei anderem Handy · Anzeige „Wer hat die Anweisung?“ am TV.
- **grill** Grill-Chaos · Spaß 4 · Overcooked, Ausgabe und Trinkgeld · 3 Minuten, Kampf um Küche bei 12 Spielern · Küchen-Layouts pro Spielerzahl.

**Geheime Rollen**
- **murder** Mord im Ferienhaus (Gesichtet) · Spaß 4 · 2 Mörder ab 7 Spielern, Raum-Logik, Leichen melden · Zahlen prüfen: 9 Aufgaben × 15 Taps je Person gegen TASKS_MS = 60 s wirkt knapp · Tap-Anzahl pro Aufgabe spielbar auf Spielerzahl skalieren.
- **ttt** Verräter im Ferienhaus · Spaß 4 · Shop, Detektiv, Poolnudel · Sehr viele Rollen-Mechaniken auf einmal · Detektiv-Hinweis kürzer.
- **verstecken** Versteckspiel mit Möbeln · Spaß 4 · Prop Hunt, Verwandlung per Handy · Sucher prüfen blind · Schuss-Anzeige am TV.
- **fangen** Urlaubs-Fangen · Spaß 4 · Unsichtbarer Animateur, Fußspuren · Karte am Handy bei Fänger-Sicht unklar · Warm/kalt-Ring blinkt bei Nähe.
- **geist** Geisterjagd · Spaß 4 · Privater Bildschirm mit Geist · Taschenlampen-Mechanik abgeschwächt im Prototyp · Vibration nur Android (iOS nicht).
- **tourist** Wer ist der Tourist? · Spaß 4 · Spyfall-Logik, 34 Orte · Erfordert 4+ Leute mit Gesprächsbereitschaft · Ortsliste nach Spielerzahl kürzen, Timer-Anzeige.
- **werwolf** Werwölfe im Ferienhaus · Spaß 5 · Klassiker ohne Spielleiter, Hexe und Seherin · Hohe Komplexität, Tag-Diskussion ohne Moderation · Automatische Diskussionsminute mit Timer am TV.

**Partyklassiker / Trink**
- **wwe** Wer würde eher …? · Spaß 4 · Klar, stimmt ab · Weniger Spannung bei Zahl der Runden · Mehrheitsanzeige live am TV.
- **nhie** Ich hab noch nie … · Spaß 4 · Trinkspiel mit Mut · Keine Pacing-Hilfe, Fragen-Pool begrenzt · Eigene Fragen sind bereits drin, Pool-Anzeige fehlt.
- **hilo** Höher oder Tiefer · Spaß 3 · Einfach, schnell · Glückslastig · Mehr Kartenwerte, Serie-Bonus.
- **bomb** Tick-Tack-Bumm · Spaß 4 · Stressige Kategorie-Bombe, Haptik · Pass-Logik am Handy fehlt Feedback-Ton · Zufallsmusik, Tempo-Anzeige.
- **stillepost** Stille Post mit Bildern · Spaß 5 · Gartic-Phone-Kette, Likes · Lange Wartezeit beim Malen · Malzeit kürzen, Vorführung mit Musik.
- **sprueche** Sprüche-Duell · Spaß 5 · Quiplash-Format, ABRÄUMER-Bonus · Ausscheidende warten · Live-Ticker für Zuschauer.
- **pixel** Pixel-Galerie · Spaß 4 · Vernissage, 16×16, verdeckte Abstimmung · 75 s Malzeit ohne Zuschauer-Unterhaltung · Mini-Timelapse am TV.

*Vollständigkeit:* Die 41 Keys verteilen sich auf Action (16), Zielen & Werfen (7), Gemeinsam (4), Geheime Rollen (7) und Partyklassiker (7). Die Kategorien stammen aus `ARCADE_GROUPS` in `shared/games.ts`.

## 3. Querschnitt

- **Game-Feel / Juice:** Ein einheitliches Juice-Modul fehlt. Im Code wirken Treffer-Feedback eher spielspezifisch (Smash `SPECIAL_HITS`, Kurve `deaths`). Ein gemeinsamer Hit-Stop und Screenshake-Helfer würde die Spiele vereinheitlichen. Sound-Cues sind über die Werkstatt-Musik nur grob vorhanden.
- **Lesbarkeit mit 12 Spielern:** Bei Kurve (12 Farben), Ententeich (12 Fadenkreuze) und Golf (12 Bälle) wird es am TV eng. Avatare 16 px sind nicht geprüft, sollten aber auf dem 480×270-Raster gezeigt werden.
- **Onboarding:** 41 Spiele mit je eigener Steuerung sind für Neue nicht in 10 s erklärbar. Eine Regelkarte pro Spiel in der Lobby (Titel, ein Satz, Steuerung) wäre der größte Quick Win.
- **Pacing:** Party-Modus hat Leerlauf beim Würfeln (ROLL_IDLE_MS = 45 s, dann Server würfelt, `server/board.ts`). Ausgeschiedene schauen bei Igel, Smash, Ttt zu, Zuschauer-Ansicht ist nicht gesichtet.
- **Fairness:** `server/board.ts` clampt Münzen auf 0 (`addCoins`), das ist nicht nullsummen-treu. Die Event-Zeile „schmeißt eine Runde“ nutzt Komma-Ausdrücke in `board.ts:33`, schwer lesbar. Hilfsrunden für Schwächere fehlen.
- **Handy-Eingaben:** Sensor-Feedback wird gerade gebaut (richtig, weil Bowling und Boule Rückmeldung brauchen). Kipp-Lenkung hängt an HTTPS, das ist eine Hürde.
- **Robustheit:** Reconnect ist gut gelöst (VIP-Grace 60 s, Offline-Kick 5 min, `server/room.ts`). Laufende Spiele warten nicht auf Abwesende, das ist akzeptabel, aber Ausgeschiedene sehen oft nichts.
- **Konsistenz der Doku:** `README.md` nennt „Smash-Arena“ zweimal (Controller-Spiele). Der Satz „Alle laufen auch im Party-Modus auf dem Spielbrett“ stimmt nicht: `BOARD_KINDS` in `shared/games.ts` enthält `golf`, `werwolf`, `tourist`, `sprueche`, `pixel`, `stillepost`, `verstecken` nicht. Die Lobby listet sie als Einzelspiel (`PARTY_KINDS`).
- **ROADMAP veraltet:** `MAX_PLAYERS = 12` steht schon in `server/room.ts:67`, bleibt aber als offener Punkt stehen. Bowling, Bogen, Smash, Kart, Igel etc. sind ohne Haken gelistet.

## 2b. 2D-Look

- Der Pixel-Look ist eine Stärke bei der Lesbarkeit (klare Silhouetten, 480×270 hochskaliert). Er wirkt simpel bei Animation: prozedurale Sprites ohne Frames, kein Parallax, keine Beleuchtung.
- Realistisch und günstig: Partikel (Pixel-Staub, Wasserspritzer), Tag-/Nacht-Tönung per Overlay, Parallax der Hintergründe. Aufwand S bis M.
- Teurer: 960×540 und Kamera-Zoom (Phaser-Scale, Layout-Umbau), Shader für Wasser (M–L). 2.5D/Iso würde die Grafik komplett neu bauen (L+) – nicht sinnvoll bei 41 Spielen.

## 2c. Meta-Ebene

- Party-Modus: Spielbrett zu simpel. Items auf dem Brett sind im ROADMAP offen. Ereignisse (8 Stück) reichen für Abwechslung nur bedingt.
- Arcade/Leaderboard: Gut (Punkte nach Platzierung, dauerhaft gespeichert). Es fehlen Statistiken pro Spieler (Siege je Spiel).
- Highlights/Replays: Fehlt. Kill-Liste und Ergebnis-Screen sind das Einzige.
- Handicap/Teams: Handicap fehlt, Teams gibt es nur in Spielen mit Teamgröße.
- Spielersonderfähigkeiten: Die Smash-Items und Verräter-Shop sind Ansätze; ein generelles System fehlt.

## 4. Neue Spiele

### (a) Igel-Krieg Worms-würdig machen

Vorhanden: Bitmasken-Terrain mit Kratern, Wind, Bazooka/Granate, Teams, Sudden Death, Sprung-Ballistik.
Fehlt: Ninjaseil (nur im ROADMAP), Wind-Anzeige am Handy, Winkel- und Stärke-Slider mit Wischen, Kisten-Abwürfe mit Waffen, Zeitlupe und Kamera-Fokus bei Treffern, Rundenzeit-Anzeige am TV, Teamnamen und Flaggen.
Vorschlag: zuerst Zielen am Handy klar machen (Winkel mit Wischen, Halten für Stärke, Trajektorie am TV), dann Kisten, dann Ninjaseil.

### (b) Zehn neue Ideen (Spaß × Passung ÷ Aufwand, absteigend)

1. **Elfmeter-Duell** – Schütze wischt den Schuss, Torwart wählt gleichzeitig links/mitte/rechts am Handy (geheim). 2 Spieler, 6 Runden. Rolle Handy: geheime Wahl plus Wischen. Aufwand S. Lücke: Duell mit Ratefaktor, bisher nur Präzision.
2. **Tauziehen** – Team tippt im Rhythmus, Gegner stehen am TV in Reihen. 4–12. Rolle Handy: Tipp-Knopf mit Rhythmus-Feedback. Aufwand S. Lücke: einfacher Teamspaß ohne Zielen.
3. **Pantomime** – Handy zeigt Wort, Spieler macht die Bewegung, Sensor erkennt Schüttel/Kipp-Muster, andere raten am Handy. 3–12. Rolle Handy: Sensor plus Tippen. Aufwand M. Lücke: erster Sensor-Ratespiel.
4. **Sackhüpfen-Rennen** – Handy hochhalten, Hüpfen per Sensor oder Tippen. 2–12. Rolle Handy: Sensor. Aufwand S. Lücke: Party-Sport ohne Zielen.
5. **Mikado am Pool** – Stäbchen per Wischen aus dem Haufen ziehen, matter-js. 2–6, Rolle Handy: Touch. Aufwand M. Lücke: präzise Physik mit Touch.
6. **Quiz-Buzzer** – Fragen am TV, Antworten am Handy, Schnelligkeit zählt. 3–12, Rolle Handy: Buzzer plus Auswahl. Aufwand S. Lücke: reines Wissensspiel.
7. **Foto-Jagd** – Aufgaben („Etwas Blaues!“), Fotos über Handykamera, Abstimmung. 3–12, Rolle Handy: Kamera. Aufwand M. Lücke: Kamera-Nutzung fehlt komplett.
8. **Sonnenschirm-Tower-Defense** – Koop, Handy-Joystick, Wellen. 2–6, Rolle Handy: Joystick. Aufwand L. Lücke: kooperatives Lernspiel.
9. **Sandburg-Bauen** – Gemeinsam Blöcke platzieren per Wisch-Grid, dann Wellen-Test. 2–8, Rolle Handy: Grid. Aufwand M. Lücke: Kreativ-Koop.
10. **Eisdielen-Chaos** – Kunden-Bestellungen mit Gegenstand-Kombinationen, Vorläufer von Grill-Chaos. 2–6, Rolle Handy: Tipp-Menü. Aufwand M. Lücke: Kombinationslogik ohne Hitze.

Angeln, Wasserpistolen, Zauber, Kings Cup, Kofferpacken, Süßigkeiten-Klau, Spion, Umzugschaos, Wackel-Prügelei sind nicht doppelt aufgenommen.

## 5. Top-10 nach Wirkung ÷ Aufwand

**Quick Wins**
1. Regelkarte pro Spiel in der Lobby (Titel, Satz, Steuerung). Aufwand S. Wirkung: größter Hebel für Neue.
2. README bereinigen (Smash-Duplikat, Board-Satz korrigieren) und ROADMAP-Haken setzen. Aufwand S. Wirkung: Doku wieder vertrauenswürdig.
3. Board-Liste klären: `golf`, `pixel`, `werwolf` etc. aufs Brett oder Lobby-Text ändern. Aufwand S. Wirkung: keine Verwirrung im Party-Modus.
4. `addCoins` nullsummen-treu machen und Komma-Zeile in `server/board.ts:33` umschreiben. Aufwand S. Wirkung: Fairness.
5. Sensor-Rückmeldung (in Arbeit) zügig fertigstellen und auf Pantomime und Sackhüpfen vorbereiten. Aufwand S. Wirkung: Sensor-Spiele wirken sofort verständlicher.
6. Tap-Zahlen Mord (`MURDER.TASK_TAPS`) gegen `TASKS_MS` prüfen und auf Spielerzahl skalieren. Aufwand S. Wirkung: Balance.

**Strukturelle Umbauten**
7. Juice-Modul (Hit-Stop, Screenshake, Partikel, Slow-Mo) als geteilter Helfer. Aufwand M. Wirkung: einheitlicher Look und mehr Feedback in allen Spielen.
8. Smash-Hitboxen und Spezialangriffe nach `shared/smash.ts` verschieben, mit Debug-Overlay. Aufwand M. Wirkung: Balance-Iteration schneller.
9. Igel-Worms-Paket (Winkel-Slider, Wind-Anzeige, Kisten, Ninjaseil, Zeitlupe). Aufwand L. Wirkung: größtes Einzel-Highlight.
10. Gemeinsame Handy-Bausteine (Joystick, Sensor-Kalibrierung, Tap-Grid) und Bot-basierte Balance-Simulation für Zahlen. Aufwand L. Wirkung: weniger Duplikate, objektivere Balance.
