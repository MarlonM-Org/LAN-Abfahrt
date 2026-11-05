/**
 * Spion unter Gästen: Gartenparty am Ferienhaus. Viele gleich aussehende Gäste, ein paar davon
 * sind Spieler. Geometrie, Wegfindung und Konstanten – benutzt von Server (Spiellogik + NPCs),
 * Bots, TV und Handy (Karte).
 *
 * Koordinaten: Welt 480 × 270, (x, y) eines Gastes = Fußpunkt.
 */

export const SPION = {
  W: 480,
  H: 270,
  /** Garten zwischen HUD oben und Spielerleiste unten */
  TOP: 22,
  BOTTOM: 250,
  TICK_MS: 50,
  /** Alle gehen gleich schnell (Spieler wie NPCs) – Rennen gibt es nicht */
  SPEED: 22,
  /** Gäste (NPCs + Spieler) */
  guests: (players: number) => Math.min(60, 36 + players * 2),
  /** Auftrag erledigen / am Buffet zugreifen dauert für alle gleich lang */
  USE_MS: 3000,
  /** Nach einem erledigten Auftrag: so lange zählt der nächste noch nicht */
  TASK_COOLDOWN_MS: 12000,
  /** Öffentlicher Fortschritt erscheint verzögert (sonst wäre der Gast sofort klar) */
  PROGRESS_DELAY_MS: [2500, 6500] as const,
  USE_R: 18,
  CHAT_R: 18,
  BALLOONS: 2,
  FLY_MS: 900,
  /** Wer daneben wirft, ist so lange auf dem TV markiert */
  EXPOSE_MS: 5000,
  WET_MS: 1800,
  /** Tippen auf der Handy-Karte: so nah muss ein Gast sein */
  PICK_R: 16,
  INTRO_MS: 7000,
  REVEAL_MS: 7000,
  OVER_MS: 3500,
  POINTS: { TASK: 2, ALL: 6, UNMASK: 5, SURVIVE: 3 },
};

/** Animation/Zustand eines Gastes (öffentlich, für NPCs und Spieler identisch) */
export const SP_A = { STAND: 0, WALK: 1, CHAT: 2, USE: 3, WET: 4, OUT: 5 } as const;
export type SpAnimId = (typeof SP_A)[keyof typeof SP_A];

/** Gast im GameState: [x, y, Flags] – Flags = Anim | (nach links ? 8 : 0) | Variante << 4 */
export type SpGuestT = [number, number, number];

export const packGuest = (x: number, y: number, a: SpAnimId, dir: 1 | -1, v: number): SpGuestT => [Math.round(x), Math.round(y), a | (dir < 0 ? 8 : 0) | (v << 4)];
export const guestAnim = (g: SpGuestT) => (g[2] & 7) as SpAnimId;
export const guestDir = (g: SpGuestT): 1 | -1 => (g[2] & 8 ? -1 : 1);
export const guestVariant = (g: SpGuestT) => g[2] >> 4;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Station {
  id: string;
  name: string;
  icon: string;
  /** Wo man stehen muss (Fußpunkt) */
  x: number;
  y: number;
  /** Was der Gast dort tut (Handy-Knopf) */
  verb: string;
}

/** Die vier Auftragsorte – NPCs besuchen sie genauso */
export const STATIONS: Station[] = [
  { id: 'buffet', name: 'Buffet', icon: '🍉', x: 92, y: 100, verb: 'Teller füllen' },
  { id: 'grill', name: 'Grill', icon: '🔥', x: 399, y: 100, verb: 'Würstchen wenden' },
  { id: 'pool', name: 'Pool', icon: '🏊', x: 240, y: 178, verb: 'Füße ins Wasser' },
  { id: 'haengematte', name: 'Hängematte', icon: '🌴', x: 396, y: 226, verb: 'Probeliegen' },
];

/** Feste Dinge im Garten */
export const HOUSE: Rect = { x: 0, y: 22, w: 480, h: 28 };
export const POOL: Rect = { x: 180, y: 118, w: 120, h: 48 };
export const BUFFET: Rect = { x: 52, y: 80, w: 80, h: 12 };
export const GRILL: Rect = { x: 389, y: 80, w: 20, h: 12 };
export const HAMMOCK: Rect = { x: 356, y: 206, w: 82, h: 10 };
/** Stehtische mit Sonnenschirm (Mitte, Fußpunkt) – hier wird gern geplaudert */
export const TABLES = [
  { x: 120, y: 196 },
  { x: 262, y: 222 },
  { x: 300, y: 82 },
];
export const SPEAKER: Rect = { x: 446, y: 56, w: 18, h: 12 };
/** Palmen/Bäume (Stamm-Fußpunkt) */
export const TREES = [
  { x: 22, y: 236 },
  { x: 168, y: 238 },
  { x: 20, y: 120 },
];

export const OBSTACLES: Rect[] = [
  HOUSE,
  { x: POOL.x - 4, y: POOL.y - 4, w: POOL.w + 8, h: POOL.h + 8 },
  BUFFET,
  GRILL,
  HAMMOCK,
  SPEAKER,
  ...TABLES.map((t) => ({ x: t.x - 7, y: t.y - 4, w: 14, h: 5 })),
  ...TREES.map((t) => ({ x: t.x - 4, y: t.y - 4, w: 8, h: 5 })),
];

/** Kann ein Gast mit dem Fußpunkt hier stehen? */
export function walkable(x: number, y: number) {
  if (x < 6 || x > SPION.W - 6 || y < HOUSE.y + HOUSE.h + 8 || y > SPION.BOTTOM - 3) return false;
  for (const r of OBSTACLES) if (x > r.x - 3 && x < r.x + r.w + 3 && y > r.y - 1 && y < r.y + r.h + 3) return false;
  return true;
}

// ------------------------------------------------------------------ Wegfindung (Raster + Sichtlinie)

const CELL = 6;
const COLS = Math.ceil(SPION.W / CELL);
const ROWS = Math.ceil(SPION.H / CELL);
let grid: Uint8Array | null = null;

function walkGrid() {
  if (grid) return grid;
  grid = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) grid[r * COLS + c] = walkable(c * CELL + CELL / 2, r * CELL + CELL / 2) ? 1 : 0;
  return grid;
}

const cellOf = (x: number, y: number) => ({ c: Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL))), r: Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL))) });

/** Nächste begehbare Rasterzelle (Mitte) */
function nearestFree(x: number, y: number) {
  const g = walkGrid();
  const { c, r } = cellOf(x, y);
  for (let rad = 0; rad < 20; rad++) {
    let best: { c: number; r: number; d: number } | null = null;
    for (let dr = -rad; dr <= rad; dr++)
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= COLS || rr >= ROWS || !g[rr * COLS + cc]) continue;
        const d = Math.hypot(cc * CELL + CELL / 2 - x, rr * CELL + CELL / 2 - y);
        if (!best || d < best.d) best = { c: cc, r: rr, d };
      }
    if (best) return best;
  }
  return { c, r, d: 0 };
}

/** Gerade Strecke frei? */
export function lineFree(ax: number, ay: number, bx: number, by: number) {
  const d = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(d / 2));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (!walkable(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
  }
  return true;
}

/** Ein begehbarer Punkt möglichst nah an (x, y) */
export function snapWalkable(x: number, y: number) {
  if (walkable(x, y)) return { x, y };
  const f = nearestFree(x, y);
  return { x: f.c * CELL + CELL / 2, y: f.r * CELL + CELL / 2 };
}

/**
 * Weg von A nach B als Liste von Wegpunkten (ohne A, mit B). Breitensuche auf einem 6-px-Raster,
 * danach per Sichtlinie geglättet – so laufen NPCs und Spieler gleich "natürlich".
 */
export function findPath(ax: number, ay: number, bx: number, by: number): { x: number; y: number }[] {
  const goal = snapWalkable(bx, by);
  if (lineFree(ax, ay, goal.x, goal.y)) return [goal];
  const g = walkGrid();
  const s = walkable(ax, ay) ? cellOf(ax, ay) : nearestFree(ax, ay);
  const t = nearestFree(goal.x, goal.y);
  const start = s.r * COLS + s.c;
  const target = t.r * COLS + t.c;
  const prev = new Int32Array(COLS * ROWS).fill(-1);
  prev[start] = start;
  const q = [start];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let i = 0; i < q.length; i++) {
    const cur = q[i];
    if (cur === target) break;
    const c = cur % COLS, r = (cur - c) / COLS;
    for (const [dc, dr] of dirs) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= COLS || rr >= ROWS) continue;
      const k = rr * COLS + cc;
      if (prev[k] >= 0 || !g[k]) continue;
      // keine Ecken abschneiden
      if (dc && dr && (!g[r * COLS + cc] || !g[rr * COLS + c])) continue;
      prev[k] = cur;
      q.push(k);
    }
  }
  if (prev[target] < 0) return [];
  const cells: { x: number; y: number }[] = [];
  for (let k = target; k !== start; k = prev[k]) cells.push({ x: (k % COLS) * CELL + CELL / 2, y: Math.floor(k / COLS) * CELL + CELL / 2 });
  cells.reverse();
  cells.push(goal);
  // Glätten: immer zum entferntesten Punkt mit freier Sicht
  const out: { x: number; y: number }[] = [];
  let px = ax, py = ay, i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !lineFree(px, py, cells[j].x, cells[j].y)) j--;
    out.push(cells[j]);
    px = cells[j].x;
    py = cells[j].y;
    i = j + 1;
  }
  return out;
}

/** Zufälliger begehbarer Punkt im Garten */
export function randomSpot(rnd = Math.random) {
  for (let i = 0; i < 200; i++) {
    const x = 10 + rnd() * (SPION.W - 20);
    const y = HOUSE.y + HOUSE.h + 10 + rnd() * (SPION.BOTTOM - HOUSE.y - HOUSE.h - 14);
    if (walkable(x, y)) return { x, y };
  }
  return { x: 240, y: 200 };
}

/** Zufälliger Stehplatz an einem Auftragsort (innerhalb des Radius) */
export function stationSpot(i: number, rnd = Math.random) {
  const s = STATIONS[i];
  for (let k = 0; k < 60; k++) {
    const x = s.x + (rnd() - 0.5) * 22;
    const y = s.y + (rnd() - 0.3) * 8;
    if (walkable(x, y) && Math.hypot(x - s.x, y - s.y) < SPION.USE_R - 4) return { x, y };
  }
  return snapWalkable(s.x, s.y);
}

/** Auftragsort in Reichweite (oder -1) */
export function stationAt(x: number, y: number) {
  let best = -1, bd = SPION.USE_R;
  STATIONS.forEach((s, i) => {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Stehplatz neben einem anderen Gast (zum Plaudern) */
export function besideSpot(x: number, y: number, rnd = Math.random) {
  for (let k = 0; k < 12; k++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const px = x + side * (9 + rnd() * 4);
    const py = y + (rnd() - 0.5) * 6;
    if (walkable(px, py)) return { x: px, y: py };
  }
  return null;
}
