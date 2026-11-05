/**
 * Mäxchen am Pool (Würfel-Bluff à la Meiern/Mäxle): Rangfolge der Würfe, Konstanten, Texte.
 * Wird von Server, TV und Handy importiert.
 */

/**
 * Alle Würfe von niedrig nach hoch: 31 < 32 < 41 … < 65 < Päsche 11 … 66 < Mäxchen (21).
 * Ein Wurf aus zwei Würfeln wird immer mit der höheren Ziffer vorn gelesen (5 + 3 = 53).
 */
export const MAEX_ORDER: readonly number[] = [31, 32, 41, 42, 43, 51, 52, 53, 54, 61, 62, 63, 64, 65, 11, 22, 33, 44, 55, 66, 21];

export const MAEXCHEN = 21;

export const MAEX = {
  LIVES: 3,
  /** Runden um den Tisch (Arcade/Einzelspiel bzw. Trinkspiel-Rotation) */
  ROUNDS: 6,
  ROUNDS_DRINK: 2,
  /** Zeit zum Glauben/Aufdecken bzw. Ansagen – danach automatisch „glauben“ bzw. ehrliche (oder knappste) Ansage */
  TURN_MS: 15_000,
  /** Becher wackelt, Trommelwirbel – Würfel noch verdeckt */
  LIFT_MS: 2_000,
  /** Würfel liegen offen, wer verliert */
  REVEAL_MS: 4_600,
  /** Mäxchen geglaubt (ohne Aufdecken) */
  ACCEPT_MS: 3_200,
  /** Strafe: normal 1, bei angesagtem Mäxchen 2 (Leben bzw. Schlücke); Mäxchen glauben kostet 1 */
  COST: 1,
  COST_MAEXCHEN: 2,
  /** Bots bluffen so oft, obwohl ihr Wurf reicht */
  BOT_BLUFF: 0.3,
};

/** Wert eines Wurfs (höhere Ziffer vorn; Pasch 11 … 66; 2 + 1 = Mäxchen 21) */
export function maexValue(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi === 2 && lo === 1) return MAEXCHEN;
  return hi * 10 + lo;
}

/** Rang in der Mäxchen-Reihenfolge (−1 = kein gültiger Wert) */
export const maexRank = (v: number) => MAEX_ORDER.indexOf(v);

/** Schlägt `v` die Ansage `claim`? (ohne Ansage zählt alles) */
export const maexBeats = (v: number, claim: number | null | undefined) => maexRank(v) >= 0 && (claim == null || maexRank(v) > maexRank(claim));

export const isPasch = (v: number) => v !== MAEXCHEN && v % 11 === 0;

/** Anzeige: „54“, „3er-Pasch“, „MÄXCHEN“ */
export function maexLabel(v: number): string {
  if (v === MAEXCHEN) return 'MÄXCHEN';
  if (isPasch(v)) return `${v / 11}er-Pasch`;
  return String(v);
}

const PASCH_WORDS = ['', 'Einer', 'Zweier', 'Dreier', 'Vierer', 'Fünfer', 'Sechser'];

/** Für den Sprecher: „Mäxchen!“, „Dreierpasch“, „54“ (Zahlen liest die Stimme selbst) */
export function maexSpoken(v: number): string {
  if (v === MAEXCHEN) return 'Mäxchen!';
  if (isPasch(v)) return `${PASCH_WORDS[v / 11]}pasch`;
  return String(v);
}

/** Wahrscheinlichkeit, mit einem Wurf mindestens `v` zu schaffen (für Bots) */
export function maexChanceAtLeast(v: number): number {
  const r = maexRank(v);
  let n = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (maexRank(maexValue(a, b)) >= r) n++;
  return n / 36;
}
