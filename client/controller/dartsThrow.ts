/**
 * Darts: Umrechnung eines kurzen Schnippens mit dem Handy in einen Wurf.
 * Reine Funktion (kein DOM) – lässt sich mit Testdaten prüfen.
 *
 * Haltung: Handy aufrecht wie einen Dart halten, Knopf gedrückt halten, aus dem Handgelenk
 * nach vorn schnippen und dabei loslassen.
 * - Kraft: Spitze der Drehrate (°/s) bzw. Beschleunigung ohne Schwerkraft in den letzten 600 ms
 * - Seite: Drehung um die Hochachse (Kompass) zwischen Drücken und Loslassen
 */
import type { MotionSample } from './motion';
import { type ThrowResult, wrapDeg } from './bowlingThrow';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const dead = (v: number, zone: number) => (Math.abs(v) < zone ? 0 : (v - Math.sign(v) * zone) / (1 - zone));
const median = (vals: number[]) => {
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** Ergebnis: `speed` = Kraft 0 … 1 (Ideal ≈ 0,6), `angle` = seitlicher Fehler −1 … 1, `spin` = 0 */
export function flickToThrow(samples: MotionSample[]): ThrowResult {
  if (samples.length < 3) return { ok: false, reason: 'Zu kurz – halten, schnippen, loslassen!' };
  const tEnd = samples[samples.length - 1].t;
  if (tEnd - samples[0].t < 120) return { ok: false, reason: 'Zu kurz – halten, schnippen, loslassen!' };
  const win = samples.filter((s) => s.t >= tEnd - 600);
  let peakW = 0;
  let peakA = 0;
  for (const s of win) {
    peakW = Math.max(peakW, Math.hypot(s.rotAlpha, s.rotBeta, s.rotGamma));
    peakA = Math.max(peakA, Math.abs(Math.hypot(s.ax, s.ay, s.az) - 9.81));
  }
  if (peakW < 90 && peakA < 2.5) return { ok: false, reason: 'Kein Wurf erkannt – Handy nach vorn schnippen!' };
  // Ein lockeres Schnippen (~700 °/s bzw. ~16 m/s²) ergibt die Idealkraft 0,6
  const raw = Math.max((peakW - 120) / 960, (peakA - 2.5) / 22);
  const speed = clamp(raw, 0.05, 1);

  const head = samples.slice(0, 3);
  const tail = samples.slice(-3);
  let yaw = wrapDeg(median(tail.map((s) => s.alpha)) - median(head.map((s) => s.alpha)));
  if (Math.abs(yaw) > 60) yaw = 0; // Kompass springt → ignorieren
  // alpha wächst bei Drehung nach links → negative Seite
  const angle = clamp(dead(-yaw / 25, 0.12), -1, 1);
  return { ok: true, t: { speed: r2(speed), angle: r2(angle), spin: 0 } };
}
