**Gutachter:** Claude Opus / Effort sehr hoch (Schwerpunkt: neue Spiele + Technik-Upgrade)

Stand: Repo `main` @ `047b102` (5.11.2026). Schwerpunkt laut Auftrag: Teil 3 (Technik, 2D-Look, Netz) und Teil 4 (Worms, neue Spiele) sehr tief, Teil 2 auf 12 Spiele gekürzt.

**Was ich wirklich angeschaut habe**

- **Vollständig gelesen:** `server/igel.ts`, `shared/igel.ts`, `client/host/IgelScene.ts`, `client/controller/screens/igel.ts`, `client/host/SmashScene.ts`, `client/host/ArenaScene.ts`, `client/host/main.ts`, `client/host/textures.ts`, `client/host/ui.ts`, `client/host/store.ts`, `shared/avatar.ts`, `server/net.ts`, `client/timesync.ts`, `client/controller/core.ts`, `client/controller/motion.ts`, `server/minigame.ts`, `shared/games.ts`, `README.md`, `ROADMAP.md`, `docs/status.json`.
- **In Teilen gelesen:** `server/room.ts` (Verbindung, Reconnect, `startMini`, `finishMini`, `snapshot`, `changed`), `client/kart3d/render.ts` + `world.ts` (Mode 7, Interpolation, Vorhersage), `client/host/KartScene.ts`, `shared/kart.ts`, `shared/smash.ts`, `shared/bogen.ts`, `shared/arena.ts`, `client/host/BogenScene.ts` (`update`), `client/host/TurmScene.ts` (Layout, `update`), `client/host/GeistScene.ts` (Dunkelheit), `client/host/VersteckScene.ts` (Ton), `client/host/BoardScene.ts`, `ResultsScene.ts`, `client/controller/screens/controller.ts` (Joystick, Arena), `client/controller/main.ts` (Render-Schleife, Reconnect, Wake Lock), `client/host/music.ts` + `client/music/player.ts` (Effekt-Bus), `server/board.ts`, `server/arena.ts` (Eingaben), `server/flieger.ts`, `server/enten.ts` (Treffer-Prüfung), `server/rhythm.ts`, `server/kurve.ts` (Farben), `server/leaderboard.ts`, die Konstanten in `shared/{grill,parcours,geist,sprueche,werwolf,verstecken,sumo,fangen}.ts`.
- **Gemessen:** Server lokal auf Port 3099 gestartet, 12 Bots Bomben-Arena, 8 Bots Smash, 8 Bots Kart, dazu ein eigener Socket-Client, der Größe und Takt jedes `state`-Pakets mitschreibt (Zahlen in 3.10).
- **Grep über alle 38 Szenen-Dateien** (`client/host`, 14.200 Zeilen) nach Phaser-Features, Partikeln, Kamera, Ton und kopiertem Code.

---

## 1. Gesamteindruck

Die Architektur ist für ein Hobbyprojekt außergewöhnlich sauber: Der Server entscheidet alles, `shared/` hält Regeln und Geometrie für Server, TV, Handy und Bots, und jedes Spiel lässt sich mit `npm run bots -- 12 --game=…` ohne Freunde testen. Das ist die eigentliche Stärke. Darauf lässt sich alles Weitere bauen, auch Replays, Zuschauer-Wetten und Hit-Stop, ohne an der Spiellogik etwas umzubauen. 42 Spiele mit eigener Pixel-Art, durchgehend gleichem Look und eigenen Avataren sind viel. Kart-Rennen (Vorhersage am Handy, Interpolation, Mode 7 pro Handy) und Ententeich (Treffer-Rückblick `ENTEN.LAG_MS = 220`) zeigen, dass die technische Tiefe da ist, wenn sie gebraucht wird.

**Das größte Problem: Breite statt Tiefe, und das Portfolio hängt schief.** Fast jedes Spiel ist bei „solide 70 %“, aber das letzte Drittel Spielgefühl fehlt überall gleichzeitig:

- Der TV hat **praktisch keine Soundeffekte**. Es gibt einen Regler „Effekte“ im Musikmenü, aber außer dem Rhythmus-Metronom hängt nichts daran.
- Es gibt **keinen einzigen Partikel-Emitter**, keine Animations-Frames für die Avatare und keine gemeinsame Regelerklärung vor dem Spiel.
- 16 der 42 Spiele stehen in der Gruppe „Action“. Viele davon sind Echtzeit-Prügeleien mit Touch-Joystick und 150–300 ms Latenz. Genau dort kann ein Handy am wenigsten.
- Die Genres, die ein Handy als privater Bildschirm ideal kann, fehlen ganz oder sind dünn besetzt: Quiz/Schätzen, Bluff, Live-Malen, Team-Wortspiele, Rhythmus für viele.
- Bei 9–12 Spielern zerfallen die rundenbasierten Spiele in Wartezeit. Igel-Krieg hat bei 12 Spielern rechnerisch nur 1–2 Züge pro Person (siehe 4a).

**Meine Empfehlung:** Die nächsten Wochenenden **nicht** in Spiel Nr. 43–50 im Arena-Genre stecken (Zauber-Arena, Wackel-Prügelei). Stattdessen erst in eine gemeinsame Schicht für Juice, Ton, Interpolation, Zuschauer und Regelkarte, die sofort allen 42 Spielen hilft. Danach 3–4 schnelle Spiele aus den fehlenden Genres bauen.

---

## 2. Spiel für Spiel (12 ausgewählte)

Ausgewählt sind die technisch oder spielerisch interessantesten (Arena, Physik, Netz, geheime Infos). Die Bewertung „Party-Spaß“ gilt für eine typische Gruppe von 6–10 Leuten.

| Spiel | Spaß | Stärke | Schwäche | 1 konkreter Vorschlag |
|---|---|---|---|---|
| 🏎️ **Kart-Rennen** | 4,5 | Beste Netztechnik im Repo: eigenes Kart wird am Handy vorhergesagt (`KartWorld.predict` mit derselben `stepKart`-Physik), andere werden mit 100 ms Puffer interpoliert. Mode 7 läuft auf TV und Handy. | Die Strecken sind so groß wie der Bildschirm (480 × 270, Strandpromenade ≈ 1.000 px Mittellinie). Bei `MAX_SPEED: 88` dauert eine Runde ≈ 12–14 s, das ganze Rennen (3 Runden) ≈ 40 s. Für Items und Überholen bleibt kaum Zeit. Es gibt nur 4 Items. | Strecken auf eine 3× größere Weltkarte (z. B. 1440 × 810 als Mode-7-Boden) bringen. Die TV-Übersicht bekommt dann eine Regie-Kamera (3.6). Dazu 2 neue Items, etwa eine Wasserbombe gegen alle vor dir und eine Sonnenbrille, die die Handy-Ansicht der anderen kurz abdunkelt. |
| 🥊 **Smash-Arena** | 4 | Die Szene mit dem meisten Juice: dynamische Zoom-Kamera (1,0–1,3), K.O.-Lichtstrahl, Flugspur bei Rückstoß, Marker für Spieler außerhalb des Bilds, Treffersterne, Extrapolation über `v × Alter`. | Treffer fühlen sich **gewichtslos** an: kein Hit-Stop (in `server/smash.ts` gibt es keine Trefferpause), kein Ton. Zum Joystick kommen 4 Knöpfe (SCHLAG/SPEZIAL/SPRUNG/SCHILD), für Neue zu viel. 12 Leute auf 2 kleinen Bühnen sind Gewusel. | Hit-Stop serverseitig (40–120 ms je nach Rückstoß, Angreifer und Getroffener frieren ein). Beim letzten K.O. 1 s Zeitlupe plus Zoom, dazu Treffer-Sounds. Ein Schalter „Einfach“ blendet SCHILD aus. |
| 🦔 **Igel-Krieg** | 2–4 | Zerstörbares Pixel-Terrain (Bitmaske 480 × 270). Übertragen werden nur Seed und Kraterliste, das ist elegant. Fallschaden, Wind, Flut als Sudden Death, Minikarte am Handy. | Mit 4 Waffen kein Worms. Keine Kamera. Wind wird jeden Zug neu ausgewürfelt, man kann also nicht dazulernen. Bei 12 Spielern 1–2 Züge pro Person vor dem harten Ende nach 8 min. Details in 4a. | Wind über die Züge driften lassen statt neu würfeln, Zugzeit nach Spielerzahl staffeln, ab 7 Spielern ein Modus „Alle gleichzeitig“ (4a, Stufe M). |
| 💣 **Bomben-Arena** | 4 | Bewährtes Prinzip, funktioniert wirklich mit 12. Die Flut ab 60 s erzwingt ein Ende. Explosionen sind mit Puff, Platsch und Shake ordentlich vertont, nur eben ohne Ton. | Nur 3 Power-ups (`ArenaItem = 'bomb' \| 'range' \| 'speed'`), kein Kicken und kein Werfen. Wer raus ist, starrt den Rest der Runde auf „PLATSCH!“. **Wer kurz die Verbindung verliert, ist sofort tot:** `playerDisconnected` ruft während `play` `this.kill(id)` auf (`server/arena.ts:377`). | „Rache-Möwen“: Ausgeschiedene kreisen am Rand und werfen alle 4 s eine Kokosnuss ins Feld (wie die Rache-Karren bei Super Bomberman). Dazu das Power-up Kicken. |
| 🏹 **Bogen-Arena** | 4 (≤ 8) | TowerFall-Regeln sauber umgesetzt (Pfeil fangen per Dash, Wrap-Around, Kopfsprung). Coyote-Zeit und Sprungpuffer sind da (`COYOTE_MS: 90`, `JUMP_BUFFER_MS: 130`). | Mit dem Touch-Stick in 8 Richtungen sauber zielen ist schwer. Ein Treffer heißt raus, bei 3 Siegen sitzen Neue oft lange draußen. | Zielhilfe für Touch: einrasten auf den nächsten Gegner im Kegel von ±20°. Ausgeschiedene dürfen als Geist 1 Pfeil pro Runde aus dem Dach schießen. |
| 🗼 **Wackelturm** | 3,5 | Echte Physik mit matter-js auf dem Server, Windböen gegen den Führenden. | Laut `layout()` in `TurmScene.ts` werden die Teile schon bei 2 Spielern auf ×0,53 gestaucht, bei 12 Spielern auf ×0,24. Ein 16-px-Block ist dann ≈ 4 Welt-Pixel groß, gedreht und mit Nearest-Filter, das flimmert. Dazu kommt Marlons Feedback (Raster, Reinschieben). | Ab 7 Spielern **Team-Türme**: 2 Leute bauen abwechselnd an einem Turm. Das halbiert die Bahnen und zwingt zum Reden. Die Render-Auflösung aus 3.4 hilft hier am meisten. |
| 🏁 **Fallen-Parcours** | 4 | Das UCH-Prinzip „Punkte nur, wenn nicht alle ankommen“ ist perfekt für Partys. Fallen bringen Punkte. | Bauen per Joystick-Cursor ist langsam (`BUILD_MS: 15000`), dazu das Zeitlimit-Feedback (in Arbeit). | Teile auf einer Minikarte am Handy **antippen und platzieren** wie das Zielen beim Minigolf, statt einen Cursor zu steuern. |
| 🔥 **Grill-Chaos** | 4 | Koop-Chaos. Ab 7 Spielern zwei gespiegelte Küchen gegeneinander. Das Handy zeigt das gehaltene Teil und passende Hinweise. | Die Küche bleibt 3 min (`GRILL.TIME_MS = 180000`) gleich. Bei Overcooked entsteht der Spaß, wenn sich das Layout ändert. | Küchen-Ereignis alle 45 s: Böe weht Teller vom Tresen, Möwe klaut Zutaten, Grill rollt ans andere Ende. |
| ✈️ **Urlaubsflieger** | 4 | Spaceteam passt perfekt zum privaten Bildschirm. Ziel- und Kostenformeln skalieren bis 12 (`fliegerTarget`, `fliegerMissCost`). | Nur Knöpfe, Schalter und Taps (`button/toggle/switch/tap`), keine Körperaktion. Der TV ist passiv. | „Notfall“-Anweisungen mit Sensor: „Turbulenz – ALLE schütteln!“, „Handy umdrehen!“, „Gib dein Handy nach links weiter!“. Der TV wackelt sichtbar mit. |
| 🏊 **Verräter (TTT)** | 4 | Tiefstes Echtzeit-Spiel mit geheimen Rollen: Shop, Detektiv-Spur, Funkspruch. | `TTT.ROUND_MS = 180000` × 2–3 Runden. Wer ausgeknockt ist, schaut bis zu 3 min zu. | Ausgeknockte werden „Hausgeister“: alle 30 s einmal Licht flackern lassen oder eine Tür zuschlagen (Hinweis oder Täuschung, je nach Team). |
| 🗯️ **Sprüche-Duell** | 4,5 (ab 5) | Saubere Quiplash-Kopie mit eigenen Fragen, Sicherheits-Spruch und ABRÄUMER. | Mit 12 Spielern gibt es 12 Duelle pro Runde × (≤ 20 s Abstimmen + 8 s Auflösen). Zwei Runden plus Finale sind ≈ 10–12 min. | Ab 9 Spielern beantwortet jeder nur **eine** Frage pro Runde, dafür treten drei Antworten gegeneinander an (Dreier-Duell). |
| 🦆 **Ententeich** | 4 | Echtes positives Feedback der Gruppe. Treffer-Rückblick über die letzten 220 ms ist vorbildliche Lag-Kompensation. | Nach ≈ 80 s vorbei (3 Wellen à 24–26 s). Auf dem TV gibt es keinen Schuss-Sound. Die Drift des Gyrosensors bleibt Thema. | Boss-Welle „Riesen-Flamingo-Ballon“ als gemeinsames Ziel mit Lebensbalken. Dazu Schuss- und Treffer-Sounds am TV und am eigenen Handy. |

---

## 3. Querschnitt

### 3.1 Game-Feel / Juice: Ist-Zustand in Zahlen

| Mittel | Befund (Grep über `client/host`) |
|---|---|
| Kamera-Shake | ✅ 26 Aufrufe in 19 Szenen, fein dosiert (meist 90–320 ms, Stärke 0,002–0,016) |
| Kamera-Flash | ⚠️ nur 4 Szenen (Drink, Geist, Murder, Sprint) |
| Tweens | ✅ 262 × `tweens.add`, das ist der Haupt-Juice-Träger |
| Partikel | ❌ **0 × `add.particles`**. Partikel sind einzelne `add.circle`/`add.rectangle` mit Tween. Eine eigene `puff()` steht in **8 Szenen**, `confetti()` in 4, `floatText()` in 3, eine eigene Banner-Logik in **21 Szenen** |
| Sound-Effekte TV | ❌ **praktisch keine.** Der `fxBus` im Synth (`client/music/player.ts`) und der Regler „Effekte“ existieren, genutzt werden sie nur vom Rhythmus-Spiel. `VersteckScene` piept als einzige Szene, aber mit **eigenem** `AudioContext` direkt auf `ctx.destination`, also an Lautstärke und Stumm-Schalter vorbei |
| Sound am Handy | ⚠️ nur Ententeich und Date Night (`controller/audio.ts`) |
| Vibration | ⚠️ in vielen Screens, aber iOS-Safari kennt `navigator.vibrate` nicht. Für die iPhones in der Gruppe fällt der Kanal komplett weg |
| Hit-Stop / Zeitlupe | ❌ nirgends (`timeScale` 0 Treffer) |
| Kamera-Zoom/Follow | ⚠️ nur Smash (Zoom 1,0–1,3), SUP (Scrollen mit dem Führenden) und Bogen (9 Kameras für den Wrap-Effekt). `startFollow`, `zoomTo` und `pan` werden nie benutzt |
| Szenenwechsel | ❌ harter Schnitt (`game.scene.stop/start` in `main.ts`) |
| Laufanimation | ❌ Der Avatar hat 1 Frame. In **14 Szenen** steht derselbe kopierte Hüpfer `img.setY(-Math.abs(Math.sin(now / 70)) * 2)` |

**Fazit:** Das Visuelle ist ordentlich (Shake, Tweens, Floating Text), aber **auf 38 Dateien verstreut und kopiert**. Ton fehlt komplett. In einer lauten Party-Runde ist Ton der stärkste Juice-Kanal: Ein Treffer, den man hört, fühlt sich doppelt so hart an.

### 3.2 Der 2D-Look: wo stark, wo „simpel“

**Stärken (bitte behalten):**

- Ein einziger, konsequenter Stil: prozedurale Pixel-Art mit automatischer dunkler Kontur (`Pix.outline`), gemeinsame Palette (`art/palette.ts`), keine Fremdgrafik. Das wirkt aus einem Guss, auch über 42 Spiele.
- Die eigenen Avatare (`shared/avatar.ts`, 16 × 27 px, über 24.000 Kombinationen) tauchen in fast jedem Spiel auf. Igel bekommen die Frisur, Schwimmringe das Shirt. Das ist der emotionale Kern („das bin ja ich!“).
- Die Schrift „Press Start 2P“ bei 8/16/24 px in einer 480er-Welt ist auf dem TV sehr gut lesbar (8 px Schrift = 32 Bildschirm-px bei 1080p).
- Einzelne Szenen sind richtig stimmungsvoll: Geisterjagd mit ausradierter Dunkelheit und Kerzen, Bowling mit animierten Tiki-Fackeln, Igel-Wasser mit Wellen, Kart in Mode 7.

**Wo es „simpel“ wirkt, und warum:**

1. **Figuren bewegen sich nicht, sie hüpfen.** Ein Frame plus Sinus-Hüpfer plus `setFlipX`. Kein Laufzyklus, kein Sprung-, Treffer- oder Jubel-Frame, kein Blinzeln. Das ist der größte einzelne „Billig“-Eindruck, weil er in 29 Szenen vorkommt (`figure()`/`ensureAvatar()`).
2. **Statische Hintergründe.** Fast alles wird einmal in eine Textur gemalt (`background()`). Es gibt kaum Bewegung in der Umgebung: keine Wolken, keine Palmen im Wind, keine Möwen im Hintergrund. Ausnahmen sind Wasserwellen in Igel und das Meer im Flieger (`tileSprite`, einziger Treffer).
3. **Flaches Licht.** Fast alles spielt bei Tageslicht ohne Schatten und Tiefe. Nur Geist hat Licht.
4. **Drehungen und Skalierungen sind krisselig** (siehe 3.4): Smash-Avatar ×1,5, Wackelturm-Teile ×0,24–0,53, gedrehte Karts in der Draufsicht. In einer 480 × 270-Leinwand mit Nearest-Filter entstehen unregelmäßige Pixel.
5. **Zu viel Text im HUD und zu wenig Symbole.** Namen werden auf 4–5 Zeichen gekürzt (Igel-HUD `.slice(0, perRow > 4 ? 4 : 7)`, Smash-Namensschild `.slice(0, 5)`), die Ansagen sind Textbanner. Das ist korrekt, aber eher „Debug-HUD“ als Show.

### 3.3 Phaser-Features: genutzt vs. ungenutzt (Phaser 3.90, WebGL über `Phaser.AUTO`)

| Feature | Heute | Wo es sich lohnt | Aufwand | Wirkung |
|---|---|---|---|---|
| **ParticleEmitter** (`this.add.particles`, seit 3.60) | 0 | Ersetzt die 8 `puff()`-Kopien und die 4 Konfetti-Kopien. Dazu Sand bei Rempler/Landung, Wasserspritzer, Funken beim Kart-Drift auf dem TV, Rauch nach Igel-Explosionen, Blätter im Wind. Ein Emitter pro Preset statt zig einzelner Objekte mit Tween | S (Modul) + S/Szene | **hoch** |
| **Sprite-Animationen** (`anims`) | 2 (Fackel, Feuer) | Avatar-Laufzyklus (4 Frames), Sprung, Treffer, Jubel, Blinzeln. Wird zentral in `shared/avatar.ts` als Spritesheet erzeugt und gilt dann überall | M | **sehr hoch** |
| **Kamera: Follow/Zoom/Pan** | nur Smash/SUP/Bogen, manuell | Igel (Geschoss folgen), Kart-Übersicht (Regie), Sumo/Arena-Finale, Spielbrett. Siehe 3.6 | S–M pro Spiel | hoch |
| **FX-Pipeline** (`preFX`/`postFX`: Glow, Vignette, ColorMatrix, Bloom, Shine, Wipe, Barrel) | 0 | **Glow** um den aktiven Spieler (Igel, Bowling, Darts) oder den Führenden. **Vignette** in Geist, Murder, Werwolf. **ColorMatrix** für Tageszeit (Party-Runden) und Entsättigen im Sudden Death. **Wipe** für Szenenwechsel. **Barrel** kurz bei großen Explosionen. Nur WebGL, Canvas-Fallback braucht einen Schalter | S je Effekt | mittel–hoch |
| **Light2D** | 0 | Eher **nicht**: Jeder Sprite braucht `setPipeline('Light2D')`, ohne Normal-Maps ist es flach, Text ist ausgenommen. Die Technik aus Geist (Dunkelheit als RenderTexture, Lichtkegel per `erase`, Schein per ADD-Blend) ist billiger und schon erprobt. Als `DarkOverlay`-Helfer verallgemeinern | M (Light2D) / S (Overlay) | mittel |
| **Zeitskala** (`time.timeScale`, `tweens.timeScale`) | 0 | TV-seitige Zeitlupe für Effekte. Die eigentliche Zeitlupe muss aus der Wiedergabe-Uhr kommen (3.10), weil die Positionen vom Server stammen | S | mittel |
| **Tilemaps** | 0 | Optisch kein Gewinn, denn die prozeduralen Hintergründe werden ohnehin einmal gebacken (effizient). Lohnt nur als **Editor-Weg** (Tiled), wenn Marlon Karten von Hand bauen will (Bogen, Parcours, Igel) | M | niedrig |
| **Parallax** (`setScrollFactor`, TileSprite) | 1 × TileSprite | In Smash (Kamera zoomt und schwenkt schon, der Hintergrund läuft 1:1 mit) bringen 2–3 Ebenen mit `scrollFactor 0,2/0,5` sofort Tiefe. In Igel eine Wolkenebene, die mit dem **Wind** zieht und den Wind damit spielerisch zeigt | S | mittel–hoch |
| **RenderTexture** | Kurve (Spuren), Geist (Dunkelheit) | Vorbildlich eingesetzt. Auch für Fußspuren und Krater-Schmauch nutzbar | – | – |
| **Szenen-Übergänge** | harter Schnitt | Iris-Wipe oder Kamera-Fade (`cameras.main.fadeOut`) zentral in `main.ts`. Ein Ort, alle Spiele | S | mittel |

### 3.4 Was bringt 960 × 540 bzw. größere Avatare wirklich?

**Hier muss man zwei Dinge trennen:** die **logische Welt** (alle Koordinaten in Server, `shared/` und 38 Szenen rechnen mit 480 × 270) und die **Render-Auflösung** (wie viele echte Pixel die Leinwand hat).

Heute ist beides 480 × 270. `pixelArt: true` setzt `roundPixels`, alles rastet auf ganze Welt-Pixel ein, also 4 × 4 Bildschirm-Pixel bei 1080p, und der Browser skaliert hoch.

**A) Die logische Welt auf 960 × 540: nein.** Jede Konstante müsste verdoppelt werden: `ARENA.TILE`, `IGEL.W`, Smash-Plattformen, Kart-Strecken, `FIELD_POS`, jede `txt()`-Position. Alle Sprites wären dann halb so groß oder müssten neu gezeichnet werden. Aufwand L+, Gewinn nahe null, denn der Pixel-Look *ist* 480 × 270.

**B) Die Render-Auflösung ×2 oder ×4 bei unveränderter Welt: ja, das lohnt sich.** Technisch: Spielgröße 1920 × 1080 (oder 960 × 540), eine Basisklasse `PixelScene` setzt in `create()` `cameras.main.setZoom(4).centerOn(240, 135)`. Die Spiellogik bleibt unangetastet. Was es konkret bringt:

1. **Sub-Pixel-Bewegung.** Ein Bomben-Arena-Spieler mit 65 px/s bewegt sich bei 60 fps um 1,1 px pro Frame. Gerundet auf ganze Welt-Pixel springt er abwechselnd 1 und 2 px (= 4 bzw. 8 Bildschirm-px). Das ist das „Stottern“, das man zusätzlich zum 20-Hz-Takt sieht. Bei ×4 rastet die Bewegung auf 0,25 Welt-px ein und wirkt glatt.
2. **Saubere Drehungen und krumme Skalierungen.** Smash-Avatar ×1,5 (heute ungleich breite Pixel), Wackelturm-Teile ×0,24–0,53 (heute flimmernd), Kart-Draufsicht, Igel-Kippeln, Pfeile in Bogen. Mit ×4 hat jede Avatar-Zelle bei ×1,5 genau 6 Geräte-Pixel.
3. **Herauszoomen wird möglich.** Eine Igel-Insel, die doppelt so breit wie der Bildschirm ist, lässt sich mit Zoom 0,5 überblicken, ohne dass die Hälfte der Pixel wegfällt. **Das ist die Voraussetzung für Kamera-Arbeit (3.6).**
4. **Schärfere Effekte.** Glow und Bloom laufen dann in 1080p statt in 270p.
5. **Kurven-Duell:** Die Spuren-RenderTexture (heute 480 × 270) könnte ×4 auflösen. Kurven würden rund statt treppig.

**Kosten:** M (ein Wochenende plus Testlauf durch alle Szenen). Stolpersteine sind Szenen mit eigenen Kameras: Smash (`hudCam`), Bogen (9 Kameras in Bildschirmkoordinaten `cameras.add(0, AY, …)`, Werte ×4) und die Kart-Bereiche. Text bleibt gleich, denn die Pixelschrift wird mit Nearest-Filter vergrößert und sieht identisch aus.

**Risiko:** Gedrehte Sprites zeigen gedrehte Pixelraster („Mixels“). Das ist eine Stilfrage, ich halte es für vertretbar. **Vorschlag:** zuerst ×2 (960 × 540) als Schalter in `main.ts`. Wenn Smash und Wackelturm damit überzeugen, auf ×4 gehen.

**Größere Avatare: nicht global.** Der Avatar ist 16 × 27, nicht 16 px. Auf einem 1080p-TV sind das 64 × 108 Bildschirm-px, die Größe reicht. Mit 12 Spielern ist nicht die Größe das Problem, sondern die **Unterscheidbarkeit**:

- **Doppelte Farben.** Die Spiele verteilen Farben unterschiedlich. Smash nimmt eigene 12 Farben nach Reihenfolge, Kurve verhindert doppelte Farben, aber Arena, Kart, Sumo und Bowling nehmen direkt `SHIRTS[look.shirt]`. Das sind nur 10 frei wählbare Farben, Doppelungen sind also programmiert.
- **Kein Name auf dem Spielfeld.** In der Arena steht nur ein Ring in Shirtfarbe unter der Figur.

**Besser als größere Avatare:**

- **(a) Eine Spielerfarbe pro Abend.** Der Raum vergibt beim Beitritt 12 garantiert verschiedene Farben. Alle Spiele nutzen sie für Ring, Namensschild, Spur und Fadenkreuz, das Handy zeigt dauerhaft „Du bist **ORANGE**“. Aufwand S–M, große Wirkung.
- **(b) Accessoires im Editor** (Sonnenbrille, Strohhut, Blume, Taucherbrille) für mehr Silhouetten-Vielfalt bei gleicher Größe.
- **(c) Ausdrucks-Frames** (Treffer-Gesicht, Jubel).
- **(d) Hochskalierung nur in Spielen mit wenigen Figuren** (Volley, Bogen bis 4 Spieler), wie Smash es schon macht.

### 3.5 Lohnt ein gemeinsames Juice-Modul? Ja, es ist die wichtigste Strukturmaßnahme

**Warum:** 8× `puff`, 4× `confetti`, 21× eigenes Banner, 14× derselbe Hüpfer, null Ton. Dazu erfindet jedes Spiel seinen eigenen Ereigniskanal im Snapshot: `fx` (Smash, Igel, Golf, Autoball, Kurve), `lastHit`, `lastGrab`, `lastWrong`, `lastScore`, `ticker`, `feedback`, `deaths`, `pickup`, `events` (Kart). Das sind rund 20 verschiedene Formate (`shared/types.ts`).

**Entwurf (Client):** `client/host/juice.ts`

```ts
export class Juice {
  constructor(scene: Phaser.Scene, opts?: { layer?: Phaser.GameObjects.Container; hud?: Phaser.GameObjects.Container });
  shake(level: 1 | 2 | 3): void;               // einheitliche Stufen statt 26 handgewählter Zahlen
  flash(color?: number, ms?: number): void;
  hitStop(ms: number): void;                    // friert die Wiedergabe-Uhr ein (siehe 3.10)
  slowMo(factor: number, ms: number): void;
  zoomPunch(amount?: number, ms?: number): void; // kurzer Zoom-Stoß 1,0 → 1,05 → 1,0
  burst(x: number, y: number, preset: 'puff' | 'sand' | 'splash' | 'confetti' | 'spark' | 'smoke' | 'wood', n?: number): void;
  float(x: number, y: number, text: string, style?: 'dmg' | 'heal' | 'gold' | 'info'): void;
  banner(text: string, sub?: string, ms?: number): void; // ersetzt die 21 Banner
  sfx(name: SfxName, opts?: { pan?: number; pitch?: number; vol?: number }): void;
  play(fx: FxEvent): void;                      // Standard-Ereignis → Ton + Partikel + Shake nach Tabelle
}
```

- **Ton:** `client/host/sfx.ts` erzeugt ~25 prozedurale Chiptune-Effekte (Treffer leicht/schwer, Explosion, Platsch, Münze, Sprung, Power-up, Countdown-Piep, LOS, K.O., Sieg-Jingle, Fehler, Wusch, Wurf, Fang, Auswahl) mit dem vorhandenen `Synth` (Oszillatoren, Rauschen, Hüllkurven) über den **vorhandenen `fxBus`**. Damit greift der Regler „Effekte“ endlich. **Stereo-Panning nach x-Position** kostet eine Zeile und macht auf dem TV viel aus. Variiert die Tonhöhe um ±5 %, nervt derselbe Treffer-Sound bei 12 Spielern nicht.
- **Server:** `server/fx.ts` mit `class FxLog { push(type, data) }` als Ringpuffer (letzte 24, mit `seq`) und ein einheitliches Feld `fx?: FxEvent[]` in `MiniSnapshot`. Weil die Ereignisse **im Zustand** stehen statt als eigenes Socket-Event zu laufen, gehen sie auch bei einem verschluckten Paket nicht verloren. Das ist heute schon richtig gelöst und sollte nur vereinheitlicht werden. Neue Spiele schreiben `fx.push('hit', { x, y, who, p })` und bekommen Ton, Partikel und Shake gratis.
- **Handy:** `juice.phone(type)` vibriert auf Android und spielt auf dem eigenen Handy einen kurzen Klick oder Pling, als Ersatz für die fehlende iOS-Vibration (`controller/audio.ts` existiert schon).
- **Migration nach und nach:** zuerst Smash, Arena, Igel, Sumo, Bogen, Ententeich, Kart (die Spiele mit den meisten Treffern), dann der Rest.

**Aufwand:** Modul M (1 Wochenende), danach S pro Szene. **Wirkung:** die höchste aller Maßnahmen. Alles fühlt sich hochwertiger an, und das Spiel Nr. 43 braucht keinen neuen Juice-Code mehr.

**Dazu Sprecher-Ansagen** (S, ein Abend): `speechSynthesis` im TV-Browser (Edge/Chrome unter Windows haben gute deutsche Stimmen) für „Drei, zwei, eins, LOS!“, „Lena ist dran!“, „K.O.!“, „Ben gewinnt!“. Abschaltbar im Musikmenü. Jackbox lebt vom Moderator. Ein leicht roboterhafter Sprecher ist in einer Freundesrunde eher ein Running Gag als ein Nachteil.

### 3.6 Kamera: welche 3 Spiele gewinnen am meisten?

1. **Igel-Krieg (größter Gewinn).**
   - Heute ist die ganze Insel ein statisches Bild (`IgelScene` hat keine einzige Kamera-Zeile außer Shake).
   - Vorschlag:
     - Zugbeginn: `pan()` und `zoomTo(1.6)` auf den aktiven Igel, dazu Banner „Ben ist dran!“.
     - Flug: `startFollow(projektil, true, 0.12, 0.12)`.
     - Einschlag: 300 ms auf dem Krater stehen bleiben.
     - Settle-Phase: `zoomTo(1.0)` als Überblick.
   - Hineinzoomen funktioniert schon in der heutigen 480er-Leinwand, Herauszoomen bei einer größeren Insel braucht 3.4 B.
   - Ohne Kamera ist es eher Pocket Tanks als Worms.
2. **Kart-Rennen, TV-Übersicht ab 5 Spielern.**
   - Dann schauen alle aufs Handy, und der TV ist reiner Zuschauer-Bildschirm. Heute zeigt er eine statische Draufsicht.
   - Eine **Regie-Kamera** zoomt 2× auf den dichtesten Zweikampf oder die Spitzengruppe, zeigt die Minikarte als Bild im Bild, springt bei Item-Treffern hin und fährt zur Ziellinie.
   - Der TV wird so zur Sportübertragung für die, die gerade nicht fahren oder fertig sind.
3. **Sumo-Steg (und das Rundenende der Bomben-Arena).**
   - Der Steg schrumpft ohnehin. Bei 2–3 Überlebenden zoomt die Kamera auf den Rest-Steg (×1,5).
   - Beim letzten Rempler: 0,8 s Zeitlupe plus Zoom-Stoß plus Platsch-Sound.
   - In der Bomben-Arena **nicht** während der Runde zoomen, man braucht dort das ganze Raster. Zoomen nur beim rundenentscheidenden Platsch.

*Ehrenplatz:* das **Spielbrett**, das an jedem Party-Abend am häufigsten zu sehen ist. Ein sanfter Schwenk mit ×1,4 auf die Figur, die gerade zieht, plus Ereigniskarte wirkt sofort wie Mario Party.

### 3.7 Wie realistisch ist 2.5D/Isometrie für Arena-Spiele?

**Technisch machbar, für dieses Projekt aber kaum lohnend.** Die Server-Logik bliebe 2D (Isometrie ist nur Darstellung: `screen = ((x − y)·w/2, (x + y)·h/2)`), die Tiefensortierung nach y existiert schon (`prop()` mit `setDepth(y)`). Dagegen spricht:

- **Jede Requisite müsste neu und schräg gezeichnet werden.** Prozedurale Iso-Pixel-Art ist deutlich schwerer (zwei Seitenflächen, Licht).
- **Die Lesbarkeit leidet.** Bei Bomberman muss man auf dem TV vom Sofa aus sofort sehen, auf welcher Kachel eine Bombe liegt. Die Ansicht schräg von oben (¾) ist dafür ideal, deshalb nutzen fast alle Bomberman-Teile sie.
- **Der Platz reicht nicht.** Ein 25 × 13-Raster in Isometrie belegt bei 480 px Breite nur noch ≈ 25 × 12 px pro Kachel und füllt die Höhe fast komplett aus.

**Besser „2,5D-Akzente“ in der vorhandenen ¾-Sicht (S–M):**

- Wurfbögen mit Höhenachse z und mitlaufendem Schatten. Bei der Wasserbomben-Schlacht und bei gekickten Bomben wirkt das sofort plastisch.
- Parallax-Ebenen in den Seitenansichten (Smash, Volley, Bogen, Igel).
- Kontaktschatten und ein leichtes Licht-Overlay.
- Kart hat mit Mode 7 schon echtes Pseudo-3D. Das ist der richtige Ort für „3D“.

**Isometrie nur für ein neues Spiel, das davon lebt**, z. B. „Spion unter Gästen“ in einer Hotel-Lobby, wo die Menge an NPCs in Isometrie gut aussieht und das Spiel präzises Positionieren nicht braucht. Aufwand L.

### 3.8 Licht, Tageszeit, Parallax, Übergänge: günstige Atmosphäre

- **Tageszeit im Party-Modus (S–M):** Runde 1 morgens, mittendrin Mittag, die letzte Runde Sonnenuntergang, das Finale (Mord/Verräter) Nacht. Umsetzung als Multiply-Overlay oder `ColorMatrix`-postFX auf `cameras.main`, gesteuert über einen Wert `timeOfDay` aus `BoardState`. Bei Nacht zusätzlich ein `DarkOverlay` (verallgemeinerte Geist-Technik) mit Lichtkreisen um Figuren und Fackeln. Ein globaler Wert, sichtbar in jedem Spiel.
- **Umgebungsbewegung (S pro Szene):** 3–5 Ambient-Objekte pro Hintergrund (Wolken, Möwen, wiegende Palmen per Sinus-Shear, Wellen). Das kostet fast nichts und nimmt den „Standbild“-Eindruck.
- **Szenenübergänge (S):** zentral in `main.ts` vor `game.scene.start(key)` ein 300-ms-Iris-Wipe. Einmal gebaut, gilt er überall.

### 3.9 Technik-Upgrade-Pfade im Überblick (Look)

| # | Maßnahme | Aufwand | Wirkung | Bemerkung |
|---|---|---|---|---|
| L1 | Soundeffekte über `fxBus` (+ Panning) | S–M | ★★★★★ | größter Einzelgewinn |
| L2 | Juice-Modul + ParticleEmitter + einheitliches `fx` | M | ★★★★★ | Fundament für alles Weitere |
| L3 | Avatar-Animations-Frames (Laufen 4, Sprung, Treffer, Jubel, Blinzeln) | M | ★★★★ | 29 Szenen profitieren, 14 kopierte Hüpfer fallen weg |
| L4 | Eine eindeutige Spielerfarbe pro Abend | S–M | ★★★★ | Lesbarkeit bei 12 Spielern |
| L5 | Kamera in Igel, Kart-Übersicht, Sumo, Brett | S–M je | ★★★★ | siehe 3.6 |
| L6 | Render-Auflösung ×2/×4 | M | ★★★ | glatte Bewegung, Drehungen, Herauszoomen |
| L7 | Parallax + Ambient-Bewegung | S je | ★★★ | Smash, Igel, Volley zuerst |
| L8 | Tageszeit/Licht-Overlay im Party-Modus | S–M | ★★★ | Atmosphäre über den ganzen Abend |
| L9 | postFX-Akzente (Glow, Vignette, Wipe) | S | ★★ | nur WebGL |
| L10 | Isometrie | L | ★ | nicht empfohlen außer für ein neues Spiel |

### 3.10 Server/Netz: Latenz-Pfad, Takt, Interpolation, Eingaben, Bandbreite, Reconnect

**Messung (eigener Probe-Client gegen den lokalen Server, Bots spielen):**

| Spiel / Spieler | Pakete in ~30 s | Ø Größe `state` | davon `players` | davon `mini` | Abstand p50 / p90 / p99 |
|---|---|---|---|---|---|
| Bomben-Arena / 12 | 592 | **5.968 B** | 1.996 B | 3.354 B | 50 / 51 / 53 ms |
| Smash / 8 | 444 | 5.697 B | 1.332 B | 3.748 B | 50 / 51 / 53 ms |
| Kart / 8 | 247 | 5.069 B | 1.332 B | 3.535 B | 50 / 51 / 55 ms |

**1. Die echte Updaterate ist 20 Hz, nicht 25.** Alle Echtzeit-Spiele ticken mit `TICK_MS = 50`, Flieger mit 200 ms. Jeder Tick ruft `onChange()`, und `Room.changed()` sendet **40 ms später** per `setTimeout(…, 40)`. Die Drosselung auf 25/s greift also nie, sie fügt nur 40 ms feste Verzögerung zu jedem Tick hinzu.

**2. Der Latenz-Pfad Handy → Server → TV (Arena, geschätzt aus Code und Messung):**

| Abschnitt | typisch | Hebel |
|---|---|---|
| Touch bis `pointerdown` im Browser | 10–30 ms | schon optimal (`tapButton` löst bei `pointerdown` aus) |
| WLAN Handy → Laptop | 5–30 ms, Ausreißer 100–300 ms (Energiesparen, 2,4 GHz, 12 Geräte) | 5-GHz-Netz, Laptop per Kabel am Router |
| Warten auf den nächsten Server-Tick | Ø 25 ms (0–50) | 30 Hz für Action-Spiele → Ø 17 ms |
| **`changed()`-Verzögerung** | **40 ms fest** | **sofort nach dem Tick senden → 0 ms** |
| Server → TV (Loopback) | < 1 ms | – |
| TV-Glättung | 20–40 ms (Arena `0.45`/Frame), Kart 100 ms Puffer | gemeinsamer Interpolations-Puffer 50–60 ms |
| Rendern + vsync | 8–16 ms | – |
| Streaming per Moonlight/Steam Link (README) | 15–40 ms | Kabel |
| Bildverarbeitung im TV | 15–100 ms | **Spielemodus am TV einschalten** (kostenlos, gehört ins README) |
| **Summe** | **≈ 140–330 ms** | Die drei Code-Hebel bringen ≈ 60–70 ms |

**Fix für `changed()` (S, 10 Zeilen):** „sofort senden, aber höchstens alle 40 ms“ statt „immer 40 ms warten“:

```ts
private lastFlush = 0;
private changed() {
  if (this.flushTimer) return;
  const wait = Math.max(0, 40 - (Date.now() - this.lastFlush));
  this.flushTimer = setTimeout(() => this.flush(), wait); // bei 20-Hz-Spielen ist wait = 0
}
private flush() { this.flushTimer = null; this.lastFlush = Date.now(); /* emit state + private wie bisher */ }
```

**3. Interpolation auf dem TV: drei verschiedene Lösungen, nur eine richtige.**

- **Kart:** echte Snapshot-Interpolation. Der Server stempelt `t`, der TV rendert `serverNow() − 100 ms` und interpoliert zwischen zwei Ständen, extrapoliert höchstens 150 ms. So ist es richtig.
- **Smash, Bogen:** Extrapolation `x + vx × Alter` (Alter gedeckelt auf 80 bzw. 60 ms) plus Glättung 0,5 pro Frame. Das ist gut genug, springt aber bei Richtungswechseln.
- **Arena, Igel und die meisten anderen:** nur exponentielle Glättung pro Frame (`a.x += (p.x − a.x) * 0.45`). Das ist **bildratenabhängig**: Auf einem 144-Hz-Laptop läuft es anders als auf 60 Hz. Bei 20 Hz legt die Figur in den ersten 3 Frames 83 % des Wegs zurück und bleibt dann fast stehen. Das ergibt ein 20-Hz-„Pumpen“, das man bei gleichmäßiger Bewegung als Zittern sieht. Zusammen mit dem Einrasten auf ganze Pixel (3.4) wirkt es leicht ruckelig. Das habe ich aus dem Code abgeleitet, nicht am TV gemessen.
- **Bewusste Ausnahme:** `VersteckScene` interpoliert absichtlich nicht, damit sich echte und falsche Möbel gleich verhalten. Gutes Detail, unbedingt so lassen.

**Vorschlag (M):** ein gemeinsames `client/host/interp.ts`:

```ts
export class SnapBuffer<S> {
  delay = 60;            // ms hinter der Serverzeit rendern (bei 20 Hz reicht etwas mehr als ein Takt)
  rate = 1;              // Wiedergabe-Tempo: 0 = Hit-Stop, 0.3 = Zeitlupe, danach 1.25 zum Aufholen
  push(serverT: number, s: S): void;
  sample(): { a: S; b: S; f: number } | null;
}
```

Der Server legt dafür in jeden Snapshot `t: Date.now()` (Kart hat das schon). Der Clou: **Mit einer Wiedergabe-Uhr bekommt der TV Hit-Stop und Zeitlupe gratis.** Bei einem harten Treffer bleibt die Uhr 80 ms stehen, danach läuft sie mit 1,25× wieder auf, bis die Verzögerung wieder 60 ms beträgt. Am Spiel ändert das nichts, der Server simuliert ganz normal weiter. Mit 8 s Puffer kommt eine **Wiederholung** dazu („TOR! Wiederholung“ in Auto-Fußball, „Schuss des Abends“ in Igel). Die Szenen bauen ohnehin alles aus dem Zustand, ein Replay füttert sie also nur mit alten Ständen.

**Vorhersage:** Am Handy gibt es sie nur bei Kart, und nur dort ist sie sinnvoll, weil das Handy dort selbst rendert. Bei TV-Spielen schaut man auf den TV, dort ist eine Vorhersage ohne Eingabe nicht möglich. **Optionaler Trick (S–M):** Der Server leitet Joystick-Änderungen *sofort* (nicht erst zum Tick) als kleines Event `input` an den TV weiter. Der TV dreht die Figur dann schon um bzw. startet die Laufanimation, bevor die Position nachkommt. Gefühlt reagiert „meine Figur“ so 50–70 ms früher.

**4. Eingaben: Zustand oder Ereignis? Richtig gelöst.**

- Der Joystick schickt seinen **Zustand** (`stick {x, y}`): sofort bei großer Änderung, kleine Änderungen höchstens alle 45 ms, solange der Finger liegt alle 300 ms als Keepalive.
- Knöpfe sind **Ereignisse** bei `pointerdown`. Über TCP gehen sie nicht verloren. Das ist genau die ROADMAP-Vorgabe.
- Lücke 1: **Server-seitig veraltet nichts.** Wer beim Halten des Sticks die Verbindung verliert (iPhone gesperrt, WLAN-Loch), läuft mit dem letzten `sx/sy` weiter, bis Socket.IO die Trennung bemerkt. Bei `pingInterval 10 s` + `pingTimeout 12 s` kann das bis zu 22 s dauern.
  - Fix (S): Kommt länger als 700 ms kein `stick` (der Client schickt beim Halten alle 300 ms), setzt der Server den Stick auf 0. Am besten zentral in `room.ts` vor `mini.input` mit einem Zeitstempel pro Spieler.
- Lücke 2: Der Socket.IO-Client startet mit HTTP-Polling und wechselt dann auf WebSocket. Die Bots nutzen schon `transports: ['websocket']`. Für Handy und TV ebenfalls einstellen (S): schnellerer Verbindungsaufbau, kein Zurückfallen auf Polling bei schwachem WLAN.

**5. Bandbreite: Unnötiges geht 20-mal pro Sekunde raus.**

- Jeder Snapshot enthält den ganzen `GameState`: `players` (bei 12 Spielern ≈ 2 KB, im Spiel statisch), `joinUrl`, Zähler und **das komplette Arcade-Leaderboard inklusive `perGame` je Name und Spiel** (`room.ts snapshot()`). Bei meinem Test war das Leaderboard leer. Nach ein paar Abenden schätze ich ≈ 15–20 KB (15 Namen × 25 Spiele × ~45 Byte).
- Heute: 12 Handys × 20/s × 6 KB ≈ **1,4 MB/s (≈ 11,5 Mbit/s)** nur für den Zustand.
- Mit gefülltem Leaderboard: ≈ **5–6 MB/s (≈ 45 Mbit/s)**. Das ist auf 2,4-GHz-WLAN mit 12 Handys ein echter Latenztreiber, weil jede Sekunde Funkzeit belegt wird.
- Zusätzlich geht `private` bei *jedem* Flush an *jeden* Spieler, auch wenn es `null` ist: 240 Pakete pro Sekunde.
- Auf dem Handy löst jedes `state` und jedes `private` ein `render()` aus, also ≈ 40 DOM-Updates pro Sekunde. Auf schwachen Android-Handys kostet das Akku und Touch-Flüssigkeit.

| Fix | Aufwand | Effekt |
|---|---|---|
| `meta`-Event (players, leaderboard, Zähler, joinUrl) nur bei Änderung, `state` nur noch phase/mini/board/results | S–M | −33 % sofort (nur `players`), bis −80 % mit gefülltem Leaderboard |
| `private` pro Spieler nur senden, wenn sich der JSON-String geändert hat | S | −240 Pakete/s |
| Am Handy `render()` per `requestAnimationFrame` zusammenfassen | S | flüssigere Touches |
| Danach Tick 30 Hz für Smash, Bogen, Arena, Sumo, Volley, Autoball | S | Ø −8 ms, glattere Bewegung |

**6. Reconnect mitten im Spiel:**

- **Gut gelöst:**
  - Die ID liegt im `localStorage`, beim Zurückkommen wird automatisch neu beigetreten.
  - `checkConnection()` prüft bei `visibilitychange`, `focus` und `online` mit einem 2,5-s-Ping und verbindet notfalls hart neu.
  - Der VIP hat 60 s Gnadenfrist, Weiter-Knöpfe drückt der Server notfalls selbst.
  - Wer während eines laufenden Spiels zurückkommt, ist wieder im Spiel, sofern er beim Start dabei war (`miniIds`).
- **Uneinheitlich:** Jedes Spiel entscheidet in `playerDisconnected` selbst, was passiert.
  - Arena: sofort tot.
  - Igel: aktiver Zug läuft nach 1,5 s ab, alle späteren Züge des Spielers dauern nur 1,5 s.
  - Smash, Grill, Kart: Eingabe wird auf null gesetzt, die Figur steht herum und wird verprügelt.
  - Mord: bleibt.
  - Werwolf: nur bei `isGone`.
- **Vorschlag:** einheitliche Regel in `MiniCtx`: `isAway(id)`, das erst nach **3 s** ohne Verbindung wahr wird. Bis dahin gilt ein kurzes Wackeln als „weiter da“. Kein Spiel tötet bei Trennung, sondern pausiert die Figur unverwundbar (blinkt), bis der Spieler 15 s weg ist.
- **Wake Lock:** wird nur **einmal** nach dem Beitreten angefordert (`requestWakeLock()` in `controller/main.ts`), und `navigator.wakeLock` gibt es **nur über HTTPS**. Über HTTP sperrt das Handy bei Spielen mit langer Wartezeit (Igel, Bowling, Tourist) nach 30 s, die Verbindung bricht ab. Außerdem gibt der Browser die Sperre frei, sobald die Seite verborgen war. Fix (S): bei `visibilitychange → visible` neu anfordern, und über HTTP ein stummes, unsichtbares Mini-Video in Schleife als Fallback (bekannter Trick, z. B. NoSleep.js).

### 3.11 Lesbarkeit auf dem TV mit 12 Spielern

- Die Avatar-Größe reicht (3.4). Kritisch sind **Farben** (doppelte Shirts) und **gekürzte Namen** (4–5 Zeichen).
- Lösung: eindeutige Spielerfarbe (L4) plus 3-Buchstaben-Kürzel, die der Raum vergibt („LEN“, „BEN“, bei Kollision „BE2“). Das Kürzel steht überall gleich in der eigenen Farbe.
- Für die HUD-Leisten: Porträt (16 × 15) **2× skalieren**, wo Platz ist. Bei Arena 12 sind es 32 px Breite pro Spieler (`Math.floor(390 / n)`). Ein Porträt ×2 passt in der Breite, die Leiste müsste dafür ~8 px höher werden.
- Wackelturm, siehe Teil 2: Bei 12 Spielern sind die Blöcke ≈ 4 px groß. Hier sind Team-Türme oder Vorläufe besser als 12 Bahnen.

### 3.12 Regelerklärung / Onboarding: versteht ein Neuer das Spiel in 10 s?

- **Heute:** Countdown 3–3,5 s mit einer Unterzeile („Runde 1 – wer zuerst 2 Runden gewinnt!“), die Steuerung steht nur am Handy. Kart macht es richtig: 8 s Countdown und am Handy einmal pro Rennen „So fährst du“.
- **Vorschlag: eine Phase `intro` im Raum für jedes Spiel (M):**
  - `MINI_INFO` bekommt `howTo: { goal: string; controls: { icon: string; text: string }[] }`.
  - **TV:** Titel, Icon, ein Satz Ziel, 3 Steuer-Piktogramme, darunter die Avatare mit Häkchen „bereit“.
  - **Handy:** dieselben Steuerelemente als **Übungsfeld**. Joystick und Knöpfe funktionieren, eine Mini-Figur am Handy reagiert, man fühlt die Bedienung vor dem Start. Darunter „Bereit!“.
  - Start, sobald alle bereit sind, spätestens nach 15 s. Bei bekannten Spielen (Leaderboard: schon gespielt) nach 5 s.
  - Das ist exakt das Mario-Party-Muster und kostet pro Spiel nur einen Datensatz.
- **Einheitliche Bedien-Logik:** Igel zielt durch *Vorwärts*-Ziehen (Richtung = Schuss), Minigolf durch *Zurückziehen* wie eine Schleuder. Für das Gehirn ist das eine Falle. Entweder überall Schleuder (dann passt auch Wurfspiele-Logik), oder auf dem Zielfeld deutlich „↗ in Schussrichtung ziehen“ einblenden.

### 3.13 Pacing und Zuschauer-Erlebnis

- **Spieldauer passt nicht zum Spielbrett.** Für `BOARD_KINDS` wird zufällig gezogen, egal ob ein Spiel 1 min (Sprint) oder 5–8 min (Igel, Parcours, Grill, Smash 3 min) dauert. 8 Party-Runden mit Zufallsspielen ergeben 45–90 min. Mario-Party-Minispiele dauern 30–60 s.
  - Vorschlag (S): `MINI_INFO.length: 'kurz' | 'mittel' | 'lang'`. Das Brett zieht standardmäßig „kurz“ und „mittel“, eine Party-Einstellung „Lange Spiele erlaubt“ schaltet den Rest zu.
- **Ausgeschiedene langweilen sich.** In Arena, Sumo, Bogen, Kurve und TTT sieht man statisch „Du schaust zu“ bzw. „PLATSCH!“. Drei Bausteine, gemeinsam gebaut:
  1. **Emote-Leiste** auf jedem Zuschauer-Screen (😂 😱 👏 🍅). Die Emojis schweben auf dem TV über dem Porträt. S, gilt sofort für alle Spiele.
  2. **Wetten:** Wer raus ist, setzt am Handy auf den Rundensieger. Ein Treffer bringt Arcade-Punkte oder Münzen. S–M.
  3. **Geister-Aktionen** pro Spiel: Rache-Möwen (Arena), Wasser spritzen (Sumo), Hausgeist (TTT), ein Hindernis pro 5 s (Kurve). M pro Spiel, nur für die Top-5-Spiele.
- **Rundenbasierte Spiele bei 12 Spielern** (Igel, Bowling): siehe 4a. Grundregel: Ab 7 Spielern gibt es keine reinen Einzelzüge mehr, sondern gleichzeitige Züge oder Teams.

### 3.14 Fairness und Balance (Auswahl)

- **Igel-Wind wird jeden Zug neu ausgewürfelt** (`startTurn()`: `const w = Math.random() * 2 - 1`), bei `WIND_ACC: 75` gegen `GRAVITY: 260`. Ein voller Schuss mit 2 s Flugzeit wird bei starkem Wind um ≈ 150 px versetzt, ein Drittel der Insel. Weil man bei 12 Spielern nur 1–2 Züge hat, entscheidet Glück. → Wind driften lassen (4a, Stufe S).
- **Arena:** Trennung bedeutet Tod (oben).
- **Arcade-Punkte 10/6/3/1, dauerhaft pro Name:** Wer öfter kommt, führt. Vorschlag: zusätzlich ein **Abend-Champion** (nur der heutige Abend) und je Spiel ein „Meister“-Titel nach Siegquote ab 5 Partien.
- **Spielbrett:** Ab Platz 4 gibt es überall 1 Münze (`PLACE_COINS = [10, 6, 3, 1]`). Bei 12 Spielern unterscheiden sich die Plätze 4–12 nicht. Für ein Brettspiel ist das okay, aber eine Aufholhilfe für die Letzten (z. B. die Möwe aus Kart als Brett-Item) würde Spannung bringen.

### 3.15 Handy-Eingaben

- **Gut:**
  - `tapButton` löst bei `pointerdown` aus.
  - Joystick mit Pointer-Capture und Keepalive.
  - Schwebender Stick (Smash, Kart).
  - Wurf- und Schwungerkennung am Handy; nur das Ergebnis geht zum Server, deshalb ist sie unempfindlich gegen Latenz.
  - Rhythmus wird am Handy bewertet (`server/rhythm.ts`: „Bewertet wird direkt am Handy, damit Netzwerk-Verzögerungen keine Rolle spielen“).
- **Schwach:**
  - Präzises 8-Richtungs-Zielen per Touch-Stick (Bogen).
  - Viele Knöpfe (Smash).
  - Feedback nur über Vibration, die auf iOS fehlt.
  - Hoch- und Querformat wechseln je Spiel (Kart quer, das meiste hoch).
- **Vorschläge:**
  - Zielhilfe in allen Zielspielen mit Stick.
  - Ton als Bestätigung am Handy (L1).
  - Die Ausrichtung pro Spiel in `MINI_INFO` festlegen (`orientation: 'portrait' | 'landscape'`), dazu einen einheitlichen „Bitte drehen“-Screen mit Animation.

### 3.16 Meta-Ebene (kurz, weil nicht Schwerpunkt)

- **Spielbrett ist zu dünn:** ein Ring aus 24 Feldern, 7 Ereignisse (`server/board.ts EVENTS`), Cocktail-Kauf automatisch beim Vorbeilaufen, keine Items, keine Abzweigungen, keine Duelle. Die drei wirksamsten Ergänzungen:
  - **Item-Laden** am Start mit 3 Items: Doppelwürfel, Cocktail klauen, Teleport.
  - Ein **Duellfeld** „Teilen oder Klauen“: zwei Spieler entscheiden geheim am Handy, der Pott sind 10 Münzen, der TV deckt dramatisch auf. Das dauert 30 s und erzeugt mehr Gesprächsstoff als jedes Feld.
  - **Teamspiele nach Feldfarbe** (blau gegen rot = 2 gegen 2 oder 1 gegen 3, der Kern von Mario Party).
- **Highlights/Replays:** dank Snapshot-Architektur und `SnapBuffer` (3.10) erstaunlich billig.
- **„Titel des Abends“** am Ende: aus den Ereignisprotokollen (`FxLog`) zählen, etwa „Meiste Eigentore“, „Igel-Kamikaze“ (meiste Selbsttreffer), „Unsichtbar“ (längste Versteckzeit). S, sobald `FxLog` existiert.
- **Turniermodus** (5 Spiele, Gesamtwertung, Siegerehrung mit Podest): Die Bausteine „Nochmal“ und Leaderboard sind in Arbeit, ein Turnier ist dann nur eine Playlist.

---

## 4. Neue Spiele

### 4a. Wie wird Igel-Krieg wirklich Worms-würdig?

**Ist-Analyse gegen Worms:**

| Worms-Merkmal | Igel-Krieg heute | Urteil |
|---|---|---|
| Zerstörbares Gelände | ✅ Pixel-Bitmaske 480 × 270, Kreis-Krater (`carve`), Höhlen, schwebende Felsen, Deko wird mit zerstört. Übertragen werden Seed und Kraterliste | **stark** |
| Waffenvielfalt | ⚠️ 4: Bazooka (∞), Wasserbombe (3), Teleport (2), Schlag (∞) | **zu wenig** (Worms hat 30+, gespielt werden ~10) |
| Ninja-Seil / Mobilität | ❌ nur Laufen (30 px/s), Sprung und Teleport | **fehlt**, das Markenzeichen |
| Wind | ✅, aber jeden Zug neu ausgewürfelt, nur als Pfeiltext `>>` angezeigt | lernfeindlich, unsichtbar |
| Rundentimer | ✅ `TURN_MS 30000`, Rückzug 3 s | gut für 2–4, zu lang für 12 |
| Teams | ⚠️ Jeder Spieler ist ein Team, bis 4 Spieler 2 Igel, sonst 1 | keine Spieler-Teams |
| Kamera | ❌ statische Gesamtansicht | **fehlt** |
| Kisten, Minen, Fässer | ❌ | **fehlt**, das ist der Chaos-Motor |
| Schaden am Zugende zählen (HP laufen runter) | ❌ Schaden wird sofort als `-45` angezeigt, das K.O. kommt erst in `finishTurn` | halb |
| Sudden Death | ✅ nach 5 min steigt die Flut um 20 px pro Zug, hartes Ende nach 8 min | gut |
| Fallschaden, Rückstoß, Ertrinken | ✅ | gut |
| Persönlichkeit (Sprüche, Grabsteine) | ⚠️ Sandburg als Grabstein, Schwimmring treibt im Wind davon (schön!), keine Sprüche, kein Ton | ausbaufähig |

**Das Kernproblem bei Partys ist die Wartezeit, nicht die Waffen.** Ein realistischer menschlicher Zug: 10–20 s zielen + 2–3 s Flug + 3 s Rückzug + 0,7–2 s Settle ≈ 20–28 s.

| Spieler | Igel gesamt | Zyklus (alle einmal) | Züge pro Person bis Sudden Death (5 min) | bis hartes Ende (8 min) |
|---|---|---|---|---|
| 2 | 4 | ≈ 50 s | ≈ 6 | ≈ 9,5 |
| 4 | 8 | ≈ 1,7 min | ≈ 3 | ≈ 4,8 |
| 8 | 8 | ≈ 3,3 min | ≈ 1,5 | ≈ 2,4 |
| 12 | 12 | ≈ 4–5,5 min | **≈ 1** | **≈ 1,5–2** |

(Ein Zug = ein Spieler bzw. Team, die Igel eines Teams wechseln sich ab.)

Bei 100 HP und 45 Schaden pro Bazooka-Treffer stirbt mit 12 Spielern kaum jemand durch Waffen. Es entscheiden Flut und `HARD_CAP`. Und Igel steht in `BOARD_KINDS`, also auch auf dem Spielbrett, wo ein 8-Minuten-Spiel die Party sprengt.

**Stufe S (ein Abend), sofort spürbar:**

1. **Wind driftet** statt neu gewürfelt zu werden: `this.wind = clamp(this.wind + (Math.random() - 0.5) * 0.4, -1, 1)`. So lernt man aus dem Schuss des Vorgängers.
2. **Zugzeit nach Spielerzahl:** `TURN_MS = n <= 4 ? 30000 : n <= 8 ? 20000 : 15000`. Sudden Death bei ≥ 7 Spielern nach 3 min statt 5.
3. **Nicht mehr aufs Brett ab 7 Spielern** (`fitsPlayers` für Brett-Ziehung um eine Obergrenze ergänzen) bzw. ein Brett-Modus „Kurz-Igel“ (60 HP, Sudden Death nach 2 min).
4. **Kamera-Grundpaket** (3.6): Schwenk auf den aktiven Igel, Banner „Ben ist dran!“, Geschoss folgen, Überblick beim Settle.
5. **Schaden am Zugende:** Treffer zeigen `-45`, aber die HP-Zahl über dem Igel läuft erst in der Settle-Phase Punkt für Punkt herunter (mit Tick-Sound). Das ist der Worms-Spannungsmoment.
6. **Wind sichtbar machen:** Partikel (Blätter, Sand) und eine Wolkenebene, die mit `wind × 40 px/s` zieht. Im HUD ein Balken statt `>>`.
7. **Zuschauer-Sprüche:** Wer nicht dran ist, tippt am Handy auf Sprüche („Rache!“, „Feigling!“, „Ups.“). Sie erscheinen als Sprechblase über dem eigenen Igel. Das hält 11 Leute beschäftigt.
8. **Ton:** Abschuss-Wusch, Explosion, Platsch, „Autsch“, Countdown-Piepen in den letzten 5 s.

**Stufe M (ein Wochenende), Worms-Gefühl und Gruppentauglichkeit:**

1. **Modus „Alle gleichzeitig“ ab 7 Spielern** (in Scorched Earth gab es das als „Simultaneous“):
   - Alle zielen 15 s gleichzeitig, der TV zeigt alle Ziellinien in Teamfarbe.
   - Danach fliegen alle Geschosse zugleich, dann gibt es 3 s Rückzug für alle.
   - Ein Zyklus dauert ≈ 25 s für **alle** statt 12 × 25 s. Auf dem TV ist es ein Spektakel: 12 Kokosnüsse in der Luft.
   - Der Server kann es fast schon: `projs: Proj[]` ist eine Liste, `weaponOf`/`ammo` sind pro Spieler. Neu sind `aim` pro Spieler und die Zustandsmaschine `aimAll → flightAll → retreatAll → settle`.
   - **Das ist die wichtigste Einzelmaßnahme für Igel bei großen Gruppen.**
2. **Waffen von 4 auf 10**, alle im Urlaubs-Thema, in `WEAPONS` (`shared/igel.ts`) plus je ein Zweig in `fire()`/`stepProjs()`:
   - *Wasser-Schrotflinte*: 2 Sofortschüsse, kleine Krater.
   - *Möwen-Luftschlag*: Ziel **auf der Minikarte am Handy antippen**. Das ist die perfekte Handy-Mechanik.
   - *Böller* (Dynamit): ablegen und weglaufen, 5 s.
   - *Seeigel-Mine*: scharf nach 2 s.
   - *Ananas-Splitterbombe*: Streubombe à la Bananenbombe.
   - *Paddel-Schlag*: Baseballschläger, wirft weit, wenig Schaden.
3. **Kisten:** zu Beginn jedes Zuges mit 30 % Chance eine Kiste am Sonnenschirm-Fallschirm (zufällige Waffe oder +25 HP). Kisten erzeugen Laufwege, Risiko und Gespräch.
4. **Gaskartuschen vom Grill** als Fässer (explodieren bei Treffer, Kettenreaktion) und 3–6 Seeigel-Minen beim Spielstart. Chaos aus der Umgebung ist der halbe Worms-Charme.
5. **Spieler-Teams für 5–12:**
   - 2–4 Teams, jeder steuert seinen eigenen Igel, die Teams ziehen reihum (A1, B1, C1, A2, B2, …).
   - Die Wartezeit pro Person sinkt dadurch nicht, aber man fiebert mit dem eigenen Team mit, berät, und ein ausgeschiedener Spieler bleibt im Spiel, solange sein Team lebt.
   - Gut kombinierbar mit „Alle gleichzeitig“ (ein Team zieht gleichzeitig).
6. **Größere Insel** (720–960 × 300) mit Kamera. Die Maske wächst auf ~290 KB, das Netz bleibt gleich (Seed + Krater). Herauszoomen setzt 3.4 B voraus.
7. **Waffenmenü am Handy als Raster mit Symbolen** und Kurzinfo. Bei 10 Waffen reicht die Knopfleiste nicht mehr.

**Stufe L (mehrere Wochenenden), die Marke:**

1. **Ninja-Seil („Lianen-Seil“):**
   - Strahl in Zielrichtung auf die Maske werfen, Ankerpunkt setzen.
   - Pendel als Abstandsbedingung mit Länge L, ◀ ▶ schwingen, ▲ ▼ einholen oder nachlassen.
   - Loslassen behält den Schwung, in der Luft darf man neu werfen.
   - Die Physik läuft schon mit `IGEL.DT = 5 ms`-Teilschritten. Das ist fein genug.
   - Problem Latenz (150–250 ms zwischen Daumen und sichtbarer Bewegung): Seil-Gravitation ×0,6, großzügiges Andocken (±6 px), eine optionale „Seil-Hilfe“ lässt am höchsten Punkt automatisch los.
   - Als letzte Stufe planen, weil es am meisten Feinschliff braucht.
2. **Dazu Mobilitäts-Werkzeuge:**
   - *Surfbrett-Brücke*: Ein Balken wird ins Gelände gesetzt. Das braucht „hinzufügen“ in der Maske: Kraterliste zu Operationsliste `[x, y, r, 'carve' | 'add']` erweitern.
   - *Sonnenschirm-Gleiter* (Fallschirm).
   - *Schaufel* (Bohrer, gräbt einen Tunnel).
3. **Handgemachte Themenkarten** (Ferienhaus-Ruine, Hafen mit Kränen, Pool-Landschaft) mit unzerstörbarer Felsschicht, Parallax-Himmel, Wasser-Spiegelung und Grasrand-Textur. Hier lohnen sich Tilemaps bzw. ein Bild-Import als Maske.
4. **„Schuss des Abends“ als Wiederholung** über den Snapshot-Puffer (3.10): der Treffer mit dem meisten Schaden in Zeitlupe vor dem Ergebnis-Screen.
5. **Persönlichkeit:**
   - Igel-Sprüche per `speechSynthesis` in hoher Tonlage.
   - Siegestanz-Animation.
   - Grabsteine mit dem Namen.
   - Abstimmung über Waffensätze („Klassik“, „Chaos“, „Nur Schläge“) vor dem Spiel.

### 4b. 12 neue Spielideen, sortiert nach (Spaß × Passung) ÷ Aufwand

Ich vermeide Dopplungen mit dem Bestand. 16 Action-Spiele und 7 Spiele mit geheimen Rollen gibt es schon. Ziel sind die Lücken: **Quiz/Wissen, Bluff, Live-Malen, Team-Wortspiele, Rhythmus für viele, kurze Sensorspiele fürs Brett, asymmetrische Koop-Spiele, Handy als geheime Hand.**

| # | Arbeitstitel | à la | Spaß | Passung | Aufwand | Score | Lücke |
|---|---|---|---|---|---|---|---|
| 1 | **Wer war's?** | Jackbox „Who's Who“ / Mr. & Mrs. | 4,5 | 5 | S | 22,5 | Wissen über die Gruppe |
| 2 | **Funkfrequenz** | Wavelength | 4,5 | 4,5 | S | 20,3 | Team-Rede-Spiel für 12 |
| 3 | **Schätzkönig** | Wits & Wagers | 4 | 5 | S | 20 | Quiz ohne Expertenwissen |
| 4 | **Mäxchen am Pool** | Meiern / Mäxle | 4 | 5 | S | 20 | Würfel-Bluff, geheime Hand, auch Trinkspiel |
| 5 | **Sektkorken** | – (Schüttel-Spiel) | 3,5 | 4,5 | S | 15,8 | 45-s-Sensorspiel fürs Brett, 12 gleichzeitig |
| 6 | **Montagsmaler live** | Pictionary / skribbl.io | 4,5 | 5 | S–M | 15 | Echtzeit-Malen und Raten |
| 7 | **Lügen-Lexikon** | Nobody is perfect / Fibbage | 4 | 5 | S (+ Inhalte) | 13,3 | Bluff + Wissen |
| 8 | **Strand-Band** | Rhythmus-Party | 4 | 4,5 | S–M | 12 | Rhythmus/Musik für 12 |
| 9 | **Drachenboot** | Team-Paddeln | 4 | 4,5 | S–M | 12 | Team-Sensor-Spiel, 60–90 s |
| 10 | **Geheimcode am Pool** | Codenames | 4,5 | 5 | M | 11,3 | Team-Wortspiel, Handy als geheimer Schlüssel |
| 11 | **Bombe entschärfen** | Keep Talking and Nobody Explodes | 4,5 | 4,5 | M | 10,1 | asymmetrisches Koop-Rätsel |
| 12 | **Flohmarkt-Auktion** | Kuhhandel / For Sale | 3 | 4,5 | S–M | 9 | Bieten mit geheimen Werten |

(Score = Spaß × Passung ÷ Aufwand mit S = 1, S–M = 1,5, M = 2.)

**1. Wer war's?** *(3–12 Spieler · Handy: Tastatur + Abstimmung · S · 4–6 min)*
Phase 1: Alle beantworten am Handy 2 persönliche Fragen („Mein peinlichster Urlaubsmoment“, „Was ich heimlich im Koffer habe“). Phase 2: Der TV zeigt eine anonyme Antwort, alle tippen am Handy auf den Avatar, von dem sie glauben, dass sie stammt. Punkte gibt es fürs Richtigraten und für den Autor, wenn ihn *niemand* errät. Eigene Fragen lassen sich wie bei WWE in der Lobby hinzufügen.
*Lücke:* Kein Spiel nutzt bisher das Wissen der Freunde übereinander. Die Inhalte machen die Spieler selbst, es wird also nie langweilig.
*Wiederverwendung:* Eingabe- und Abstimmungsfluss aus `server/sprueche.ts`, `playerButtons()`, `QuestionStore`.

**2. Funkfrequenz** *(4–12 in 2 Teams · Handy: privates Ziel + Drehregler · S · 6–10 min)*
Der TV zeigt eine Skala mit zwei Polen („eiskalt ↔ glühend heiß“). Nur der „Funker“ des Teams sieht am Handy, wo das geheime Ziel liegt, und gibt laut einen Hinweis („Glühwein“). Sein Team dreht gemeinsam am Handy den Zeiger auf dem TV (Mittelwert aller Regler oder Kapitän bestätigt), das andere Team wettet „weiter links/rechts“.
*Lücke:* das beste Rede-Spiel für große Gruppen, sehr sozial, kein Vorwissen nötig. Bisher gibt es kein Teamspiel mit Gesprächsfokus.
*Technik:* trivial, nur Zustand und ein Slider. Die Inhalte sind 150 Gegensatzpaare.

**3. Schätzkönig** *(3–12 · Handy: Zahlenfeld + Chips setzen · S · 5 min, Brett-Variante 90 s)*
Schätzfrage („Wie viele Liegestühle stehen am Ballermann-Strand?“, „Wie viele Minuten hat Marlon heute im Bad verbracht?“). Alle tippen eine Zahl, der TV sortiert die Antworten auf einem Zahlenstrahl. Dann setzt jeder 2 Chips auf die Antwort, die er für die beste hält (am nächsten dran, ohne drüber), außen liegende Antworten zahlen höhere Quoten.
*Lücke:* Es gibt **kein einziges Quiz**. Durch das Wetten gewinnen auch Leute ohne Wissen. Mit 1 Frage ist es ein gutes 60–90-s-Brettspiel.
*Technik:* wie WWE plus Quoten. Inhalte: 100 Fragen, davon einige als „Gruppenfragen“, die die Lobby vorher beantwortet.

**4. Mäxchen am Pool** *(2–12 · Handy: geheimer Wurf, Schütteln zum Würfeln · S · 5–8 min)*
Reihum schüttelt man das Handy (ohne Sensor: tippen). Nur man selbst sieht den Wurf und sagt einen Wert an, ehrlich oder gelogen, der den vorherigen schlagen muss. Der Nächste glaubt und gibt weiter oder deckt auf („Aufdecken!“), der TV zeigt den Becher dramatisch. Wer lügt bzw. falsch zweifelt, verliert ein Leben (Trinkspiel: einen Schluck), Mäxchen (21) zählt doppelt.
*Lücke:* Würfel-Bluff, deutscher Klassiker, Handy als echte geheime Hand. Passt in Party, Arcade **und** Trinkspiel.
*Technik:* einfacher Zustandsautomat. Fürs Schütteln reicht `onMotion` (Betrag der Beschleunigung).

**5. Sektkorken** *(2–12 gleichzeitig · Handy: Schütteln, Fallback schnelles Reiben · S · 45 s)*
Jeder hat auf dem TV eine Sektflasche. Schütteln baut Druck auf, die Flasche zittert sichtbar und die Druckanzeige steigt. Auf das Signal „PLOPP!“ lässt man los, der Korken fliegt so weit, wie Druck da ist. Wer über den roten Bereich geht, dem platzt die Flasche vorzeitig.
*Lücke:* Kurze 45-Sekunden-Spiele fürs Brett fehlen. Körperkomik (12 Leute schütteln ihre Handys) ist ein Party-Garant.
*Technik:* klein. Sicherheitshinweis „Handy gut festhalten“ einblenden. iOS braucht HTTPS, sonst Reiben als Fallback.

**6. Montagsmaler live** *(3–12 · Handy: Zeichenfläche bzw. Tastatur · S–M · 6–8 min)*
Einer malt am Handy, die Striche erscheinen **live** Strich für Strich auf dem TV (gebündelt mit ~15 Hz, der TV malt in eine RenderTexture wie bei Kurve). Alle anderen tippen Rateversuche, schnellere Treffer geben mehr Punkte, der Maler bekommt Punkte pro Treffer. Mit der Zeit werden Buchstaben als Hinweis aufgedeckt, Fast-Treffer („Flamingo“ statt „Flamingos“) werden freundlich gemeldet.
*Lücke:* Stille Post ist langsam und versetzt, das hier ist schnell, laut und gleichzeitig.
*Technik:* Die Zeichenfläche aus `stillepost.ts`/`pixel.ts` gibt es schon. Neu sind Strich-Streaming und unscharfer Wortvergleich (Umlaute, Plural, Levenshtein ≤ 1).

**7. Lügen-Lexikon** *(3–12 · Handy: Tastatur + Abstimmung · S Code, M Inhalte · 6–8 min)*
Der TV zeigt ein seltsames echtes Wort oder einen Fakt mit Lücke („Ein ‚Fernwehgürtel‘ ist …“). Alle schreiben eine glaubwürdige Fälschung, der TV listet alle Fälschungen plus die Wahrheit, alle tippen auf die vermutete Wahrheit. Punkte gibt es für die Wahrheit und für jeden, der auf die eigene Lüge hereinfällt.
*Lücke:* Bluff mit Text. Das deutsche „Nobody is perfect“ kennt jeder. Anders als Sprüche-Duell (Humor) geht es hier um Täuschung.
*Aufwand:* Der Code ist der Sprüche-Duell-Fluss. Die Arbeit liegt in 150 guten deutschen Wörtern und Fakten.

**8. Strand-Band** *(2–12 · Handy: Tippen/Schütteln im Takt · S–M · 2–3 min pro Song)*
Ein eingebauter Song läuft am TV. Jedes Handy ist ein Instrument (Trommel, Shaker, Kuhglocke, Klatschen) und zeigt seine eigene Notenspur. Bewertet wird **am Handy**, wie schon im Date-Night-Rhythmusspiel, der TV zeigt die Bühne mit 12 Avataren, die mitwippen, und eine Gruppen-Combo. Bei hoher Combo gibt es Feuerwerk, bei Patzern gerät die Band hörbar aus dem Takt.
*Lücke:* Rhythmus für viele gibt es nicht (`rhythm` hat max. 2 Spieler).
*Wiederverwendung:* Die Noten lassen sich **automatisch aus den Schlagzeug- und Bassspuren der eingebauten Songs erzeugen** (`shared/music.ts`), `timesync.ts` und `playRhythmSong` existieren. Die Musik-Investition zahlt sich doppelt aus.

**9. Drachenboot** *(4–12 in 2 Teams · Handy: Paddel-Schwung, Fallback Wischen · S–M · 60–90 s)*
Zwei Drachenboote, jedes Teammitglied schwingt das Handy wie ein Paddel. **Gleichzeitige** Schläge geben einen Turbo, chaotisches Paddeln bremst. Ein Trommler-NPC auf dem TV gibt den Takt vor, das Team muss sich laut synchronisieren. Hindernisse (Bojen) zwingen zum einseitigen Paddeln.
*Lücke:* ein Team-Sensorspiel, kurz genug fürs Brett, für 12 gleichzeitig. Die Team-Version von SUP.
*Wiederverwendung:* Schwungerkennung aus `throwInput.ts`/Bowling, Wasser-Grafik aus SUP und Lagune.

**10. Geheimcode am Pool** *(4–12 in 2 Teams · Handy: geheimer Lageplan + Abstimmung · M · 12–20 min)*
5 × 5 Wörter auf dem TV, nur die „Chefs“ beider Teams sehen am Handy die geheime Farbkarte. Der Chef sagt laut einen Hinweis plus Zahl, sein Team tippt die Wörter am Handy an (der Kapitän bestätigt), die Bombe beendet das Spiel. Ein 90-s-Timer pro Hinweis hält das Tempo hoch.
*Lücke:* Das beste Partyspiel für 8–12 mit privatem Bildschirm fehlt ganz.
*Aufwand:* M wegen Wortliste (400 deutsche Wörter), Teamwahl und Ablauf. Eher Arcade als Brett.

**11. Bombe entschärfen** *(3–12 · Handy: ein Spieler hat die Bombe, alle anderen je eine Handbuch-Seite · M · 5–8 min)*
Der TV und das Handy des Entschärfers zeigen eine Strandbar-Bombe mit 3–4 Modulen (Drähte, Knopf, Symbole, Farb-Simon). Alle anderen haben auf ihrem Handy **verschiedene Seiten** des Handbuchs, niemand hat alle. Man muss reden und kombinieren. Jede Runde gibt es einen neuen Entschärfer, mehr Spieler bedeuten kleinere Handbuch-Stücke.
*Lücke:* asymmetrisch **und** kooperativ mit Rätsel-Charakter. Der Urlaubsflieger ist reines Rufen unter Zeitdruck, das hier ist Logik.
*Aufwand:* M wegen der Modul-Regeln (prozedural pro Runde).

**12. Flohmarkt-Auktion** *(3–12 · Handy: geheime Infos + Gebote · S–M · 6 min)*
Gegenstände kommen unter den Hammer („Omas Schwimmflügel“), ihr wahrer Wert ist verdeckt, aber jeder Spieler kennt am Handy den Wert von 2–3 Gegenständen. Verdeckte Gebote am Handy, der Höchstbietende zahlt, am Ende wird aufgedeckt. Bluffen („Ich biete hoch, weil ich weiß, dass es viel wert ist … oder?“) ist der Kern.
*Lücke:* Wirtschafts-Bluff mit privaten Infos.
*Fazit:* Mittelmaß, nur falls noch Lust ist.

**Wo die Lücken abgedeckt sind:**

| Lücke | Ideen |
|---|---|
| asymmetrisch | 11, 2 (Funker), 10 (Chef) |
| kooperativ | 11, 8, 9 |
| Bewegungssensor | 5, 9, 4, 8 |
| 10–12 gleichzeitig | 1, 2, 3, 5, 6, 8, 9 |
| 60-s-Brettspiele | 5, 9, 3 (Kurzform) |
| Handy als geheime Hand | 4, 10, 2, 12 |
| Rhythmus | 8, 9 |
| Quiz | 3, 7, 1 |
| Bluff | 4, 7, 12 |

### 4c. Bewertung: In Arbeit und Warteschlange (`docs/status.json`)

| Projekt | Status | Urteil | Begründung |
|---|---|---|---|
| Angeln | in Arbeit | 👍 weitermachen | Sensorspiel mit Ruhe-Moment (Anbiss, Spannung). Wichtig: **alle gleichzeitig** angeln lassen (wie Darts), nicht reihum |
| Wasserpistolen-Duell | in Arbeit | 👍, aber Format prüfen | Gutes 30-s-Brettspiel. Bei 12 Spielern wird ein Duell-Turnier aber zu lang → „alle gegen alle gleichzeitig, jeder hat einen zugelosten Gegner“ oder Runden à 4 gleichzeitige Duelle. Ähnelt dem Reaktionstest im Liegestuhl-Sprint |
| Zauber-Arena | in Arbeit | ✋ **pausieren** | Wäre die ~9. Echtzeit-Arena (Arena, Smash, Sumo, Bogen, Autoball, Volley, Kurve, TTT, Parcours). Geringster Grenznutzen fürs Portfolio. Falls fast fertig: als Smash-Bühne oder Spezialset statt als eigenes Spiel |
| Kings Cup | in Arbeit | 👍 | Trinkspiel-Klassiker, klein, passt in den Modus |
| Fallen-Parcours-Fix, Wackelturm-Fix | in Arbeit | 👍 | echtes Gruppen-Feedback hat Vorrang |
| Sensor-Rückmeldung | in Arbeit | 👍👍 | Richtig: Wer nicht sieht, was erkannt wurde, gibt auf. Gleich im Juice-Modul (Handy-Seite) verallgemeinern |
| Nochmal + Leaderboard | in Arbeit | 👍 | dabei das Leaderboard aus dem 20-Hz-Zustand nehmen (3.10) |
| Kofferpacken | Warteschlange | ✋ zusammenlegen | Physik-Stapeln überschneidet sich stark mit Wackelturm (matter-js). Besser als **Wackelturm-Variante** „Kofferraum“ |
| Süßigkeiten-Klau | Warteschlange | 🆗 später | Asymmetrisch (2 Wächter gegen Sammler), gut für 6–12, überschneidet sich aber mit Fangen und Geist. M |
| Spion unter Gästen | Warteschlange | 👍👍 **vorziehen** | Einzigartig, glänzt mit 12, nutzt den privaten Bildschirm perfekt. Braucht eine kleine NPC-Menge (Wegpunkte, Pausen, Herdenverhalten), damit Spieler darin untertauchen. M |
| Umzugschaos | Warteschlange | ✋ streichen/später | Moving-Out-Koop überschneidet sich mit Grill-Chaos und Aufräumen, braucht Physik-Tragen zu zweit. L |
| Wackel-Prügelei | Warteschlange | ✋ später | Ragdoll-Physik verzeiht Latenz sogar (alles ist ohnehin wabbelig), aber es wäre die nächste Prügelei neben Sumo und Smash. L |

**Empfohlene Reihenfolge der nächsten Spiele:**

1. Wer war's?
2. Schätzkönig
3. Mäxchen
4. Funkfrequenz
5. Spion unter Gästen
6. Montagsmaler live
7. Strand-Band

Die Punkte 1–4 sind jeweils ein Abend, weil sie auf dem Sprüche-Duell- und WWE-Fluss aufbauen. Sie verschieben das Portfolio von „Action-lastig“ zu „ausgewogen“.

---

## 5. Top-10-Maßnahmen (Wirkung ÷ Aufwand)

S = Abend, M = Wochenende, L = mehrere Wochenenden.

### Quick Wins

| # | Maßnahme | Aufwand | Erwartete Wirkung |
|---|---|---|---|
| 1 | **Soundeffekte am TV:** ~25 prozedurale Effekte über den vorhandenen `fxBus` (Regler „Effekte“ existiert schon), mit Panning nach x-Position, zuerst in Smash, Arena, Igel, Sumo, Bogen, Ententeich, Kart. `VersteckScene` auf den gemeinsamen Synth umhängen (heute an Lautstärke und Stumm vorbei) | S–M | Größter einzelner Sprung im Spielgefühl. Jeder Treffer, Platsch und Countdown fühlt sich doppelt so gut an |
| 2 | **`Room.changed()` sofort senden statt immer 40 ms warten** + `transports: ['websocket']` + Stick-Timeout 700 ms am Server | S | −40 ms Latenz in allen Echtzeit-Spielen, keine „Geisterläufer“ bei WLAN-Löchern |
| 3 | **Leaderboard und `players` aus dem 20-Hz-Zustand** (eigenes `meta`-Event bei Änderung), `private` nur bei Änderung, Handy-`render()` per `requestAnimationFrame` | S | −33 % bis −80 % WLAN-Last bei 12 Handys, flüssigere Handys |
| 4 | **Igel-Sofortpaket:** Wind driftet, `TURN_MS` nach Spielerzahl, ab 7 Spielern nicht aufs Brett, HP am Zugende herunterzählen, Banner „X ist dran“ + Kamera folgt dem Geschoss | S | Igel wird bei 2–6 Spielern deutlich besser und blockiert keine Party mehr |
| 5 | **Robuster Reconnect:** 3 s Gnadenfrist vor `playerDisconnected`-Folgen (Arena tötet nicht mehr), Wake Lock bei `visibilitychange` neu anfordern, Fallback über HTTP | S | Weniger „ich war kurz weg und bin tot“-Frust |

### Strukturelle Umbauten

| # | Maßnahme | Aufwand | Erwartete Wirkung |
|---|---|---|---|
| 6 | **Juice-Modul + einheitliches `fx`** (`FxLog` am Server, `Juice.play(fx)` am TV, ParticleEmitter statt 8× `puff`, ein Banner statt 21, Sprecher-Ansagen per `speechSynthesis`) | M | Alle 42 Spiele fühlen sich gleich hochwertig an. Neue Spiele bekommen Juice gratis |
| 7 | **Eine Spielerfarbe + Kürzel pro Abend** und **Avatar-Animations-Frames** (Laufen, Sprung, Treffer, Jubel, Blinzeln) in `shared/avatar.ts`, ersetzt 14 kopierte Hüpfer | M | Mit 12 Spielern deutlich lesbarer. Der größte „wirkt nicht mehr billig“-Effekt im Look |
| 8 | **Regelkarte + Übungsfeld vor jedem Spiel** (`MINI_INFO.howTo`, Raum-Phase `intro`, „Bereit!“) und **Zuschauer-Ebene** (Emotes, Wetten) | M | Neue verstehen jedes Spiel in 10 s. Ausgeschiedene bleiben beteiligt |
| 9 | **`SnapBuffer` (Interpolation mit Wiedergabe-Uhr)** für alle Echtzeit-Spiele, Server stempelt `t` in jeden Snapshot. Damit kommen Hit-Stop, Zeitlupe beim letzten K.O. und Wiederholungen („TOR!“) ohne Server-Umbau. Danach Render-Auflösung ×2/×4 | M (+ M) | Glatte Bewegung statt 20-Hz-Pumpen, Hit-Stop und Replays fast gratis. Mit ×4 auch saubere Drehungen und Herauszoomen |
| 10 | **Portfolio umsteuern:** Zauber-Arena pausieren, die nächsten 4 Spiele aus 4b (Wer war's?, Schätzkönig, Mäxchen, Funkfrequenz, je S), danach Igel Stufe M („Alle gleichzeitig“, 10 Waffen, Kisten, Fässer) und Spion unter Gästen | je S, dann M | Die Spieleliste passt endlich zu „Handy als Controller“ und zu 12 Leuten. Igel wird Worms-würdig |

**Begründung der Reihenfolge:**

- 1–5 sind Abende mit sofort spürbarer Wirkung für alle Spiele bzw. die größte Baustelle.
- 6 und 7 sind das Fundament, das jede spätere Arbeit billiger macht.
- 8 und 9 heben das Ganze von „Hobby-Sammlung“ zu „Party-Produkt“.
- 10 sorgt dafür, dass neue Arbeit dorthin geht, wo das Portfolio Lücken hat, statt eine zehnte Arena zu bauen.
