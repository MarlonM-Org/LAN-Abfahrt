/**
 * Minigolf: Umrechnung von Zurückziehen (Schleuder) bzw. Putter-Schwung in einen Schlag.
 * Reine Funktionen (kein DOM) – damit lassen sie sich mit Testdaten prüfen (`npm run test:golf`).
 */
import type { MotionSample } from './motion';

export interface Putt {
  /** Richtung in Welt-Koordinaten (rad, 0 = nach rechts, π/2 = nach unten) */
  angle: number;
  /** 0 … 1 (1 = maximale Rollweite) */
  power: number;
}

export type PuttResult = { ok: true; putt: Putt } | { ok: false; reason: string };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const median = (vals: number[]) => {
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** unter so vielen px Zurückziehen passiert nichts (Antippen/Verwackeln) */
export const DRAG_DEAD = 14;

/**
 * Zurückziehen wie eine Schleuder: (dx, dy) = Weg des Fingers in Bildschirm-Pixeln (Karte nicht gedreht,
 * Bildschirm-x = Welt-x). Der Ball fliegt in die Gegenrichtung, die Länge bestimmt die Kraft.
 * `maxLen` = Ziehweg für 100 %.
 */
export function dragToPutt(dx: number, dy: number, maxLen: number): PuttResult {
  const len = Math.hypot(dx, dy);
  if (len < DRAG_DEAD) return { ok: false, reason: 'Weiter zurückziehen – dann loslassen!' };
  const power = clamp((len - DRAG_DEAD) / Math.max(1, maxLen - DRAG_DEAD), 0, 1);
  return { ok: true, putt: { angle: r3(Math.atan2(-dy, -dx)), power: Math.round(Math.max(0.02, power) * 100) / 100 } };
}

/**
 * Putter-Schwung mit dem Bewegungssensor (Knopf halten, Handy wie einen Putter pendeln, loslassen).
 * - Kraft: Spitze der Drehrate bzw. Beschleunigung (ohne Schwerkraft) in der letzten Sekunde –
 *   bewusst viel feinfühliger als beim Bowling: ein sanftes Pendeln ist ein kurzer Putt
 * - Richtung: `aimAngle` (Zielpfeil auf der Karte) + kleine Korrektur durch Drehen des Handys (Kompass)
 */
export function swingToPutt(samples: MotionSample[], aimAngle: number): PuttResult {
  if (samples.length < 4) return { ok: false, reason: 'Zu kurz – halten, pendeln, dann loslassen!' };
  const t0 = samples[0].t;
  const tEnd = samples[samples.length - 1].t;
  if (tEnd - t0 < 150) return { ok: false, reason: 'Zu kurz – halten, pendeln, dann loslassen!' };
  const win = samples.filter((s) => s.t >= tEnd - 1000);
  let peakW = 0;
  let peakA = 0;
  for (const s of win) {
    peakW = Math.max(peakW, Math.hypot(s.rotAlpha, s.rotBeta, s.rotGamma));
    peakA = Math.max(peakA, Math.abs(Math.hypot(s.ax, s.ay, s.az) - 9.81));
  }
  if (peakW < 25 && peakA < 0.8) return { ok: false, reason: 'Kein Schwung erkannt – pendel das Handy wie einen Putter!' };
  const raw = Math.max((peakW - 25) / 420, (peakA - 0.8) / 14);
  const power = clamp(0.05 + 0.95 * clamp(raw, 0, 1), 0.05, 1);
  const head = samples.slice(0, 3);
  const tail = samples.slice(-3);
  let yaw = wrapDeg(median(tail.map((s) => s.alpha)) - median(head.map((s) => s.alpha)));
  if (Math.abs(yaw) > 60) yaw = 0; // Kompass springt → ignorieren
  // alpha wächst bei Drehung nach links (gegen den Uhrzeigersinn von oben) → Winkel auf dem TV kleiner
  const corr = (clamp(-yaw, -24, 24) * 0.5 * Math.PI) / 180;
  return { ok: true, putt: { angle: r3(aimAngle + corr), power: Math.round(power * 100) / 100 } };
}
