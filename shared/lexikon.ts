/**
 * Lügen-Lexikon (à la Fibbage) – Zeiten, Punkte, Zustands-Typen und der unscharfe Vergleich
 * „zu nah an der Wahrheit“. Die Einträge selbst (Wahrheit, Haus-Lügen, Erklärung) liegen nur auf dem Server
 * (`server/lexikonData.ts`), damit niemand die Lösung im Handy-Code nachschlagen kann.
 */

export const LEXIKON = {
  /** Spielbrett (`ctx.onBoard`): eine einzige Frage, ohne Verdopplung */
  PARTY_ROUNDS: 1,
  /** Schreiben und Tippen ohne Zeitlimit – geht weiter, wenn alle fertig sind (VIP/Laptop können überspringen) */
  WRITE_MS: null as number | null,
  VOTE_MS: null as number | null,
  /** Aufdecken: eine Lüge (Text → wer reingefallen ist → Stempel mit Autor) */
  LIE_MS: 4600,
  /** Aufdecken: die Wahrheit samt Erklärung */
  TRUTH_MS: 9500,
  SCORES_MS: 10_000,
  /** So viele Antworten (inkl. Wahrheit) stehen mindestens zur Wahl – Haus-Lügen füllen auf */
  MIN_OPTIONS: 6,
  /** Länge einer Lüge (Zeichen) */
  MAX_TEXT: 36,
  /** Wahrheit gefunden */
  TRUTH_POINTS: 100,
  /** Pro Mitspieler, der auf deine Lüge hereinfällt */
  FOOL_POINTS: 50,
  /** Letzte Frage: Punkte ×2 */
  FINAL_MULT: 2,
};

/** Fragen pro Spiel nach Spielerzahl – kleine Runden sind schneller durch, große brauchen länger zum Aufdecken */
export const lexRounds = (players: number) => (players <= 5 ? 5 : players <= 8 ? 4 : 3);

/** Art eines Eintrags: seltenes Wort (Bedeutung), Wortherkunft oder kurioser Fakt */
export type LexCat = 'wort' | 'herkunft' | 'fakt';

export const LEX_CAT: Record<LexCat, { icon: string; title: string }> = {
  wort: { icon: '📖', title: 'Seltenes Wort' },
  herkunft: { icon: '🔤', title: 'Wortherkunft' },
  fakt: { icon: '🤯', title: 'Kurioser Fakt' },
};

export const LEX_TOO_CLOSE = 'Zu nah an der Wahrheit – denk dir was anderes aus!';

/**
 * write = alle schreiben eine Lüge · vote = alle tippen auf die vermutete Wahrheit ·
 * reveal = Lüge für Lüge aufdecken, zum Schluss die Wahrheit · scores = Zwischenstand · over = Ende
 */
export type LexSub = 'write' | 'vote' | 'reveal' | 'scores' | 'over';

/** Ein Schritt beim Aufdecken: eine Antwort, auf die jemand reingefallen ist – zuletzt die Wahrheit */
export interface LexStep {
  /** Index in `options` */
  idx: number;
  truth: boolean;
  /** Autoren der Lüge (leer = Haus-Lüge; bei der Wahrheit leer) */
  by: string[];
  /** Wer darauf getippt hat */
  pickers: string[];
  /** Punkte pro Autor (Lüge) bzw. pro Finder (Wahrheit) */
  points: number;
}

export interface LexState {
  sub: LexSub;
  round: number;
  rounds: number;
  /** Punkte-Faktor dieser Frage (letzte Frage ×2) */
  mult: number;
  endsIn: number;
  cat: LexCat;
  /** Aufgabe mit Lücke `___` */
  prompt: string;
  players: string[];
  /** Wer seine Lüge schon abgegeben hat */
  written: string[];
  /** Ab `vote`: alle Antworten gemischt – ohne Autoren und ohne Markierung der Wahrheit */
  options: string[] | null;
  /** Wer schon getippt hat */
  voted: string[];
  /** Aufdecken: die bisher gezeigten Schritte (der letzte ist der aktuelle) */
  steps: LexStep[];
  /** So viele Schritte hat das Aufdecken insgesamt */
  stepCount: number;
  /** Ab dem Wahrheits-Schritt: kurze Erklärung */
  why: string | null;
  /** Ab dem Wahrheits-Schritt: Autoren jeder Antwort (null = Wahrheit, [] = Haus-Lüge) */
  authors: (string[] | null)[] | null;
  points: Record<string, number>;
  /** Punkte aus dieser Frage (ab dem Wahrheits-Schritt) */
  gain: Record<string, number>;
}

export interface LexPrivate {
  round: number;
  sub: LexSub;
  /** Eigene, angenommene Lüge dieser Frage */
  lie: string | null;
  /** Abgewiesen (zu nah an der Wahrheit / leer) – `seq` zählt hoch */
  reject: { seq: number; text: string } | null;
  /** „Lüge vorschlagen“ – `seq` zählt hoch */
  suggest: { seq: number; text: string } | null;
  /** Eigene Antworten (Indizes in `options`) – nicht wählbar */
  mine: number[];
  /** Eigener Tipp */
  pick: number | null;
}

// ------------------------------------------------------------------ Text

/** Eingabe säubern: Leerraum zusammenfassen, Anführungszeichen und Satzzeichen am Ende weg, Länge begrenzen */
export function lexClean(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'„“”‚‘’»«]+|["'„“”‚‘’»«]+$/g, '')
    .replace(/[\s.!?,;:…]+$/g, '')
    .trim()
    .slice(0, LEXIKON.MAX_TEXT)
    .trim();
}

/** So erscheinen alle Antworten – in Großbuchstaben, damit Schreibweisen nichts verraten */
export const lexShow = (text: string) => text.toLocaleUpperCase('de-DE');

const FOLD: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', é: 'e', è: 'e', ê: 'e', á: 'a', à: 'a', â: 'a', í: 'i', ì: 'i', ó: 'o', ò: 'o', ô: 'o', ú: 'u', ñ: 'n', ç: 'c', ő: 'oe', č: 'c', š: 's' };

/** Füll- und Artikelwörter, die beim Vergleich nicht zählen */
const STOP = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines', 'und', 'oder', 'mit', 'von', 'vom',
  'im', 'in', 'am', 'an', 'auf', 'aus', 'zu', 'zum', 'zur', 'fuer', 'fuers', 'durchs', 'ins', 'ans', 'aufs', 'ums', 'vors', 'als', 'bei', 'beim',
  'sein', 'seine', 'seinen', 'seinem', 'seiner',
  'ihr', 'ihre', 'ihren', 'ihrem', 'ihrer', 'etwa', 'rund', 'ca', 'circa', 'ungefaehr', 'fast', 'knapp', 'ueber', 'bis', 'so', 'sehr',
  'ganz', 'nur', 'ist', 'sind', 'war', 'the', 'a', 'of',
]);

/** Kleinbuchstaben, Umlaute ausgeschrieben, nur Buchstaben/Ziffern, Ziffern von Buchstaben getrennt („13ter“ → „13 ter“) */
export function lexTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[äöüßéèêáàâíìóòôúñçőčš]/g, (c) => FOLD[c] ?? c)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .split(' ')
    .filter(Boolean);
}

const words = (s: string) => lexTokens(s).filter((t) => !STOP.has(t));
const isNum = (t: string) => /\d/.test(t);
/** Grober Wortstamm: „Kapuzinern“ ≈ „Kapuziner“, „Hoden“ ≈ „Hode“ */
const stem = (t: string) => (isNum(t) ? t : t.length > 4 && t.endsWith('en') ? t.slice(0, -2) : t.length > 3 && /[enrs]$/.test(t) ? t.slice(0, -1) : t);

/** Schlüssel zum Zusammenfassen gleicher Antworten („Ein Hut“ = „hut“) */
export function lexKey(s: string): string {
  const w = words(s);
  return (w.length ? w : lexTokens(s)).map(stem).join('');
}

/** Tippfehler-Abstand (Damerau-Levenshtein, vertauschte Nachbarbuchstaben zählen einfach) */
export function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * Ist eine Lüge zu nah an der Wahrheit (oder einer ihrer Schreibweisen)?
 *   - gleich bis auf Artikel, Groß-/Kleinschreibung, Umlaute, Endungen („Kapuzinern“/„Kapuziner“)
 *   - Tippfehler (ein Wort: ab 5 Buchstaben einer, ab 12 zwei; mehrere Wörter: ab 10 bzw. 17 Buchstaben)
 *   - enthält alle Wörter der Wahrheit („Rache des Papstes“ ⊂ „Papstes späte Rache“; auch als Wortende: „Mineralwasser“ ⊃ „Wasser“)
 *   - Zahlen: dieselbe Zahl ohne neue Wörter („38“ = „38 Minuten“, aber „38 Tage“ ist eine Lüge)
 */
export function lexTooClose(answer: string, targets: readonly string[]): boolean {
  const a = words(answer);
  if (!a.length) return false;
  const aKey = a.map(stem).join('');
  for (const target of targets) {
    const t = words(target);
    if (!t.length) continue;
    const tKey = t.map(stem).join('');
    if (aKey === tKey) return true;
    if (t.some(isNum)) {
      const nums = (xs: string[]) => xs.filter(isNum).join(' ');
      if (nums(a) === nums(t) && a.every((x) => isNum(x) || t.some((y) => stem(y) === stem(x)))) return true;
      continue;
    }
    // Mehrere Wörter: erst ab 10 Buchstaben ein Tippfehler – sonst wäre „nachts zu sehen“ ≈ „nicht zu sehen“
    const short = t.length > 1 ? 10 : 5;
    const tol = tKey.length < short ? 0 : tKey.length < short + 7 ? 1 : 2;
    if (lev(aKey, tKey) <= tol) return true;
    const has = (w: string) => {
      const sw = stem(w);
      return a.some((x) => {
        const sx = stem(x);
        return sx === sw || (sw.length >= 5 && sx.endsWith(sw)) || (sw.length >= 7 && lev(sx, sw) <= 1);
      });
    };
    const need = t.filter((w) => w.length >= 3);
    if (need.length && need.every(has)) return true;
  }
  return false;
}
