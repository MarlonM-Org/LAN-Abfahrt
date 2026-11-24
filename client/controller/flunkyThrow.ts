/**
 * Flunkyball: Umrechnung von Handy-Schwung bzw. Wischgeste in die Wurfkraft – die Richtung kommt vom Zielpfeil
 * (▲/▼), der Wurf liefert nur Kraft und beim Wischen eine kleine Abweichung, wenn schräg gewischt wird.
 * Reine Funktionen (kein DOM) – geprüft in `npm run test:flunky`.
 *
 * Kalibrierung Sensor: Ein kräftiger Flunkyball-Wurf (Arm voll durchgeschwungen, wie mit einem echten Ball) dreht
 * das Handy mit gut 1000 °/s – das ist die Referenz (Schwungstärke 1 → mittlerer Abstand ≈ 9,4 m). Für die
 * Abstände im Spiel (7,6–11,5 m) braucht es 850–1350 °/s, ein lockerer Schwung (≈ 600 °/s) kommt nur halb so weit,
 * ein voller Hieb bis an den Kreisel-Anschlag (2000 °/s) fliegt gut 3 m zu weit, aber nicht ans Ende des Strands.
 * Die Beschleunigung zählt nur ohne Kreisel: Sie stößt bei vielen Handys schon bei mittlerem Schwung an den
 * Messbereich (±4 g/±8 g) – deshalb flog mit der alten Bowling-Kurve (voll ab 620 °/s bzw. 25 m/s²) jeder
 * richtige Wurf viel zu weit.
 */
import { flunkyPowerFromLevel } from '../../shared/flunky';
import { type MotionSample, type SwingScale, swingAcc, swingRot } from './motion';
import type { SwipePoint } from './bowlingThrow';

export const FLUNKY_SWING = {
  /** Drehrate (°/s) eines kräftigen Wurfs = Schwungstärke 1 */
  W_REF: 1050,
  /**
   * Beschleunigung ohne Schwerkraft (m/s²) eines kräftigen Wurfs – nur ohne Kreisel. Schon ein mittlerer Schwung
   * stößt an den Messbereich (±8 g ≈ 69 m/s² ohne Schwerkraft), der Anschlag landet deshalb beim weitesten Wurfpunkt.
   */
  A_REF: 55,
  /** darunter gilt es nicht als Wurf */
  W_MIN: 120,
  A_MIN: 3,
  /** ausgewertet wird die letzte Sekunde vor dem Loslassen */
  WINDOW_MS: 1000,
};

export const FLUNKY_SWIPE = {
  /** Fingertempo (CSS-px/ms) eines zügigen Wischers = Schwungstärke 1 */
  V_REF: 1.6,
  /** Tempo aus den letzten 120 ms */
  WINDOW_MS: 120,
  /** Mindestlänge: so viel der Feldhöhe (bzw. mindestens 50 px) */
  MIN_UP: 0.22,
};

export interface FlunkyThrowIn {
  /** 0 … 1 */
  power: number;
  /** Schwungstärke relativ zum kräftigen Wurf (1 = Referenz) */
  level: number;
  /** Wischen: Schräge in Grad (+ = nach rechts), Sensor: null */
  slantDeg: number | null;
  /** Sensor: gemessene Spitzen (Drehrate °/s, Beschleunigung m/s²) */
  peakRot: number;
  peakAcc: number;
  gyro: boolean;
}

export type FlunkyThrowResult = { ok: true; t: FlunkyThrowIn } | { ok: false; reason: string };

/** Hat das Handy einen Kreisel? (irgendein Messwert mit Drehrate) */
const hasGyro = (samples: MotionSample[]) => samples.some((s) => s.rotAlpha || s.rotBeta || s.rotGamma);

/** Schwungstärke eines Messwerts (gleiche Skala wie die Kraft-Kurve) */
export const flunkySampleLevel = (s: MotionSample, gyro: boolean) => (gyro ? swingRot(s) / FLUNKY_SWING.W_REF : swingAcc(s) / FLUNKY_SWING.A_REF);

/** Feedback-Skala zu flunkySwing (Graph am Handy: 1 = kräftiger Wurf) */
export const FLUNKY_SCALE: SwingScale = {
  level: (s) => (s.rotAlpha || s.rotBeta || s.rotGamma ? swingRot(s) / FLUNKY_SWING.W_REF : swingAcc(s) / FLUNKY_SWING.A_REF),
  windowMs: FLUNKY_SWING.WINDOW_MS,
  yawLimit: 80,
};

/**
 * Schwung → Kraft. `samples` = alle Messwerte zwischen Drücken und Loslassen, chronologisch.
 * Gezählt wird die Spitze der Drehrate in der letzten Sekunde (ohne Kreisel: Beschleunigung ohne Schwerkraft).
 */
export function flunkySwing(samples: MotionSample[]): FlunkyThrowResult {
  if (samples.length < 4) return { ok: false, reason: 'Zu kurz – halten, ausholen, werfen, dann loslassen!' };
  const tEnd = samples[samples.length - 1].t;
  if (tEnd - samples[0].t < 200) return { ok: false, reason: 'Zu kurz – halten, ausholen, werfen, dann loslassen!' };
  const win = samples.filter((s) => s.t >= tEnd - FLUNKY_SWING.WINDOW_MS);
  let peakRot = 0;
  let peakAcc = 0;
  for (const s of win) {
    peakRot = Math.max(peakRot, swingRot(s));
    peakAcc = Math.max(peakAcc, swingAcc(s));
  }
  const gyro = hasGyro(samples);
  if (gyro ? peakRot < FLUNKY_SWING.W_MIN : peakAcc < FLUNKY_SWING.A_MIN) {
    return { ok: false, reason: 'Kein Wurf erkannt – Arm richtig durchschwingen!' };
  }
  const level = gyro ? peakRot / FLUNKY_SWING.W_REF : peakAcc / FLUNKY_SWING.A_REF;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { ok: true, t: { power: r2(flunkyPowerFromLevel(level)), level: r2(level), slantDeg: null, peakRot: Math.round(peakRot), peakAcc: Math.round(peakAcc * 10) / 10, gyro } };
}

/**
 * Wischgeste → Kraft (Touch-Alternative): Tempo am Ende der Geste (schnell = weit), Mindestlänge nach oben.
 * Die Schräge (Grad) kommt mit – schräg gewischt verzieht den Wurf ein wenig (`flunkyDev`).
 */
export function flunkySwipe(pts: SwipePoint[], padH: number): FlunkyThrowResult {
  if (pts.length < 2) return { ok: false, reason: 'Nach OBEN wischen!' };
  const a = pts[0];
  const b = pts[pts.length - 1];
  const up = a.y - b.y;
  if (up < Math.max(50, padH * FLUNKY_SWIPE.MIN_UP)) return { ok: false, reason: 'Länger nach OBEN wischen!' };
  const tail = pts.filter((p) => p.t >= b.t - FLUNKY_SWIPE.WINDOW_MS);
  const p0 = tail[0] ?? a;
  const dt = Math.max(16, b.t - p0.t);
  const v = Math.hypot(b.x - p0.x, b.y - p0.y) / dt;
  const level = v / FLUNKY_SWIPE.V_REF;
  const slantDeg = (Math.atan2(b.x - a.x, up) * 180) / Math.PI;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return { ok: true, t: { power: r2(flunkyPowerFromLevel(level)), level: r2(level), slantDeg: Math.round(slantDeg * 10) / 10, peakRot: 0, peakAcc: 0, gyro: false } };
}
