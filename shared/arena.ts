/**
 * Bomben-Arena: gemeinsame Geometrie und Regeln (Server, TV, Handy, Bots).
 * Koordinaten in Kacheln – die Mitte von Kachel (x, y) liegt bei (x, y).
 * Die Feldgröße hängt von der Spielerzahl ab (`ARENA_SIZES`, `arenaGeo()`); sie steht pro Spiel fest
 * und kommt im Snapshot als `cols`/`rows` mit.
 */

export const ARENA = {
  /** Kachelgröße in Welt-Pixeln (der TV zoomt kleine Felder größer) */
  TILE: 18,
  TICK_MS: 33,
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

/**
 * Feldgröße (Kacheln inkl. Heckenrand, beide ungerade) nach Spielerzahl: zu zweit klein und schnell in der
 * Action, mit mehr Spielern wächst das Feld bis 25 × 13 (≈ 16–30 begehbare Kacheln pro Spieler, zu zweit 42).
 * Flach wie der Fernseher (≈ 2 : 1), damit das Feld nach dem Zoom den Bildschirm füllt.
 */
export const ARENA_SIZES: { upTo: number; cols: number; rows: number }[] = [
  { upTo: 2, cols: 17, rows: 9 },
  { upTo: 4, cols: 19, rows: 11 },
  { upTo: 6, cols: 23, rows: 11 },
  { upTo: 8, cols: 23, rows: 13 },
  { upTo: 12, cols: 25, rows: 13 },
];

export function arenaSize(players: number) {
  return ARENA_SIZES.find((s) => players <= s.upTo) ?? ARENA_SIZES[ARENA_SIZES.length - 1];
}

/** '#' Rand, 'P' Palme/Felsen, 'b' Sandburg/Liegestuhl/Kühlbox, '.' frei, '~' Flut */
export type ArenaCell = '#' | 'P' | 'b' | '.' | '~';
export type ArenaItem = 'bomb' | 'range' | 'speed';

export const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Geometrie eines Felds (zwischengespeichert pro Größe) */
export class ArenaGeo {
  /** Startplätze: erst die Ecken, dann die Mitten der langen Ränder, der kurzen Ränder, dann Viertel – bis 12 Spieler */
  readonly spawns: [number, number][];
  /** Reihenfolge, in der die Flut die Arena füllt: Spirale von außen nach innen (ohne Säulen) */
  readonly flood: number[];

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    const r = cols - 2;
    const b = rows - 2;
    const mx = (cols - 1) / 2;
    const my = (rows - 1) / 2;
    const qx = Math.round((cols - 1) / 4);
    this.spawns = [
      [1, 1], [r, b], [r, 1], [1, b],
      [mx, 1], [mx, b], [1, my], [r, my],
      [qx, 1], [cols - 1 - qx, b], [cols - 1 - qx, 1], [qx, b],
    ];
    const order: number[] = [];
    const seen = new Set<number>();
    const add = (x: number, y: number) => {
      const i = this.idx(x, y);
      if (seen.has(i) || this.solid(x, y)) return;
      seen.add(i);
      order.push(i);
    };
    for (let k = 0; ; k++) {
      const x0 = 1 + k;
      const y0 = 1 + k;
      const x1 = cols - 2 - k;
      const y1 = rows - 2 - k;
      if (x0 > x1 || y0 > y1) break;
      for (let x = x0; x <= x1; x++) add(x, y0);
      for (let y = y0; y <= y1; y++) add(x1, y);
      for (let x = x1; x >= x0; x--) add(x, y1);
      for (let y = y1; y >= y0; y--) add(x0, y);
    }
    this.flood = order;
  }

  idx(x: number, y: number) {
    return y * this.cols + x;
  }

  /** Kachel-Koordinaten aus einem Index */
  at(i: number): [number, number] {
    return [i % this.cols, Math.floor(i / this.cols)];
  }

  /** Rand oder Säule (feste Hindernisse, unabhängig vom Spielverlauf) */
  solid(x: number, y: number) {
    if (x <= 0 || y <= 0 || x >= this.cols - 1 || y >= this.rows - 1) return true;
    return x % 2 === 0 && y % 2 === 0;
  }

  /** Geister-Kachelring: 0 = äußerster begehbarer Ring, steigt nach innen */
  ring(x: number, y: number) {
    return Math.min(x - 1, y - 1, this.cols - 2 - x, this.rows - 2 - y);
  }

  /** Zellen um einen Startplatz, die frei bleiben (Manhattan-Abstand ≤ 2, nicht durch Säulen) */
  clearing(sx: number, sy: number): [number, number][] {
    const out: [number, number][] = [[sx, sy]];
    const seen = new Set([this.idx(sx, sy)]);
    let frontier: [number, number][] = [[sx, sy]];
    for (let d = 0; d < 2; d++) {
      const next: [number, number][] = [];
      for (const [x, y] of frontier) {
        for (const [dx, dy] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          if (this.solid(nx, ny) || seen.has(this.idx(nx, ny))) continue;
          seen.add(this.idx(nx, ny));
          out.push([nx, ny]);
          next.push([nx, ny]);
        }
      }
      frontier = next;
    }
    return out;
  }
}

const geos = new Map<string, ArenaGeo>();

export function arenaGeo(cols: number, rows: number) {
  const key = `${cols}x${rows}`;
  let g = geos.get(key);
  if (!g) geos.set(key, (g = new ArenaGeo(cols, rows)));
  return g;
}

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
