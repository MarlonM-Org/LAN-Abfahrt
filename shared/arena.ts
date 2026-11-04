/**
 * Bomben-Arena: gemeinsame Geometrie und Regeln (Server, TV, Handy, Bots).
 * Koordinaten in Kacheln – die Mitte von Kachel (x, y) liegt bei (x, y).
 */

export const ARENA = {
  COLS: 25,
  ROWS: 13,
  /** Kachelgröße in Welt-Pixeln und Versatz der Arena (oben ist Platz für das HUD) */
  TILE: 18,
  OX: 15,
  OY: 35,
  TICK_MS: 50,
  COUNTDOWN_MS: 3000,
  /** Danach kommt die Flut (Sudden Death) */
  ROUND_MS: 60000,
  FLOOD_STEP_MS: 70,
  ROUND_OVER_MS: 3800,
  /** Kurz warten, bevor die Runde ausgewertet wird (Gleichzeitig-Platsch = Unentschieden) */
  END_DELAY_MS: 900,
  FUSE_MS: 2500,
  FLAME_MS: 550,
  SPEED: 3.6,
  SPEED_STEP: 0.55,
  MAX_SPEED_UPS: 4,
  START_BOMBS: 1,
  MAX_BOMBS: 6,
  START_RANGE: 2,
  MAX_RANGE: 8,
  BOX_DENSITY: 0.62,
  DROP_CHANCE: 0.38,
  WIN_ROUNDS: 2,
  MAX_ROUNDS: 3,
};

/** '#' Rand, 'P' Palme/Felsen, 'b' Sandburg/Liegestuhl/Kühlbox, '.' frei, '~' Flut */
export type ArenaCell = '#' | 'P' | 'b' | '.' | '~';
export type ArenaItem = 'bomb' | 'range' | 'speed';

export const cellIdx = (x: number, y: number) => y * ARENA.COLS + x;

export function isSolidTile(x: number, y: number) {
  if (x <= 0 || y <= 0 || x >= ARENA.COLS - 1 || y >= ARENA.ROWS - 1) return true;
  return x % 2 === 0 && y % 2 === 0;
}

/** Startplätze: erst die Ecken, dann Ränder – bis 12 Spieler */
export const ARENA_SPAWNS: [number, number][] = [
  [1, 1], [23, 11], [23, 1], [1, 11],
  [12, 1], [12, 11], [1, 6], [23, 6],
  [6, 1], [18, 11], [18, 1], [6, 11],
];

/** Zellen um einen Startplatz, die frei bleiben (Manhattan-Abstand ≤ 2, nicht durch Säulen) */
export function spawnClearing(sx: number, sy: number): [number, number][] {
  const out: [number, number][] = [[sx, sy]];
  const seen = new Set([cellIdx(sx, sy)]);
  let frontier: [number, number][] = [[sx, sy]];
  for (let d = 0; d < 2; d++) {
    const next: [number, number][] = [];
    for (const [x, y] of frontier) {
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (isSolidTile(nx, ny) || seen.has(cellIdx(nx, ny))) continue;
        seen.add(cellIdx(nx, ny));
        out.push([nx, ny]);
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return out;
}

export const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Reihenfolge, in der die Flut die Arena füllt: Spirale von außen nach innen (ohne Säulen) */
export const FLOOD_ORDER: number[] = (() => {
  const order: number[] = [];
  const seen = new Set<number>();
  const add = (x: number, y: number) => {
    const i = cellIdx(x, y);
    if (seen.has(i) || isSolidTile(x, y)) return;
    seen.add(i);
    order.push(i);
  };
  for (let k = 0; ; k++) {
    const x0 = 1 + k;
    const y0 = 1 + k;
    const x1 = ARENA.COLS - 2 - k;
    const y1 = ARENA.ROWS - 2 - k;
    if (x0 > x1 || y0 > y1) break;
    for (let x = x0; x <= x1; x++) add(x, y0);
    for (let y = y0; y <= y1; y++) add(x1, y);
    for (let x = x1; x >= x0; x--) add(x, y1);
    for (let y = y1; y >= y0; y--) add(x0, y);
  }
  return order;
})();

export interface BlastCell {
  x: number;
  y: number;
  /** c = Mitte, h = waagerecht, v = senkrecht */
  k: 'c' | 'h' | 'v';
}

/**
 * Zellen, die eine Explosion trifft (Plus-Form). Stoppt an Rand/Säulen/Flut,
 * zerstört die erste Kiste (inklusive) und stoppt an anderen Bomben (inklusive, die zünden mit).
 */
export function blastCells(
  cellAt: (x: number, y: number) => ArenaCell,
  bombAt: (x: number, y: number) => boolean,
  bx: number,
  by: number,
  range: number,
): BlastCell[] {
  const out: BlastCell[] = [{ x: bx, y: by, k: 'c' }];
  for (const [dx, dy] of DIRS) {
    for (let i = 1; i <= range; i++) {
      const x = bx + dx * i;
      const y = by + dy * i;
      const c = cellAt(x, y);
      if (c === '#' || c === 'P' || c === '~') break;
      out.push({ x, y, k: dx ? 'h' : 'v' });
      if (c === 'b' || bombAt(x, y)) break;
    }
  }
  return out;
}

export const ITEM_LABEL: Record<ArenaItem, string> = { bomb: '+1 Bombe', range: '+1 Reichweite', speed: 'Flip-Flops: schneller' };
