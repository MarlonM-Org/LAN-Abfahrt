# Mitbauen: Roadmap-Punkte übernehmen

Mehrere Leute (und ihre Claude-Sessions) bauen parallel an LAN-Abfahrt. Damit nichts doppelt gebaut wird, gilt: **erst claimen, dann bauen.** Die Roadmap und alle Claims stehen in `docs/status.json` auf `main`; daraus baut `node scripts/status-page.mjs` die Status-Seite.

Der Text unten kann 1:1 als erste Nachricht an eine Claude-Session gehen, die in einem lokalen Klon arbeitet.

---

```text
Du arbeitest im Repo MarlonM-Org/LAN-Abfahrt (lokaler Klon). Lies zuerst CLAUDE.md,
dort steht die Claim-Regel. Die Roadmap und alle Claims stehen in docs/status.json
auf main. Mehrere Leute bauen parallel, deshalb gilt: erst claimen, dann bauen.

1. AUSWAHL
   - git fetch origin, dann docs/status.json von origin/main lesen: "queue" ist die
     Roadmap (Karten mit "title", "detail", "steps" = Ausbaustufen), "inProgress"
     sind laufende Claims.
   - Du suchst dir selbst aus, was du baust. Gehe die "queue" von oben nach unten
     (Reihenfolge = Priorität von Marlon) und nimm die erste Karte oder Stufe, die
     frei ist (nicht in "inProgress", nicht mit "← <Name>" markiert) und die du ohne
     Rückfrage bauen kannst. "detail" und "steps" sind die Spezifikation; was dort
     "entschieden" heißt, ist so gewollt.
   - Überspringe: Stufen, die Marlon selbst braucht (z. B. "Testabend"), und Karten,
     deren detail noch eine offene Frage an Marlon enthält.
   - Fang lieber mit einer kleinen Karte (S) an und liefere, als eine große (XL)
     anzureißen. Bei Karten mit Stufen claimst du eine Stufe, nicht die ganze Karte.
   - Immer nur ein Claim gleichzeitig. Fertig und gemergt? Nächste Karte, gleicher
     Ablauf.

2. CLAIM
   - git checkout -b <dein-name>/<kurzname> origin/main
   - In docs/status.json unter "inProgress" einen Eintrag ergänzen:
     { "type": "in Arbeit · <Dein Name>", "kind": "<MiniKind oder null>",
       "title": "<Titel der Karte oder Stufe>", "detail": "<was genau du baust,
       2–3 Sätze, welche Dateien>", "branch": "<dein-name>/<kurzname>",
       "since": "<Datum>" }
     Die Karte bleibt in "queue" stehen; bei einer Teil-Stufe die Stufe im Text mit
     "← <Dein Name>" markieren. "updated" auf jetzt setzen.
   - node scripts/status-page.mjs ausführen, NUR docs/status.json und docs/status.html
     committen, pushen und sofort einen PR "Claim: <Titel>" nach main aufmachen und
     mergen (reiner Docs-PR, kein Review nötig). Erst wenn der Claim auf main ist,
     fängst du an zu bauen. Steht der Punkt bis dahin schon bei jemand anderem in
     "inProgress", nimm einen anderen.
   - Das Claude-Artefakt (Status-Seite) kannst du nicht veröffentlichen, das macht
     Marlons Session beim nächsten Mal aus docs/status.json. Überspringe den Schritt.

3. BAUEN
   - Auf demselben Branch weiterarbeiten, Regeln aus CLAUDE.md einhalten (Server
     autoritativ, shared/ für Gemeinsames, Texte Deutsch, Pixel-Look, Handy-Screens
     nur bei Key-Wechsel neu bauen, Juice/sfx statt eigener Effekte).
   - Vor jedem Commit npm run typecheck; passende npm run test:* laufen lassen;
     bei Spielen npm run bots -- <n> --game=<kind> und einmal --party.
   - Halte dich an den Umfang der Karte bzw. Stufe. Was du bewusst weglässt, kommt
     als Satz in die PR-Beschreibung.

4. FERTIG
   - git fetch origin && git merge origin/main (docs/status.json: beide Seiten
     behalten, es ist nur JSON – nie die Einträge anderer löschen).
   - docs/status.json: deinen Eintrag aus "inProgress" entfernen, in "done" oben
     einfügen { "title": "<was gebaut wurde, 1 Satz>", "pr": <PR-Nummer>,
     "date": "<Datum>" }, die Karte aus "queue" löschen (oder nur deine Stufe
     streichen). Unter "feedback" NICHTS eintragen, das ist Marlons Test-Liste.
     node scripts/status-page.mjs, committen.
   - PR nach main mit: was, warum, wie getestet (Befehle + Bot-Läufe), Screenshots
     von TV und Handy (Playwright, iPhone-Größe) bei UI-Änderungen. PR-Titel wie die
     bisherigen (siehe git log). Nicht selbst mergen, Marlon merged.

5. ABBRECHEN
   - Wenn du etwas nicht fertig baust: Claim per Docs-PR wieder aus "inProgress"
     nehmen und in "detail" der Karte einen Satz hinterlassen, was zu beachten ist.

Leg los: Roadmap lesen, erste freie Karte wählen, claimen, bauen.
```

---

## Für Menschen ohne Claude

Derselbe Ablauf, von Hand: Karte in `docs/status.json` unter `inProgress` eintragen und als Docs-PR mergen, bauen, am Ende den Eintrag nach `done` verschieben und die Karte aus `queue` löschen. Die Felder sind oben beschrieben; `kind` ist der Schlüssel aus `MINI_INFO` in `shared/games.ts` oder `null`.
