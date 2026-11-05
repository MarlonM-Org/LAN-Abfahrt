/**
 * Angeln: gemeinsame Konstanten, Fisch-Tabelle, Geometrie und Typen (Server, TV, Handy, Bots).
 * Draufsicht auf den See am Ferienhaus: unten der Steg (alle stehen nebeneinander),
 * nach oben wird der See tiefer – wer weiter auswirft, fängt größere Fische.
 */

export const ANGELN = {
  TICK_MS: 50,
  INTRO_MS: 7000,
  /** Rundenlänge (zum Testen kürzer: ANGELN_ROUND_MS=60000 npm run dev) */
  ROUND_MS: 200000,
  /** Nach Ablauf dürfen laufende Drills noch so lange zu Ende gehen */
  LAST_MS: 15000,
  OVER_MS: 3500,

  /** Wurf: Flugzeit der Pose */
  CAST_MS: 750,
  /** Mindest-Wurfweite (0 … 1) */
  MIN_POWER: 0.12,
  /** Warten auf den Biss */
  BITE_MIN_MS: 2600,
  BITE_MAX_MS: 8500,
  /** Fenster zum Anschlagen (seltene Fische sind schneller wieder weg) */
  STRIKE_MS: 1300,
  STRIKE_MS_RARE: 1000,
  /** Anzeige nach Fang / Verlust */
  CAUGHT_MS: 3000,
  LOST_MS: 1900,

  // ---- Drill (alle Werte pro Sekunde, Spannung 0 … 1)
  /** Grüne Zone der Schnurspannung */
  GREEN_LO: 0.22,
  GREEN_HI: 0.78,
  /** Ab hier reißt die Schnur */
  SNAP: 1,
  /** Unter dieser Spannung ist die Schnur schlaff … */
  SLACK: 0.1,
  /** … und nach so langer Zeit schlaff ist der Fisch weg */
  SLACK_MS: 1600,
  /** Halten: Spannung steigt um REEL_UP + PULL_UP · Zug */
  REEL_UP: 0.12,
  PULL_UP: 0.75,
  /** Loslassen: Spannung fällt um REL_DOWN, Zug bremst das */
  REL_DOWN: 0.5,
  PULL_HOLD: 0.28,
  /** Kippen gegen die Zugrichtung nimmt bis zu so viel Zug weg */
  TILT_COUNTER: 0.4,
  /** Kurbel-Tempo (Anteil der Strecke pro Sekunde) – schwere Fische langsamer */
  REEL_FAST: 0.28,
  REEL_SLOW: 0.18,
  /** Ohne Kurbeln nimmt der Fisch Schnur */
  TAKE_LINE: 0.025,

  /** Spielfeld: Steg, Bahnen und See */
  JETTY_Y: 228,
  /** Füße der Angler */
  FEET_Y: 240,
  LANE_X0: 70,
  LANE_X1: 476,
  /** Nächster / weitester Wurf (y-Position der Pose) */
  NEAR_Y: 206,
  FAR_Y: 52,
  /** Sichtbare Tiefenzonen */
  ZONES: [
    { name: 'Flach', from: 0 },
    { name: 'Mittel', from: 0.38 },
    { name: 'Tief', from: 0.72 },
  ],
};

export type FishKind = 'alge' | 'schuh' | 'rotauge' | 'barsch' | 'forelle' | 'karpfen' | 'zander' | 'hecht' | 'wels' | 'goldfisch';

export interface FishDef {
  name: string;
  /** Gewicht in kg (min/max) */
  kg: [number, number];
  /** Punkte = base + kg · perKg */
  base: number;
  perKg: number;
  /** Lieblingstiefe 0 … 1 und Streuung */
  depth: number;
  spread: number;
  /** Grundhäufigkeit */
  weight: number;
  /** Kampfkraft 0 … 1 */
  fight: number;
  /** Krempel statt Fisch */
  junk?: boolean;
  rare?: boolean;
}

export const FISH: Record<FishKind, FishDef> = {
  alge: { name: 'Alge', kg: [0.1, 0.4], base: 1, perKg: 0, depth: 0.1, spread: 0.35, weight: 0.7, fight: 0, junk: true },
  schuh: { name: 'Alter Schuh', kg: [0.4, 1.1], base: 2, perKg: 0, depth: 0.45, spread: 0.5, weight: 0.45, fight: 0.05, junk: true },
  rotauge: { name: 'Rotauge', kg: [0.1, 0.6], base: 5, perKg: 6, depth: 0.15, spread: 0.3, weight: 1.2, fight: 0.15 },
  barsch: { name: 'Barsch', kg: [0.2, 1.6], base: 8, perKg: 5, depth: 0.35, spread: 0.3, weight: 1.0, fight: 0.3 },
  forelle: { name: 'Forelle', kg: [0.4, 2.6], base: 10, perKg: 5, depth: 0.5, spread: 0.28, weight: 0.8, fight: 0.45 },
  karpfen: { name: 'Karpfen', kg: [2, 9], base: 12, perKg: 3, depth: 0.6, spread: 0.28, weight: 0.75, fight: 0.6 },
  zander: { name: 'Zander', kg: [1, 6], base: 15, perKg: 4, depth: 0.8, spread: 0.2, weight: 0.6, fight: 0.6 },
  hecht: { name: 'Hecht', kg: [2, 11], base: 18, perKg: 4, depth: 0.9, spread: 0.2, weight: 0.5, fight: 0.8 },
  wels: { name: 'Wels', kg: [8, 32], base: 25, perKg: 2, depth: 1, spread: 0.14, weight: 0.16, fight: 1, rare: true },
  goldfisch: { name: 'Goldfisch', kg: [0.1, 0.3], base: 60, perKg: 0, depth: 0.5, spread: 1, weight: 0.05, fight: 0.2, rare: true },
};

export const FISH_KINDS = Object.keys(FISH) as FishKind[];

/** Punkte für einen Fang */
export const fishPoints = (kind: FishKind, kg: number) => Math.round(FISH[kind].base + kg * FISH[kind].perKg);

/** „4,2 kg“ bzw. „350 g“ */
export function fmtKg(kg: number): string {
  if (kg < 1) return `${Math.round(kg * 100) * 10} g`;
  return `${kg.toFixed(1).replace('.', ',')} kg`;
}

/** Tiefe 0 … 1 → y der Pose */
export const castY = (depth: number) => ANGELN.NEAR_Y + (ANGELN.FAR_Y - ANGELN.NEAR_Y) * depth;

/** Name der Tiefenzone */
export function zoneName(depth: number): string {
  let n = ANGELN.ZONES[0].name;
  for (const z of ANGELN.ZONES) if (depth >= z.from) n = z.name;
  return n;
}

/** Bahn-Mitte (x) für Spieler i von n */
export function laneX(i: number, n: number): number {
  const w = Math.min(70, (ANGELN.LANE_X1 - ANGELN.LANE_X0) / Math.max(1, n));
  const x0 = (ANGELN.LANE_X0 + ANGELN.LANE_X1) / 2 - (w * n) / 2;
  return x0 + w * (i + 0.5);
}

/** Bahnbreite bei n Spielern */
export const laneW = (n: number) => Math.min(70, (ANGELN.LANE_X1 - ANGELN.LANE_X0) / Math.max(1, n));

// ------------------------------------------------------------------ Typen

export type AngelSt = 'idle' | 'cast' | 'wait' | 'bite' | 'reel' | 'caught' | 'lost';
export type AngelLost = 'early' | 'late' | 'snap' | 'slack' | 'time' | null;

export interface AngelCatch {
  seq: number;
  pid: string;
  kind: FishKind;
  kg: number;
  pts: number;
}

export interface AngelPlayer {
  lane: number;
  st: AngelSt;
  /** Zählt bei jedem Wurf hoch (Handy baut dann neu) */
  castSeq: number;
  /** Ziel der Pose (Welt-Pixel) und Tiefe 0 … 1 */
  fx: number;
  fy: number;
  depth: number;
  /** Restzeit des aktuellen Zustands (Wurf, Anbiss-Fenster, Anzeige) in ms */
  left: number;
  /** Zupfer am Köder (Handy vibriert kurz) */
  nibbles: number;
  /** Drill: Spannung 0 … 1, Reststrecke 1 → 0, Zugrichtung des Fischs (−1 links, 0 ruhig, 1 rechts) */
  tension: number;
  prog: number;
  pull: -1 | 0 | 1;
  /** Wie lange die Schnur schon schlaff ist (ms) */
  slack: number;
  hold: boolean;
  /** Drill: grobe Größenklasse (0 Krempel/klein … 3 riesig) – Art bleibt geheim bis zum Fang */
  size: number;
  lost: AngelLost;
  score: number;
  count: number;
  /** Letzter Fang (für Anzeige am Handy) */
  last: AngelCatch | null;
  /** Bester Fang (meiste Punkte) */
  best: AngelCatch | null;
}

export interface AngelnState {
  sub: 'intro' | 'play' | 'last' | 'over';
  endsIn: number;
  players: Record<string, AngelPlayer>;
  /** Letzte Fänge (für TV-Effekte), aufsteigend nach seq */
  catches: AngelCatch[];
  /** Größter Fang der Runde (nach Gewicht, ohne Krempel) */
  record: AngelCatch | null;
}
