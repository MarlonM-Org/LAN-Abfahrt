/**
 * Zielen per Bewegungssensor bzw. Touchpad – bewusst reine Funktionen (ohne DOM),
 * damit sie sich ohne Handy mit künstlichen Messwerten prüfen lassen.
 *
 * Haltung: Handy wie eine Fernbedienung/Lichtpistole halten, Oberkante zeigt auf den TV.
 * - Links/rechts drehen ändert alpha (Kompass; nach links drehen → alpha wird größer)
 * - Oberkante heben/senken ändert beta (heben → beta wird größer)
 */

export interface AimCalib {
  alpha: number;
  beta: number;
}

export interface AimField {
  /** Breite/Höhe der Zielfläche in Weltpixeln */
  w: number;
  h: number;
  /** Drehwinkel (°) vom Zentrum bis zum linken/rechten Rand */
  yawRange: number;
  /** Neigungswinkel (°) vom Zentrum bis zum oberen/unteren Rand */
  pitchRange: number;
}

/** Winkeldifferenz auf −180 … 180° normieren (alpha springt bei 0/360°). */
export function wrapDeg(d: number): number {
  const r = (((d + 180) % 360) + 360) % 360 - 180;
  return r === -180 ? 180 : r;
}

/**
 * Ausrichtung → Fadenkreuz-Position. Die Kalibrierung (Handy zeigt auf die TV-Mitte)
 * entspricht der Feldmitte. Ergebnis ist auf die Fläche begrenzt.
 */
export function orientToAim(o: { alpha: number; beta: number }, calib: AimCalib, f: AimField): { x: number; y: number } {
  const yaw = wrapDeg(o.alpha - calib.alpha);
  const pitch = wrapDeg(o.beta - calib.beta);
  const x = f.w / 2 - (yaw / f.yawRange) * (f.w / 2);
  const y = f.h / 2 - (pitch / f.pitchRange) * (f.h / 2);
  return { x: Math.max(0, Math.min(f.w, x)), y: Math.max(0, Math.min(f.h, y)) };
}

/** Leichte Glättung gegen Sensorzittern: k = 0 (träge) … 1 (keine Glättung). Große Sprünge werden schneller übernommen. */
export function smoothAim(prev: { x: number; y: number } | null, next: { x: number; y: number }, k = 0.35) {
  if (!prev) return { ...next };
  const d = Math.hypot(next.x - prev.x, next.y - prev.y);
  const kk = Math.min(1, k + d / 200);
  return { x: prev.x + (next.x - prev.x) * kk, y: prev.y + (next.y - prev.y) * kk };
}

/**
 * Touchpad wie am Laptop: Fingerweg (CSS-px) → Weltpixel mit Beschleunigung.
 * Langsame Bewegungen sind präzise, schnelle Wischer bringen das Fadenkreuz weit.
 */
export function trackpadDelta(dx: number, dy: number, dtMs: number): { dx: number; dy: number } {
  const speed = Math.hypot(dx, dy) / Math.max(1, dtMs); // px/ms
  const gain = 0.6 + Math.min(1.8, speed * 1.1);
  return { dx: dx * gain, dy: dy * gain };
}
