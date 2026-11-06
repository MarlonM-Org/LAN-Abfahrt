/**
 * Tempel-Kugel (Balance Board): Labyrinth, Physik und Zustand (Server, TV, Bots).
 *
 * Schmaler, moosbewachsener Steinpfad hoch über einem Abgrund, gesehen aus der Verfolgerkamera hinter der Figur
 * (wie im Kart). Gesteuert wird wie auf einem Hoverboard: vorn lehnen = Gas in Blickrichtung, hinten = bremsen,
 * seitlich lehnen = sich drehen (die Kamera dreht mit). Die Kugel rollt dorthin, wohin man schaut – seitlich
 * driftet sie kaum (Grip). Verlässt die Mitte der Kugel den Pfad, stürzt sie ab und
 * beginnt am letzten Kontrollpunkt neu (Strafzeit). Alle rollen dasselbe Labyrinth (Startwert pro Spiel), Bestzeit gewinnt.
 */
import { type BalanceTurn, seeded } from './balance';

export const KUG = {
  TICK_MS: 33,
  COLS: 9,
  ROWS: 6,
  /** Abstand der Zellmitten (px) */
  P: 40,
  OX: 36,
  OY: 50,
  /** Halbe Pfadbreite (px): liegt die Kugelmitte weiter von der Pfadlinie weg, stürzt sie ab */
  R: 12,
  BALL_R: 5,
  /** Gas bei vollem Ausschlag nach vorn (px/s²), Bremse beim Zurücklehnen, Rollwiderstand (1/s), Höchsttempo (px/s) */
  ACCEL: 120,
  BRAKE: 160,
  DAMP: 0.9,
  VMAX: 72,
  /** Rückwärts nur langsam (zum Rangieren in Sackgassen) */
  VBACK: 18,
  /** Drehen bei vollem Seitenausschlag (rad/s) – auch im Stand, wie ein Hoverboard */
  TURN: 2.1,
  /** Seitliches Rutschen wird so schnell abgebaut (1/s) = Grip */
  GRIP: 7,
  /** Totzone und Kurve: kleine Ausschläge wirken sehr fein (Potenz > 1) */
  DEADZONE: 0.12,
  CURVE: 1.6,
  FALL_MS: 900,
  /** Strafe pro Absturz (s) */
  FALL_PEN_S: 4,
  /** Spätestens dann ist der Versuch vorbei */
  MAX_S: 100,
  GATE_MS: 3000,
  DONE_MS: 4000,
  /** Abstand der Kontrollpunkte entlang des Lösungswegs (Zellen) */
  CP_EVERY: 8,
  CP_R: 14,
  GOAL_R: 12,
  /** Zusätzliche Verbindungen (Schleifen), damit es nicht nur Sackgassen gibt */
  LOOPS: 4,
  /** Mindestlänge des Lösungswegs (Zellen) */
  MIN_ROUTE: 22,
};

export const cellX = (c: number) => KUG.OX + c * KUG.P;
export const cellY = (r: number) => KUG.OY + r * KUG.P;

export interface Cell {
  c: number;
  r: number;
}
export type Link = [c1: number, r1: number, c2: number, r2: number];

export interface KugelCourse {
  links: Link[];
  start: Cell;
  goal: Cell;
  /** Lösungsweg von Start bis Ziel (Zellen) */
  route: Cell[];
  /** Kontrollpunkte als Indizes in `route` (aufsteigend) */
  checkpoints: number[];
}

const id = (c: number, r: number) => r * KUG.COLS + c;
const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function bfs(adj: number[][], from: number) {
  const dist = new Array<number>(adj.length).fill(-1);
  const parent = new Array<number>(adj.length).fill(-1);
  const q = [from];
  dist[from] = 0;
  for (let i = 0; i < q.length; i++) {
    const u = q[i];
    for (const v of adj[u]) {
      if (dist[v] >= 0) continue;
      dist[v] = dist[u] + 1;
      parent[v] = u;
      q.push(v);
    }
  }
  return { dist, parent };
}

function build(seed: number): KugelCourse {
  const r = seeded(seed);
  const n = KUG.COLS * KUG.ROWS;
  const adj: number[][] = Array.from({ length: n }, () => []);
  const links: Link[] = [];
  const link = (a: number, b: number) => {
    adj[a].push(b);
    adj[b].push(a);
    links.push([a % KUG.COLS, Math.floor(a / KUG.COLS), b % KUG.COLS, Math.floor(b / KUG.COLS)]);
  };
  // Zufälliger Spannbaum (Tiefensuche) = perfektes Labyrinth
  const seen = new Array<boolean>(n).fill(false);
  const first = Math.floor(r() * n);
  const stack = [first];
  seen[first] = true;
  while (stack.length) {
    const u = stack[stack.length - 1];
    const uc = u % KUG.COLS;
    const ur = Math.floor(u / KUG.COLS);
    const opts = DIRS.map(([dc, dr]) => [uc + dc, ur + dr] as const).filter(([c, rr]) => c >= 0 && c < KUG.COLS && rr >= 0 && rr < KUG.ROWS && !seen[id(c, rr)]);
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const [c, rr] = opts[Math.floor(r() * opts.length)];
    seen[id(c, rr)] = true;
    link(u, id(c, rr));
    stack.push(id(c, rr));
  }
  // Start und Ziel an den beiden fernsten Enden des Baums, Start links
  const far = (from: number) => {
    const { dist } = bfs(adj, from);
    return dist.indexOf(Math.max(...dist));
  };
  let a = far(0);
  let b = far(a);
  if (a % KUG.COLS > b % KUG.COLS) [a, b] = [b, a];
  // Ein paar Schleifen
  for (let k = 0, tries = 0; k < KUG.LOOPS && tries < 60; tries++) {
    const u = Math.floor(r() * n);
    const [dc, dr] = DIRS[Math.floor(r() * 4)];
    const c = (u % KUG.COLS) + dc;
    const rr = Math.floor(u / KUG.COLS) + dr;
    if (c < 0 || c >= KUG.COLS || rr < 0 || rr >= KUG.ROWS) continue;
    const v = id(c, rr);
    if (adj[u].includes(v)) continue;
    link(u, v);
    k++;
  }
  const { parent } = bfs(adj, a);
  const route: Cell[] = [];
  for (let u = b; u >= 0; u = parent[u]) route.unshift({ c: u % KUG.COLS, r: Math.floor(u / KUG.COLS) });
  const checkpoints: number[] = [];
  for (let i = KUG.CP_EVERY; i < route.length - 3; i += KUG.CP_EVERY) checkpoints.push(i);
  return { links, start: route[0], goal: route[route.length - 1], route, checkpoints };
}

/** Labyrinth aus dem Startwert – auf Server, TV und Bots identisch */
export function kugelCourse(seed: number): KugelCourse {
  let c = build(seed);
  for (let k = 1; c.route.length < KUG.MIN_ROUTE && k <= 30; k++) c = build(seed + k * 7919);
  return c;
}

export const routePoint = (course: KugelCourse, i: number) => {
  const cell = course.route[Math.max(0, Math.min(course.route.length - 1, i))];
  return { x: cellX(cell.c), y: cellY(cell.r) };
};

/** Abstand eines Punkts zur Pfadmitte (kleinster Abstand zu allen Verbindungsstrecken) */
export function distToPath(course: KugelCourse, x: number, y: number): number {
  let best = Infinity;
  for (const [c1, r1, c2, r2] of course.links) {
    const x1 = cellX(Math.min(c1, c2));
    const x2 = cellX(Math.max(c1, c2));
    const y1 = cellY(Math.min(r1, r2));
    const y2 = cellY(Math.max(r1, r2));
    const dx = x < x1 ? x1 - x : x > x2 ? x - x2 : 0;
    const dy = y < y1 ? y1 - y : y > y2 ? y - y2 : 0;
    const d = Math.hypot(dx, dy);
    if (d < best) best = d;
  }
  return best;
}

export const wrapAng = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Ausschlag am Board (−1…1) → Steuerwert (−1…1): Totzone, dann feine Kurve */
export function kugelInput(v: number): number {
  const a = Math.abs(v);
  if (a < KUG.DEADZONE) return 0;
  return Math.sign(v) * Math.min(1, (a - KUG.DEADZONE) / (1 - KUG.DEADZONE)) ** KUG.CURVE;
}

/** Umkehrung (für Bots): gewünschter Steuerwert −1…1 → Ausschlag am Board */
export const kugelLean = (l: number) => (Math.abs(l) < 0.01 ? 0 : Math.sign(l) * (Math.min(1, Math.abs(l)) ** (1 / KUG.CURVE) * (1 - KUG.DEADZONE) + KUG.DEADZONE));

/**
 * Hoverboard-Physik, ein Schritt: seitlich lehnen (bx) dreht die Blickrichtung `ang`, vorn/hinten (by) gibt Gas
 * bzw. bremst entlang der Blickrichtung; seitliches Rutschen wird über den Grip abgebaut.
 */
export function kugelDrive(k: { vx: number; vy: number; ang: number }, bx: number, by: number, dt: number) {
  const steer = kugelInput(bx);
  const thr = kugelInput(by);
  k.ang = wrapAng(k.ang + steer * KUG.TURN * dt);
  const cs = Math.cos(k.ang);
  const sn = Math.sin(k.ang);
  // in Vorwärts-/Seitenanteil zerlegen
  let fwd = k.vx * cs + k.vy * sn;
  let side = -k.vx * sn + k.vy * cs;
  if (thr >= 0) fwd += thr * KUG.ACCEL * dt;
  else if (fwd > 0) fwd = Math.max(0, fwd + thr * KUG.BRAKE * dt);
  else fwd = Math.max(-KUG.VBACK, fwd + thr * KUG.ACCEL * 0.4 * dt);
  fwd *= Math.exp(-KUG.DAMP * dt);
  side *= Math.exp(-KUG.GRIP * dt);
  fwd = Math.min(KUG.VMAX, fwd);
  k.vx = cs * fwd - sn * side;
  k.vy = sn * fwd + cs * side;
}

/** Blickrichtung am Start bzw. Kontrollpunkt: entlang des Lösungswegs */
export function routeHeading(course: KugelCourse, i: number): number {
  const a = routePoint(course, i);
  const b = routePoint(course, i + 1);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export interface KugelRun {
  /** Zeit bis ins Ziel (s), sonst MAX_S */
  time: number;
  falls: number;
  /** Wertung: Zeit + Strafen (kleiner = besser) */
  score: number;
  /** Anteil des Wegs, der geschafft wurde (0…1) */
  prog: number;
  finished: boolean;
  dns?: boolean;
  /** Neuer Gesamtrekord / persönliche Bestzeit */
  rec?: import('./balance').RecordResult;
}

export interface KugelState extends BalanceTurn {
  sub: 'ready' | 'countdown' | 'roll' | 'done' | 'over';
  t: number;
  seed: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Blickrichtung der Verfolgerkamera (rad, 0 = nach rechts im Labyrinth) */
  ang: number;
  /** Rollzeit (s) */
  ft: number;
  /** Absturz: 0 = keiner, sonst Fortschritt der Fall-Animation 0…1 */
  fall: number;
  falls: number;
  /** Erreichter Kontrollpunkt: 0 = Start, n = n-ter Kontrollpunkt */
  cp: number;
  runs: Record<string, KugelRun>;
  /** Platz-Punkte für die Zuschauer-Leiste */
  points: Record<string, number>;
  last: (KugelRun & { id: string }) | null;
}
