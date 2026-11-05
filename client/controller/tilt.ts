/**
 * Kipp-Lenkung: reine Rechenfunktionen (ohne DOM), damit sie sich mit künstlichen Sensorwerten testen lassen.
 *
 * Idee: Aus beta/gamma (deviceorientation, auf iOS und Android gleich definiert) wird der "Oben"-Vektor
 * im Geräte-Koordinatensystem berechnet, in Bildschirm-Koordinaten gedreht (Hoch-/Querformat) und daraus
 * der Rollwinkel bestimmt: wie weit das Handy – wie ein Lenkrad – nach rechts bzw. links gedreht ist.
 * Das funktioniert sowohl aufrecht gehalten (Lenkrad) als auch flach (Tablett nach links/rechts kippen).
 */

const DEG = Math.PI / 180;

/** Rollwinkel in Grad: positiv = im Uhrzeigersinn gedreht / rechte Seite nach unten (= nach rechts lenken) */
export function tiltRoll(betaDeg: number, gammaDeg: number, screenAngleDeg: number): number {
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  // "Oben" (Gegenrichtung der Schwerkraft) in Geräte-Koordinaten (W3C: R = Rz(α)·Rx(β)·Ry(γ))
  const ux = -Math.cos(b) * Math.sin(g);
  const uy = Math.sin(b);
  // Bildschirm-Achse "rechts" in Geräte-Koordinaten je nach Ausrichtung des Bildschirms
  const t = screenAngleDeg * DEG;
  const right = ux * Math.cos(t) - uy * Math.sin(t);
  return Math.asin(Math.max(-1, Math.min(1, -right))) / DEG;
}

/**
 * Lenkung −1 … 1 aus dem Rollwinkel relativ zur kalibrierten Mitte.
 * Totzone gegen Zittern, volle Lenkung bei `fullDeg` Grad.
 */
export function steerFromRoll(rollDeg: number, centerDeg: number, fullDeg = 28, deadDeg = 2.5): number {
  let d = rollDeg - centerDeg;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  const sign = Math.sign(d);
  const mag = Math.max(0, Math.abs(d) - deadDeg) / Math.max(1, fullDeg - deadDeg);
  return Math.round(sign * Math.min(1, mag) * 100) / 100;
}

/**
 * Anzeige für die Kipp-Lenkung: gemessener Winkel relativ zur Mitte, z. B. „◀ 12°“ oder „8° ▶“.
 * Innerhalb der Totzone „0°“, ab voller Lenkung mit „MAX“.
 */
export function tiltLabel(rollDeg: number, centerDeg: number, fullDeg = 28, deadDeg = 2.5): string {
  let d = rollDeg - centerDeg;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  const a = Math.round(Math.abs(d));
  if (Math.abs(d) < deadDeg) return '0°';
  const txt = Math.abs(d) >= fullDeg ? `${a}° MAX` : `${a}°`;
  return d < 0 ? `◀ ${txt}` : `${txt} ▶`;
}
