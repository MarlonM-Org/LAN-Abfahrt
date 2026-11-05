/**
 * Darts an der Strandbar: gemeinsame Geometrie, Wertung, Wurfberechnung und Zustandstypen.
 * Wird von Server (Spiellogik), TV, Handy, Bots und dem Test-Skript benutzt.
 *
 * Koordinaten = Millimeter auf der Scheibe, Mitte (0, 0), x nach rechts, y nach UNTEN
 * (wie auf dem Bildschirm). Echte Turnier-Maße: Doppelring außen bei 170 mm.
 */
import type { Point } from './types';

export const DARTS = {
  /** Radien (mm) */
  BULL_IN: 6.35,
  BULL_OUT: 15.9,
  TRIPLE_IN: 99,
  TRIPLE_OUT: 107,
  DOUBLE_IN: 162,
  DOUBLE_OUT: 170,
  /** Ziel- und Landepunkte werden auf ± WALL begrenzt (Wand um die Scheibe) */
  WALL: 230,

  ROUNDS: 5,
  DARTS_PER_ROUND: 3,
  /** Letzte Runde: Punkte zählen doppelt */
  FINAL_MULT: 2,

  /** Wackeln des Fadenkreuzes (Amplitude in mm): Start, Minimum (ganz ruhig), Maximum */
  AMP_START: 30,
  AMP_MIN: 11,
  AMP_MAX: 42,
  /** Zeitkonstante (ms), mit der sich das Fadenkreuz beruhigt */
  CALM_TAU_MS: 1300,

  /** Wurfkraft 0 … 1: im Bereich IDEAL ± TOL fällt der Dart genau aufs Fadenkreuz */
  POWER_IDEAL: 0.6,
  POWER_TOL: 0.06,
  /** mm Abweichung nach unten/oben pro Krafteinheit außerhalb des Idealbereichs */
  DROP_MM: 220,
  /** mm seitliche Abweichung bei voll schräger Geste (side = ±1) */
  SIDE_MM: 40,
  /** Standardabweichung der kleinen Zufallsstreuung (mm) */
  NOISE_MM: 5,

  /** Erklär-Screen (VIP kann überspringen) */
  INTRO_MS: 8000,
  /**
   * Runde: `null` = kein Zeitlimit (vorher 40 s) – sie endet, wenn alle ihre Darts geworfen haben.
   * Der VIP kann im Menü abkürzen; fehlende Darts werden dann automatisch (ungenau) geworfen.
   */
  ROUND_MS: null as number | null,
  /** nach dem letzten Dart einer Runde (Flug + Anzeige) */
  LAST_MS: 1800,
  /** Zwischenstand nach jeder Runde (vorher 5 s, VIP kann überspringen) */
  TALLY_MS: 10000,
  OVER_MS: 4500,
  /** Abwesende Spieler werfen automatisch (Abstand zwischen zwei Darts) */
  AUTO_MS: 1400,
};

/** Segmentzahlen im Uhrzeigersinn, beginnend oben */
export const DART_SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

export type DartRing = 'bull' | 'outerbull' | 'single' | 'double' | 'triple' | 'miss';

export interface DartHit {
  ring: DartRing;
  /** Segmentzahl (bei Bull 25, bei Daneben 0) */
  seg: number;
  /** Punkte ohne Runden-Multiplikator */
  points: number;
  /** z. B. "TRIPLE 20", "BULLSEYE", "7" */
  label: string;
  /** kurz für die Anzeige am Dart, z. B. "T20", "D5", "BULL" */
  short: string;
}

/** Segment-Index (0 = 20 oben) für einen Punkt */
export function dartSegmentIndex(p: Point): number {
  const deg = (Math.atan2(p.x, -p.y) * 180) / Math.PI; // 0 = oben, im Uhrzeigersinn
  return Math.floor((((deg + 9) % 360) + 360) % 360 / 18) % 20;
}

/** Wertung eines Treffers */
export function dartsScore(p: Point): DartHit {
  const r = Math.hypot(p.x, p.y);
  if (r <= DARTS.BULL_IN) return { ring: 'bull', seg: 25, points: 50, label: 'BULLSEYE', short: 'BULL' };
  if (r <= DARTS.BULL_OUT) return { ring: 'outerbull', seg: 25, points: 25, label: 'BULL 25', short: '25' };
  if (r > DARTS.DOUBLE_OUT) return { ring: 'miss', seg: 0, points: 0, label: 'DANEBEN', short: '0' };
  const seg = DART_SEGMENTS[dartSegmentIndex(p)];
  if (r >= DARTS.TRIPLE_IN && r <= DARTS.TRIPLE_OUT) return { ring: 'triple', seg, points: seg * 3, label: `TRIPLE ${seg}`, short: `T${seg}` };
  if (r >= DARTS.DOUBLE_IN) return { ring: 'double', seg, points: seg * 2, label: `DOPPEL ${seg}`, short: `D${seg}` };
  return { ring: 'single', seg, points: seg, label: String(seg), short: String(seg) };
}

/** Mitte eines Feldes (für Bots und Schnellwahl am Handy) */
export function dartsTarget(seg: number, ring: 'triple' | 'double' | 'single' | 'bull'): Point {
  if (ring === 'bull' || seg === 25) return { x: 0, y: 0 };
  const idx = DART_SEGMENTS.indexOf(seg);
  const a = (idx * 18 * Math.PI) / 180;
  const r = ring === 'triple' ? (DARTS.TRIPLE_IN + DARTS.TRIPLE_OUT) / 2 : ring === 'double' ? (DARTS.DOUBLE_IN + DARTS.DOUBLE_OUT) / 2 : 135;
  return { x: Math.round(Math.sin(a) * r * 10) / 10, y: Math.round(-Math.cos(a) * r * 10) / 10 };
}

// ------------------------------------------------------------------ Wackeln (Lissajous)

/** Fester Phasenversatz pro Spieler, Runde und Dart – Handy und Server rechnen dasselbe */
export function dartsPhase(playerId: string, round: number, n: number): number {
  let h = 2166136261;
  for (const ch of `${playerId}|${round}|${n}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

/** Versatz des Fadenkreuzes zum Zielpunkt nach `t` ms bei Amplitude `amp` (mm) – eine Lissajous-Schleife */
export function dartsWobble(t: number, amp: number, phase: number): Point {
  const x = Math.sin(t * 0.0021 + phase) * 0.72 + Math.sin(t * 0.0057 + phase * 2) * 0.28;
  const y = Math.sin(t * 0.0029 + phase * 1.7) * 0.72 + Math.sin(t * 0.0043 + phase * 3) * 0.28;
  return { x: x * amp, y: y * amp };
}

/** Wie sich das Fadenkreuz in `dtMs` beruhigt */
export function dartsCalm(amp: number, dtMs: number): number {
  return DARTS.AMP_MIN + (amp - DARTS.AMP_MIN) * Math.exp(-dtMs / DARTS.CALM_TAU_MS);
}

// ------------------------------------------------------------------ Wurf

export type PowerHint = 'low' | 'ok' | 'high';

export function dartsPowerHint(power: number): PowerHint {
  if (power < DARTS.POWER_IDEAL - DARTS.POWER_TOL) return 'low';
  if (power > DARTS.POWER_IDEAL + DARTS.POWER_TOL) return 'high';
  return 'ok';
}

export const POWER_TEXT: Record<PowerHint, string> = { low: 'zu schwach', ok: 'perfekt', high: 'zu stark' };

/**
 * Landepunkt aus Fadenkreuz (mm), Wurfkraft 0 … 1, seitlichem Fehler −1 … 1 und zwei
 * normalverteilten Zufallszahlen (Streuung). Zu schwach → tiefer, zu stark → höher.
 */
export function dartsLanding(cross: Point, power: number, side: number, noise: [number, number]): Point {
  const p = Math.max(0, Math.min(1, power));
  const lo = DARTS.POWER_IDEAL - DARTS.POWER_TOL;
  const hi = DARTS.POWER_IDEAL + DARTS.POWER_TOL;
  const off = p < lo ? p - lo : p > hi ? p - hi : 0;
  const s = Math.max(-1, Math.min(1, side));
  const x = cross.x + s * DARTS.SIDE_MM + noise[0] * DARTS.NOISE_MM;
  const y = cross.y - off * DARTS.DROP_MM + noise[1] * DARTS.NOISE_MM;
  const W = DARTS.WALL;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { x: r1(Math.max(-W, Math.min(W, x))), y: r1(Math.max(-W, Math.min(W, y))) };
}

/** Deterministischer Zufall (mulberry32) */
export function dartsRng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Zwei normalverteilte Zahlen (Box-Muller) aus einem Seed – begrenzt auf ±2.5 σ */
export function dartsNoise(seed: number): [number, number] {
  const rnd = dartsRng(seed);
  const u = Math.max(1e-9, rnd());
  const v = rnd();
  const m = Math.sqrt(-2 * Math.log(u));
  const c = (z: number) => Math.max(-2.5, Math.min(2.5, z));
  return [c(m * Math.cos(2 * Math.PI * v)), c(m * Math.sin(2 * Math.PI * v))];
}

// ------------------------------------------------------------------ Zustand

export interface DartsDart {
  seq: number;
  owner: string;
  round: number;
  /** 0 … 2 */
  n: number;
  /** Landepunkt (mm) */
  x: number;
  y: number;
  ring: DartRing;
  seg: number;
  label: string;
  short: string;
  /** Punkte inkl. Runden-Multiplikator */
  points: number;
  power: PowerHint;
  /** automatisch geworfen (Zeit um / Spieler weg) */
  auto?: boolean;
}

export interface DartsPlayer {
  id: string;
  /** Pfeilfarbe als Hex-Zahl */
  color: number;
  total: number;
  /** Punkte dieser Runde */
  round: number;
  /** Darts dieser Runde schon geworfen */
  thrown: number;
  /** Punkte pro Runde */
  history: number[];
}

export interface DartsState {
  sub: 'intro' | 'throw' | 'tally' | 'over';
  endsIn: number;
  round: number;
  rounds: number;
  /** Multiplikator der aktuellen Runde (Finale: 2) */
  mult: number;
  players: DartsPlayer[];
  /** Darts der aktuellen Runde (werden nach jeder Runde aus der Scheibe gezogen) */
  darts: DartsDart[];
  /** Auswertung der Runde (sub = 'tally') */
  tally: { best: string[]; points: number } | null;
}
