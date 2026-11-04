/**
 * Boule am Strand: gemeinsame Geometrie und Regeln (Server, TV, Handy, Bots).
 * Koordinaten = Welt-Pixel (480 × 270), von oben gesehen: Wurfkreis links, geworfen wird nach rechts.
 * Aus Sicht des Werfers ist "rechts" auf dem TV also unten (+y).
 */
import type { Point } from './types';

export const BOULE = {
  /** Spielfeld innerhalb der Holzbande */
  X0: 16,
  X1: 466,
  Y0: 70,
  Y1: 260,
  /** Wurfkreis */
  CIRCLE: { x: 42, y: 165 } as Point,
  CIRCLE_R: 9,
  BALL_R: 4.5,
  JACK_R: 2.5,
  /** Ziel-Weite (wo die Kugel ohne Hindernis liegen bleibt) bei Kraft 0 bzw. 1 */
  D_MIN: 90,
  D_MAX: 430,
  /** maximale seitliche Abweichung (rad) */
  ANGLE_MAX: 0.2,
  /** Legen: Anteil der Weite, der gerollt wird; Schießen: viel weniger */
  ROLL_LEGEN: 0.27,
  ROLL_SCHIESSEN: 0.12,
  /** Gleitreibung im Sand (px/s²) – der Schuss bremst durch Rückwärtsdrall viel stärker */
  FRICTION: 300,
  FRICTION_SHOT: 2400,
  /** seitliche Beschleunigung durch Effet (px/s²) */
  SPIN_ACC: 80,
  /** Schweinchen: Abstand zum Kreis und seitliche Streuung */
  JACK_DMIN: 220,
  JACK_DMAX: 340,
  JACK_LAT: 45,
  TARGET: 7,
  AIM_MS: 25000,
  INTRO_MS: 5500,
  PLACE_MS: 1900,
  RESULT_MS: 1300,
  /** Messen: Basis + pro gezähltem Punkt */
  MEASURE_MS: 2600,
  MEASURE_STEP_MS: 700,
  OVER_MS: 3500,
  TRACK_DT: 1 / 20,
};

/** Kugeln pro Spieler und Aufnahme, Anzahl Aufnahmen */
export function bouleSetup(sizes: number[]): { balls: number[][]; maxEnds: number } {
  if (sizes.length !== 2 || sizes.every((s) => s === 1)) {
    // Jeder gegen jeden (sizes = [1, 1, …])
    const per = sizes.length <= 2 ? 3 : 2;
    return { balls: sizes.map(() => [per]), maxEnds: 4 };
  }
  // Teams: gleich viele Kugeln pro Team, 1–2 pro Person
  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  const total = Math.max(max, Math.min(6, 2 * min));
  const balls = sizes.map((n) => Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0)));
  return { balls, maxEnds: total >= 6 ? 3 : 4 };
}

/** Ziel-Weite in px aus der Kraft 0 … 1 */
export const bouleDistance = (power: number) => BOULE.D_MIN + Math.max(0, Math.min(1, power)) * (BOULE.D_MAX - BOULE.D_MIN);
/** Kraft, mit der eine Kugel bei `dist` px liegen bleibt */
export const boulePowerFor = (dist: number) => Math.max(0, Math.min(1, (dist - BOULE.D_MIN) / (BOULE.D_MAX - BOULE.D_MIN)));

/** Wie ein Punkt aus Sicht des Wurfkreises liegt: Weite + Winkel (rad, positiv = rechts/unten) */
export function bouleAim(p: Point): { dist: number; angle: number } {
  const dx = p.x - BOULE.CIRCLE.x;
  const dy = p.y - BOULE.CIRCLE.y;
  return { dist: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
}

export const bouleDist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
