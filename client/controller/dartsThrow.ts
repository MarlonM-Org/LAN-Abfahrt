/**
 * Darts: Zielen am Handy – reine Funktionen (ohne DOM), damit sie sich mit Testdaten prüfen lassen.
 *
 * - Touch: Finger gedrückt halten und ziehen verschiebt das Fadenkreuz RELATIV (langsam = fein, schnell = weit),
 *   Loslassen wirft. Was beim Abheben des Fingers noch verrutscht, zählt nicht (Position von kurz davor).
 * - Sensor: Handy wie eine Fernbedienung auf den TV richten; Drehen/Neigen verschiebt das Fadenkreuz
 *   (kalibrierte Mitte = Bull), Tippen wirft.
 * Das „Atmen“ (shared/darts.ts) liegt in beiden Fällen die ganze Zeit obendrauf.
 */
import type { Point } from '../../shared/types';
import { type AimCalib, wrapDeg } from './aim';

export const DARTS_AIM = {
  /** mm pro CSS-Pixel bei langsamem Ziehen (Triple-Ring 8 mm ≈ 18 px Fingerweg) */
  SLOW_MM_PER_PX: 0.45,
  /** zusätzliche mm/px pro px/ms Fingertempo … */
  SPEED_GAIN: 1.1,
  /** … bis höchstens so viel (ein schneller Wisch quer über die Scheibe) */
  MAX_MM_PER_PX: 2.2,
  /** Zielpunkt bleibt in ± LIMIT mm (sichtbarer Ausschnitt am Handy) */
  LIMIT: 200,
  /** Sensor: mm pro Grad Drehung/Neigung (± 22° = ganze Scheibe) */
  MM_PER_DEG: 9,
  /** kürzer gehalten = kein Wurf (versehentliches Antippen) */
  MIN_HOLD_MS: 250,
  /** Beim Loslassen zählt die Zielposition von so viel ms vorher (Abheben verwackelt sonst) */
  RELEASE_LOOKBACK_MS: 60,
  /** Sensor: Tippen ruckelt das Handy – es zählt die Position von so viel ms vor dem Tipp */
  TAP_LOOKBACK_MS: 40,
  /** Pause nach einem Wurf, bevor der nächste geht (Doppel-Tipp im Sensor-Modus) */
  COOLDOWN_MS: 500,
};

export const clampAim = (p: Point): Point => {
  const L = DARTS_AIM.LIMIT;
  return { x: Math.max(-L, Math.min(L, p.x)), y: Math.max(-L, Math.min(L, p.y)) };
};

/** Fingerweg (CSS-px) in `dtMs` → Weg des Fadenkreuzes in mm: langsam fein, schnell weit */
export function dragToMm(dx: number, dy: number, dtMs: number): Point {
  const speed = Math.hypot(dx, dy) / Math.max(1, dtMs); // px/ms
  const gain = Math.min(DARTS_AIM.MAX_MM_PER_PX, DARTS_AIM.SLOW_MM_PER_PX + speed * DARTS_AIM.SPEED_GAIN);
  return { x: dx * gain, y: dy * gain };
}

/**
 * Sensor: Ausrichtung → Zielpunkt (mm). Die kalibrierte Ausrichtung zeigt aufs Bull.
 * Nach links drehen → alpha wächst → Fadenkreuz nach links; Oberkante heben → beta wächst → nach oben.
 */
export function sensorAim(o: { alpha: number; beta: number }, calib: AimCalib): Point {
  const yaw = wrapDeg(o.alpha - calib.alpha);
  const pitch = wrapDeg(o.beta - calib.beta);
  return clampAim({ x: -yaw * DARTS_AIM.MM_PER_DEG, y: -pitch * DARTS_AIM.MM_PER_DEG });
}

/** Verlauf der Zielposition der letzten Augenblicke (für „Position kurz vor dem Loslassen“) */
export class AimTrail {
  private pts: { t: number; p: Point }[] = [];

  reset(t: number, p: Point) {
    this.pts = [{ t, p: { ...p } }];
  }

  push(t: number, p: Point) {
    this.pts.push({ t, p: { ...p } });
    // nur die letzte halbe Sekunde behalten (mindestens einen Punkt davor)
    while (this.pts.length > 2 && this.pts[1].t < t - 500) this.pts.shift();
  }

  /** Position zum Zeitpunkt `t`: der letzte Stand davor – oder der älteste bekannte, wenn `t` noch früher liegt */
  at(t: number): Point | null {
    if (!this.pts.length) return null;
    let best = this.pts[0];
    for (const x of this.pts) if (x.t <= t) best = x;
    return { ...best.p };
  }
}
