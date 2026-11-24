/**
 * Busfahrer (Trinkspiel, MiniKind `hilo` – der Bezeichner bleibt wegen gespeicherter Leaderboards/Favoriten).
 * Vier verdeckte Karten, alle tippen gleichzeitig; Karte n falsch getippt = n Schlücke.
 *
 * Kartenwerte: 2–10 wie aufgedruckt, Bube 11, Dame 12, König 13, Ass 14 (Ass ist hoch, wie `cardLabel`).
 * Symbole (`suit`): 0 ♥, 1 ♦ (rot), 2 ♣, 3 ♠ (schwarz) – wie bei Kings Cup.
 *
 * Reine Regel-Logik (Optionen, Auflösung, Schlücke, Chancen, Bot-Tipp) – getestet in `scripts/test-busfahrer.ts`.
 */
import { cardLabel } from './games';

export type BusFrage = 'farbe' | 'hoehe' | 'zwischen' | 'symbol';
export type BusTipp = 'rot' | 'schwarz' | 'hoeher' | 'tiefer' | 'gleich' | 'zwischen' | 'ausserhalb' | 'ja' | 'nein';

export interface BusCard {
  /** 2–14 (Ass = 14) */
  rank: number;
  /** 0 ♥, 1 ♦, 2 ♣, 3 ♠ */
  suit: number;
}

export const BUS = {
  /**
   * Reihenfolge der verdeckten Karten = Fragen (Marlon: genau diese vier). Falsch getippt bei Karte n
   * (1-basiert) = n Schlücke. Neue Fragen in `BUS_FRAGEN` + `busAnswer()`; `busFragenOk()` prüft die Reihenfolge.
   */
  FRAGEN: ['farbe', 'hoehe', 'zwischen', 'symbol'] as BusFrage[],
  /** Durchgänge mit jeweils frischem Stapel */
  DURCHGAENGE: 1,
  /** Kein Zeitlimit beim Tippen: aufgedeckt wird, wenn alle Verbundenen getippt haben oder der VIP überspringt */
  GUESS_MS: null as number | null,
  /** Auflösung einer Karte (schaltet von selbst weiter, VIP kann überspringen) */
  REVEAL_MS: 9000,
  /** Zusammenfassung am Ende, dann Ergebnis-Screen */
  OVER_MS: 10000,
};

export const BUS_FRAGEN: Record<BusFrage, { titel: string; tipps: BusTipp[]; /** braucht so viele aufgedeckte Karten davor */ braucht: number }> = {
  farbe: { titel: 'Rot oder Schwarz?', tipps: ['rot', 'schwarz'], braucht: 0 },
  hoehe: { titel: 'Höher, tiefer oder gleich?', tipps: ['hoeher', 'gleich', 'tiefer'], braucht: 1 },
  zwischen: { titel: 'Dazwischen, außerhalb oder gleich?', tipps: ['zwischen', 'gleich', 'ausserhalb'], braucht: 2 },
  symbol: { titel: 'Symbol schon dabei?', tipps: ['ja', 'nein'], braucht: 1 },
};

export const BUS_TIPP_TEXT: Record<BusTipp, string> = {
  rot: 'ROT',
  schwarz: 'SCHWARZ',
  hoeher: 'HÖHER',
  tiefer: 'TIEFER',
  gleich: 'GLEICH',
  zwischen: 'DAZWISCHEN',
  ausserhalb: 'AUSSERHALB',
  ja: 'JA',
  nein: 'NEIN',
};

export const BUS_SUIT_CHARS = ['♥', '♦', '♣', '♠'];
export const BUS_SUIT_NAMES = ['Herz', 'Karo', 'Kreuz', 'Pik'];
const RANK_WORDS: Record<number, string> = { 11: 'Bube', 12: 'Dame', 13: 'König', 14: 'Ass' };
const RANK_SPOKEN = ['', '', 'Zwei', 'Drei', 'Vier', 'Fünf', 'Sechs', 'Sieben', 'Acht', 'Neun', 'Zehn', 'Bube', 'Dame', 'König', 'Ass'];
const ARTICLE: Record<number, string> = { 11: 'der Bube', 12: 'die Dame', 13: 'der König', 14: 'das Ass' };

export const busRed = (c: BusCard) => c.suit < 2;
/** „7“, „Dame“, „Ass“ */
export const busRankWord = (rank: number) => RANK_WORDS[rank] ?? String(rank);
/** Mit Artikel: „die 7“, „der Bube“, „das Ass“ */
export const busRankArtikel = (rank: number) => ARTICLE[rank] ?? `die ${rank}`;
/** „♥7“, „♠A“ (Handy) */
export const busCardText = (c: BusCard) => `${BUS_SUIT_CHARS[c.suit]}${cardLabel(c.rank)}`;
/** „Herz Sieben“, „Pik Ass“ (Sprecher) */
export const busCardSpoken = (c: BusCard) => `${BUS_SUIT_NAMES[c.suit]} ${RANK_SPOKEN[c.rank] ?? c.rank}`;
/** Schlücke bei falschem Tipp auf Karte `step` (0-basiert): 1., 2., 3. … Karte = 1, 2, 3 … */
export const busSchluecke = (step: number) => step + 1;
export const sipText = (n: number) => (n === 1 ? '1 Schluck' : `${n} Schlücke`);

/** Volles Blatt (52 Karten, ungemischt – gemischt wird auf dem Server) */
export function busDeck(): BusCard[] {
  const d: BusCard[] = [];
  for (let suit = 0; suit < 4; suit++) for (let rank = 2; rank <= 14; rank++) d.push({ rank, suit });
  return d;
}

/** Passt die Reihenfolge? Jede Frage braucht genug aufgedeckte Karten davor (z. B. „dazwischen“ zwei). */
export function busFragenOk(fragen: BusFrage[]): boolean {
  return fragen.length > 0 && fragen.every((f, i) => i >= BUS_FRAGEN[f].braucht);
}

/** Untere/obere Grenze für „dazwischen“: die letzten beiden aufgedeckten Karten */
export function busGrenzen(cards: BusCard[]): [number, number] {
  const a = cards[cards.length - 2]?.rank ?? 2;
  const b = cards[cards.length - 1]?.rank ?? 14;
  return [Math.min(a, b), Math.max(a, b)];
}

/** Vergleichskarte für „höher/tiefer“: die zuletzt aufgedeckte */
export const busRef = (cards: BusCard[]): BusCard | null => cards[cards.length - 1] ?? null;

/** Schon aufgedeckte Symbole (sortiert, ohne Doppelte) */
export const busSeenSuits = (cards: BusCard[]) => [...new Set(cards.map((c) => c.suit))].sort();

/**
 * Welche Tipps angeboten werden – nur mögliche: „dazwischen“ fällt weg, wenn nichts dazwischen liegt
 * (Karte 1 = Karte 2 oder Nachbarn wie 7/8), „außerhalb“ bei 2 und Ass, „höher“ gibt es nicht gegen ein Ass,
 * „tiefer“ nicht gegen eine 2.
 */
export function busOptions(frage: BusFrage, cards: BusCard[]): BusTipp[] {
  const all = BUS_FRAGEN[frage].tipps;
  if (frage === 'hoehe') {
    const ref = busRef(cards)?.rank ?? 8;
    return all.filter((t) => !(t === 'hoeher' && ref >= 14) && !(t === 'tiefer' && ref <= 2));
  }
  if (frage === 'zwischen') {
    const [lo, hi] = busGrenzen(cards);
    return all.filter((t) => !(t === 'zwischen' && hi - lo <= 1) && !(t === 'ausserhalb' && lo <= 2 && hi >= 14));
  }
  if (frage === 'symbol') {
    const seen = busSeenSuits(cards).length;
    return all.filter((t) => !(t === 'ja' && seen === 0) && !(t === 'nein' && seen >= 4));
  }
  return all;
}

/** Richtige Antwort für die neue Karte `next` (genau eine pro Frage) */
export function busAnswer(frage: BusFrage, cards: BusCard[], next: BusCard): BusTipp {
  switch (frage) {
    case 'farbe':
      return busRed(next) ? 'rot' : 'schwarz';
    case 'hoehe': {
      const ref = busRef(cards)?.rank ?? next.rank;
      return next.rank > ref ? 'hoeher' : next.rank < ref ? 'tiefer' : 'gleich';
    }
    case 'zwischen': {
      const [lo, hi] = busGrenzen(cards);
      if (next.rank === lo || next.rank === hi) return 'gleich';
      return next.rank > lo && next.rank < hi ? 'zwischen' : 'ausserhalb';
    }
    case 'symbol':
      return cards.some((c) => c.suit === next.suit) ? 'ja' : 'nein';
  }
}

/** Schlücke für einen Tipp: richtig = 0, falsch oder kein Tipp = Schlücke der Karte */
export function busSips(step: number, tipp: BusTipp | null | undefined, answer: BusTipp): number {
  return tipp === answer ? 0 : busSchluecke(step);
}

/**
 * Wahrscheinlichkeit jeder Antwort, gerechnet mit den Karten, die in diesem Durchgang noch im Stapel sein können
 * (52 minus die aufgedeckten). Für die Bots – und als Prüfung, dass angebotene Tipps auch möglich sind.
 */
export function busChancen(frage: BusFrage, cards: BusCard[]): Record<BusTipp, number> {
  const out = Object.fromEntries(BUS_FRAGEN[frage].tipps.map((t) => [t, 0])) as Record<BusTipp, number>;
  const rest = busDeck().filter((c) => !cards.some((o) => o.rank === c.rank && o.suit === c.suit));
  for (const c of rest) out[busAnswer(frage, cards, c)] += 1;
  for (const t of Object.keys(out) as BusTipp[]) out[t] /= rest.length;
  return out;
}

/** Bot-Tipp: meist die wahrscheinlichste Antwort, ab und zu aus dem Bauch heraus (`rnd` = Math.random) */
export function busBotTipp(frage: BusFrage, cards: BusCard[], options: BusTipp[], rnd: () => number = Math.random): BusTipp {
  if (rnd() < 0.25) return options[Math.floor(rnd() * options.length)] ?? options[0];
  const ch = busChancen(frage, cards);
  return [...options].sort((a, b) => (ch[b] ?? 0) - (ch[a] ?? 0))[0];
}

/**
 * Die Frage zur aktuellen Karte als Satz (TV, Handy), z. B. „Höher oder tiefer als die 7 – oder gleich?“.
 */
export function busFrageText(frage: BusFrage, cards: BusCard[]): string {
  switch (frage) {
    case 'farbe':
      return 'Rot oder Schwarz?';
    case 'hoehe': {
      const ref = busRef(cards);
      if (!ref) return BUS_FRAGEN.hoehe.titel;
      const what = busRankArtikel(ref.rank);
      if (ref.rank >= 14) return `Tiefer als ${what} – oder gleich?`;
      if (ref.rank <= 2) return `Höher als ${what} – oder gleich?`;
      return `Höher oder tiefer als ${what} – oder gleich?`;
    }
    case 'zwischen': {
      const [lo, hi] = busGrenzen(cards);
      const opts = busOptions('zwischen', cards);
      const grenze = lo === hi ? busRankWord(lo) : `${busRankWord(lo)} / ${busRankWord(hi)}`;
      if (!opts.includes('zwischen')) return `Außerhalb oder gleich (${grenze})?`;
      if (!opts.includes('ausserhalb')) return `Dazwischen oder gleich (${grenze})?`;
      return `Zwischen ${busRankWord(lo)} und ${busRankWord(hi)}, außerhalb oder gleich?`;
    }
    case 'symbol':
      return 'Hatten wir das Symbol schon?';
  }
}

/** Kurze Erklärung eines Tipps fürs Handy (unter dem Knopf) */
export function busTippHint(frage: BusFrage, tipp: BusTipp, cards: BusCard[]): string {
  const [lo, hi] = busGrenzen(cards);
  const ref = busRef(cards);
  switch (tipp) {
    case 'rot':
      return '♥ ♦';
    case 'schwarz':
      return '♣ ♠';
    case 'hoeher':
      return ref ? `über ${cardLabel(ref.rank)}` : '';
    case 'tiefer':
      return ref ? `unter ${cardLabel(ref.rank)}` : '';
    case 'gleich':
      if (frage === 'hoehe') return ref ? `wieder ${cardLabel(ref.rank)}` : '';
      return lo === hi ? `wieder ${cardLabel(lo)}` : `${cardLabel(lo)} oder ${cardLabel(hi)}`;
    case 'zwischen':
      return hi - lo === 2 ? `nur ${cardLabel(lo + 1)}` : `${cardLabel(lo + 1)} bis ${cardLabel(hi - 1)}`;
    case 'ausserhalb':
      if (lo === hi) return `alles außer ${cardLabel(lo)}`;
      return [lo > 2 ? `unter ${cardLabel(lo)}` : '', hi < 14 ? `über ${cardLabel(hi)}` : ''].filter(Boolean).join(' oder ');
    case 'ja':
      return busSeenSuits(cards).map((s) => BUS_SUIT_CHARS[s]).join(' ');
    case 'nein':
      return [0, 1, 2, 3].filter((s) => !busSeenSuits(cards).includes(s)).map((s) => BUS_SUIT_CHARS[s]).join(' ');
  }
}

/** Warum die Antwort stimmt – Auflösung am Handy/TV, z. B. „9 ist höher als 7“ */
export function busAnswerText(frage: BusFrage, cards: BusCard[], next: BusCard, answer: BusTipp): string {
  const n = cardLabel(next.rank);
  const ref = busRef(cards);
  const [lo, hi] = busGrenzen(cards);
  switch (frage) {
    case 'farbe':
      return `${BUS_SUIT_NAMES[next.suit]} ist ${answer === 'rot' ? 'rot' : 'schwarz'}`;
    case 'hoehe':
      if (!ref) return '';
      return answer === 'gleich' ? `${n} = ${cardLabel(ref.rank)}` : `${n} ist ${answer === 'hoeher' ? 'höher' : 'tiefer'} als ${cardLabel(ref.rank)}`;
    case 'zwischen':
      if (answer === 'gleich') return `${n} – gleich!`;
      return answer === 'zwischen' ? `${n} liegt zwischen ${cardLabel(lo)} und ${cardLabel(hi)}` : `${n} liegt außerhalb von ${cardLabel(lo)}–${cardLabel(hi)}`;
    case 'symbol':
      return answer === 'ja' ? `${BUS_SUIT_NAMES[next.suit]} hatten wir schon` : `${BUS_SUIT_NAMES[next.suit]} ist neu`;
  }
}

// ------------------------------------------------------------------ Zustand (Snapshot an TV und Handys)

export interface BusState {
  /** Durchgang (1-basiert) und wie viele es gibt – jeder Durchgang mit frischem Stapel */
  pass: number;
  passes: number;
  /** Aktuelle Karte (0-basiert) und die Fragen-Reihenfolge (`BUS.FRAGEN`) */
  step: number;
  fragen: BusFrage[];
  /** Zählt jede Karte über alle Durchgänge (Timer-Schlüssel, Animationen) */
  round: number;
  rounds: number;
  sub: 'guess' | 'reveal' | 'over';
  /** Restzeit in ms (0 = kein Zeitlimit) */
  endsIn: number;
  /** Aufgedeckte Karten dieses Durchgangs (in `reveal` inkl. der gerade aufgedeckten) */
  cards: BusCard[];
  /** Angebotene Tipps für die aktuelle Karte */
  options: BusTipp[];
  /** Wer schon getippt hat (die Tipps selbst erst in `reveal`) */
  chosen: string[];
  guesses: Record<string, BusTipp> | null;
  /** Richtige Antwort und Begründung (nur `reveal`) */
  answer: BusTipp | null;
  answerText: string;
  /** Schlücke dieser Karte (nur `reveal`; 0 = sicher) */
  roundSips: Record<string, number> | null;
  /** Hat bei dieser Karte ausgesetzt (Handy weg, nicht getippt) */
  out: string[];
  /** Schlücke insgesamt */
  sips: Record<string, number>;
}
