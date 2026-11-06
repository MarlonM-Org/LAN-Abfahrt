/**
 * Wasserbomben-Schlacht: Konstanten, Garten-Geometrie und Zustandstypen.
 * Wird von Server (Spiellogik), TV (Zeichnen) und Bots (Ausweichen) benutzt.
 */
import type { Point, Team } from './types';

export const WASSER = {
  TIME_MS: 120000,
  COUNTDOWN_MS: 3000,
  /** Spielfläche (unter der HUD-Leiste) */
  AREA: { x: 6, y: 32, w: 468, h: 234 },
  PLAYER_R: 5,
  SPEED: 74,
  SOAKED_SPEED: 62,
  /** Maximale Wurfweite (volle Auslenkung des Ziel-Sticks) */
  RANGE: 160,
  /** Kürzester Wurf (Stick knapp über der Totzone) – so trifft man auch Gegner direkt neben sich */
  MIN_THROW: 6,
  /** Kurve Stick-Auslenkung → Weite (Exponent): kleine Ausschläge bleiben fein und nah, voller Ausschlag = RANGE */
  AIM_CURVE: 2,
  /** Ab dieser Auslenkung (0–1, nach der Totzone) wird beim Loslassen geworfen, darunter abgebrochen */
  AIM_MIN: 0.05,
  MIN_FLIGHT_MS: 260,
  FLIGHT_MS_PER_PX: 3.4,
  THROW_COOLDOWN_MS: 380,
  MAX_AMMO: 3,
  /** ms pro Wasserbombe an Eimer bzw. Gartenschlauch */
  BUCKET_REFILL_MS: 700,
  HOSE_REFILL_MS: 260,
  REFILL_R: 15,
  HOSE_R: 20,
  DIRECT_R: 7,
  SPLASH_R: 22,
  DIRECT_WET: 55,
  SPLASH_WET_MAX: 26,
  SPLASH_WET_MIN: 10,
  /** Sonne trocknet langsam, wenn man eine Weile nicht getroffen wurde */
  DRY_PER_S: 2.5,
  DRY_DELAY_MS: 2500,
  /** Am Handtuch abtrocknen */
  TOWEL_R: 14,
  TOWEL_DRY_MS: 2500,
  /** Klatschnass: so lange darf man selbst zum Handtuch laufen, danach wird man hingetragen (nie Dauer-Pause) */
  SOAKED_AUTO_MS: 5000,
  SPAWN_SHIELD_MS: 1500,
  /** Wasserpistole */
  PISTOL_MS: 6000,
  PISTOL_RANGE: 64,
  PISTOL_CONE: 0.32,
  PISTOL_WET_PER_S: 40,
  PISTOL_EVERY_MS: 22000,
  PISTOL_FIRST_MS: 14000,
  /** Kurzer Splash-Verlauf im Snapshot */
  SPLASH_KEEP_MS: 700,
};

export type WasserCoverKind = 'hedge' | 'lounger';
export interface WasserRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const mirror = (r: WasserRect): WasserRect => ({ ...r, x: 480 - r.x - r.w });

/** Deckung: blockt Laufen, Volltreffer und Spritzer */
export const WASSER_COVER: (WasserRect & { kind: WasserCoverKind })[] = (() => {
  const left: (WasserRect & { kind: WasserCoverKind })[] = [
    { x: 94, y: 64, w: 12, h: 46, kind: 'hedge' },
    { x: 118, y: 200, w: 46, h: 12, kind: 'hedge' },
    { x: 168, y: 128, w: 24, h: 10, kind: 'lounger' },
    { x: 204, y: 230, w: 24, h: 10, kind: 'lounger' },
  ];
  return [...left, ...left.map((r) => ({ ...mirror(r), kind: r.kind }))];
})();

/** Pool: man kann nicht durchlaufen, aber drüberwerfen */
export const WASSER_POOL: WasserRect = { x: 196, y: 32, w: 88, h: 50 };

/** Nachfüll-Punkt am Gartenschlauch (die Trommel steht direkt dahinter) */
export const WASSER_HOSE: Point = { x: 240, y: 166 };
export const WASSER_HOSE_REEL: WasserRect = { x: 230, y: 148, w: 20, h: 10 };

export const WASSER_BASE: Record<Team, { bucket: Point; towel: Point }> = {
  A: { bucket: { x: 26, y: 96 }, towel: { x: 26, y: 206 } },
  B: { bucket: { x: 454, y: 96 }, towel: { x: 454, y: 206 } },
};

export const WASSER_PISTOL_SPOTS: Point[] = [
  { x: 240, y: 112 },
  { x: 240, y: 214 },
  { x: 150, y: 160 },
  { x: 330, y: 160 },
];

/** Alle Hindernisse für die Bewegung */
export const WASSER_BLOCKERS: WasserRect[] = [...WASSER_COVER, WASSER_POOL, WASSER_HOSE_REEL];

/** Schneidet die Strecke a→b das Rechteck (leicht verkleinert)? */
export function segHitsRect(ax: number, ay: number, bx: number, by: number, r: WasserRect, shrink = 0.5): number | null {
  const x0 = r.x + shrink;
  const y0 = r.y + shrink;
  const x1 = r.x + r.w - shrink;
  const y1 = r.y + r.h - shrink;
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay)) return t0;
  return null;
}

/** Liegt zwischen a und b Deckung? */
export function coverBetween(ax: number, ay: number, bx: number, by: number): boolean {
  return WASSER_COVER.some((r) => segHitsRect(ax, ay, bx, by, r) !== null);
}

export function flightMs(dist: number) {
  return WASSER.MIN_FLIGHT_MS + dist * WASSER.FLIGHT_MS_PER_PX;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Wurfweite für eine Stick-Auslenkung 0–1: quadratisch – fein in der Nähe, voller Ausschlag reicht trotzdem bis RANGE */
export function throwDist(stick: number) {
  return WASSER.MIN_THROW + (WASSER.RANGE - WASSER.MIN_THROW) * clamp(stick, 0, 1) ** WASSER.AIM_CURVE;
}

/** Aufschlagpunkt eines Wurfs von (x, y) mit Ziel-Stick (ax, ay) – Server (Wurf) und TV (Vorschau) rechnen identisch */
export function throwTarget(x: number, y: number, ax: number, ay: number): Point {
  const len = Math.hypot(ax, ay);
  const k = len > 1e-6 ? throwDist(len) / len : 0;
  const A = WASSER.AREA;
  return { x: clamp(x + ax * k, A.x + 2, A.x + A.w - 2), y: clamp(y + ay * k, A.y + 2, A.y + A.h - 2) };
}

/** Umkehrung (Bots): Ziel-Stick, mit dem ein Wurf (dx, dy) vom Werfer entfernt landet */
export function aimFor(dx: number, dy: number): Point {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: 0, y: 0 };
  const s = Math.max(WASSER.AIM_MIN, clamp((d - WASSER.MIN_THROW) / (WASSER.RANGE - WASSER.MIN_THROW), 0, 1) ** (1 / WASSER.AIM_CURVE));
  return { x: (dx / d) * s, y: (dy / d) * s };
}

// ------------------------------------------------------------------ Zustand (kompakt)

export type WasserStatus = 'ok' | 'soaked' | 'drying';

export interface WasserPlayer {
  x: number;
  y: number;
  /** Team (bei Jeder-gegen-jeden null) */
  t: Team | null;
  /** Farbe (Team- bzw. Spielerfarbe) */
  c: number;
  /** Nässe 0–100 */
  w: number;
  /** Wasserbomben in der Hand */
  a: number;
  s: WasserStatus;
  /** Blickrichtung */
  d: 1 | -1;
  /** läuft gerade */
  m: boolean;
  /** Ziel-Stick (−1…1), 0/0 = zielt nicht */
  ax: number;
  ay: number;
  /** Restzeit Wasserpistole in ms */
  pi: number;
  /** Abtrocknen-Fortschritt 0–1 (nur bei "drying") */
  dp: number;
  /** Klatschnass: ms, bis man automatisch zum Handtuch getragen wird (sonst 0) */
  sk: number;
  /** Verbindung weg: eingefroren und unverwundbar */
  away?: boolean;
  /** Treffer gelandet */
  h: number;
  /** selbst klatschnass geworden */
  n: number;
  /** andere klatschnass gemacht */
  k: number;
}

export interface WasserBalloon {
  id: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  /** bereits geflogen (ms) */
  age: number;
  dur: number;
  c: number;
}

export interface WasserSplash {
  id: number;
  x: number;
  y: number;
  /** Volltreffer (großer Platscher) */
  big: boolean;
  /** an Deckung abgeprallt */
  cover: boolean;
  c: number;
}

export interface WasserState {
  sub: 'countdown' | 'play' | 'over';
  /** Warum vorbei: Zeit um oder eine Seite kann nicht mehr mitspielen (Handy weg / entfernt) */
  endReason: 'time' | 'away' | null;
  endsIn: number;
  ffa: boolean;
  players: Record<string, WasserPlayer>;
  balloons: WasserBalloon[];
  splashes: WasserSplash[];
  pistol: Point | null;
  /** Klatschnass-Zähler pro Team (bei Jeder-gegen-jeden ungenutzt) */
  score: Record<Team, number>;
  /** Zuletzt klatschnass geworden (für Einblendung) */
  lastSoak: { seq: number; victim: string; by: string | null } | null;
}
