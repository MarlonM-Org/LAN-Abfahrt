/**
 * Minigolf: gemeinsame Bahn-Geometrie, Physik und Bot-Zielhilfe (Server, TV, Handy, Bots).
 * Koordinaten = Welt-Pixel (480 × 270), von oben gesehen. Die Zeit `t` (Sekunden seit Lochbeginn)
 * bestimmt die Stellung der beweglichen Hindernisse – Server und TV rechnen damit dasselbe aus.
 */
import type { Point } from './types';

export interface GolfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Hang: schiebt den Ball mit (ax, ay) px/s² */
export interface GolfSlope extends GolfRect {
  ax: number;
  ay: number;
}
/** Leuchtturm: drehende Flügel um eine feste Nabe */
export interface GolfSpinner {
  x: number;
  y: number;
  hub: number;
  len: number;
  blades: number;
  /** rad/s */
  speed: number;
}
/** Bewegliches Surfbrett (Kapsel), Mitte pendelt um (x, y) ± (dx, dy) */
export interface GolfMover {
  x: number;
  y: number;
  dx: number;
  dy: number;
  period: number;
  /** Länge und Dicke der Kapsel, `vertical` = Längsachse senkrecht */
  len: number;
  thick: number;
  vertical: boolean;
}
/** Looping-Röhre: Eingang (Kreis) → Ausgang mit Richtung */
export interface GolfTube {
  x: number;
  y: number;
  r: number;
  out: Point;
  dir: number;
}
export interface GolfBumper {
  x: number;
  y: number;
  r: number;
}
/** Bot-Hilfspunkt: `pass` = mit Schwung durchrollen (Röhre/Lücke), `region` = nur, wenn der Ball dort liegt */
export interface GolfWaypoint {
  x: number;
  y: number;
  pass?: boolean;
  region?: GolfRect;
}
export type GolfDecoKind = 'palm' | 'umbrella' | 'towel' | 'shell' | 'boat' | 'crab';

export interface GolfHole {
  name: string;
  par: number;
  tee: Point;
  cup: Point;
  /** Bahn-Umriss (geschlossenes Polygon, Kanten = Bande) */
  shape: Point[];
  /** feste Mauerblöcke in der Bahn (geschlossene Polygone) */
  blocks: Point[][];
  bumpers: GolfBumper[];
  sand: GolfRect[];
  water: GolfRect[];
  /** Holzbrücke über dem Wasser (nur Optik) */
  bridges: GolfRect[];
  slopes: GolfSlope[];
  spinners: GolfSpinner[];
  movers: GolfMover[];
  tubes: GolfTube[];
  waypoints: GolfWaypoint[];
  deco: { kind: GolfDecoKind; x: number; y: number }[];
}

export const GOLF = {
  BALL_R: 3,
  CUP_R: 5,
  /** Rollreibung: konstante Bremsung + geschwindigkeitsabhängiger Anteil */
  MU: 95,
  K: 0.55,
  MU_SAND: 560,
  /** maximale Rollweite (Kraft 100 %) auf ebener Bahn */
  MAX_DIST: 430,
  /** langsamer als das → fällt ins Loch */
  CAPTURE_V: 145,
  /** Sog in Lochnähe */
  CUP_PULL: 300,
  STOP_V: 4,
  WALL_E: 0.7,
  BUMPER_E: 1.15,
  BUMPER_MIN_V: 90,
  TUBE_S: 0.7,
  MAX_STROKES: 6,
  /** nicht eingelocht: höchstens so viele Schläge auf der Karte */
  MAX_SCORE: 7,
  /**
   * Zeit pro Loch: `null` = kein Limit (vorher 60 s). Ein Loch endet, wenn alle eingelocht oder
   * MAX_STROKES erreicht haben – oder wenn der VIP im Menü „Loch beenden“ wählt (Rest bekommt +2).
   */
  HOLE_S: null as number | null,
  /** Erklär-Screen (VIP kann überspringen; vorher 6,5 s) */
  INTRO_MS: 10000,
  TEE_MS: 3200,
  /** Scorekarte nach jedem Loch (VIP kann überspringen; vorher 6,5 s / 8 s) */
  CARD_MS: 12000,
  LAST_CARD_MS: 12000,
  DONE_PAUSE_MS: 1400,
  /** Physik-Takt: TICK_S pro Tick, in SUBSTEPS Teilschritten */
  TICK_S: 1 / 30,
  SUBSTEPS: 4,
  /** Spieler offline → automatischer Schlag nach … ms */
  AUTO_MS: 2500,
  /** Ball rollt länger als das → wird angehalten (Sicherheitsnetz) */
  MAX_ROLL_S: 14,
};

const R = (x: number, y: number, w: number, h: number): GolfRect => ({ x, y, w, h });
const rectPoly = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const base = (): Pick<GolfHole, 'blocks' | 'bumpers' | 'sand' | 'water' | 'bridges' | 'slopes' | 'spinners' | 'movers' | 'tubes' | 'waypoints' | 'deco'> => ({
  blocks: [],
  bumpers: [],
  sand: [],
  water: [],
  bridges: [],
  slopes: [],
  spinners: [],
  movers: [],
  tubes: [],
  waypoints: [],
  deco: [],
});

/** Die 6 Löcher des Urlaubs-Minigolfplatzes */
export const GOLF_HOLES: GolfHole[] = [
  {
    ...base(),
    name: 'Flamingo-Allee',
    par: 2,
    tee: { x: 66, y: 143 },
    cup: { x: 410, y: 143 },
    shape: rectPoly(40, 96, 400, 94),
    bumpers: [
      { x: 200, y: 117, r: 7 },
      { x: 200, y: 169, r: 7 },
      { x: 318, y: 143, r: 8 },
    ],
    waypoints: [{ x: 262, y: 120 }],
    deco: [
      { kind: 'palm', x: 70, y: 84 },
      { kind: 'umbrella', x: 300, y: 222 },
      { kind: 'towel', x: 120, y: 214 },
      { kind: 'palm', x: 420, y: 238 },
      { kind: 'shell', x: 230, y: 70 },
    ],
  },
  {
    ...base(),
    name: 'Leuchtturm',
    par: 3,
    tee: { x: 66, y: 143 },
    cup: { x: 408, y: 143 },
    shape: rectPoly(40, 80, 400, 126),
    blocks: [rectPoly(236, 80, 8, 40), rectPoly(236, 180, 8, 26)],
    spinners: [{ x: 240, y: 150, hub: 6, len: 31, blades: 3, speed: 1.0 }],
    waypoints: [{ x: 252, y: 134, pass: true }],
    deco: [
      { kind: 'palm', x: 30, y: 230 },
      { kind: 'boat', x: 380, y: 236 },
      { kind: 'umbrella', x: 150, y: 232 },
      { kind: 'crab', x: 330, y: 66 },
    ],
  },
  {
    ...base(),
    name: 'Sandbank',
    par: 3,
    tee: { x: 66, y: 201 },
    cup: { x: 366, y: 88 },
    shape: [
      { x: 40, y: 170 },
      { x: 300, y: 170 },
      { x: 300, y: 56 },
      { x: 432, y: 56 },
      { x: 432, y: 232 },
      { x: 40, y: 232 },
    ],
    sand: [R(386, 182, 46, 50), R(304, 60, 30, 26)],
    slopes: [{ ...R(300, 112, 132, 44), ax: 45, ay: 0 }],
    waypoints: [{ x: 360, y: 201 }],
    deco: [
      { kind: 'palm', x: 120, y: 120 },
      { kind: 'umbrella', x: 220, y: 130 },
      { kind: 'towel', x: 60, y: 104 },
      { kind: 'shell', x: 260, y: 92 },
      { kind: 'palm', x: 456, y: 120 },
    ],
  },
  {
    ...base(),
    name: 'Lagune',
    par: 3,
    tee: { x: 66, y: 200 },
    cup: { x: 408, y: 100 },
    shape: rectPoly(40, 62, 400, 170),
    water: [R(176, 62, 128, 70), R(176, 164, 128, 68)],
    bridges: [R(172, 132, 136, 32)],
    waypoints: [
      { x: 164, y: 148 },
      { x: 318, y: 148 },
    ],
    deco: [
      { kind: 'palm', x: 22, y: 236 },
      { kind: 'crab', x: 456, y: 160 },
      { kind: 'palm', x: 460, y: 100 },
      { kind: 'shell', x: 120, y: 48 },
    ],
  },
  {
    ...base(),
    name: 'Surfbrett',
    par: 3,
    tee: { x: 66, y: 148 },
    cup: { x: 404, y: 118 },
    shape: rectPoly(40, 70, 400, 156),
    blocks: [rectPoly(236, 70, 8, 42), rectPoly(236, 188, 8, 38)],
    movers: [{ x: 240, y: 150, dx: 0, dy: 23, period: 3.2, len: 40, thick: 8, vertical: true }],
    slopes: [{ ...R(276, 70, 92, 156), ax: 0, ay: 40 }],
    waypoints: [{ x: 252, y: 150, pass: true }],
    deco: [
      { kind: 'umbrella', x: 110, y: 60 },
      { kind: 'palm', x: 456, y: 238 },
      { kind: 'towel', x: 330, y: 238 },
      { kind: 'shell', x: 30, y: 60 },
    ],
  },
  {
    ...base(),
    name: 'Looping',
    par: 3,
    tee: { x: 66, y: 196 },
    cup: { x: 394, y: 100 },
    shape: rectPoly(40, 62, 400, 170),
    blocks: [
      rectPoly(290, 140, 114, 6),
      rectPoly(290, 62, 6, 84),
      // Rampe: Seitenwände + Rückwand, oben die Röhre
      rectPoly(186, 176, 48, 4),
      rectPoly(186, 212, 48, 4),
      rectPoly(234, 176, 4, 40),
    ],
    slopes: [{ ...R(186, 180, 48, 32), ax: -235, ay: 0 }],
    tubes: [{ x: 226, y: 196, r: 8, out: { x: 312, y: 100 }, dir: 0 }],
    waypoints: [
      { x: 226, y: 196, pass: true },
      { x: 420, y: 196, region: R(238, 146, 202, 86) },
      { x: 422, y: 118, region: R(238, 146, 202, 86) },
    ],
    deco: [
      { kind: 'palm', x: 22, y: 150 },
      { kind: 'shell', x: 260, y: 48 },
      { kind: 'crab', x: 456, y: 120 },
      { kind: 'palm', x: 460, y: 238 },
    ],
  },
];

// ================================================================== Geometrie

export const golfHole = (i: number) => GOLF_HOLES[Math.max(0, Math.min(GOLF_HOLES.length - 1, i))];

/** Rahmen der Bahn (für Mini-Karte am Handy) */
export function golfBounds(h: GolfHole): GolfRect {
  const xs = h.shape.map((p) => p.x);
  const ys = h.shape.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

export const inRect = (r: GolfRect, x: number, y: number, m = 0) => x >= r.x - m && x <= r.x + r.w + m && y >= r.y - m && y <= r.y + r.h + m;

export function inPoly(poly: Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Liegt (x, y) auf der bespielbaren Fläche (im Umriss, nicht in einem Block)? */
export const onCourse = (h: GolfHole, x: number, y: number) => inPoly(h.shape, x, y) && !h.blocks.some((b) => inPoly(b, x, y));

/** Alle festen Bandensegmente [ax, ay, bx, by] */
export function golfWalls(h: GolfHole): number[][] {
  const out: number[][] = [];
  for (const poly of [h.shape, ...h.blocks]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      out.push([a.x, a.y, b.x, b.y]);
    }
  }
  return out;
}

/** Flügel des Leuchtturms zur Zeit t: [ax, ay, bx, by] je Flügel */
export function spinnerBlades(s: GolfSpinner, t: number): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < s.blades; k++) {
    const a = s.speed * t + (k * Math.PI * 2) / s.blades;
    const c = Math.cos(a);
    const d = Math.sin(a);
    out.push([s.x + c * (s.hub - 1), s.y + d * (s.hub - 1), s.x + c * s.len, s.y + d * s.len]);
  }
  return out;
}

/** Surfbrett zur Zeit t: Mittelpunkt + Geschwindigkeit */
export function moverAt(m: GolfMover, t: number): { x: number; y: number; vx: number; vy: number } {
  const w = (Math.PI * 2) / m.period;
  const s = Math.sin(w * t);
  const c = Math.cos(w * t) * w;
  return { x: m.x + m.dx * s, y: m.y + m.dy * s, vx: m.dx * c, vy: m.dy * c };
}

/** Achse des Surfbretts (Kapsel-Segment) zur Zeit t */
export function moverSeg(m: GolfMover, t: number): number[] {
  const p = moverAt(m, t);
  const hl = m.len / 2 - m.thick / 2;
  return m.vertical ? [p.x, p.y - hl, p.x, p.y + hl] : [p.x - hl, p.y, p.x + hl, p.y];
}

// ================================================================== Physik

/** Kraft 0 … 1 ↔ Rollweite/Anfangstempo */
export function golfRollDist(v0: number): number {
  if (v0 <= 0) return 0;
  const { MU, K } = GOLF;
  return (v0 - (MU / K) * Math.log(1 + (K * v0) / MU)) / K;
}

export function golfSpeedFor(dist: number): number {
  let lo = 0;
  let hi = 2000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (golfRollDist(mid) < dist) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export const golfPowerToSpeed = (p: number) => golfSpeedFor(Math.max(0, Math.min(1, p)) * GOLF.MAX_DIST);
/** Kraft, mit der der Ball nach `dist` px liegen bleibt (ebene Bahn) */
export const golfPowerFor = (dist: number) => Math.max(0, Math.min(1, dist / GOLF.MAX_DIST));

export interface GolfBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** verbleibende Zeit in der Röhre (s) und Austrittstempo */
  tube: number;
  tubeV: number;
  tubeIdx: number;
  /** kurze Sperre nach einem Lippen-Abpraller */
  lip: number;
}

export type GolfEvent = 'stop' | 'hole' | 'water' | 'tube' | 'tubeOut' | 'bump' | 'wall' | 'lip' | 'out';

/** Kreis-gegen-Kapsel-Stoß; `vel` liefert die Geschwindigkeit des Hindernisses am Kontaktpunkt */
function hitCapsule(b: GolfBody, ax: number, ay: number, bx: number, by: number, rad: number, e: number, vel?: (x: number, y: number) => [number, number]): number {
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  let u = l2 > 0 ? ((b.x - ax) * ex + (b.y - ay) * ey) / l2 : 0;
  u = Math.max(0, Math.min(1, u));
  const cx = ax + ex * u;
  const cy = ay + ey * u;
  let dx = b.x - cx;
  let dy = b.y - cy;
  const min = GOLF.BALL_R + rad;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return 0;
  let d = Math.sqrt(d2);
  if (d < 1e-6) {
    // genau auf der Linie → Normale des Segments
    const l = Math.sqrt(l2) || 1;
    dx = -ey / l;
    dy = ex / l;
    d = 1;
  }
  const nx = dx / d;
  const ny = dy / d;
  b.x = cx + nx * min;
  b.y = cy + ny * min;
  const [svx, svy] = vel ? vel(cx, cy) : [0, 0];
  const rvx = b.vx - svx;
  const rvy = b.vy - svy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0;
  // Normalanteil umdrehen (gedämpft), Tangentialanteil etwas bremsen
  const tx = rvx - vn * nx;
  const ty = rvy - vn * ny;
  b.vx = svx + tx * 0.96 - e * vn * nx;
  b.vy = svy + ty * 0.96 - e * vn * ny;
  return -vn;
}

/** Netto-Hangbeschleunigung an (x, y) */
export function slopeAt(h: GolfHole, x: number, y: number): [number, number] {
  let ax = 0;
  let ay = 0;
  for (const s of h.slopes) if (inRect(s, x, y)) (ax += s.ax), (ay += s.ay);
  return [ax, ay];
}

export const inSand = (h: GolfHole, x: number, y: number) => h.sand.some((s) => inRect(s, x, y));
export const inWater = (h: GolfHole, x: number, y: number) => h.water.some((s) => inRect(s, x, y));

/**
 * Ein Physik-Schritt (dt s) für einen Ball zur Lochzeit t. Liefert Ereignisse (Loch, Wasser, Stopp …).
 * Bälle verschiedener Spieler stoßen NICHT zusammen – jeder spielt „seine“ Bahn.
 */
export function golfStep(b: GolfBody, h: GolfHole, walls: number[][], t: number, dt: number): GolfEvent[] {
  const ev: GolfEvent[] = [];
  if (b.tube > 0) {
    b.tube -= dt;
    if (b.tube <= 0) {
      const tb = h.tubes[b.tubeIdx];
      b.tube = 0;
      b.x = tb.out.x;
      b.y = tb.out.y;
      b.vx = Math.cos(tb.dir) * b.tubeV;
      b.vy = Math.sin(tb.dir) * b.tubeV;
      ev.push('tubeOut');
    }
    return ev;
  }
  if (b.lip > 0) b.lip -= dt;
  const [sx, sy] = slopeAt(h, b.x, b.y);
  b.vx += sx * dt;
  b.vy += sy * dt;
  // Sog am Loch
  const cdx = h.cup.x - b.x;
  const cdy = h.cup.y - b.y;
  const cd = Math.hypot(cdx, cdy);
  let v = Math.hypot(b.vx, b.vy);
  if (cd < GOLF.CUP_R + 3 && cd > 0.01 && v < GOLF.CAPTURE_V * 1.4) {
    b.vx += (cdx / cd) * GOLF.CUP_PULL * dt;
    b.vy += (cdy / cd) * GOLF.CUP_PULL * dt;
    v = Math.hypot(b.vx, b.vy);
  }
  // Reibung
  if (v > 0) {
    const mu = inSand(h, b.x, b.y) ? GOLF.MU_SAND : GOLF.MU;
    const nv = Math.max(0, v - (mu + GOLF.K * v) * dt);
    b.vx *= nv / v;
    b.vy *= nv / v;
    v = nv;
  }
  // Bewegen in kleinen Schritten (kein Tunneln durch dünne Banden)
  const n = Math.max(1, Math.ceil((v * dt) / 1.2));
  for (let i = 0; i < n; i++) {
    b.x += (b.vx * dt) / n;
    b.y += (b.vy * dt) / n;
    let wallHit = 0;
    for (const w of walls) wallHit = Math.max(wallHit, hitCapsule(b, w[0], w[1], w[2], w[3], 0, GOLF.WALL_E));
    for (const bp of h.bumpers) {
      const imp = hitCapsule(b, bp.x, bp.y, bp.x, bp.y, bp.r, GOLF.BUMPER_E);
      if (imp > 0) {
        const nv = Math.hypot(b.vx, b.vy);
        if (nv < GOLF.BUMPER_MIN_V && nv > 0) (b.vx *= GOLF.BUMPER_MIN_V / nv), (b.vy *= GOLF.BUMPER_MIN_V / nv);
        ev.push('bump');
      }
    }
    for (const sp of h.spinners) {
      wallHit = Math.max(wallHit, hitCapsule(b, sp.x, sp.y, sp.x, sp.y, sp.hub, GOLF.WALL_E));
      for (const bl of spinnerBlades(sp, t)) {
        wallHit = Math.max(wallHit, hitCapsule(b, bl[0], bl[1], bl[2], bl[3], 1.5, 0.6, (x, y) => [-sp.speed * (y - sp.y), sp.speed * (x - sp.x)]));
      }
    }
    for (const m of h.movers) {
      const s = moverSeg(m, t);
      const mv = moverAt(m, t);
      wallHit = Math.max(wallHit, hitCapsule(b, s[0], s[1], s[2], s[3], m.thick / 2, 0.75, () => [mv.vx, mv.vy]));
    }
    if (wallHit > 40) ev.push('wall');
  }
  v = Math.hypot(b.vx, b.vy);
  // Röhre
  for (let i = 0; i < h.tubes.length; i++) {
    const tb = h.tubes[i];
    if (Math.hypot(b.x - tb.x, b.y - tb.y) < tb.r) {
      b.tube = GOLF.TUBE_S;
      b.tubeIdx = i;
      b.tubeV = Math.max(80, Math.min(300, v * 0.95));
      b.vx = b.vy = 0;
      ev.push('tube');
      return ev;
    }
  }
  if (inWater(h, b.x, b.y)) {
    b.vx = b.vy = 0;
    ev.push('water');
    return ev;
  }
  if (!onCourse(h, b.x, b.y)) {
    b.vx = b.vy = 0;
    ev.push('out');
    return ev;
  }
  const d = Math.hypot(h.cup.x - b.x, h.cup.y - b.y);
  if (d < GOLF.CUP_R) {
    if (v < GOLF.CAPTURE_V) {
      b.x = h.cup.x;
      b.y = h.cup.y;
      b.vx = b.vy = 0;
      ev.push('hole');
      return ev;
    }
    if (b.lip <= 0) {
      // zu schnell: über die Lippe – wird abgelenkt und gebremst
      const cross = (b.x - h.cup.x) * b.vy - (b.y - h.cup.y) * b.vx;
      const rot = (cross >= 0 ? 1 : -1) * 0.45;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const vx = b.vx * c - b.vy * s;
      const vy = b.vx * s + b.vy * c;
      b.vx = vx * 0.8;
      b.vy = vy * 0.8;
      b.lip = 0.2;
      ev.push('lip');
    }
  }
  if (v < GOLF.STOP_V) {
    const [ax, ay] = slopeAt(h, b.x, b.y);
    if (Math.hypot(ax, ay) <= GOLF.MU) {
      b.vx = b.vy = 0;
      ev.push('stop');
    }
  }
  return ev;
}

// ================================================================== Bot-Zielhilfe

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  const u = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2)) : 0;
  return Math.hypot(px - (ax + ex * u), py - (ay + ey * u));
}

function segsCross(a: number[], b: number[]) {
  const d = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const p1 = [a[0], a[1]];
  const p2 = [a[2], a[3]];
  const p3 = [b[0], b[1]];
  const p4 = [b[2], b[3]];
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Freie Linie von a nach b (keine Bande, kein Wasser, keine Flamingos/Naben)? Bewegliche Hindernisse zählen nicht. */
export function golfClear(h: GolfHole, a: Point, b: Point): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return true;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const m = GOLF.BALL_R;
  for (const off of [-m, 0, m]) {
    const s = [a.x + nx * off, a.y + ny * off, b.x + nx * off, b.y + ny * off];
    for (const w of golfWalls(h)) if (segsCross(s, w)) return false;
  }
  for (const c of [...h.bumpers, ...h.spinners.map((s) => ({ x: s.x, y: s.y, r: s.hub }))]) {
    if (segDist(c.x, c.y, a.x, a.y, b.x, b.y) < c.r + m + 1) return false;
  }
  for (let d = 0; d <= len; d += 3) {
    const x = a.x + ((b.x - a.x) * d) / len;
    const y = a.y + ((b.y - a.y) * d) / len;
    if (h.water.some((w) => inRect(w, x, y, m + 1))) return false;
  }
  return true;
}

/** Ziel für einen Bot (bzw. für die Auto-Schläge): Loch, sonst der letzte frei erreichbare Hilfspunkt */
export function golfAimTarget(h: GolfHole, ball: Point): { target: Point; pass: boolean } {
  if (golfClear(h, ball, h.cup)) return { target: h.cup, pass: false };
  const wps = h.waypoints.filter((w) => !w.region || inRect(w.region, ball.x, ball.y));
  for (let i = wps.length - 1; i >= 0; i--) {
    const w = wps[i];
    if (Math.hypot(w.x - ball.x, w.y - ball.y) < 10) continue;
    if (golfClear(h, ball, w)) return { target: w, pass: !!w.pass };
  }
  const w = wps[0] ?? h.cup;
  return { target: w, pass: !!(w as GolfWaypoint).pass };
}

/** Idealer Schlag (Winkel rad, Kraft 0 … 1) zum Ziel – ohne Streuung */
export function golfIdealPutt(h: GolfHole, ball: Point): { angle: number; power: number } {
  const { target, pass } = golfAimTarget(h, ball);
  const dist = Math.hypot(target.x - ball.x, target.y - ball.y);
  // aufs Loch: etwas drüber zielen (der Sog hilft), Durchgänge mit Schwung
  const want = pass ? dist + golfRollDist(185) : target === h.cup ? dist + 8 : dist;
  return { angle: Math.atan2(target.y - ball.y, target.x - ball.x), power: golfPowerFor(want) };
}

/** Spielt einen Schlag komplett durch (für Bots): Endlage + ob eingelocht / ins Wasser */
export function golfSimulate(h: GolfHole, from: Point, angle: number, power: number, t0: number, walls = golfWalls(h)): { x: number; y: number; holed: boolean; water: boolean; secs: number } {
  const v = golfPowerToSpeed(power);
  const b: GolfBody = { x: from.x, y: from.y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, tube: 0, tubeV: 0, tubeIdx: 0, lip: 0 };
  const dt = GOLF.TICK_S / GOLF.SUBSTEPS;
  const max = Math.round(GOLF.MAX_ROLL_S / dt);
  for (let i = 0; i < max; i++) {
    const ev = golfStep(b, h, walls, t0 + i * dt, dt);
    if (ev.includes('hole')) return { x: b.x, y: b.y, holed: true, water: false, secs: i * dt };
    if (ev.includes('water') || ev.includes('out')) return { x: b.x, y: b.y, holed: false, water: true, secs: i * dt };
    if (ev.includes('stop')) return { x: b.x, y: b.y, holed: false, water: false, secs: i * dt };
  }
  return { x: b.x, y: b.y, holed: false, water: false, secs: GOLF.MAX_ROLL_S };
}

/**
 * Bot-Plan: probiert ein paar Kräfte und Wartezeiten (Leuchtturm/Surfbrett abpassen) durch und nimmt den
 * besten Schlag. Streuung kommt danach dazu – Bots treffen also nicht immer.
 */
export function golfBotPlan(h: GolfHole, ball: Point, t0: number): { angle: number; power: number; wait: number } {
  const ideal = golfIdealPutt(h, ball);
  const { target } = golfAimTarget(h, ball);
  const walls = golfWalls(h);
  const moving = h.spinners.length > 0 || h.movers.length > 0;
  const waits = moving ? [0, 0.4, 0.8, 1.2, 1.6, 2, 2.4] : [0];
  const factors = [0.85, 0.95, 1, 1.08, 1.2];
  let best = { angle: ideal.angle, power: ideal.power, wait: 0 };
  let bestScore = Infinity;
  for (const w of waits) {
    for (const f of factors) {
      const pw = Math.min(1, ideal.power * f);
      const r = golfSimulate(h, ball, ideal.angle, pw, t0 + w, walls);
      const end = { x: r.x, y: r.y };
      const score = r.holed
        ? -100 + w
        : r.water
          ? 1e4
          : golfClear(h, end, h.cup)
            ? Math.hypot(end.x - h.cup.x, end.y - h.cup.y) + w * 5
            : 300 + Math.hypot(end.x - target.x, end.y - target.y) + w * 5;
      if (score < bestScore) {
        bestScore = score;
        best = { angle: ideal.angle, power: pw, wait: w };
      }
    }
  }
  return best;
}
