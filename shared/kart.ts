import type { Point } from './types';

/**
 * Kart-Rennen: Strecken (Mittellinie als geschlossener Spline + Breite) und Geometrie.
 * Wird von Server (Physik), TV (Zeichnen) und Bots (Lenken) gemeinsam benutzt – keine DOM-/Node-Imports.
 */

export const KART = {
  LAPS: 3,
  /** Etwas länger als früher: Zeit für „So fährst du“ und die Ansichts-Wahl des VIP */
  COUNTDOWN_MS: 8000,
  /** Nach dem Sieger haben alle anderen noch so lange Zeit */
  AFTER_WINNER_MS: 20000,
  /** Notbremse, falls niemand ins Ziel kommt */
  MAX_RACE_MS: 210000,
  /** Fahrphysik (Pixel, Sekunden) */
  MAX_SPEED: 88,
  ACCEL: 120,
  BRAKE: 210,
  /** Ohne Gas rollt das Kart aus */
  COAST: 55,
  /** Rückwärtsgang (BREMSE halten, wenn das Kart steht) */
  REVERSE_SPEED: 34,
  REVERSE_ACCEL: 70,
  SAND_SPEED: 40,
  TURN: 3.0,
  GRIP: 11,
  DRIFT_GRIP: 2.6,
  DRIFT_MIN_SPEED: 40,
  DRIFT_CHARGE_S: 0.75,
  MINI_TURBO_MS: 700,
  BOOST_MS: 1600,
  BOOST_FACTOR: 1.5,
  RADIUS: 5,
  /** Sandstreifen neben der Strecke, dahinter Bande */
  SAND: 11,
  /** Item-Boxen */
  BOX_R: 6,
  BOX_RESPAWN_MS: 1200,
  /** Wurfgeschoss Kokosnuss */
  COCONUT_SPEED: 175,
  COCONUT_MS: 1900,
  BANANA_MS: 30000,
  SPIN_MS: 1100,
  /** Nach dem Drehen kurz unverwundbar */
  SAFE_MS: 900,
  GULL_SPEED: 230,
  MAX_HAZARDS: 16,
  /** Bis zu so vielen (menschlichen) Spielern ist TV-Splitscreen Standard, darüber rendert jedes Handy selbst */
  SPLIT_MAX: 4,
  /** Server-Takt der Physik (ms) – die Handys bekommen so oft einen Stand */
  TICK_MS: 50,
};

/** Wo die Verfolger-Ansicht läuft: geteilter TV-Bildschirm oder auf jedem Handy */
export type KartView = 'split' | 'phone';

export interface TrackDef {
  name: string;
  /** "auf der Strandpromenade", "im Hafen" … für Texte */
  at: string;
  /** Thema für die Zeichnung */
  theme: 'beach' | 'harbor' | 'pool';
  width: number;
  /** Kontrollpunkte (geschlossen, im Uhrzeigersinn); Punkt 0 = Start/Ziel */
  pts: [number, number][];
  /** Item-Box-Reihen als Anteil der Streckenlänge */
  boxRows: number[];
}

/** Welt 480 × 270, oben 20 px für die Rangliste */
export const KART_TRACKS: TrackDef[] = [
  {
    name: 'Strandpromenade',
    at: 'auf der Strandpromenade',
    theme: 'beach',
    width: 30,
    pts: [
      [190, 58], [310, 56], [420, 64], [450, 110], [432, 170], [384, 222], [300, 240], [220, 232],
      [150, 198], [96, 172], [48, 160], [34, 116], [60, 72], [120, 58],
    ],
    boxRows: [0.28, 0.68],
  },
  {
    name: 'Hafen',
    at: 'im Hafen',
    theme: 'harbor',
    width: 30,
    pts: [
      [150, 56], [300, 54], [420, 58], [450, 84], [430, 110], [340, 110], [250, 112], [214, 139],
      [250, 166], [350, 168], [428, 172], [452, 206], [428, 238], [300, 242], [160, 242], [66, 234],
      [36, 190], [40, 120], [70, 70],
    ],
    boxRows: [0.3, 0.72],
  },
  {
    name: 'Pool-Runde',
    at: 'auf der Pool-Runde',
    theme: 'pool',
    width: 32,
    pts: [
      [330, 58], [410, 62], [450, 104], [436, 160], [446, 210], [400, 238], [320, 236], [262, 200],
      [204, 234], [110, 238], [46, 212], [38, 150], [50, 92], [90, 60], [146, 64], [196, 102], [244, 62],
    ],
    boxRows: [0.25, 0.62],
  },
];

export interface TrackSample extends Point {
  /** Bogenlänge ab Start/Ziel */
  s: number;
  /** Richtung der Mittellinie */
  a: number;
}

export interface Track {
  def: TrackDef;
  samples: TrackSample[];
  length: number;
  half: number;
  /** Bogenlängen der Checkpoints (0 = Ziellinie) */
  checkpoints: number[];
  /** Startaufstellung (Index = Startplatz) */
  grid: { x: number; y: number; a: number }[];
  boxes: Point[];
}

const SPACING = 3;

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

const cache = new Map<number, Track>();

/** Baut (einmalig) die Geometrie einer Strecke */
export function getTrack(index: number): Track {
  const hit = cache.get(index);
  if (hit) return hit;
  const def = KART_TRACKS[index] ?? KART_TRACKS[0];
  const P = def.pts;
  const n = P.length;
  // 1) dichter Spline
  const dense: Point[] = [];
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [P[(i - 1 + n) % n], P[i], P[(i + 1) % n], P[(i + 2) % n]];
    const steps = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      dense.push({ x: catmull(p0[0], p1[0], p2[0], p3[0], t), y: catmull(p0[1], p1[1], p2[1], p3[1], t) });
    }
  }
  // 2) gleichmäßig neu abtasten
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cum[dense.length];
  const count = Math.round(total / SPACING);
  const samples: TrackSample[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = (i / count) * total;
    while (cum[j + 1] < s) j++;
    const a = dense[j];
    const b = dense[(j + 1) % dense.length];
    const t = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s, a: 0 });
  }
  for (let i = 0; i < count; i++) {
    const a = samples[(i - 1 + count) % count];
    const b = samples[(i + 1) % count];
    samples[i].a = Math.atan2(b.y - a.y, b.x - a.x);
  }
  const half = def.width / 2;
  const cpCount = Math.max(8, Math.floor(total / 110));
  const checkpoints = Array.from({ length: cpCount }, (_, i) => (i / cpCount) * total);
  // Startaufstellung: zwei Reihen hinter der Ziellinie
  const grid: Track['grid'] = [];
  for (let i = 0; i < 12; i++) {
    const back = 9 + Math.floor(i / 2) * 12 + (i % 2) * 5;
    const p = pointAt({ samples, length: total } as Track, total - back);
    const side = i % 2 === 0 ? -1 : 1;
    grid.push({ x: p.x + Math.cos(p.a + Math.PI / 2) * side * 7, y: p.y + Math.sin(p.a + Math.PI / 2) * side * 7, a: p.a });
  }
  const boxes: Point[] = [];
  for (const f of def.boxRows) {
    const p = pointAt({ samples, length: total } as Track, f * total);
    for (const off of [-10, 0, 10]) boxes.push({ x: p.x + Math.cos(p.a + Math.PI / 2) * off, y: p.y + Math.sin(p.a + Math.PI / 2) * off });
  }
  const track: Track = { def, samples, length: total, half, checkpoints, grid, boxes };
  cache.set(index, track);
  return track;
}

/** Punkt auf der Mittellinie bei Bogenlänge s (mit Wrap-around) */
export function pointAt(track: Pick<Track, 'samples' | 'length'>, s: number): TrackSample {
  const L = track.length;
  const ss = ((s % L) + L) % L;
  const n = track.samples.length;
  const f = (ss / L) * n;
  const i = Math.floor(f) % n;
  const a = track.samples[i];
  const b = track.samples[(i + 1) % n];
  const t = f - Math.floor(f);
  let da = b.a - a.a;
  if (da > Math.PI) da -= 2 * Math.PI;
  if (da < -Math.PI) da += 2 * Math.PI;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s: ss, a: a.a + da * t };
}

export interface Projection {
  s: number;
  /** Abstand zur Mittellinie */
  dist: number;
  /** Einheitsvektor von der Mittellinie zum Punkt */
  nx: number;
  ny: number;
  cx: number;
  cy: number;
}

/** Nächster Punkt auf der Mittellinie */
export function project(track: Track, x: number, y: number): Projection {
  const S = track.samples;
  const n = S.length;
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < n; i++) {
    const d = (S[i].x - x) ** 2 + (S[i].y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  // Auf den beiden Nachbarsegmenten verfeinern
  let res: Projection | null = null;
  for (const [i0, i1] of [[(best - 1 + n) % n, best], [best, (best + 1) % n]]) {
    const a = S[i0];
    const b = S[i1];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / len2));
    const cx = a.x + vx * t;
    const cy = a.y + vy * t;
    const dist = Math.hypot(x - cx, y - cy);
    if (!res || dist < res.dist) {
      const seg = i1 === 0 ? track.length - a.s : b.s - a.s;
      res = { s: (a.s + seg * t) % track.length, dist, nx: dist > 1e-6 ? (x - cx) / dist : 0, ny: dist > 1e-6 ? (y - cy) / dist : 0, cx, cy };
    }
  }
  return res!;
}

/** Winkel auf (−π, π] normieren */
export function wrapAngle(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Autopilot: lenkt auf einen Punkt etwas voraus auf der Mittellinie (Bots + Ehrenrunde).
 * Liefert Lenkung −1…1 und ob gebremst werden sollte.
 */
export function autopilot(track: Track, x: number, y: number, angle: number, speed: number, lane = 0): { steer: number; brake: boolean } {
  const p = project(track, x, y);
  const look = 22 + speed * 0.32;
  const t = pointAt(track, p.s + look);
  const tx = t.x + Math.cos(t.a + Math.PI / 2) * lane;
  const ty = t.y + Math.sin(t.a + Math.PI / 2) * lane;
  const diff = wrapAngle(Math.atan2(ty - y, tx - x) - angle);
  return { steer: Math.max(-1, Math.min(1, diff * 2.4)), brake: Math.abs(diff) > 1.1 && speed > 45 };
}

// ------------------------------------------------------------------ Fahrphysik (Server + Vorhersage am Handy)

/** Eingaben eines Karts */
export interface KartInput {
  /** −1 … 1 */
  steer: number;
  gas: boolean;
  /** Bremsen, im Stand rückwärts */
  brake: boolean;
  /** Drift-Knopf (gibt automatisch Gas) */
  drift: boolean;
}

export const NO_INPUT: KartInput = { steer: 0, gas: false, brake: false, drift: false };

/** Der Teil des Kart-Zustands, den die Physik braucht (Zeiten als Restdauer in ms, damit Server und Handy gleich rechnen) */
export interface KartPhys {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  /** −1/1 = driftet nach links/rechts */
  driftDir: number;
  /** Sekunden Drift-Ladung */
  driftCharge: number;
  boostMs: number;
  spinMs: number;
  offroad: boolean;
}

export interface StepOpts {
  /** Ehrenrunde: langsamer */
  finished?: boolean;
  /** Spieler weg: Kart rollt aus */
  frozen?: boolean;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Ein Physik-Schritt für ein Kart – identisch auf dem Server und (als Vorhersage) auf dem Handy.
 * Kollisionen mit anderen Karts, Items und Rundenzählung macht nur der Server.
 * Liefert true, wenn gerade ein Mini-Turbo gezündet wurde.
 */
export function stepKart(c: KartPhys, inp: KartInput, dt: number, T: Track, o: StepOpts = {}): boolean {
  let fired = false;
  const steer = clamp(inp.steer, -1, 1);
  const spinning = c.spinMs > 0;
  const fx = Math.cos(c.angle);
  const fy = Math.sin(c.angle);
  let vf = c.vx * fx + c.vy * fy;
  let vl = -c.vx * fy + c.vy * fx;
  c.offroad = project(T, c.x, c.y).dist > T.half + 1;
  const boosting = c.boostMs > 0;

  if (spinning) {
    vf *= Math.exp(-4 * dt);
    vl *= Math.exp(-4 * dt);
    c.driftDir = 0;
    c.driftCharge = 0;
  } else {
    // Drift starten / beenden
    if (c.driftDir === 0 && inp.drift && Math.abs(steer) > 0.35 && vf > KART.DRIFT_MIN_SPEED && !c.offroad) {
      c.driftDir = Math.sign(steer);
      c.driftCharge = 0;
    } else if (c.driftDir !== 0 && (!inp.drift || vf < 25)) {
      if (!inp.drift && c.driftCharge >= KART.DRIFT_CHARGE_S) {
        c.boostMs = Math.max(c.boostMs, KART.MINI_TURBO_MS);
        fired = true;
      }
      c.driftDir = 0;
      c.driftCharge = 0;
    }
    const drifting = c.driftDir !== 0;
    let max = c.offroad ? KART.SAND_SPEED * (boosting ? 1.7 : 1) : KART.MAX_SPEED * (boosting ? KART.BOOST_FACTOR : 1);
    if (o.finished) max *= 0.6;
    // DRIFT gibt mit Gas (Daumen rutscht am Handy von GAS nach oben auf DRIFT)
    const gas = !o.frozen && (inp.gas || inp.drift || drifting || boosting || !!o.finished);
    const brake = !o.frozen && inp.brake && !drifting && !boosting;
    if (brake) {
      // Erst bremsen, im Stand rückwärts
      if (vf > 3) vf = Math.max(0, vf - KART.BRAKE * dt);
      else vf = Math.max(-KART.REVERSE_SPEED, vf - KART.REVERSE_ACCEL * dt);
    } else if (gas) {
      if (vf < 0) vf = Math.min(0, vf + KART.BRAKE * dt);
      else if (vf < max) vf = Math.min(max, vf + KART.ACCEL * (boosting ? 2.2 : 1) * dt);
      else vf = Math.max(max, vf - (c.offroad ? 260 : 90) * dt);
    } else {
      // Ausrollen
      const coast = (c.offroad ? 140 : KART.COAST) * dt;
      if (vf > max) vf = Math.max(max, vf - (c.offroad ? 260 : 90) * dt);
      else vf = vf > 0 ? Math.max(0, vf - coast) : Math.min(0, vf + coast);
    }
    const grip = drifting ? KART.DRIFT_GRIP : KART.GRIP;
    vl *= Math.exp(-grip * dt);
    let turn: number;
    if (drifting) {
      // Driften lenkt immer etwas in Driftrichtung; Gegenlenken macht den Bogen weiter
      turn = clamp(c.driftDir * 0.5 + steer * 0.45, -0.95, 0.95) * KART.TURN;
      // Lenken in Driftrichtung lädt schneller
      c.driftCharge += dt * (Math.sign(steer) === c.driftDir ? 1.25 : 0.8);
      // Beim Driften rutscht das Kart nach außen
      vl -= c.driftDir * vf * 0.6 * dt;
    } else {
      // Im Stand dreht sich das Kart nur ein bisschen (wenn Gas/Bremse gedrückt), rückwärts andersherum
      const minTurn = gas || brake ? 0.3 : 0;
      turn = steer * KART.TURN * clamp(Math.abs(vf) / 40, minTurn, 1) * (vf < -2 ? -1 : 1);
    }
    c.angle = wrapAngle(c.angle + turn * dt);
  }
  const nfx = Math.cos(c.angle);
  const nfy = Math.sin(c.angle);
  c.vx = nfx * vf - nfy * vl;
  c.vy = nfy * vf + nfx * vl;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  c.spinMs = Math.max(0, c.spinMs - dt * 1000);
  c.boostMs = Math.max(0, c.boostMs - dt * 1000);
  keepInside(c, T);
  return fired;
}

/** Bande hinter dem Sandstreifen; liefert die Projektion nach der Korrektur */
export function keepInside(c: { x: number; y: number; vx: number; vy: number }, T: Track): Projection {
  const limit = T.half + KART.SAND;
  let p = project(T, c.x, c.y);
  if (p.dist > limit) {
    c.x = p.cx + p.nx * limit;
    c.y = p.cy + p.ny * limit;
    const vn = c.vx * p.nx + c.vy * p.ny;
    if (vn > 0) {
      c.vx -= p.nx * vn * 1.3;
      c.vy -= p.ny * vn * 1.3;
    }
    c.vx *= 0.93;
    c.vy *= 0.93;
    p = project(T, c.x, c.y);
  }
  return p;
}
