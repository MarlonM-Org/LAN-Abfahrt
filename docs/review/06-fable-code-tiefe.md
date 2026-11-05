**Gutachter:** Claude Fable 5.1 (Fork) / Effort hoch (Schwerpunkt: Code-Tiefe der Flaggschiff-Spiele + Party-Schleife)

Gelesen (vollständig): `server/igel.ts`, `shared/igel.ts`, `client/host/IgelScene.ts`, `client/controller/screens/igel.ts`; dasselbe Trio für `smash`, `kart` (+ `client/kart3d/world.ts`, Kopf von `render.ts`), `arena` (Screen in `screens/controller.ts`), `parcours`, `sumo`, `grill`, `ttt` (+ `shared/house.ts`); Party-Schleife `server/room.ts`, `server/board.ts`, `client/host/BoardScene.ts`, `client/host/ResultsScene.ts`, `screens/board.ts`, `screens/results.ts`; Controller-Fundament `core.ts`, `motion.ts`, `tilt.ts`, `throwInput.ts`, `aim.ts`, `audio.ts`, `style.css` (Stichproben) und die Joystick-Implementierungen.

---

## 0 · Kurzfazit

Die Code-Basis ist für ein Hobbyprojekt ungewöhnlich sauber: jedes Spiel hat ein eigenes, autoritatives Server-Modell mit festem Takt (50 ms), geteilte Konstanten in `shared/`, nachvollziehbare Balance-Werte und fast überall eine Ergebnislogik, die Gleichstände und Abbrecher bedenkt. Das Kart-Rennen hat sogar Client-Vorhersage mit Reconciliation – das ist Netcode-Niveau, das viele kommerzielle Browser-Partyspiele nicht haben.

Die Schwächen liegen nicht im Code-Handwerk, sondern im **Design für 8–12 Spieler** und im **Rhythmus**:

1. Mehrere Spiele skalieren schlecht nach oben: Igel-Krieg ist bei 12 Spielern ein Zuschauer-Spiel (1–2 eigene Züge in 8 Minuten), Fallen-Parcours lässt ab 9 Spielern dieselben Leute **nie** laufen (echter Bug), Smash wirft bei 2 Leben Spieler nach 30 s für 2,5 Minuten raus.
2. Ausgeschiedene haben nirgends etwas zu tun (Arena, Sumo, Smash, TTT, Bogen): „Du schaust zu“ ist der häufigste Handy-Screen des Abends.
3. Das Spielbrett ist eine reine Würfel-Animation ohne eine einzige Entscheidung – 12 Leute warten bis zu einer Minute pro Runde, nur um einen Würfel zu sehen.
4. Verräter im Ferienhaus funktioniert als Deduktionsspiel auf einem **gemeinsamen** Bildschirm nicht: Jeder Angriff ist für alle sichtbar, inklusive Namensschild über dem Täter.
5. Game-Feel ist gut (Screenshake, Partikel, Hitstun-Flackern), aber Haptik auf dem Handy ist für iPhone-Nutzer faktisch nicht vorhanden (`navigator.vibrate` gibt es auf iOS nicht) und Sound auf dem Handy fehlt komplett.

---

## 1 · Spiel für Spiel

### 1.1 Igel-Krieg (`igel`) – der Worms-Klon

**(a) Was gut ist**

- Terrain als Bitmaske, nur Seed + Kraterliste werden übertragen (`shared/igel.ts` `buildTerrain`), TV stanzt Krater lokal in eine Canvas-Textur (`IgelScene.applyCraters`). Elegant und bandbreitenschonend.
- Physik ist deterministisch in `shared/igel.ts` (`stepBallistic`, `launch`), die Bots simulieren damit ihre Schüsse. Sub-Steps mit `DT = 0.005` – Geschosse tunneln nicht.
- Vier Waffen mit sinnvollen Rollen: Bazooka (Wind), Wasserbombe (3 s Zünder, hüpft), Teleport, Schlag. `BAZOOKA.ARM_MS = 140` verhindert Selbsttreffer beim Abschuss.
- Game-Feel am TV ist das beste im Projekt: Explosionsblitz + Feuer + Rauch + Erdbrocken + „BUMM!/KRAWUMM!“ + Shake (`IgelScene.playFx 'boom'`), Fallschaden, Schwimmring treibt im Wind davon.
- Handy: Ziehen = Winkel + Kraft mit Farbverlauf grün→rot, Reichweitenkreis, Zielvorschau auf dem TV (`send('aim')` alle 90 ms, `screens/igel.ts:173`), Zuschauer bekommen eine eigene Mini-Karte mit HP-Balken.

**(b) Schwächen**

- **Skalierung ist der Killer.** `shared/igel.ts:13` `TURN_MS = 30000`, `:18` `SUDDEN_MS = 5 min`, `:20` `HARD_CAP_MS = 8 min`. Ein Zug dauert realistisch 15–25 s (Zielen + bis 9 s Flug `server/igel.ts:510` + 3 s Rückzug + Settle). Bei 12 Teams (`server/igel.ts:89`: ab 5 Spielern nur noch 1 Igel pro Team) kommen in 8 Minuten ~20–30 Züge zustande → **jeder Spieler schießt 2-mal, wartet dazwischen 3–4 Minuten**. Elimination ist unmöglich: 11 Gegner × 100 HP ÷ 45 Bazooka-Schaden = ≥ 33 Treffer. Das Spiel endet praktisch immer per Zeitlimit mit „meiste Lebenspunkte“.
- Sudden Death steigt **pro Zug**, nicht pro Runde (`server/igel.ts:178–192`): `WATER_RISE = 20` × ~10 Züge = Insel komplett weg, bevor bei 12 Teams jeder einmal dran war. Wer zufällig tief steht, ertrinkt, ohne gespielt zu haben.
- Kein Haltezeit-Laden („Power-Bar“ wie bei Worms), sondern Ziehlänge. Das ist für Touch richtig – aber die TV-Vorschau zeigt nur einen kurzen Pfeil (`IgelScene.ts:372`, max. 72 px), keine Flugbahn-Hilfe. Für Neulinge ist der erste Schuss Lotterie, besonders mit Wind.
- Der aktive Spieler sieht am Handy **nicht**, wo sein Igel steht (Mini-Karte gibt es nur im Zuschauer-Screen `screens/igel.ts:229`). Er muss zwischen TV und Pad hin- und herschauen; bei 12 kleinen Igeln auf 480 px ist der eigene schwer zu finden (nur Pfeil + Name).
- Nur ein Spieler = ein Team, keine Kooperation. Worms’ bester Moment (Team-Absprache „nimm du den links“) fehlt.
- Keine Kisten/Drops, kein Seil, keine Mine, kein Luftangriff – die Waffen-Palette ist nach 2 Partien ausgereizt.

**(c) Verbesserungen**

1. **(M) Parallele Züge statt Rundlauf:** Alle Teams zielen gleichzeitig innerhalb von 12 s, dann fliegen alle Geschosse zusammen (Hedgewars-„Simultaneous“/WWP-Echtzeit-Variante). Reduziert eine 12er-Runde von ~4 Minuten auf ~25 s und löst die Flut-Unfairness nebenbei. Technisch: `aim`/`fire` pro Team puffern, `flight` einmal für alle.
2. **(S) Turn-Zeit und HP nach Spielerzahl skalieren:** `TURN_MS = clamp(30000 − 2000·(n−2), 12000, 30000)`, `HP = n ≥ 8 ? 60 : 100`. Dazu Sudden Death erst nach einer vollen Runde steigen lassen (`turn % teams.length === 0`).
3. **(M) Teams à 2–3 Spieler ab 6 Spielern**, jeder Igel gehört einer Person; Zug-Reihenfolge innerhalb des Teams rotiert. Halbiert die Wartezeit, erzeugt Tischgespräche. Bonus (S): Mini-Karte auch im aktiven Screen und Trajektorien-Punkte auf dem TV (aus `simulateBazooka` die ersten 25 Schritte zeichnen – die Funktion existiert bereits für Bots).

**(d) Bugs / Unfairness (belegt)**

- Flut pro Zug statt pro Runde (siehe oben, `server/igel.ts:186–192`) – bei ≥ 6 Teams ertrinken Spieler, die seit Sudden-Death-Beginn keinen Zug hatten.
- `server/igel.ts:166`: Ist ein Spieler kurz offline (App gewechselt), bekommt er 1,5 s Zugzeit und verliert den Zug faktisch – bei 4 Minuten Wartezeit pro Zug ist das hart; eine Gnadenfrist von 5 s mit Hinweis wäre fairer.

---

### 1.2 Smash-Arena (`smash`)

**(a) Was gut ist**

- Echtes Fighting-Game-Gerüst: Startup/Active/End-Frames pro Angriff (`shared/smash.ts:136–143`), Hitbox vs. Hurtbox, Knockback = `base + scale·%` (`knockback()`), Hitstun skaliert mit Knockback, Eingabepuffer 160 ms (`server/smash.ts:228`), Sprung kann die Nachlaufphase eines Angriffs abbrechen.
- Großzügiger Kantengriff (`physics()` „Kante greifen“) und zwei Luftsprünge machen das Zurückkommen mit Touch-Stick machbar.
- Präsentation: Trefferstern, Shake ab stärkeren Hits, KO-Lichtstrahl + Blitz + Flash, Hitstun-Weißflackern, Trail-Puffs ab 200 px/s, Rand-Marker mit Porträt, dynamische Kamera (Zoom 1–1,3). Prozentzahl pulsiert bei Schaden. Handy vibriert proportional zum Schaden.
- Substeps (4) verhindern das Durchfallen durch dünne Plattformen.

**(b) Schwächen**

- `shared/smash.ts:10` `TIME_MS = 180 s`, `:53` ab 6 Spielern 2 Leben. Mit 10–12 Leuten auf einer 280 px breiten Hauptplattform ist ein Spieler nach 20–40 s raus und sitzt dann 2+ Minuten auf dem Screen `sm-out` (`screens/smash.ts:118`). Keine Zuschauer-Rolle.
- Spezialmove wird zufällig zugeteilt (`server/smash.ts:180`), nicht gewählt. Dadurch keine Identität („ich bin der Wasserpistolen-Typ“) und ungleiche Recovery: `schirm` und `matratze` sind zusätzliche Aufwärts-Impulse, `flipflop`/`cocktail`/`wasser` nicht.
- `wasser` (`shared/smash.ts:165`: `base 250, scale 0.4`) hat bei 0 % bereits den Rückstoß eines Seitenschlags bei ~29 % – am Rand ein Instant-Edge-Guard mit 2 s Abklingzeit. Nicht kaputt, aber die klar stärkste Zuteilung.
- Nur zwei Bühnen mit fast identischem Layout (Hauptplattform + 2 Seiten + 1 bewegliche). Keine Gefahren, keine Bühnen-Events.
- Kamera-Zoom bleibt bei vielen Spielern bei 1 (`SmashScene.ts:630`); Avatare sind 24 × 40 px auf 480 × 270 – okay, aber 12 Namensschilder à 5 Zeichen sind unlesbar.
- Kein Hit-Stop (Freeze-Frames bei Treffern), kein Sound – genau die zwei Dinge, die Smash „knackig“ machen.

**(c) Verbesserungen**

1. **(S) Ausgeschiedene werden Geister:** dürfen alle 10 s ein Item von oben fallen lassen (Position per Stick wählen). Kostet ~60 Zeilen Server + ein kleiner Screen; löst das Zuschauer-Problem.
2. **(S) Spezial in der Countdown-Phase wählen** (3,5 s reichen mit 5 Kacheln) und jeder bekommt zusätzlich einen Standard-Recovery (`schirm`-ähnlich, einmal pro Luftphase). Wahl in `localStorage` merken.
3. **(M) Team-Modus ab 6 Spielern** (Sonne/Meer, Friendly-Fire aus, Stocks gepoolt) – halbiert die Chaos-Dichte und verlängert die Lebenszeit jedes Einzelnen. Plus (S) Hit-Stop: beim Treffer ab `kb > 300` Server-Tick für 60–90 ms „einfrieren“ (eigenen `freezeUntil`), TV-Lerp pausieren.

**(d) Bugs / Unfairness**

- `server/smash.ts:239` `playerDisconnected` nullt nur Eingaben: ein Offline-Spieler steht als Zielscheibe auf der Plattform und wird von allen zu KOs verwertet (`kos` zählen). Offline > 3 s sollte unverwundbar + halbtransparent sein.
- Keine echten Bugs gefunden; die Physik ist sorgfältig (Plattform-Mitfahren, Kopfstoß gegen feste Plattformen).

---

### 1.3 Kart-Rennen (`kart` + `client/kart3d`)

**(a) Was gut ist**

- `stepKart()` in `shared/kart.ts` läuft identisch auf Server und Handy; `client/kart3d/world.ts` macht Prediction + Replay der Eingaben seit dem letzten Server-Stand und blendet den Korrekturfehler über 150 ms aus. Andere Karts werden 100 ms in der Vergangenheit interpoliert (`world.ts:49`). Das ist der mit Abstand beste Netcode im Projekt.
- Drift-System mit Ladung und Mini-Turbo, Gegenlenken weitet den Bogen – fühlt sich nach Mario Kart an. Haptik: Vibration beim Drift-Start, bei „geladen“, beim Turbo, beim Treffer.
- Rubber-Banding über `rollItem()` (`server/kart.ts:275`): Führender bekommt nur Banane/Kokosnuss, hinten Möwe/Eis.
- Mode-7-Renderer ohne Phaser auf Handy und TV, Splitscreen bis 4, jeder kann live zwischen TV- und Handy-Ansicht wechseln, ohne dass gehaltene Finger verloren gehen (sehr durchdacht im `screens/kart.ts`).

**(b) Schwächen**

- `shared/kart.ts:17` `MAX_SPEED = 88` auf ~1200 px Strecke: eine Runde ≈ 14 s, drei Runden ≈ 45 s. Das Rennen ist vorbei, bevor Items Dramaturgie erzeugen; `AFTER_WINNER_MS = 20 s` (`:13`) heißt bei 12 Karts: die Hälfte wird DNF gewertet.
- Vier Items, keines mit Spannungsbogen (kein roter Panzer, kein Blitz). Die Möwe trifft nur den Führenden – bei 12 Spielern bestraft sie denselben Spieler immer wieder.
- Item-Knopf oben rechts (`k3-item`) liegt weit vom rechten Daumen (GAS unten rechts) entfernt; ein Item-Einsatz kostet kurz Gas.
- Countdown 8 s (`shared/kart.ts:11`) ist für die Ansichtswahl gedacht, fühlt sich aber bei jedem Rennen lang an.
- Keine Rundenzeiten, kein Fotofinish, keine Bestenliste pro Strecke – für ein Rennspiel fehlt das Vergleichsmoment über den Abend hinweg (`feature/nochmal-leaderboard` ist in Arbeit).
- TV-Splitscreen rendert in 240 × 125 px pro Pane; das ist bewusst pixelig, aber Gegner sind nur wenige Pixel groß und ab 4 Panes nicht mehr erkennbar.

**(c) Verbesserungen**

1. **(S) Grand-Prix-Format:** 3 Strecken hintereinander mit Punkten (10/8/6/…), Zwischenstand-Screen. Die Infrastruktur (`finishOrder`, Leaderboard) ist da. Dazu `LAPS` je Strecke und `AFTER_WINNER_MS` nach Spielerzahl skalieren (`20000 + 2000·n`).
2. **(M) Zwei Items mehr:** „Fliegende Kokosnuss“ (Homing auf das nächste Kart voraus, 1,5 s Lebensdauer) und „Sonnencreme-Pfütze“ (Drehen beim Durchfahren, 15 s). Beides sind Varianten vorhandener Hazards (`updateHazards`).
3. **(S) Item-Knopf auf die linke Seite über den Stick** (linker Daumen hat beim Lenken Spiel), oder „Item = Drift-Knopf tippen“ statt halten.

**(d) Bugs / Unfairness**

- `server/kart.ts:152`: Offline-Karts rollen aus und stehen dann als Hindernis auf der Strecke („Geist“ wären sie nur nach dem Zieleinlauf). Bei 12 Spielern mit einer Handy-Sperre pro Rennen regelmäßig ein Blocker auf der Ideallinie.
- `rollItem()` `server/kart.ts:284`: Platz 1 bekommt **nie** Eis – korrekt als Rubber-Banding, aber bei 2 Spielern wird der Zweite so fast immer mit Möwe/Eis gefüttert, während der Erste nur Bananen legen kann; bei 2–3 Spielern lieber die mittlere Tabelle für alle.

---

### 1.4 Bomben-Arena (`arena`)

**(a) Was gut ist**

- Bewegung auf Kachelmitten mit Ecken-Hilfe und Abbiege-Vorrang (`server/arena.ts tryMove/move`) – das löst das klassische Touch-Bomberman-Problem „hängt an der Ecke“. `DEAD = 0.3` (`:34`) passt zum Fix-Pad.
- Flut als Spirale (`FLOOD_ORDER`), Kettenexplosionen, Items mit `safeUntil`, Spawn-Freiräume. Rundenformat Best-of-3 mit Überlebens-Punkten (`survival`) als Tiebreak – die Wertung ist fair auch für Runden-Verlierer.
- Scene: Kisten zerbröseln, Wasserspritzer statt Feuer (Thema!), Bomben pulsieren und blinken kurz vor dem Knall, HUD mit Porträts und Siegpunkten.

**(b) Schwächen**

- 60 s Runde (`shared/arena.ts:16`) + 14 s Flut; wer früh stirbt, wartet bis ~70 s auf dem Screen `ar-dead` (`screens/controller.ts:143`). Dreimal pro Partie.
- Keine Bomben-Kick/-Wurf-Mechanik und keine „Bombenanzahl −1“-Flasche – Power-up-Spirale ist nach 30 s ausgereizt (max. Reichweite 8 auf einem 23 × 11-Feld = fast die ganze Arena).
- Kein Vibrations-/Feedback-Moment beim eigenen Tod am Handy (nur Text). Beim Bombenlegen vibriert es (`:163`), beim Sterben nicht.
- Beim Legen gibt es keine Server-Rückmeldung, wenn die Bombe nicht gelegt werden konnte (z. B. Limit erreicht) – der Spieler drückt ins Leere.
- Shake bei Explosionen ist mit `0.004` sehr dezent; im Vergleich zu Igel (0.006) und Smash-KO (0.016) wirkt die Arena ruhig.

**(c) Verbesserungen**

1. **(S) Tote werden Flut-Helfer:** Ausgeschiedene bekommen alle 8 s eine Wasserbombe, die sie per Stick auf ein Feld am Rand werfen (nur auf schon gefluteten/äußeren Kacheln, damit es fair bleibt). Bomberman-„Revenge-Cart“-Prinzip.
2. **(S) Zwei Items ergänzen:** „Kick“ (Bombe schiebt sich beim Dagegenlaufen) und „Platsch-Schutz“ (ein Treffer wird absorbiert). Kick braucht nur eine `vx/vy` an der Bombe plus Stopp an Hindernissen.
3. **(S) Rundenzeit nach Spielerzahl:** `ROUND_MS = n ≤ 4 ? 60 s : 45 s`, Flut-Schritt 50 ms. Mehr Runden (Best-of-5 bei ≥ 8), dafür kürzere.

**(d) Bugs / Unfairness**

- `server/arena.ts:377`: Jeder Verbindungsabbruch während `play` tötet sofort (`kill(id, null)`). Ein 1-Sekunden-WLAN-Hänger oder ein versehentliches Wischen zum Homescreen = Runde verloren. Besser: 3 s einfrieren, dann erst raus.
- Keine weiteren Bugs; die Grid-Logik ist korrekt (geprüft: Kettenreaktion, Item-Safe-Fenster, Flut löscht Bomben).

---

### 1.5 Fallen-Parcours (`parcours`)

**(a) Was gut ist**

- Platformer-Feel ist richtig gemacht: Coyote-Zeit 100 ms, Sprungpuffer 130 ms, Jump-Cut beim Loslassen (`P.JUMP_CUT`), Wandrutschen + Wandsprung, Eis mit reduzierter Beschleunigung, Ventilator-Windzonen, Mover-Mitfahren. Substeps 4.
- UCH-Regel „Punkte nur, wenn nicht alle und nicht keiner ankommen“ (`server/parcours.ts:174`) ist korrekt umgesetzt und erzeugt echte Zielkonflikte beim Bauen.
- Bau-Phase mit Geistern aller Spieler gleichzeitig auf dem TV, rot/grün-Validierung (`canPlace`), Bombe erst ab vorhandenen Teilen. Platzieren mit `tapButton`, Wahl mit großen Karten.

**(b) Schwächen**

- `shared/parcours.ts:69` `MAX_RUNNERS = 8`, `server/parcours.ts:129` `active().slice(0, 8)`: **ab 9 Spielern laufen immer dieselben 8** (die ersten in `ids`), die übrigen bauen nur und können nie Ziel-/Erster-Punkte holen. Siehe (d).
- `BUILD_MS = 15 s` (`:30`): Teil wählen, Geist 300 px weit fahren (150 px/s), drehen, platzieren – für Neulinge zu knapp (Marlons Feedback bestätigt das; Fix in Arbeit). Timer-Ende setzt den Geist automatisch, auch an schlechter Stelle.
- Läufer sind auf dem TV 8 × 13 px (`ParcoursScene.ts:255` `setScale(0.5)`) – bei 8 gleichzeitigen Läufern vom gleichen Startpunkt ein Pixelhaufen; nur ein kleines farbiges Dreieck unterscheidet.
- Strecke ist immer dieselbe Grundform (`BASE_SOLIDS`), nur 5 feste Felsen; nach 2 Partien ist jeder Build-Trick bekannt.
- Pick-Buttons nutzen `click` (`screens/parcours.ts:65, :92`), der Rest `tapButton` – minimal langsamer und inkonsistent, nicht spielentscheidend.

**(c) Verbesserungen**

1. **(S) Läufer rotieren oder alle laufen:** entweder `MAX_RUNNERS` auf 12 (Physik ist billig, 12 Läufer × 4 Substeps ist nichts) oder pro Runde ein rotierendes Fenster (`offset = round · 8 % n`). Erstes ist einfacher und fairer.
2. **(M) 3–4 Grundstrecken** (Spiegelung + zwei weitere Fels-Layouts) und Zufallswahl pro Partie; `BASE_SOLIDS`/`GOAL`/`NO_BUILD` als Array von Layouts.
3. **(S) Bau-Phase endet, wenn alle platziert haben, sonst 25 s; letzter Spieler bekommt ein „Alle warten auf dich“ mit Vibration** (der Server beendet bereits bei `allDone`, nur das Zeitlimit und das Drängeln fehlen).

**(d) Bugs / Unfairness (belegt)**

- **Unfair ab 9 Spielern** (`server/parcours.ts:129`): `this.ids` ist die Join-Reihenfolge, `active()` filtert nur Offline raus, `slice(0, 8)` nimmt immer dieselben. Spieler 9–12 können in 6 Runden ausschließlich Fallen-Punkte (max. 2/Runde) sammeln, die anderen bis zu 7/Runde. Das Spiel hat kein `maxPlayers` in `MINI_INFO`, wird also mit 12 angeboten.
- `playerDisconnected` löscht den Läufer (`runners.delete`) – ein kurzer Abbruch während des Laufs = kein Ziel, keine Punkte, und das `verdict` ändert sich für alle (weniger Läufer → „alle angekommen“ wird wahrscheinlicher).

---

### 1.6 Sumo-Steg (`sumo`)

**(a) Was gut ist**

- Einfachster Controller des Projekts (Stick + REMPELN) und trotzdem Tiefe: Dash mit Masse 1,7 im Stoß, Frontalzusammenstoß ×1,8 (`shared/sumo.ts:42`), Stun 380 ms, Rempler wird selbst abgebremst – Timing-Duelle entstehen von allein.
- Steg skaliert mit Spielerzahl (`sumoRadii`), bricht von außen mit Zufallslöchern, Kern bleibt bis Sudden Death. Rundenlänge 45 s (`:23`) – kurz genug, dass Zuschauen erträglich ist.
- Scene: Planken knacken (rot blinkend) 1,3 s vor dem Bruch, Whoosh-Linien beim Dash, Bonk-Stern, Ripples, Figur kippt ins Wasser, dann Schwimmring mit Porträt. Dash-Cooldown als Füllstand am Knopf. Vibration bei Treffer.

**(b) Schwächen**

- Nur eine Mechanik; nach Runde 2 gibt es nichts Neues zu entdecken. Kein Power-up, keine Hindernisse, keine Boje zum Festhalten.
- Alle Startplätze im Kreis, Kern in der Mitte: das Spiel degeneriert zu „alle rennen in die Mitte“. Taktisches Warten am Rand wird durch das Wegbrechen bestraft – was gewollt ist, aber immer gleich abläuft.
- Dash-Richtung = letzte Stick-Richtung (`lx/ly`). Steht der Stick still, dasht man in die alte Richtung; auf dem Fix-Pad ohne Deadzone (`controller.ts joystick`) zittert `lx/ly` bei leichtem Druck.
- Zuschauer-Screen `su-dead` (`screens/sumo.ts:13`) ist ein reiner Text.

**(c) Verbesserungen**

1. **(S) Ein Spezial pro Runde:** „Anker“ (3 s unverschiebbar, Masse 5) oder „Sprint-Ladung“ (Dash-Knopf halten = längerer Dash, aber länger Cooldown). Server: zwei Felder, Screen: Halten statt Tippen (`holdButton` aus `smash.ts` wiederverwenden).
2. **(S) Planken-Varianten:** rutschige Planke (Reibung 2) und Trampolin-Boje am Rand. Beides nur Tile-Typen in `sumoShape` + ein Faktor in `move()`.
3. **(S) Tote dürfen Wellen machen:** Ausgeschiedene tippen alle 5 s eine Welle an, die von ihrer Position am Rand einen kleinen Stoß über den Steg schickt – kurze Zuschauer-Beteiligung, visuell leicht (Ripple existiert).

**(d) Bugs / Unfairness**

- `server/sumo.ts:401`: Wie in der Arena – jeder Disconnect während `play` = sofortiger Sturz ins Wasser.
- Kollision auflösen in 2 Pässen, Effekte nur im ersten – sauber; keine weiteren Auffälligkeiten.

---

### 1.7 Grill-Chaos (`grill`)

**(a) Was gut ist**

- Die Kombinier-Logik (`mergeItems`, `validCombo`, `matchRecipe` in `shared/grill.ts`) ist klein, deterministisch und handy-freundlich („geht nicht“ → rotes X über dem Kopf statt Fehlermeldung). Spieß = zwei rohe Grillzutaten – eine clevere Reduktion von Overcooked.
- Zielstation in Blickrichtung mit Diagonal-Malus (`targetOf`), Highlight-Rahmen auf dem TV in Spielerfarbe, Handy zeigt groß „DU TRÄGST“ + Kontext-Tipp (`grillHint`). AKTION-Latch 900 ms mit 300-ms-Wiederholung übersteht Paketverlust.
- Dramaturgie: 30 s Easy-Phase, Bestellrate wächst mit Küchengröße (`orderEvery`), Trinkgeld-Verfall, Feuer mit Löscher, Rauch als Warnung, Sterne-Ziele nach Spielerzahl. Team-Modus ab 7 mit gespiegelten Küchen.
- Wertung im Koop-Modus über Beitrag (`contrib`, `server/grill.ts:532`) statt „alle gleich“ – und Münzen hängen von den Sternen ab (`:557`).

**(b) Schwächen**

- Fünf Rezepte, max. zwei Verarbeitungsschritte; nach 3 Minuten hat man alles gesehen. Kein Teller-Rücklauf (dreckige Teller), keine Zeit-Ereignisse (Regen löscht Grill, Gäste-Ansturm).
- 3 Minuten (`shared/grill.ts:8`) sind für ein Koop-Spiel knapp – bei 2–3 Spielern ist die Easy-Phase ein Sechstel der Spielzeit.
- Beide Layouts sind offene Rechtecke mit einer Mittel-Theke; keine Engpässe, keine Förderbänder, keine getrennten Zonen, die Kommunikation erzwingen (das ist Overcookeds eigentlicher Trick).
- 12 Spieler = 6 pro 11 × 7-Küche mit `separate()` → Dauerdrängeln vor der Ausgabe. `maxOrders` im Team-Modus ist fix 3 (`server/grill.ts:206`), was bei 6 Köchen Leerlauf erzeugt.
- Kein Spieler sieht die Bestellliste gut: am TV sind Zettel 74 px breit, auf dem Handy 44 px-Icons ohne Zutatenschritte.

**(c) Verbesserungen**

1. **(S) Zwei Layouts mehr, die trennen:** eine Küche mit Durchreiche (Theke quer, nur ein Fenster) – erzwingt Arbeitsteilung. Nur ein String-Array in `GRILL_LAYOUTS`.
2. **(S) Rezept-Kurve nach Zeit:** ab 90 s 3-Zutaten-Teller (Spieß + Brötchen = „Grillteller“, 60 Punkte), ab 150 s „Große Bestellung“ (2 Gerichte gleichzeitig, doppelte Punkte). Rezepte nur in der Tabelle ergänzen.
3. **(M) Zwischen-Ereignisse:** alle 45 s eins von „Möwenangriff klaut eine Zutat von der Theke“, „Grill geht aus – neu anzünden (AKTION 2 s)“, „Happy Hour: Limo doppelt“. Das gibt dem TV-Zuschauer-Teil (Sprecher-Zeile) einen Grund.

**(d) Bugs / Unfairness**

- Team-Modus: `groups` = alle Gewinner gleich (Platz 1), alle Verlierer Platz 2 – korrekt; aber `details` zeigt nur `served/chops`, obwohl `contrib` auch `grilled`/`rescues` wertet. Kein Bug, aber der Spieler sieht nicht, warum er in der Arcade-Wertung vorn/hinten liegt.
- Keine Fehler in der Slot-/Merge-Logik gefunden (durchgespielt: Teller auf Theke + Zutat, Zutat auf Teller-Slot, Löscher nur auf `#`/`F`).

---

### 1.8 Verräter im Ferienhaus (`ttt`)

**(a) Was gut ist**

- Rollen-Verteilung bevorzugt, wer noch nicht Verräter war (`traitorRounds`), Detektiv ab 6, Rundenzahl nach Spielerzahl (`server/ttt.ts:90`). Private Infos korrekt über `privateFor`, Rolle nur bei gedrücktem Knopf sichtbar (`roleHold`) – gut gegen Mitlesen.
- Verräter-Shop (Falle in Tür, Tarnumhang, Fake-Funk) ist thematisch stark; Detektiv-Spur „Shirt-Farbe“ nach 5 s ist ein hübscher Deduktions-Haken.
- Waffen-Dreiklang: Poolnudel (Nahkampf, Zielhilfe im Kegel), Wasserpistole (4 Schuss, Reichweite 140 = fast ein Raum), Kokosnuss (2 Schaden, einmal). Feed-Zeile mit Tönen (Funk/Hinweis/Alarm).

**(b) Schwächen**

- **Konzeptbruch durch den gemeinsamen Bildschirm.** Jeder Angriff wird am TV als Animation an der Täterposition gezeichnet (`TttScene.attackFx`), und über jeder Figur steht ihr Name (`TttScene.ts:142`). Der Snapshot enthält alle lebenden Spieler mit Position (`server/ttt.ts:518`), nur Getarnte fehlen. Ergebnis: Der erste sichtbare Angriff entlarvt den Verräter für alle 12 Zuschauer gleichzeitig. Die `by = null`-Logik für den Tarnumhang (`:294`) betrifft nur die Feed-Zeile, nicht die Animation. Verräter starten mit **einem** Credit (`:133`), d. h. genau ein Kill unter Tarnung, danach ist das Spiel ein offenes Team-Deathmatch 3 gegen 9 – ohne Deduktion.
- `ROUND_MS = 180 s` (`shared/games.ts:379`) bei drei Runden plus Rollen-/Endscreens = bis zu 10 Minuten, in denen früh Ausgeknockte nur den Text `ttt-dead` sehen (`screens/ttt.ts:18`).
- Unschuldige haben keine Aufgabe außer Überleben und Zuschlagen. Da man alle sieht, gibt es auch keinen Grund, sich zu bewegen – Gruppenbildung in einer Ecke ist dominant.
- Wasserpistole: 3 Schuss in 1,1 s auf 140 px (`PISTOL_RANGE`, `shared/games.ts:386`) = KO aus sicherer Entfernung, Nudel braucht 3 Treffer à 700 ms auf 20 px. Wer die Pistole findet, gewinnt das Duell immer.

**(c) Verbesserungen**

1. **(M) Sichtbarkeit begrenzen – „Stromausfall“:** Der TV zeigt nur Räume mit Licht; jeder Raum hat einen Lichtschalter (BENUTZEN), Verräter können Licht ausknipsen (Shop, 0 Credits, Cooldown). In dunklen Räumen werden Figuren nur als Silhouette ohne Namen gezeichnet, Angriffe ohne Animation. Das ist dieselbe Idee wie die Geisterjagd-Szene und rettet das Deduktionsspiel.
2. **(S) Namen nur bei Stillstand oder nur auf Anfrage** (`txt` bei `moving` ausblenden) + Angriffs-Animation ohne Herkunftsposition (nur Einschlag beim Opfer). Reduziert die Entlarvung sofort, ohne Lichtsystem.
3. **(S) Rolle für Ausgeknockte:** Geister können am Handy einen Raum „spuken“ lassen (Feed: „Es klopft in der Küche“) – einmal pro Runde, Wahrheitsgehalt zufällig 70 %. Dazu `ROUND_MS` auf 120 s und zwei Runden bei ≥ 6.

**(d) Bugs / Unfairness**

- Siehe Konzeptbruch oben – kein Code-Bug, aber die Designannahme „verdeckt“ ist im Code nicht eingelöst.
- `startRound` wählt den Detektiv aus `order[traitorCount]` – `order` ist nach `traitorRounds` sortiert, also wird der Detektiv bevorzugt jemand mit wenigen Verräter-Runden; harmlos, aber der Detektiv rotiert dadurch kaum (gleiche Spieler vorn in der Sortierung bei Gleichstand – `shuffle` davor mildert das).

---

## 2 · Party-Schleife (Spielbrett → Minispiel → Ergebnis)

**Zeitbudget pro Runde (gemessen am Code):** Pro Spieler: Würfeln (bis `ROLL_IDLE_MS = 45 s`, `server/board.ts:8`), Animation `900 + Wert·280 ms` (`:109`, Ø 1,9 s), Pause 1,8 s (`:180`). Realistisch 4–6 s pro Spieler → **bei 12 Spielern 50–70 s reine Würfelphase pro Runde**, in der 11 Leute zuschauen, wie einer auf einen Knopf drückt. Danach 4 s Intro, 2–6 Minuten Minispiel, Ergebnis mit manuellem „Weiter“ (Auto nur ohne Menschen, `AUTO_RESULTS_MS`, `server/room.ts:76`). 8 Runden ≈ 45–60 Minuten, davon ~10 Minuten Würfel-Animation.

**Was fehlt gegenüber Mario Party:**

- **Null Entscheidungen auf dem Brett.** Der Cocktail wird automatisch gekauft (`server/board.ts:150`), es gibt keine Abzweigungen, keine Items, kein „Doppelt würfeln“, kein Duell-Feld, kein Stern-Preis-Dilemma. `EVENTS` (`:25`) sind 7 reine Zufallseffekte von ±3–5 Münzen. Das Brett erzeugt damit weder Hoffnung noch Ärger, nur Wartezeit.
- **Keine Aufholmechanik und kein Finale-Twist.** Münzen 10/6/3/1 (`shared/games.ts:108`) plus Felder ±3; Cocktail 10 (`:82`). Wer die ersten zwei Minispiele gewinnt, führt praktisch uneinholbar – es gibt keine Bonus-Sterne („meiste Minispiel-Siege“, „am meisten gelaufen“), kein „letzte Runde doppelte Münzen“, kein Chance-Feld mit Tausch.
- **Das Finale (Mord/Verräter) ist nicht ans Brett gekoppelt:** Es gibt dafür Münzen wie für jedes Minispiel. Ein Finale sollte den Stand kippen können (z. B. Mörder/Verräter-Sieg = 2 Cocktails).
- **Cocktail-Glück:** Die Bar steht auf einem Feld; ob man „vorbeiläuft“, entscheidet der Würfel. Bei 24 Feldern und Ø 3,5 Schritten passiert man die Bar alle ~7 Runden – bei 5 Runden Party bekommt der Durchschnittsspieler also **nicht einmal einen Cocktail**. Der Sieger wird dann über `finalResults` (`server/room.ts:686`) nach Münzen bestimmt – d. h. Cocktails sind reine Lotterie-Boni.

**Ergebnis-Screen (`ResultsScene`):** Nach jedem Minispiel eine statische Liste mit Porträt, Detail und `+Münzen` (`renderList`, `:76`) – keine Reihenfolge-Animation, kein Konfetti, keine Hervorhebung des Siegers, kein Sprecher-Text. Das Podium mit Krone und Hüpfen gibt es nur beim Endstand (`renderPodium`, `:98`). Für den emotionalen Höhepunkt jedes Minispiels („Ich hab gewonnen!“) ist das zu wenig; auf dem Handy vibriert es immerhin (`screens/results.ts`), aber der Screen ist Text.

**Konkret:**

1. **(S) Alle würfeln gleichzeitig** (10 s Fenster, dann Auto-Würfeln), Züge werden danach parallel animiert (die Scene kann das: `animateRoll` pro Spieler). Würfelphase 60 s → 12 s. `ROLL_IDLE_MS` auf 12 s.
2. **(M) Drei Entscheidungen:** (a) An der Bar **fragen** statt kaufen – mit Preis-Steigerung pro Cocktail (10/15/20); (b) ein Item pro Spieler (Sonnenbrille = Würfel +3, Möwe = 3 Münzen vom Führenden, Strandtuch = Bar-Teleport), erhältlich auf `?`-Feldern; (c) eine Abzweigung im Rundweg (kurzer Weg ohne Bar, langer Weg mit Bar + rotem Feld).
3. **(S) Bonus-Cocktails am Ende** (meiste Minispiel-Siege, meiste Münzen unterwegs, Pechvogel), jeweils mit eigenem Reveal – das ist in Mario Party der Grund, warum alle bis zum Schluss hoffen.
4. **(S) Ergebnis-Screen mit Reveal:** Plätze von unten nach oben einblenden (200 ms Abstand), Sieger zuletzt mit Konfetti + Shake, `coins` hochzählen. Alles in `ResultsScene.renderList` mit Tweens machbar.
5. **(S) Ergebnis automatisch nach 15 s weiter** – auch mit menschlichem VIP („VIP kann früher“). Der VIP ist heute bei jedem Übergang die Bremse.

---

## 3 · Controller-Fundament

**Eingabemodell:** Event-basiert mit Änderungsschwelle + Heartbeat, kein fester Sende-Takt. Fix-Pad `joystick()` (`screens/controller.ts:17–60`): Radius 60 px, sendet sofort bei Δ ≥ 0,25, sonst frühestens alle 45 ms, Keepalive 300 ms, **keine Deadzone** (jedes Spiel macht serverseitig eine eigene: Arena 0,3, Grill 0,3/0,15, Sumo 0,2 nur für die Richtung, TTT 0,15). Schwebender Stick `floatingStick()` (`screens/smash.ts:9–84`): Radius 46, Deadzone 0,18, Ring wandert mit dem Daumen, 50 ms/0,08-Schwelle, Keepalive 250 ms. Kart: eigener 1-D-Stick, Deadzone 6 px, voll bei 58 px, 33 ms + 300 ms Heartbeat. Igel: 90-ms-Aim-Throttle. Der Server tickt überall mit 50 ms und `Room.changed()` bündelt auf 40 ms (`server/room.ts:1063`).

**Latenzkette (Touch → TV):** Touch-Event (~10 ms) → Socket im LAN (5–20 ms) → nächster Server-Tick (0–50 ms) → Flush (0–40 ms) → TV-Empfang → Scene-Lerp (Smash 0,5/Frame mit Extrapolation; Arena 0,45, Parcours 0,45, Sumo 0,5, TTT 0,35 **ohne** Extrapolation; Igel 0,35). Summe ≈ 80–150 ms, plus bei Moonlight/Apple TV nochmal 30–80 ms. Für Arena/Sumo/Grill unproblematisch, für Smash und Bogen (Plattformer mit Frame-Fenstern von 50–100 ms) spürbar. Nur Kart hat Prediction. Es gibt keinen Sequenz-/Zeitstempel in `mini:input`, also kann kein anderes Spiel nachrüsten, ohne das Protokoll zu ändern.

**Standard-Baukasten? Nein, es sind drei.** Drei Stick-Implementierungen, vier „Halten“-Implementierungen (`holdButton` in `smash.ts:87`, Hand-Code in `igel.ts:68`, `parcours.ts:122`, `grill.ts:74`) und `tapButton` in `core.ts:92`. Jede ist für sich korrekt (Pointer-Capture, `pointercancel`, `contextmenu` unterdrückt), aber Deadzones, Ansprechverhalten und Haptik unterscheiden sich von Spiel zu Spiel – ein Spieler, der von Sumo (Fix-Pad, keine Deadzone) zu Smash (Floating, 0,18) wechselt, lernt die Steuerung neu.

**Haptik:** `navigator.vibrate` wird in 36 von 37 Screens benutzt (118 Aufrufe) – vorbildlich gemeint, aber **iOS hat diese API nicht**. Für die iPhone-Nutzer der Gruppe (die README spricht von iPhones) gibt es also keinerlei Rückmeldung am Gerät außer der Optik. Alternative: ein kurzer WebAudio-Klick/Tiefton (`client/controller/audio.ts` hat bereits den Synth für das Rhythmusspiel) oder ein weißer Bildschirm-Blitz als Standard-„Haptik“ in `core.ts`.

**Querformat:** Nur Kart/Autoball versuchen Vollbild + Orientation-Lock (`screens/kart.ts:101`), alle anderen sind Hochformat ohne Lock. Smash/Bogen/Parcours mit Stick links und 3–4 Knöpfen rechts würden quer deutlich besser liegen (Daumen auf gleicher Höhe). Fat-Finger: `big-btn` mit 44 vh Höhe und `touch-action: none` sind gut; die 4 Smash-Knöpfe im 2 × 2-Raster sind okay, die Kart-Knopfleiste mit „Daumen rutscht“ ist clever.

**Robustheit:** Rejoin mit gespeicherter ID funktioniert auch mitten im Spiel (`server/room.ts:175–177` lehnt nur **neue** Spieler ab). Aber: Arena und Sumo töten bei Disconnect sofort, Parcours löscht den Läufer, Kart lässt das Kart als Hindernis stehen, Smash lässt es als Zielscheibe stehen. Ein einheitliches „3 s Gnade, dann einfrieren/unverwundbar“ in `MiniCtx` würde das zentral lösen.

**Bewegungssensor:** `throwInput.ts` (Sensor-oder-Wischen, gespeicherte Wahl, Fallback bei fehlenden Samples) und `aim.ts`/`tilt.ts` (reine Funktionen, testbar) sind sauber. Fehlt: die vom Feedback gewünschte Rückmeldung „was wurde erkannt“ (in Arbeit) und ein Kalibrier-Screen, der einmal pro Abend die Sensor-Qualität zeigt.

**Empfehlung:** Ein `client/controller/input.ts` mit `stick({ floating, deadzone, rate })`, `button({ hold })`, `haptic(kind)` und einem einheitlichen Input-Paket `{ seq, t, stick, buttons }` alle 33 ms, solange etwas gedrückt ist. Danach Spiel für Spiel umstellen – Smash und Bogen zuerst, weil sie am meisten von konsistentem Timing profitieren.

---

## 4 · Top-10-Maßnahmen (Wirkung ÷ Aufwand)

**Quick Wins (S = ein Abend)**

1. **Parcours: alle laufen** – `MAX_RUNNERS` auf 12, Läufer-Sprites auf Scale 0,75 + Namenskürzel. Behebt eine echte Unfairness ab 9 Spielern.
2. **Disconnect-Gnade in Arena/Sumo/Parcours** – 3 s einfrieren statt sofort raus; zentral über `playerDisconnected` + `isConnected` im Tick.
3. **Ergebnis-Reveal mit Animation + Auto-Weiter nach 15 s** – der meistgesehene Screen des Abends bekommt endlich einen Höhepunkt, und der VIP ist keine Bremse mehr.
4. **Spielbrett: alle würfeln gleichzeitig** – spart pro Runde bis zu eine Minute Leerlauf bei großen Gruppen.
5. **Igel: Zugzeit/HP nach Spielerzahl, Flut pro Runde** – macht den Worms-Klon bei 8–12 Leuten überhaupt spielbar, bis die parallele Variante kommt.
6. **iOS-Haptik-Ersatz** – `haptic()` in `core.ts`, das auf Geräten ohne `vibrate` einen 30-ms-Klick über WebAudio und einen Bildschirm-Blitz macht. Betrifft jeden Screen, der heute `navigator.vibrate` ruft.

**Strukturelle Umbauten (M/L)**

7. **(M) Zuschauer-Rollen in den Elimination-Spielen** – Smash-Geister werfen Items, Arena-Tote werfen Wasserbomben an den Rand, Sumo-Tote machen Wellen, TTT-Geister spuken. Ein Muster, vier Spiele, und „Du schaust zu“ verschwindet weitgehend.
8. **(M) Igel-Krieg: parallele Züge + Teams** – aus dem Rundlauf-Problem wird ein 30-Sekunden-Takt für alle; danach lohnen sich neue Waffen (Seil, Mine, Luftangriff) und Kisten.
9. **(M) Brett mit Entscheidungen** – Items, Bar-Preisstaffel, eine Abzweigung, Bonus-Cocktails am Ende, Finale verändert den Stand. Das ist der Unterschied zwischen „Minispiel-Playlist“ und Mario Party.
10. **(M) Einheitlicher Input-Baukasten mit Sequenznummern** – ein Stick, ein Halte-Knopf, ein Haptik-Aufruf, Input-Pakete mit `seq/t`; dann Prediction für Smash und Bogen nach dem Kart-Vorbild. (L, wenn man die Prediction gleich mitmacht; die Grundlage in `client/kart3d/world.ts` ist übertragbar.)

**Nicht auf der Liste, aber wichtig:** TTT braucht eine Sicht-Beschränkung (Abschnitt 1.8, Punkt 1), sonst bleibt es ein Deathmatch mit Rollenkarten – das ist eher ein Redesign (M) als eine Optimierung.
