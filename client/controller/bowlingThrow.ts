/**
 * Bowling: Umrechnung von Handy-Schwung bzw. Wischgeste in einen Wurf.
 * Reine Funktionen (kein DOM) – damit lassen sie sich mit Testdaten prüfen.
 * Alles ist bewusst großzügig eingestellt: Ein lockerer Schwung soll einen ordentlichen Wurf ergeben.
 */
import { type MotionSample, type SwingScale, swingAcc, swingRot } from './motion';

export interface BowlThrow {
  /** 0 … 1 */
  speed: number;
  /** −1 (links) … 1 (rechts) */
  angle: number;
  /** −1 … 1, Haken nach links/rechts */
  spin: number;
}

export type ThrowResult = { ok: true; t: BowlThrow } | { ok: false; reason: string };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r2 = (v: number) => Math.round(v * 100) / 100;
/** kleine Werte → 0, Rest linear bis 1 */
const dead = (v: number, zone: number) => (Math.abs(v) < zone ? 0 : (v - Math.sign(v) * zone) / (1 - zone));
/** Winkeldifferenz in −180 … 180 */
export const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

const median = (vals: number[]) => {
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/**
 * Schwung → Wurf.
 * - Tempo: Spitze der Drehrate (°/s) bzw. der Beschleunigung ohne Schwerkraft während des Schwungs
 * - Richtung: Drehung um die Hochachse (Kompass alpha) zwischen Drücken und Loslassen, etwas Kippen (gamma)
 * - Effet: Drehung des Handgelenks (Drehrate um die Längsachse) kurz vor dem Loslassen
 * `samples` = alle Messwerte zwischen Drücken und Loslassen, chronologisch.
 */
export function swingToThrow(samples: MotionSample[]): ThrowResult {
  if (samples.length < 4) return { ok: false, reason: 'Zu kurz – halten, schwingen, dann loslassen!' };
  const t0 = samples[0].t;
  const tEnd = samples[samples.length - 1].t;
  if (tEnd - t0 < 200) return { ok: false, reason: 'Zu kurz – halten, schwingen, dann loslassen!' };

  // Nur die letzte Sekunde zählt für den Schwung
  const win = samples.filter((s) => s.t >= tEnd - 1000);
  let peakW = 0;
  let peakA = 0;
  for (const s of win) {
    peakW = Math.max(peakW, Math.hypot(s.rotAlpha, s.rotBeta, s.rotGamma));
    peakA = Math.max(peakA, Math.abs(Math.hypot(s.ax, s.ay, s.az) - 9.81));
  }
  if (peakW < 70 && peakA < 2.5) return { ok: false, reason: 'Kein Schwung erkannt – schwing das Handy nach vorn!' };
  const raw = Math.max((peakW - 100) / 520, (peakA - 3) / 22);
  const speed = 0.18 + 0.82 * clamp(raw, 0, 1);

  // Richtung: Mittel der ersten/letzten Messwerte (robuster gegen Ausreißer)
  const head = samples.slice(0, 3);
  const tail = samples.slice(-3);
  let yaw = wrapDeg(median(tail.map((s) => s.alpha)) - median(head.map((s) => s.alpha)));
  if (Math.abs(yaw) > 80) yaw = 0; // Kompass springt (z. B. Handy fast senkrecht) → ignorieren
  let roll = median(tail.map((s) => s.gamma)) - median(head.map((s) => s.gamma));
  if (Math.abs(roll) > 80) roll = 0;
  // alpha wächst bei Drehung nach links → negative Richtung
  const angle = clamp(dead((-yaw / 30) * 0.8 + (roll / 60) * 0.2, 0.08), -1, 1);

  // Effet: Handgelenk-Drehung in den letzten 250 ms
  const rel = samples.filter((s) => s.t >= tEnd - 250);
  const twist = rel.reduce((a, s) => a + s.rotGamma, 0) / Math.max(1, rel.length);
  const spin = clamp(dead(twist / 260, 0.15), -1, 1) * 0.85;

  return { ok: true, t: { speed: r2(speed), angle: r2(angle), spin: r2(spin) } };
}

/** Feedback-Skala zu swingToThrow (gleiche Schwellen: Roh-Stärke vor der Umrechnung in das Tempo) */
export const BOWL_SCALE: SwingScale = {
  level: (s) => Math.max((swingRot(s) - 100) / 520, (swingAcc(s) - 3) / 22),
  windowMs: 1000,
  yawLimit: 80,
};

/** Feedback-Skala zu swipeToThrow: Fingertempo (px/ms) → Roh-Stärke, ausgewertet werden die letzten 120 ms */
export const swipeLevel = (v: number) => (v - 0.35) / 2.2;
export const SWIPE_WINDOW_MS = 120;

export interface SwipePoint {
  x: number;
  y: number;
  t: number;
}

/**
 * Wischgeste → Wurf (Touch-Alternative).
 * - Tempo: Geschwindigkeit am Ende der Geste
 * - Richtung: Winkel von Start zu Ende
 * - Effet: Krümmung der Geste (Bogen nach links → Kurve nach rechts, wie ein Haken)
 */
export function swipeToThrow(pts: SwipePoint[], padH: number): ThrowResult {
  if (pts.length < 2) return { ok: false, reason: 'Nach OBEN wischen!' };
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b.x - a.x;
  const up = a.y - b.y;
  if (up < Math.max(50, padH * 0.18)) return { ok: false, reason: 'Länger nach OBEN wischen!' };

  // Tempo aus den letzten ~120 ms
  const tail = pts.filter((p) => p.t >= b.t - 120);
  const p0 = tail[0] ?? a;
  const dt = Math.max(16, b.t - p0.t);
  const v = Math.hypot(b.x - p0.x, b.y - p0.y) / dt; // px/ms
  const speed = 0.18 + 0.82 * clamp((v - 0.35) / 2.2, 0, 1);

  const ang = Math.atan2(dx, up); // rad, positiv = nach rechts
  const angle = clamp(dead(ang / 0.4, 0.06), -1, 1);

  // größte seitliche Abweichung der Bahn von der Sehne (positiv = rechts der Sehne)
  const len = Math.hypot(dx, up);
  let dev = 0;
  for (const p of pts) {
    const d = ((p.x - a.x) * up - (a.y - p.y) * dx) / len;
    if (Math.abs(d) > Math.abs(dev)) dev = d;
  }
  // Bogen nach links (dev < 0) → Bahn endet nach rechts drehend → Haken nach rechts
  const spin = clamp(dead((-dev / len) * 5, 0.1), -1, 1);

  return { ok: true, t: { speed: r2(speed), angle: r2(angle), spin: r2(spin) } };
}
