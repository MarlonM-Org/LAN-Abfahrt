/**
 * Skispringen auf dem Balance Board: Schanze, Konstanten und Zustand (Server, TV, Handy, Bots).
 *
 * Seitenansicht in Metern (x nach rechts, y nach OBEN, Schanzentisch-Kante bei 0/0).
 * Ablauf eines Sprungs:
 *   ready  – Springer stellt sich aufs Board, ruhig stehen = Körpergewicht einmessen
 *   countdown – 3-2-1 auf dem Balken, „In die Hocke!“
 *   inrun  – Anlauf: Schwerpunkt ruhig in der Mitte halten = wenig Luftwiderstand = schneller
 *   flight – am Schanzentisch schnell hochdrücken (Gewichtsspitze) = Absprung; in der Luft leicht nach vorn lehnen
 *   landed – Weite + Punkte (K-Punkt-System wie im Weltcup), dann der Nächste
 */
import type { BalanceTurn } from './balance';

export const SKI = {
  TICK_MS: 33,
  /** Startpunkt des Anlaufs (Meter, horizontal vor dem Tisch) */
  START_X: -78,
  /** K-Punkt und Hill Size (Weite entlang des Hangs) */
  K: 120,
  HS: 140,
  /** Punkte: 60 am K-Punkt, pro Meter ± 1,8 */
  K_POINTS: 60,
  PER_M: 1.8,
  /** Absprung: so viele s vor/nach der Kante zählt noch (0 = perfekt) */
  TAKEOFF_WINDOW_S: 0.42,
  /** Ab so viel Prozent des Anlaufs wird ein Hochdrücken als Absprung gewertet (vorher: nur Wackeln) */
  ARM_AT: 0.55,
  /** Zielhaltung in der Luft: leicht nach vorn */
  FLIGHT_Y: 0.3,
  GATE_MS: 3000,
  LANDED_MS: 4200,
  /** Bei mehr Springern nur ein Durchgang */
  TWO_ROUNDS_MAX: 6,
  /** Anzeige: Pixel pro Meter */
  PX: 3,
};

// ---------------------------------------------------------------- Schanzenprofil

const STEP = 0.5;
const X0 = -100;
const X1 = 260;
const deg = Math.PI / 180;
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Neigung (rad, positiv = bergab) an der Stelle x */
function slopeAt(x: number): number {
  if (x < 0) {
    // Anlauf: 35° steil, die letzten 22 m runden auf 11° am Tisch aus
    return (35 - 24 * smooth((x + 22) / 22)) * deg;
  }
  // Aufsprunghang: Kuppe → 36° → Auslauf flach
  if (x < 38) return (12 + 24 * smooth(x / 38)) * deg;
  if (x < 108) return 36 * deg;
  if (x < 170) return 36 * (1 - smooth((x - 108) / 62)) * deg;
  return 0;
}

/** Höhe des Tisches über der Kuppe: der Hang beginnt 3 m unter der Kante */
const TABLE_DROP = 3;

const N = Math.round((X1 - X0) / STEP) + 1;
const HY = new Float64Array(N);
const HD = new Float64Array(N);
(() => {
  // Anlauf rückwärts vom Tisch (0/0) aufintegrieren, Aufsprunghang vorwärts von (0/−3)
  const i0 = Math.round(-X0 / STEP);
  HY[i0] = 0;
  for (let i = i0 - 1; i >= 0; i--) {
    const x = X0 + i * STEP;
    HY[i] = HY[i + 1] + Math.tan(slopeAt(x + STEP / 2)) * STEP;
  }
  let d = 0;
  let y = -TABLE_DROP;
  for (let i = i0; i < N; i++) {
    const x = X0 + i * STEP;
    if (i > i0) {
      const dy = Math.tan(slopeAt(x - STEP / 2)) * STEP;
      y -= dy;
      d += Math.hypot(STEP, dy);
    }
    HY[i] = i === i0 ? 0 : y;
    HD[i] = d;
  }
})();

const idx = (x: number) => Math.max(0, Math.min(N - 2, (x - X0) / STEP));

/** Oberfläche: Anlauf für x < 0, sonst Aufsprunghang (an der Kante springt sie 3 m nach unten) */
export function hillY(x: number): number {
  const f = idx(x);
  const i = Math.floor(f);
  return HY[i] + (HY[i + 1] - HY[i]) * (f - i);
}

/** Hangneigung (rad, positiv = bergab) */
export const hillSlope = slopeAt;

/** Weite (Meter entlang des Hangs ab der Kante) an der Stelle x ≥ 0 */
export function hillDist(x: number): number {
  if (x <= 0) return 0;
  const f = idx(x);
  const i = Math.floor(f);
  return HD[i] + (HD[i + 1] - HD[i]) * (f - i);
}

/** Umkehrung: an welchem x liegt Weite d? (für Markierungen) */
export function distToX(d: number): number {
  let lo = 0;
  let hi = X1;
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2;
    if (hillDist(m) < d) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

export const HILL = { X0, X1, TABLE_DROP };

/** Punkte für eine Weite (Weltcup-Formel, ohne Wind/Gate) + Haltung (0–20) */
export const distPoints = (dist: number) => Math.max(0, SKI.K_POINTS + (dist - SKI.K) * SKI.PER_M);

// ---------------------------------------------------------------- Zustand

export interface SkiJump {
  dist: number;
  /** Haltungsnote 0–20 */
  style: number;
  points: number;
  fall: boolean;
  /** Absprung-Timing in s (negativ = zu früh, null = verpasst) */
  takeoff: number | null;
  /** Tempo am Tisch (km/h) */
  kmh: number;
  /** Nicht angetreten (nicht aufs Board gekommen) */
  dns?: boolean;
}

export interface SkiState extends BalanceTurn {
  sub: 'ready' | 'countdown' | 'inrun' | 'flight' | 'landed' | 'over';
  round: number;
  rounds: number;
  /** Serverzeit des Standes (für den Snapshot-Puffer am TV) */
  t: number;
  /** Springer: Position (m), Geschwindigkeit (m/s), Körperwinkel (rad, 0 = waagrecht nach rechts) */
  px: number;
  py: number;
  vx: number;
  vy: number;
  ang: number;
  /** Tempo in km/h (Anzeige) */
  kmh: number;
  /** Haltung 0…1 (Anlauf: Hocke, Flug: Lage) */
  q: number;
  /** Absprung erkannt: Timing (s, negativ = zu früh) */
  takeoff: number | null;
  /** Live-Weite (m, während des Flugs) */
  dist: number;
  /** Sprünge pro Spieler und Durchgang */
  jumps: Record<string, SkiJump[]>;
  /** Gesamtpunkte (für Zuschauer-Leiste und Tabelle) */
  points: Record<string, number>;
  /** Letzter Sprung (Anzeige in `landed`) */
  last: (SkiJump & { id: string }) | null;
  /** Bester Sprung des Tages (Schanzenrekord in diesem Spiel) */
  best: { id: string; dist: number } | null;
}
