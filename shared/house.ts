import { ROOMS } from './games';

/**
 * Grundriss des Ferienhauses (Mord im Ferienhaus + Verräter im Ferienhaus).
 * 3 × 2 Räume unterhalb des HUD, Wände 3 px dick, Türen in der Mitte der Zwischenwände.
 * Reine Geometrie – wird von Server (Kollision), TV (Malen) und Bots (Wegfindung) benutzt.
 */
export const HOUSE = {
  COLS: 3,
  RW: 156,
  RH: 114,
  OX: 6,
  OY: 36,
  WALL: 3,
  /** Türhöhe in senkrechten Wänden (links ↔ rechts) */
  DOOR_V: 24,
  /** Türbreite in waagerechten Wänden (oben ↔ unten) */
  DOOR_H: 28,
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Door extends Rect {
  /** Räume links/oben (a) und rechts/unten (b) */
  a: number;
  b: number;
  cx: number;
  cy: number;
  /** true = Tür in einer senkrechten Wand (man läuft waagerecht durch) */
  vertical: boolean;
}

export const roomRect = (i: number): Rect => ({
  x: HOUSE.OX + (i % HOUSE.COLS) * HOUSE.RW,
  y: HOUSE.OY + Math.floor(i / HOUSE.COLS) * HOUSE.RH,
  w: HOUSE.RW,
  h: HOUSE.RH,
});

/** Begehbare Fläche eines Raums (ohne Wände) */
export const roomInner = (i: number): Rect => {
  const r = roomRect(i);
  const W = HOUSE.WALL;
  return { x: r.x + W, y: r.y + W, w: r.w - 2 * W, h: r.h - 2 * W };
};

export const DOORS: Door[] = (() => {
  const doors: Door[] = [];
  const W = HOUSE.WALL;
  ROOMS.forEach((_, i) => {
    const r = roomRect(i);
    if (i % HOUSE.COLS < HOUSE.COLS - 1) {
      const d = { x: r.x + r.w - W, y: r.y + r.h / 2 - HOUSE.DOOR_V / 2, w: 2 * W, h: HOUSE.DOOR_V };
      doors.push({ ...d, a: i, b: i + 1, cx: d.x + d.w / 2, cy: d.y + d.h / 2, vertical: true });
    }
    if (i + HOUSE.COLS < ROOMS.length) {
      const d = { x: r.x + r.w / 2 - HOUSE.DOOR_H / 2, y: r.y + r.h - W, w: HOUSE.DOOR_H, h: 2 * W };
      doors.push({ ...d, a: i, b: i + HOUSE.COLS, cx: d.x + d.w / 2, cy: d.y + d.h / 2, vertical: false });
    }
  });
  return doors;
})();

/** Raum an einer Position (−1 = Wand/draußen; Türen zählen zum näheren Raum) */
export function roomAt(x: number, y: number): number {
  for (let i = 0; i < ROOMS.length; i++) {
    const r = roomRect(i);
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
  }
  return -1;
}

/** Kann ein Kreis mit Radius r an (x, y) stehen? (Achsparallele Räume + Türdurchgänge) */
export function walkable(x: number, y: number, r: number): boolean {
  for (let i = 0; i < ROOMS.length; i++) {
    const a = roomInner(i);
    if (x >= a.x + r && x <= a.x + a.w - r && y >= a.y + r && y <= a.y + a.h - r) return true;
  }
  for (const d of DOORS) {
    if (d.vertical) {
      if (y >= d.y + r && y <= d.y + d.h - r && x >= d.x - r - 1 && x <= d.x + d.w + r + 1) return true;
    } else if (x >= d.x + r && x <= d.x + d.w - r && y >= d.y - r - 1 && y <= d.y + d.h + r + 1) {
      return true;
    }
  }
  return false;
}

/** Ist die Sichtlinie zwischen zwei Punkten frei (keine Wand dazwischen)? */
export function lineFree(x1: number, y1: number, x2: number, y2: number): boolean {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(len / 2));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    if (!walkable(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 0)) return false;
  }
  return true;
}

/** Türen auf dem kürzesten Weg von Raum `from` nach Raum `to` (Breitensuche) */
export function doorPath(from: number, to: number): Door[] {
  if (from < 0 || to < 0 || from === to) return [];
  const prev = new Map<number, { room: number; door: Door }>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const d of DOORS) {
      const next = d.a === cur ? d.b : d.b === cur ? d.a : -1;
      if (next < 0 || seen.has(next)) continue;
      seen.add(next);
      prev.set(next, { room: cur, door: d });
      queue.push(next);
    }
  }
  const path: Door[] = [];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur);
    if (!p) return [];
    path.unshift(p.door);
    cur = p.room;
  }
  return path;
}

/**
 * Nächster Wegpunkt, um von (x, y) zu (tx, ty) zu laufen – erst vor die Tür, dann hindurch.
 * Für Bots; liefert das Ziel selbst, wenn es im selben Raum liegt.
 */
export function nextWaypoint(x: number, y: number, tx: number, ty: number): { x: number; y: number } {
  const from = roomAt(x, y);
  const to = roomAt(tx, ty);
  const path = doorPath(from, to);
  if (!path.length) return { x: tx, y: ty };
  const d = path[0];
  const into = d.a === from ? 1 : -1;
  // Erst mittig vor die Tür stellen, dann durchlaufen
  const before = d.vertical ? { x: d.cx - into * 12, y: d.cy } : { x: d.cx, y: d.cy - into * 12 };
  const after = d.vertical ? { x: d.cx + into * 14, y: d.cy } : { x: d.cx, y: d.cy + into * 14 };
  const aligned = d.vertical ? Math.abs(y - d.cy) < 4 : Math.abs(x - d.cx) < 4;
  const nearDoor = Math.hypot(x - before.x, y - before.y) < 6;
  return aligned && (nearDoor || (d.vertical ? Math.abs(x - d.cx) < 14 : Math.abs(y - d.cy) < 14)) ? after : before;
}
