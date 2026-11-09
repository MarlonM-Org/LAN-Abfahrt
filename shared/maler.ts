import type { PostStroke } from './types';
import { POST, POST_BRUSHES, POST_ERASER } from './stillepost';

/**
 * Montagsmaler live (à la skribbl.io, intern „maler“): Einer malt am Handy, die Striche erscheinen live auf dem TV,
 * alle anderen tippen ihre Tipps. Zeichenfläche, Farben und Pinsel kommen von Stille Post (`shared/stillepost.ts`).
 */
export const MALER = {
  /** Wort aussuchen (3 Vorschläge, danach wählt der Server) */
  CHOOSE_MS: 12_000,
  /** Auflösung nach jedem Bild */
  REVEAL_MS: 6_000,
  /** Alle haben's → so lange noch das fertige Bild zeigen, dann Auflösung */
  ALL_DONE_MS: 1_200,
  /** Bei vielen Spielern malen nicht alle (Gesamtdauer im Rahmen): Menschen zuerst, Bots danach */
  MAX_TURNS: 8,
  /** Wörter zur Auswahl */
  CHOICES: 3,
  /** Maler so lange ohne Verbindung → Bild wird aufgelöst */
  DRAWER_OFFLINE_MS: 10_000,
  /** Handy bündelt Striche so oft (~15 Hz) */
  SEND_MS: 66,
  /** Mindestabstand zweier Punkte im Raster (0–255) */
  MIN_DIST: 2,
  MAX_POINTS: 5000,
  MAX_STROKES: 400,
  /** Höchstens so viele Punkte pro Op, Ops pro Nachricht */
  OP_POINTS: 80,
  MSG_OPS: 24,
  /** Snapshot: nur die Ops der letzten so vielen ms (wer mehr verpasst hat, wartet aufs Schlüsselbild) */
  OPS_WINDOW_MS: 1_500,
  /** Schlüsselbild (alle Striche) mindestens so oft – z. B. für einen TV, der über den Online-Tunnel läuft */
  KEY_MS: 4_000,
  /** Rateversuche: Länge, Mindestabstand */
  GUESS_MAX: 32,
  GUESS_GAP_MS: 600,
  /** So viele Chat-Zeilen gehen mit dem Snapshot raus */
  CHAT_MAX: 14,
  /** Eigene letzte Tipps (privat) */
  MINE_MAX: 6,
};

/** Malzeit pro Bild: wenige Spieler 80 s, mittlere 70 s, viele 60 s */
export const malerDrawMs = (players: number) => (players <= 5 ? 80_000 : players <= 8 ? 70_000 : 60_000);

/** Buchstaben-Hinweise je nach Wortlänge (in Buchstaben) */
export const malerHintCount = (letters: number) => (letters <= 3 ? 0 : letters <= 5 ? 1 : letters <= 8 ? 2 : 3);

/** Zeitpunkte der Hinweise als Anteil der Malzeit: einer bei 50 %, zwei bei 40/75 %, drei bei 35/60/85 % */
export function malerHintTimes(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0.5];
  return Array.from({ length: count }, (_, i) => 0.35 + (0.5 * i) / (count - 1) + (count === 2 ? 0.05 : 0));
}

/** Punkte für einen Rater: 3 + bis zu 7 nach Restzeit + Bonus für die ersten drei (3/2/1) → 4 … 13 */
export const malerGuessPoints = (remFrac: number, order: number) => 3 + Math.ceil(7 * Math.max(0, Math.min(1, remFrac))) + Math.max(0, 3 - order);

/** Punkte für den Maler pro richtigem Rater – zusammen etwa so viel wie eine starke Raterunde (≈ 12) */
export const malerDrawerPer = (guessers: number) => Math.max(1, Math.round(12 / Math.max(1, guessers)));

// ------------------------------------------------------------------ Typen

/**
 * Ein Schritt am Bild: Strich anfangen (Farbe, Pinsel, erste Punkte) · Punkte an den letzten Strich anhängen ·
 * letzten Strich zurücknehmen · alles löschen. Punkte flach [x0, y0, x1, y1, …] im Raster 0–255 wie bei Stille Post.
 */
export type MalerOp = { t: 's'; c: number; w: number; p: number[] } | { t: 'a'; p: number[] } | { t: 'u' } | { t: 'x' };

/**
 * Live-Striche im Snapshot: `seq` = Anzahl Ops dieses Bilds, `ops` = die jüngsten ab Nummer `from`.
 * Wer weiter zurückhängt (neuer TV, Neuverbindung), nimmt das Schlüsselbild `full` (alle Striche zum Stand `seq`) –
 * das kommt alle paar Sekunden, in der Auflösung immer und auf Anfrage (`host:mini`/Eingabe `sync`).
 */
export interface MalerInk {
  seq: number;
  from: number;
  ops: MalerOp[];
  full: PostStroke[] | null;
}

/** Chat-Zeile am TV: falscher Tipp (mit Text) oder „✓ … hat's!“ (ohne Text) */
export interface MalerChat {
  n: number;
  id: string;
  text: string | null;
  ok?: boolean;
}

export type MalerSub = 'choose' | 'draw' | 'reveal' | 'over';

export interface MalerState {
  /** choose = Maler sucht ein Wort aus · draw = malen + raten · reveal = Auflösung · over = Ende */
  sub: MalerSub;
  /** Bild 1 … rounds */
  round: number;
  rounds: number;
  endsIn: number;
  /** Dauer der laufenden Phase (für den Zeitbalken am TV) */
  total: number;
  players: string[];
  /** Wer der Reihe nach malt */
  order: string[];
  drawer: string;
  /** Muster des Worts: „_“ = verdeckter Buchstabe, aufgedeckte Buchstaben groß, Leerzeichen/Bindestrich bleiben */
  hint: string;
  /** Wer es schon hat (Reihenfolge) */
  guessed: string[];
  points: Record<string, number>;
  /** Punkte aus dem aktuellen Bild */
  gain: Record<string, number>;
  chat: MalerChat[];
  /** Erst in der Auflösung öffentlich */
  word: string | null;
  /** Warum aufgelöst wurde */
  why: 'all' | 'time' | 'skip' | 'gone' | null;
  ink: MalerInk;
}

export type MalerResult = 'hit' | 'close' | 'miss';

/** Nur an den jeweiligen Spieler */
export interface MalerPrivate {
  round: number;
  role: 'draw' | 'guess' | 'got' | 'none';
  /** Maler in `choose`: die drei Vorschläge */
  choices: string[] | null;
  /** Maler (nach der Wahl) und wer es erraten hat */
  word: string | null;
  /** Eigene letzte Tipps mit Ergebnis („knapp daneben!“ erfährt nur der Ratende) */
  mine: { text: string; res: MalerResult }[];
  /** Zähler der eigenen Tipps (Handy erkennt daran eine neue Rückmeldung) */
  tries: number;
  /** Nur Maler: Server hat Striche verpasst (z. B. WLAN-Aussetzer) → Handy schickt das ganze Bild */
  need: boolean;
}

// ------------------------------------------------------------------ Striche

/** Op auf eine Strichliste anwenden (Server, TV, Bot, Handy) – true, wenn Striche weggefallen sind (neu zeichnen) */
export function applyInkOp(strokes: PostStroke[], op: MalerOp): boolean {
  switch (op.t) {
    case 's':
      strokes.push({ c: op.c, w: op.w, p: [...op.p] });
      return false;
    case 'a': {
      const last = strokes[strokes.length - 1];
      if (last) for (const v of op.p) last.p.push(v);
      return false;
    }
    case 'u':
      strokes.pop();
      return true;
    case 'x':
      strokes.length = 0;
      return true;
  }
}

export const cloneStrokes = (s: readonly PostStroke[]): PostStroke[] => s.map((st) => ({ c: st.c, w: st.w, p: [...st.p] }));
export const strokePoints = (s: readonly PostStroke[]) => s.reduce((n, st) => n + st.p.length / 2, 0);

const int = (v: unknown, lo: number, hi: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
};

/** Punkte prüfen: gerade Anzahl, ganze Zahlen im Raster, gedeckelt */
export function cleanPoints(raw: unknown, max = MALER.OP_POINTS): number[] {
  if (!Array.isArray(raw)) return [];
  const n = Math.min(Math.floor(raw.length / 2), max);
  const out: number[] = new Array(n * 2);
  for (let i = 0; i < n * 2; i++) out[i] = int(raw[i], 0, POST.GRID);
  return out;
}

/** Eine Op vom Handy prüfen (null = unbrauchbar) */
export function cleanOp(raw: unknown): MalerOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.t === 'u' || r.t === 'x') return { t: r.t };
  if (r.t === 'a') {
    const p = cleanPoints(r.p);
    return p.length ? { t: 'a', p } : null;
  }
  if (r.t === 's') {
    const p = cleanPoints(r.p);
    if (!p.length) return null;
    return { t: 's', c: int(r.c, 0, POST_ERASER), w: int(r.w, 0, POST_BRUSHES.length - 1), p };
  }
  return null;
}

/** Ganzes Bild vom Handy prüfen (Neuabgleich nach einem Aussetzer) */
export function cleanStrokes(raw: unknown): PostStroke[] {
  const out: PostStroke[] = [];
  if (!Array.isArray(raw)) return out;
  let budget = MALER.MAX_POINTS;
  for (const st of raw.slice(0, MALER.MAX_STROKES)) {
    if (!st || typeof st !== 'object') continue;
    const r = st as Record<string, unknown>;
    const p = cleanPoints(r.p, budget);
    if (!p.length) continue;
    out.push({ c: int(r.c, 0, POST_ERASER), w: int(r.w, 0, POST_BRUSHES.length - 1), p });
    budget -= p.length / 2;
    if (budget <= 0) break;
  }
  return out;
}

// ------------------------------------------------------------------ Wörter vergleichen

/** Erster Eintrag = angezeigtes Wort, weitere (mit „|“) zählen beim Raten genauso */
export const malerAlts = (entry: string) => entry.split('|').map((w) => w.trim()).filter(Boolean);
export const malerDisplay = (entry: string) => malerAlts(entry)[0] ?? entry;

const ARTICLES = /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|the|a|an)\s+/;

/** Für den Vergleich: klein, Umlaute ausgeschrieben, ß → ss, Akzente weg, Artikel vorne weg, nur Buchstaben/Ziffern */
export function malerNorm(s: string): string {
  let t = String(s ?? '').toLowerCase().trim();
  t = t.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) t = t.replace(ARTICLES, '');
  return t.replace(/[^a-z0-9]/g, '');
}

/** Levenshtein-Distanz (bricht ab, sobald sie `max` übersteigt → max + 1) */
export function levenshtein(a: string, b: string, max = 99): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Erlaubte Tippfehler je nach Länge (normalisiert): bis 4 Zeichen keiner, bis 7 einer, darüber zwei */
export const malerTolerance = (len: number) => (len <= 4 ? 0 : len <= 7 ? 1 : 2);

/** Alle Wörter der Liste (normalisiert, inkl. Alternativen) – ein Tipp, der selbst ein anderes Wort ist, ist kein Tippfehler */
let known: Set<string> | null = null;
const knownWords = () => (known ??= new Set(MALER_WORDS.flatMap((e) => malerAlts(e).map(malerNorm))));

/**
 * Tipp gegen das gesuchte Wort (Eintrag mit Alternativen):
 * hit = gleich (Groß/klein, Umlaute, Leerzeichen/Bindestriche egal) oder kleiner Tippfehler (gleicher Anfangsbuchstabe,
 * kein anderes Wort der Liste) · close = knapp daneben (etwas mehr Tippfehler, Teilwort) · miss = falsch.
 */
export function malerMatch(guess: string, entry: string): MalerResult {
  const g = malerNorm(guess);
  if (!g) return 'miss';
  let close = false;
  for (const alt of malerAlts(entry)) {
    const w = malerNorm(alt);
    if (!w) continue;
    if (g === w) return 'hit';
    const tol = malerTolerance(w.length);
    const d = levenshtein(g, w, tol + 2);
    const otherWord = knownWords().has(g);
    if (d <= tol && g[0] === w[0] && !otherWord) return 'hit';
    if (w.length >= 4 && d <= tol + 1) close = true;
    // Teilwort: „Brille“ bei „Sonnenbrille“, „Hundehütte“ bei „Hund“
    const short = g.length < w.length ? g : w;
    const long = g.length < w.length ? w : g;
    if (short.length >= 3 && short.length * 2 >= w.length && long.includes(short)) close = true;
  }
  return close ? 'close' : 'miss';
}

/** Buchstaben-Positionen eines Worts (ohne Leerzeichen/Bindestriche) */
export const malerLetterIdx = (word: string) => [...word].flatMap((c, i) => (/\p{L}|\d/u.test(c) ? [i] : []));

const upper = (c: string) => (c === 'ß' ? c : c.toUpperCase());

/** Muster für Hinweise: verdeckte Buchstaben „_“, aufgedeckte groß; Leerzeichen und Bindestriche bleiben stehen */
export function malerHint(word: string, revealed: ReadonlySet<number> | readonly number[] = []): string {
  const shown = revealed instanceof Set ? revealed : new Set(revealed);
  return [...word].map((c, i) => (/\p{L}|\d/u.test(c) ? (shown.has(i) ? upper(c) : '_') : c)).join('');
}

/** Passt ein Wort zum Muster (Länge, aufgedeckte Buchstaben)? – für Bots */
export function malerFits(word: string, hint: string): boolean {
  const a = [...word];
  const h = [...hint];
  if (a.length !== h.length) return false;
  return a.every((c, i) => (h[i] === '_' ? /\p{L}|\d/u.test(c) : upper(c) === h[i]));
}

// ------------------------------------------------------------------ Wortliste

/**
 * Gut malbare Begriffe: Urlaub & Strand, Tiere, Essen & Trinken, Alltag & Zuhause, Unterwegs, Natur, Freizeit.
 * Erster Eintrag wird angezeigt, Alternativen hinter „|“ zählen beim Raten auch. Keine Dubletten (auch nicht
 * normalisiert) – `npm run test:maler` prüft das.
 */
export const MALER_WORDS: string[] = [
  // Urlaub & Strand
  'Strand', 'Sonne', 'Welle', 'Muschel', 'Sandburg', 'Liegestuhl', 'Sonnenschirm', 'Sonnenbrille', 'Badehose', 'Bikini',
  'Handtuch|Badetuch', 'Flipflop|Flipflops|Badelatschen', 'Schwimmring|Schwimmreifen', 'Luftmatratze', 'Leuchtturm', 'Segelboot|Segelschiff',
  'Anker', 'Insel', 'Palme', 'Kokosnuss', 'Hängematte', 'Surfbrett', 'Taucherbrille', 'Schnorchel', 'Rettungsring', 'Koffer',
  'Rucksack', 'Flugzeug|Flieger', 'Reisepass|Pass', 'Zelt', 'Wohnmobil|Camper|Wohnwagen', 'Lagerfeuer', 'Postkarte', 'Fernglas',
  'Kompass', 'Schatzkarte', 'Sandeimer|Eimer', 'Schaufel', 'Wasserball', 'Schwimmbad|Pool', 'Wasserrutsche|Rutsche', 'Sprungbrett', 'Sonnencreme',
  'Strohhut|Sonnenhut', 'Eiswagen', 'Cocktail', 'Schiff|Kreuzfahrtschiff', 'Hotel', 'Seilbahn|Gondel', 'Kamera|Fotoapparat', 'Pirat',
  'Meerjungfrau', 'Vulkan', 'Wasserfall', 'Regenbogen', 'Iglu', 'Pyramide', 'Eiffelturm', 'Skilift', 'Schneemann', 'Ski|Skier',
  'Schlitten', 'Kanu|Kajak', 'Angel|Angelrute', 'Ruderboot', 'U-Boot',
  // Tiere
  'Hund', 'Katze', 'Maus', 'Pferd', 'Kuh', 'Schwein', 'Schaf', 'Ziege', 'Huhn', 'Ente', 'Hase', 'Igel', 'Fuchs', 'Bär',
  'Eule', 'Papagei', 'Pinguin', 'Flamingo', 'Möwe', 'Delfin|Delphin', 'Hai', 'Wal', 'Krake|Oktopus|Tintenfisch', 'Qualle', 'Krebs|Krabbe',
  'Seestern', 'Seepferdchen', 'Schildkröte', 'Krokodil', 'Frosch', 'Schlange', 'Schnecke', 'Biene', 'Schmetterling', 'Marienkäfer',
  'Spinne', 'Ameise', 'Giraffe', 'Elefant', 'Löwe', 'Tiger', 'Zebra', 'Affe', 'Känguru', 'Koala', 'Kamel', 'Nashorn',
  'Nilpferd|Flusspferd', 'Dinosaurier|Dino', 'Einhorn', 'Drache', 'Fledermaus', 'Eichhörnchen', 'Robbe|Seehund', 'Storch', 'Fisch',
  'Raupe', 'Hummer', 'Pfau', 'Faultier', 'Panda', 'Wurm|Regenwurm',
  // Essen & Trinken
  'Pizza', 'Pommes|Pommes frites|Fritten', 'Burger|Hamburger', 'Hotdog', 'Döner|Dönerkebab|Kebab', 'Bratwurst|Wurst', 'Brezel',
  'Croissant', 'Brot', 'Käse', 'Spiegelei', 'Eis|Eiscreme', 'Torte', 'Keks', 'Donut', 'Lolli|Lutscher', 'Schokolade', 'Popcorn',
  'Banane', 'Apfel', 'Birne', 'Erdbeere', 'Kirsche', 'Ananas', 'Wassermelone|Melone', 'Zitrone', 'Weintraube|Trauben', 'Karotte|Möhre',
  'Tomate', 'Gurke', 'Kartoffel', 'Pilz', 'Brokkoli', 'Maiskolben|Mais', 'Spaghetti|Nudeln', 'Suppe', 'Sushi', 'Taco',
  'Pfannkuchen|Pancake', 'Waffel', 'Honig', 'Kaffee', 'Bier', 'Weinglas|Wein', 'Kaugummi', 'Zuckerwatte', 'Muffin', 'Ei|Hühnerei', 'Salat',
  // Alltag & Zuhause
  'Haus', 'Tür', 'Fenster', 'Treppe', 'Bett', 'Sofa|Couch', 'Stuhl', 'Tisch', 'Lampe', 'Uhr', 'Wecker', 'Spiegel', 'Dusche',
  'Badewanne', 'Toilette|Klo|WC', 'Zahnbürste', 'Kühlschrank', 'Herd', 'Toaster', 'Pfanne', 'Kochtopf|Topf', 'Gabel', 'Löffel',
  'Messer', 'Tasse', 'Teller', 'Flasche', 'Schlüssel', 'Brille', 'Regenschirm|Schirm', 'Handy|Smartphone|Telefon', 'Laptop|Notebook|Computer',
  'Fernseher|TV', 'Kopfhörer', 'Gitarre', 'Klavier', 'Trommel|Schlagzeug', 'Geschenk', 'Kerze', 'Luftballon|Ballon', 'Brief', 'Buch',
  'Bleistift|Stift', 'Schere', 'Hammer', 'Säge', 'Leiter', 'Besen', 'Staubsauger', 'Waschmaschine', 'Socke', 'Schuh', 'Mütze',
  'Schal', 'Handschuh', 'Krawatte', 'Kleid', 'Ring', 'Zahn', 'Auge', 'Nase', 'Ohr', 'Hand', 'Fuß', 'Bart', 'Briefkasten',
  'Mülleimer|Mülltonne', 'Glühbirne', 'Steckdose', 'Bügeleisen', 'Kinderwagen', 'Gießkanne', 'Rasenmäher', 'Zahnpasta',
  // Unterwegs & Stadt
  'Fahrrad|Rad', 'Auto', 'Bus', 'Zug|Eisenbahn', 'Traktor', 'Rakete', 'Hubschrauber|Helikopter', 'Ampel', 'Brücke', 'Kirche',
  'Burg|Schloss', 'Krone', 'Ritter', 'Geist|Gespenst', 'Roboter', 'Feuerwehrauto|Feuerwehr', 'Polizeiauto|Polizei', 'Krankenwagen',
  'Motorrad', 'Roller', 'Skateboard', 'Bagger', 'Kran', 'Fallschirm', 'Heißluftballon', 'Schubkarre', 'Tankstelle', 'Windmühle', 'Zirkus', 'Clown', 'Zauberer', 'Hexe', 'Astronaut', 'Alien|Außerirdischer', 'Ufo',
  // Natur & Wetter
  'Blume', 'Baum', 'Kaktus', 'Sonnenblume', 'Wolke', 'Blitz', 'Mond', 'Stern', 'Schneeflocke', 'Herz', 'Berg', 'Tannenbaum|Weihnachtsbaum',
  'Kürbis', 'Rose', 'Tornado', 'Pfütze', 'Feder', 'Kleeblatt', 'Spinnennetz', 'Vogelnest|Nest', 'Zaun', 'Brunnen',
  // Freizeit & Party
  'Fußball', 'Basketball', 'Tennisschläger', 'Würfel', 'Puzzle', 'Discokugel', 'Mikrofon', 'Partyhut', 'Konfetti', 'Pokal',
  'Medaille', 'Schaukel', 'Trampolin', 'Kegel', 'Zielscheibe|Dartscheibe', 'Grill', 'Karussell', 'Riesenrad',
  'Achterbahn', 'Weihnachtsmann|Nikolaus', 'Osterhase', 'Schatztruhe', 'Spielkarte', 'Joystick|Controller',
];
