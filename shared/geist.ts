/**
 * Geisterjagd – gemeinsame Konstanten und Geometrie (Server, TV, Handy, Bots).
 * Das Ferienhaus bei Nacht: 3 × 2 Räume mit Türöffnungen, ein paar Möbel als Hindernisse.
 * Wände und Möbel blockieren Bewegung UND Taschenlampen-Licht.
 */

export const GEIST = {
  /** Spielfläche (Innenraum des Hauses) */
  AREA: { x: 12, y: 30, w: 456, h: 234 },
  WALL: 6,
  /** Radius einer Figur */
  R: 6,
  HUNTER_SPEED: 60,
  GHOST_SPEED: 84,
  /** Im Lichtkegel ist der Geist langsamer */
  GHOST_LIT_SLOW: 0.8,
  LIGHT_LEN: 82,
  LIGHT_HALF: 0.42,
  /** Akku: Anteil pro Sekunde */
  DRAIN: 1 / 9,
  RECHARGE: 1 / 12,
  EMPTY_RECHARGE: 0.32,
  EMPTY_RESUME: 0.5,
  /** Schaden pro Sekunde für einen Lichtkegel; mehrere stapeln sich abgeschwächt (n^STACK) */
  DMG: 12,
  STACK: 0.6,
  HEALTH_BASE: 60,
  HEALTH_PER_HUNTER: 25,
  SCARE_DIST: 12,
  SCARE_COOLDOWN: 900,
  REVIVE_DIST: 18,
  REVIVE_MS: 2000,
  /** Ab dieser Entfernung kriegt man Gänsehaut */
  FEAR_DIST: 115,
  ROUND_MS: 90000,
  INTRO_MS: 6000,
  END_MS: 5000,
  FLASH_MIN: 15000,
  FLASH_MAX: 25000,
  FLASH_MS: 700,
  TOUCH_REVEAL_MS: 1300,
  /** Nachleuchten, nachdem der Geist den Lichtkegel verlassen hat */
  LIGHT_REVEAL_MS: 250,
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const A = GEIST.AREA;
export const COL_W = A.w / 3;
export const ROW_H = A.h / 2;
const DOOR_V = 36; // Türhöhe in senkrechten Wänden
const DOOR_H = 40; // Türbreite in der waagrechten Wand

export const GEIST_ROOMS = ['Küche', 'Wohnzimmer', 'Bad', 'Schlafzimmer', 'Flur', 'Keller'];

/** Raum-Index (0–5) für eine Position: oben 0–2, unten 3–5 */
export function roomAt(x: number, y: number): number {
  const c = Math.max(0, Math.min(2, Math.floor((x - A.x) / COL_W)));
  const r = y < A.y + ROW_H ? 0 : 1;
  return r * 3 + c;
}

export function roomCenter(i: number) {
  return { x: A.x + (i % 3) * COL_W + COL_W / 2, y: A.y + Math.floor(i / 3) * ROW_H + ROW_H / 2 };
}

export function roomRect(i: number): Rect {
  return { x: A.x + (i % 3) * COL_W, y: A.y + Math.floor(i / 3) * ROW_H, w: COL_W, h: ROW_H };
}

/** Innenwände mit Türlücken */
export const GEIST_WALLS: Rect[] = (() => {
  const t = GEIST.WALL;
  const walls: Rect[] = [];
  for (const c of [1, 2]) {
    const x = A.x + c * COL_W - t / 2;
    for (const r of [0, 1]) {
      const y0 = A.y + r * ROW_H;
      const mid = y0 + ROW_H / 2;
      walls.push({ x, y: y0, w: t, h: mid - DOOR_V / 2 - y0 });
      walls.push({ x, y: mid + DOOR_V / 2, w: t, h: y0 + ROW_H - (mid + DOOR_V / 2) });
    }
  }
  const y = A.y + ROW_H - t / 2;
  for (const c of [0, 1, 2]) {
    const x0 = A.x + c * COL_W;
    const mid = x0 + COL_W / 2;
    walls.push({ x: x0, y, w: mid - DOOR_H / 2 - x0, h: t });
    walls.push({ x: mid + DOOR_H / 2, y, w: x0 + COL_W - (mid + DOOR_H / 2), h: t });
  }
  return walls;
})();

/** Möbel: Kollision + Sprite (Sprite unten mittig an x + w/2, y + h) */
export interface Furniture extends Rect {
  sprite: 'counter' | 'table' | 'sofa' | 'bathtub' | 'bed' | 'bedR' | 'crate' | 'plant' | 'wardrobe';
}

export const GEIST_FURNITURE: Furniture[] = (() => {
  const at = (room: number, dx: number, dy: number, w: number, h: number, sprite: Furniture['sprite']): Furniture => {
    const r = roomRect(room);
    return { x: Math.round(r.x + dx), y: Math.round(r.y + dy), w, h, sprite };
  };
  return [
    at(0, 10, 6, 44, 12, 'counter'),
    at(0, 70, 64, 26, 12, 'table'),
    at(1, 20, 6, 36, 14, 'sofa'),
    at(1, 112, 70, 16, 16, 'plant'),
    at(2, 8, 8, 32, 16, 'bathtub'),
    at(2, 112, 72, 18, 20, 'wardrobe'),
    at(3, 14, 64, 24, 30, 'bed'),
    at(3, 48, 64, 24, 30, 'bedR'),
    at(5, 26, 26, 16, 14, 'crate'),
    at(5, 106, 66, 16, 14, 'crate'),
    at(5, 122, 66, 16, 14, 'crate'),
  ];
})();

export const GEIST_OBSTACLES: Rect[] = [...GEIST_WALLS, ...GEIST_FURNITURE];

/** Kreis aus Rechtecken und Hauswänden herausschieben (gleitet an Kanten entlang) */
export function collide(p: { x: number; y: number }, r = GEIST.R) {
  for (let pass = 0; pass < 2; pass++) {
    for (const o of GEIST_OBSTACLES) {
      const cx = Math.max(o.x, Math.min(p.x, o.x + o.w));
      const cy = Math.max(o.y, Math.min(p.y, o.y + o.h));
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d > 0.001) {
        p.x = cx + (dx / d) * r;
        p.y = cy + (dy / d) * r;
      } else {
        // Mittelpunkt im Rechteck → zur nächsten Kante raus
        const opts = [
          { d: p.x - o.x, x: o.x - r, y: p.y },
          { d: o.x + o.w - p.x, x: o.x + o.w + r, y: p.y },
          { d: p.y - o.y, x: p.x, y: o.y - r },
          { d: o.y + o.h - p.y, x: p.x, y: o.y + o.h + r },
        ].sort((a, b) => a.d - b.d)[0];
        p.x = opts.x;
        p.y = opts.y;
      }
    }
  }
  p.x = Math.max(A.x + r, Math.min(A.x + A.w - r, p.x));
  p.y = Math.max(A.y + r, Math.min(A.y + A.h - r, p.y));
}

/** Entfernung bis zum ersten Hindernis entlang eines Strahls (max. `max`) */
export function rayDist(x: number, y: number, angle: number, max: number): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = max;
  for (const o of GEIST_OBSTACLES) {
    // Slab-Test
    let t0 = 0;
    let t1 = best;
    if (Math.abs(dx) < 1e-9) {
      if (x < o.x || x > o.x + o.w) continue;
    } else {
      let a = (o.x - x) / dx;
      let b = (o.x + o.w - x) / dx;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
    }
    if (Math.abs(dy) < 1e-9) {
      if (y < o.y || y > o.y + o.h) continue;
    } else {
      let a = (o.y - y) / dy;
      let b = (o.y + o.h - y) / dy;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
    }
    if (t0 <= t1 && t0 < best) best = t0;
  }
  // Außenwände
  if (dx > 0) best = Math.min(best, (A.x + A.w - x) / dx);
  if (dx < 0) best = Math.min(best, (A.x - x) / dx);
  if (dy > 0) best = Math.min(best, (A.y + A.h - y) / dy);
  if (dy < 0) best = Math.min(best, (A.y - y) / dy);
  return Math.max(0, best);
}

/** Freie Sicht zwischen zwei Punkten? */
export function lineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
  const d = Math.hypot(bx - ax, by - ay);
  if (d < 1) return true;
  return rayDist(ax, ay, Math.atan2(by - ay, bx - ax), d) >= d - 0.5;
}

const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Trifft der Lichtkegel (von x/y in Richtung angle) den Punkt? */
export function inCone(x: number, y: number, angle: number, px: number, py: number, margin = GEIST.R): boolean {
  const d = Math.hypot(px - x, py - y);
  if (d > GEIST.LIGHT_LEN + margin) return false;
  if (d > margin) {
    // Etwas großzügiger: Radius des Geists zählt mit
    const slack = Math.atan2(margin, d);
    if (angleDiff(Math.atan2(py - y, px - x), angle) > GEIST.LIGHT_HALF + slack) return false;
  }
  return lineOfSight(x, y, px, py);
}

/** Umriss des Lichtkegels (an Wänden abgeschnitten) – zum Zeichnen */
export function conePolygon(x: number, y: number, angle: number, rays = 14): { x: number; y: number }[] {
  const pts = [{ x, y }];
  for (let i = 0; i <= rays; i++) {
    const a = angle - GEIST.LIGHT_HALF + (2 * GEIST.LIGHT_HALF * i) / rays;
    const d = rayDist(x, y, a, GEIST.LIGHT_LEN);
    pts.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d });
  }
  return pts;
}

// ------------------------------------------------------------------ Navigation (Bots)

function doorBetween(a: number, b: number) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  if (hi - lo === 3) return { x: A.x + (lo % 3) * COL_W + COL_W / 2, y: A.y + ROW_H };
  return { x: A.x + (hi % 3) * COL_W, y: A.y + Math.floor(lo / 3) * ROW_H + ROW_H / 2 };
}

function neighbours(i: number) {
  const n: number[] = [];
  if (i % 3 > 0) n.push(i - 1);
  if (i % 3 < 2) n.push(i + 1);
  n.push(i < 3 ? i + 3 : i - 3);
  return n;
}

/** Nächster Wegpunkt von `from` zu `to` (über Türen) */
export function navTarget(from: { x: number; y: number }, to: { x: number; y: number }) {
  const a = roomAt(from.x, from.y);
  const b = roomAt(to.x, to.y);
  if (a === b) return to;
  const prev = new Map<number, number>([[a, a]]);
  const queue = [a];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === b) break;
    for (const n of neighbours(cur)) if (!prev.has(n)) (prev.set(n, cur), queue.push(n));
  }
  let step = b;
  while (prev.get(step) !== a) step = prev.get(step)!;
  const door = doorBetween(a, step);
  // Erst gerade vor die Tür, dann hindurch
  const c = roomCenter(a);
  const horizontal = Math.abs(a - step) === 1;
  const before = horizontal ? { x: door.x + Math.sign(c.x - door.x) * 14, y: door.y } : { x: door.x, y: door.y + Math.sign(c.y - door.y) * 14 };
  const aligned = horizontal ? Math.abs(from.y - door.y) < 10 : Math.abs(from.x - door.x) < 12;
  if (!aligned && Math.hypot(from.x - before.x, from.y - before.y) > 6) return before;
  const nc = roomCenter(step);
  return horizontal ? { x: door.x + Math.sign(nc.x - door.x) * 16, y: door.y } : { x: door.x, y: door.y + Math.sign(nc.y - door.y) * 16 };
}

/** Kartenzeichnung fürs Handy des Geists (Canvas 2D, Welt-Koordinaten) */
export function drawGeistMap(g: CanvasRenderingContext2D) {
  g.fillStyle = '#1a1530';
  g.fillRect(0, 0, 480, 270);
  for (let i = 0; i < 6; i++) {
    const r = roomRect(i);
    g.fillStyle = i % 2 ? '#2c2547' : '#29233f';
    g.fillRect(r.x, r.y, r.w, r.h);
  }
  g.fillStyle = '#4a3f6b';
  for (const f of GEIST_FURNITURE) g.fillRect(f.x, f.y, f.w, f.h);
  g.fillStyle = '#8a7bb8';
  for (const w of GEIST_WALLS) g.fillRect(w.x, w.y, w.w, w.h);
  g.strokeStyle = '#8a7bb8';
  g.lineWidth = 4;
  g.strokeRect(A.x - 2, A.y - 2, A.w + 4, A.h + 4);
  g.fillStyle = 'rgba(200,190,240,0.4)';
  g.font = '12px "Press Start 2P", monospace';
  g.textAlign = 'center';
  GEIST_ROOMS.forEach((name, i) => {
    const r = roomRect(i);
    g.fillText(name.toUpperCase(), r.x + r.w / 2, r.y + r.h / 2 + 4);
  });
}
