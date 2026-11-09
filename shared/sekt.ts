/**
 * Sektkorken: gemeinsame Konstanten, Formeln und Typen (Server, TV, Handy, Bots).
 *
 * Jeder hat eine Sektflasche an der Strandbar. Daumen auf dem Korken = Korken drin; Schütteln (bzw. Reiben)
 * baut Druck auf, der langsam wieder sinkt. Loslassen = PLOPP – der Korken fliegt so weit, wie Druck da ist.
 * Wer zu lange im roten Bereich bleibt (die Zone wackelt und sinkt im Lauf des Durchgangs), dem platzt die
 * Flasche: 0 m. Drei Durchgänge, der beste Wurf zählt.
 */

export const SEKT = {
  TICK_MS: 50,
  /** Flaschen werden aufgestellt (Handy: Sensor oder Reiben wählen) */
  INTRO_MS: 3500,
  /** 3-2-1 vor jedem Durchgang (Daumen auf den Korken) – Phase `countdown` → Piep/„Los!“ aus ui.ts */
  COUNT_MS: 3000,
  /** Schüttelzeit pro Durchgang; wer dann noch hält, dessen Korken knallt automatisch */
  SHAKE_MS: 8000,
  /** Sind alle fertig, endet der Durchgang nach dieser kurzen Pause früher */
  ALL_DONE_MS: 900,
  /** Weiten-Schau am Strand nach jedem Durchgang */
  SHOW_MS: 4200,
  OVER_MS: 5500,
  ROUNDS: 3,

  // ---- Druck (0 … 1)
  /** Druckaufbau pro Sekunde bei voller Schüttelstärke (s = 1), wird zur Spitze hin zäher */
  GAIN: 0.42,
  /** So viel zäher wird der Aufbau bei vollem Druck (Faktor 1 − STIFF · p) */
  STIFF: 0.35,
  /** Druckverlust pro Sekunde (auch beim Schütteln) */
  DECAY: 0.05,
  /** Höchste gewertete Schüttelstärke (Sensor und Reiben) */
  S_MAX: 1.3,
  /** Ohne neue Schüttel-Meldung gilt die Stärke nach so vielen ms als 0 */
  S_STALE_MS: 350,
  /** Darunter zählt Loslassen nicht (Korken wieder rein, kein Wurf verbraucht) */
  MIN_POP: 0.06,

  // ---- Rote Zone (Unterkante, wandert)
  /** Unterkante zu Beginn bzw. am Ende des Durchgangs (die Flasche wird warm) */
  RED_START: 0.88,
  RED_END: 0.77,
  /** Langsames Wandern und schnelles Wackeln: Amplitude + Periode (ms) */
  RED_A1: 0.05,
  RED_P1: 2600,
  RED_A2: 0.022,
  RED_P2: 900,
  /** So lange (ms) darf der Druck in der roten Zone sein, dann PENG */
  BURST_MS: 450,

  // ---- Weite
  /** Weite bei Druck 1 (m) */
  MAX_M: 50,
  /** Kurve Druck → Weite (p^EXP) */
  EXP: 1.35,
  /** Zufall pro Wurf (± Anteil) */
  NOISE: 0.02,
};

export type SektSub = 'intro' | 'countdown' | 'shake' | 'show' | 'over';

/**
 * Zustand der eigenen Flasche im laufenden Durchgang:
 * `wait` = Korken nicht gehalten (kein Druck), `in` = Daumen drauf, `pop` = geknallt, `burst` = geplatzt,
 * `fizzle` = zur Zeit noch gehalten, aber ohne Druck („Pfft“).
 */
export type SektSt = 'wait' | 'in' | 'pop' | 'burst' | 'fizzle';

export interface SektPlayer {
  /** Platz an der Bar (0 … n−1) */
  slot: number;
  st: SektSt;
  /** Druck 0 … 1 */
  p: number;
  /** Aktuelle Schüttelstärke 0 … S_MAX (TV wackelt, Handy zeigt „kommt an“) */
  s: number;
  /** Fortschritt bis zum Platzen 0 … 1 (nur in der roten Zone > 0) */
  danger: number;
  /** Weite pro Durchgang: > 0 Meter, 0 = kein Wurf, −1 = geplatzt */
  throws: number[];
  /** Bester Wurf (m) */
  best: number;
}

export interface SektPop {
  seq: number;
  pid: string;
  round: number;
  /** Weite in m (0 bei Platzen/Pfft) */
  m: number;
  burst: boolean;
  /** Druck beim Knall */
  p: number;
  /** Zur Zeit automatisch geknallt */
  auto: boolean;
}

export interface SektState {
  sub: SektSub;
  /** Durchgang 1 … rounds (0 im Intro) */
  round: number;
  rounds: number;
  endsIn: number;
  /** Unterkante der roten Zone 0 … 1 (für alle gleich) */
  red: number;
  /** Reihenfolge an der Bar */
  order: string[];
  players: Record<string, SektPlayer>;
  /** Letzte Knalle (für TV-Effekte), aufsteigend nach seq */
  pops: SektPop[];
}

// ------------------------------------------------------------------ Formeln

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Unterkante der roten Zone nach `ms` Schüttelzeit; `phase` = Zufalls-Versatz des Durchgangs */
export function sektRed(ms: number, phase: number): number {
  const k = clamp(ms / SEKT.SHAKE_MS, 0, 1);
  const base = SEKT.RED_START + (SEKT.RED_END - SEKT.RED_START) * k;
  const w1 = Math.sin((ms / SEKT.RED_P1) * Math.PI * 2 + phase * 6.283) * SEKT.RED_A1;
  const w2 = Math.sin((ms / SEKT.RED_P2) * Math.PI * 2 + phase * 17.1) * SEKT.RED_A2;
  return clamp(base + w1 + w2, 0.6, 0.97);
}

/** Druck → Weite in m (ohne Zufall) */
export const sektMeters = (p: number) => SEKT.MAX_M * Math.pow(clamp(p, 0, 1), SEKT.EXP);

/** „23,4 m“ */
export const fmtM = (m: number) => `${m.toFixed(1).replace('.', ',')} m`;

/** Weite eines Durchgangs als kurzer Text („23,4 m“, „geplatzt“, „–“) */
export const throwText = (m: number) => (m < 0 ? 'geplatzt' : m > 0 ? fmtM(m) : '–');
