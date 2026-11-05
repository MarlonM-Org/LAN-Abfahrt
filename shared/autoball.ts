/**
 * Auto-Fußball: Konstanten, Spielfeld-Geometrie und Zustandstypen.
 * Wird von Server (Physik), TV (Zeichnen), Handy und Bots benutzt – keine DOM-/Node-Imports.
 *
 * Draufsicht, Welt 480 × 270. Team Sonne (A) verteidigt das linke Tor und spielt nach rechts,
 * Team Meer (B) umgekehrt. Das Feld bleibt immer gleich groß (der TV zeigt das ganze Feld),
 * nur die Tore werden mit der Teamgröße breiter (mehr Autos = mehr Gedränge vor dem Tor).
 */
import type { Team } from './types';

export const AFB = {
  /** Server-Takt; pro Takt mehrere Physik-Teilschritte (gegen Durchtunneln) */
  TICK_MS: 33,
  SUBSTEPS: 3,
  /** Erster Anstoß: Zeit für „So spielst du“ */
  INTRO_MS: 7000,
  COUNTDOWN_MS: 3000,
  /** Torpause: 2 s Wiederholung in Zeitlupe + Tafel mit dem Schützen */
  GOAL_MS: 3800,
  MATCH_MS: 180000,
  /** Golden Goal bei Gleichstand – höchstens so lange, dann Unentschieden */
  OVERTIME_MS: 60000,
  END_MS: 3500,

  // Spielfeld (Innenkante der Bande)
  X0: 50,
  X1: 430,
  Y0: 46,
  Y1: 238,
  /** Abgeschrägte Ecken, damit der Ball nicht festhängt */
  CORNER: 20,
  GOAL_DEPTH: 26,

  CAR_R: 6,
  /** Ball-Kollision sitzt etwas vor der Kartmitte (Schnauze) */
  CAR_NOSE: 1.5,
  BALL_R: 10,
  BALL_MASS: 1,
  CAR_MASS: 3,
  /** Rollwiderstand im Sand: exponentiell (1/s) + konstant (px/s²) */
  BALL_DRAG: 0.6,
  BALL_ROLL: 7,
  BALL_MAX: 260,
  BALL_WALL_E: 0.72,
  BALL_CAR_E: 0.5,
  /** Anteil der Autogeschwindigkeit (Richtung Ball), der zusätzlich als Schuss übertragen wird */
  KICK: 0.32,
  /** … beim HÜPFER mehr */
  HOP_KICK: 0.75,
  CAR_WALL_E: 0.3,

  BOOST_MAX: 100,
  /** pro Sekunde */
  BOOST_FILL: 9,
  BOOST_DRAIN: 36,
  BOOST_KICKOFF: 34,
  /** Kleineres Team (z. B. 2 gegen 3) lädt schneller */
  BOOST_UNDERDOG: 1.6,

  HOP_MS: 450,
  HOP_COOLDOWN_MS: 1300,

  /** Torschütze: letzter Kontakt des eigenen Teams innerhalb dieser Zeit (sonst Eigentor) */
  SCORER_MS: 5000,
};

export const AFB_CX = (AFB.X0 + AFB.X1) / 2;
export const AFB_CY = (AFB.Y0 + AFB.Y1) / 2;

/** Halbe Torbreite je nach Teamgröße: 1 gegen 1 → 56 px, 6 gegen 6 → 76 px */
export const afbGoalHalf = (perTeam: number) => 26 + 2 * Math.max(1, Math.min(6, perTeam));

/** Welches Tor greift ein Team an? (x der Torlinie, Richtung) */
export const afbAttackX = (t: Team) => (t === 'A' ? AFB.X1 : AFB.X0);
export const afbOwnX = (t: Team) => (t === 'A' ? AFB.X0 : AFB.X1);
/** +1 = spielt nach rechts */
export const afbDir = (t: Team) => (t === 'A' ? 1 : -1);

export interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const wallCache = new Map<number, { pts: [number, number][]; segs: Seg[] }>();

/** Bande als geschlossenes Polygon (im Uhrzeigersinn) inkl. Torkästen */
export function afbWalls(goalHalf: number): { pts: [number, number][]; segs: Seg[] } {
  const hit = wallCache.get(goalHalf);
  if (hit) return hit;
  const { X0, X1, Y0, Y1, CORNER: c, GOAL_DEPTH: d } = AFB;
  const g0 = AFB_CY - goalHalf;
  const g1 = AFB_CY + goalHalf;
  const pts: [number, number][] = [
    [X0 + c, Y0], [X1 - c, Y0], [X1, Y0 + c],
    [X1, g0], [X1 + d, g0], [X1 + d, g1], [X1, g1],
    [X1, Y1 - c], [X1 - c, Y1], [X0 + c, Y1], [X0, Y1 - c],
    [X0, g1], [X0 - d, g1], [X0 - d, g0], [X0, g0],
    [X0, Y0 + c],
  ];
  const segs = pts.map(([ax, ay], i) => {
    const [bx, by] = pts[(i + 1) % pts.length];
    return { ax, ay, bx, by };
  });
  const out = { pts, segs };
  wallCache.set(goalHalf, out);
  return out;
}

/** Nächster Punkt auf einer Strecke */
export function closestOnSeg(s: Seg, x: number, y: number): { x: number; y: number } {
  const vx = s.bx - s.ax;
  const vy = s.by - s.ay;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (y - s.ay) * vy) / len2));
  return { x: s.ax + vx * t, y: s.ay + vy * t };
}

/**
 * Kreis gegen Bande: rausschieben + Geschwindigkeit an der Wand spiegeln (Rückprall `e`).
 * Liefert true bei einem Wandkontakt.
 */
export function afbCollideWalls(o: { x: number; y: number; vx: number; vy: number }, r: number, goalHalf: number, e: number): boolean {
  let hit = false;
  for (const s of afbWalls(goalHalf).segs) {
    const p = closestOnSeg(s, o.x, o.y);
    const dx = o.x - p.x;
    const dy = o.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d >= r) continue;
    let nx: number;
    let ny: number;
    if (d > 1e-6) {
      nx = dx / d;
      ny = dy / d;
    } else {
      // genau auf der Linie: Innennormale (Polygon im Uhrzeigersinn → rechts von a→b liegt innen)
      const l = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
      nx = -(s.by - s.ay) / l;
      ny = (s.bx - s.ax) / l;
    }
    o.x = p.x + nx * r;
    o.y = p.y + ny * r;
    const vn = o.vx * nx + o.vy * ny;
    if (vn < 0) {
      o.vx -= (1 + e) * vn * nx;
      o.vy -= (1 + e) * vn * ny;
      hit = true;
    }
  }
  // Notbremse: nie außerhalb des Gesamtrechtecks landen
  const minX = AFB.X0 - AFB.GOAL_DEPTH + r;
  const maxX = AFB.X1 + AFB.GOAL_DEPTH - r;
  if (o.x < minX || o.x > maxX || o.y < AFB.Y0 + r || o.y > AFB.Y1 - r) {
    o.x = Math.max(minX, Math.min(maxX, o.x));
    o.y = Math.max(AFB.Y0 + r, Math.min(AFB.Y1 - r, o.y));
  }
  return hit;
}

/** Anstoß-Aufstellung (Abstand zur Mittellinie, Höhe) – Index 0 steht am nächsten am Ball */
const KICKOFF: [number, number][] = [
  [60, 0],
  [104, -52],
  [104, 52],
  [160, 0],
  [150, -78],
  [150, 78],
];

export function afbKickoff(team: Team, index: number): { x: number; y: number; a: number } {
  const [dx, dy] = KICKOFF[index % KICKOFF.length];
  const x = AFB_CX - afbDir(team) * dx;
  const y = AFB_CY + dy;
  return { x, y, a: Math.atan2(AFB_CY - y, AFB_CX - x) };
}

// ------------------------------------------------------------------ Zustand (Snapshot)

export interface AfbCar {
  x: number;
  y: number;
  /** Fahrtrichtung */
  a: number;
  t: Team;
  /** Boost-Tank 0–100 */
  b: number;
  /** Boost / Mini-Turbo brennt gerade */
  bo: boolean;
  /** −1/1 = driftet, 0 = nein */
  d: number;
  /** Mini-Turbo geladen */
  ch: boolean;
  /** Rest-Hüpfer (ms), 0 = am Boden */
  hop: number;
  /** Rest-Abklingzeit Hüpfer (ms) */
  hc: number;
  /** Tore / Ballkontakte */
  g: number;
  k: number;
}

export interface AfbGoal {
  seq: number;
  /** Team, das den Punkt bekommt */
  team: Team;
  scorer: string | null;
  own: boolean;
}

export interface AfbState {
  sub: 'countdown' | 'play' | 'goal' | 'over';
  /** Serverzeit (Date.now()) dieses Standes – Wiedergabe-Uhr am TV (`client/host/interp.ts`) */
  t: number;
  /** Countdown/Torjubel/Abpfiff: Restzeit; im Spiel: Restspielzeit */
  endsIn: number;
  /** Zähler für Anstöße (damit Handy-Countdowns neu starten) */
  round: number;
  /** Restspielzeit (ms), läuft nur in „play“ */
  clock: number;
  overtime: boolean;
  /** Erster Anstoß (mit Erklärung) */
  first: boolean;
  goalHalf: number;
  score: Record<Team, number>;
  ball: { x: number; y: number; vx: number; vy: number };
  cars: Record<string, AfbCar>;
  lastGoal: AfbGoal | null;
  /** Gewinner nach Abpfiff (null = unentschieden) */
  winner: Team | null;
}
