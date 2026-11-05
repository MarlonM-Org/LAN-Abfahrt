/**
 * Kings Cup (Trinkspiel) – Kartenregeln, Zeiten und Zustandstyp.
 * Werte: 2–10 wie aufgedruckt, 11 = Bube, 12 = Dame, 13 = König, 14 = Ass (wie `cardLabel`).
 */

export const KINGS = {
  /** Karten pro Spiel in der Trinkspiel-Rotation (die anderen Trinkspiele dauern je 1–3 Minuten, 12 Karten ≈ 3 Minuten) */
  CARDS_DRINK: 12,
  /** Einzeln gestartet (Arcade / Partyklassiker): das ganze Deck – der VIP kann jederzeit beenden */
  CARDS_SOLO: 52,
  /*
   * Kein Zeitdruck beim Ziehen, Auswählen, Tippen und in Reim-/Kategorie-Runden: es geht erst weiter,
   * wenn der Ziehende (bzw. der Schiri) tippt – oder der VIP überspringt (`skipTurn`). Offline-Spieler
   * werden automatisch übersprungen. Zeitdruck gibt es nur bei den Knopf-Rennen.
   */
  /** Karte umdrehen + Regel lesen */
  REVEAL_MS: 4200,
  /** Reim-/Kategorie-Runde: Richtwert pro Spieler (nur Anzeige, kein Zwang) */
  CHAIN_TURN_MS: 10000,
  /** Reihum höchstens so viele Runden, dann gilt sie als geschafft */
  CHAIN_LAPS: 2,
  /** Knopf-Rennen: Countdown, danach wartet der Server höchstens so lange auf alle */
  RACE_READY_MS: 3000,
  RACE_GO_MAX_MS: 6000,
  /** Zusätzliche zufällige Wartezeit nach dem Countdown (bis „JETZT!“) */
  RACE_JITTER_MS: 1200,
  /** Wasserfall: Grunddauer + pro Spieler */
  WATERFALL_MS: 5000,
  WATERFALL_PER_MS: 1200,
  /** Ansage „X trinkt“ */
  RESULT_MS: 5500,
  /** Sichtbare Regeln (älteste fliegen raus) */
  MAX_RULES: 5,
  RULE_LEN: 60,
  WORD_LEN: 24,
};

export type KingsAction = 'pick' | 'self' | 'race' | 'show' | 'mate' | 'chain' | 'rule' | 'qm' | 'waterfall';

export const KINGS_RULES: Record<number, { title: string; text: string; action: KingsAction }> = {
  2: { title: 'Zwei ist du', text: 'Wer gezogen hat, sucht sich jemanden aus – der trinkt.', action: 'pick' },
  3: { title: 'Drei ist ich', text: 'Wer gezogen hat, trinkt selbst.', action: 'self' },
  4: { title: 'Vier ist Boden', text: 'Hand auf den Boden – und am Handy auf BODEN tippen! Wer zuletzt ist, trinkt.', action: 'race' },
  5: { title: 'Fünf sind Jungs', text: 'Alle Jungs trinken!', action: 'show' },
  6: { title: 'Sechs sind Mädels', text: 'Alle Mädels trinken!', action: 'show' },
  7: { title: 'Sieben ist Himmel', text: 'Hände hoch – und am Handy auf HIMMEL tippen! Wer zuletzt ist, trinkt.', action: 'race' },
  8: { title: 'Acht ist Kumpel', text: 'Such dir einen Trink-Kumpel: Trinkt einer von euch, trinkt der andere mit.', action: 'mate' },
  9: { title: 'Neun ist Reim', text: 'Ein Wort vorgeben – reihum muss jeder darauf reimen. Wer hängt, trinkt.', action: 'chain' },
  10: { title: 'Zehn ist Kategorie', text: 'Eine Kategorie vorgeben – reihum nennt jeder etwas dazu. Wer hängt, trinkt.', action: 'chain' },
  11: { title: 'Bube ist Regel', text: 'Denk dir eine neue Regel aus – sie gilt bis zum Spielende.', action: 'rule' },
  12: { title: 'Dame ist Fragenmeister', text: 'Wer dem Fragenmeister eine Frage beantwortet, trinkt. Konter: „Du bist der Fragenmeister!“', action: 'qm' },
  13: { title: 'König ist Wikingerkönig', text: 'Der König macht ein Geweih mit den Händen – alle anderen rudern! Wer zuletzt rudert, trinkt.', action: 'race' },
  14: { title: 'Ass ist Wasserfall', text: 'Alle trinken gleichzeitig. Aufhören darf nur, wer vor dir (im Uhrzeigersinn) aufgehört hat.', action: 'waterfall' },
};

export type KingsRace = 'boden' | 'himmel' | 'rudern';
export const KINGS_RACE: Record<number, { kind: KingsRace; button: string }> = {
  4: { kind: 'boden', button: 'BODEN' },
  7: { kind: 'himmel', button: 'HIMMEL' },
  13: { kind: 'rudern', button: 'RUDERN!' },
};

/** Vorschläge (für Bots und wenn die Zeit abläuft) */
export const KINGS_RHYMES = ['Haus', 'Bier', 'Hand', 'Stein', 'Licht', 'Bett', 'Wein', 'Rhein'];
export const KINGS_CATEGORIES = ['Tiere', 'Biersorten', 'Automarken', 'Länder', 'Cocktails', 'Obst', 'Fußballvereine', 'Brettspiele'];
export const KINGS_PRESET_RULES = [
  'Vor dem Trinken „Prost“ rufen',
  'Keine Vornamen sagen',
  'Nur mit links trinken',
  'Kein „Ja“ und kein „Nein“',
  'Wer flucht, trinkt',
  'Vor jedem Satz „Ahoi“',
  'Nicht aufs Handy zeigen',
];

export type KingsSub = 'draw' | 'reveal' | 'pick' | 'race' | 'word' | 'chain' | 'rule' | 'waterfall' | 'result' | 'over';

export interface KingsCard {
  /** 2–14 */
  rank: number;
  /** 0 ♥, 1 ♦, 2 ♣, 3 ♠ */
  suit: number;
}

export interface KingsAnnounce {
  /** z. B. „Bob trinkt!“ */
  title: string;
  /** Direkt Betroffene */
  main: string[];
  /** Trinken als Kumpel mit: id + über wen */
  extra: { id: string; via: string }[];
  /** Müssen `main` (und `extra`) trinken? */
  drink: boolean;
  note?: string;
}

export interface KingsState {
  /** Sitzordnung im Uhrzeigersinn */
  order: string[];
  /** Wer gerade dran ist (zieht bzw. gezogen hat) */
  drawer: string;
  drawn: number;
  total: number;
  card: KingsCard | null;
  /** Zählt jede gezogene Karte – für Animationen */
  drawSeq: number;
  sub: KingsSub;
  /** Restzeit des aktuellen Schritts in ms */
  endsIn: number;
  pickFor: 'drink' | 'mate' | null;
  race: {
    kind: KingsRace;
    /** ready = Countdown, go = JETZT!, done = Auflösung */
    phase: 'ready' | 'go' | 'done';
    /** Wer mitmacht (beim König ohne den König) */
    players: string[];
    /** Reaktionszeit in ms ab „JETZT!“ (vom Server gemessen) */
    times: Record<string, number>;
    /** Die Langsamsten (trinken) */
    slow: string[];
  } | null;
  chain: {
    mode: 'reim' | 'kategorie';
    word: string;
    /** Wer gerade dran ist */
    turn: string;
    step: number;
    maxSteps: number;
  } | null;
  rules: { text: string; by: string }[];
  /** Fragenmeister */
  qm: string | null;
  /** Kumpel: wer die 8 gezogen hat → sein Kumpel */
  mates: Record<string, string>;
  /** Wie oft jemand trinken musste (inkl. Kumpel) */
  drinks: Record<string, number>;
  announce: KingsAnnounce | null;
  /** Wasserfall-Reihenfolge (beginnt beim Ziehenden) */
  waterfall: string[] | null;
  /** Zuletzt auf den Fragenmeister reingefallen */
  fooled: { id: string; seq: number; extra: string[] } | null;
}

/** Alle, die mit trinken müssen (Kumpel, auch über mehrere Ecken) */
export function kingsMateClosure(mates: Record<string, string>, start: string[]): { id: string; via: string }[] {
  const seen = new Set(start);
  const out: { id: string; via: string }[] = [];
  const queue = [...start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const [a, b] of Object.entries(mates)) {
      const other = a === cur ? b : b === cur ? a : null;
      if (other && !seen.has(other)) {
        seen.add(other);
        out.push({ id: other, via: cur });
        queue.push(other);
      }
    }
  }
  return out;
}

export const SUIT_CHARS = ['♥', '♦', '♣', '♠'];
