/**
 * Urlaubs-Fangen: Labyrinth der Ferienanlage + gemeinsame Bewegungs-/Wegfindungs-Helfer.
 * Wird vom Server (Spiellogik), von den Bots, vom TV und vom Handy (Karte des Flüchtlings) benutzt.
 *
 * Legende: '#' Hecke, '~' Pool, 'h' Strandhütte, 'p' Palme (alles Hindernisse),
 *          '.' Rasen, ':' Sand, '=' Holzdeck (begehbar)
 */
export const FANGEN_MAZE = [
  '##############################',
  '#:::::::#.......#....#=======#',
  '#:h::h::#.##.##.#.##.#=~~~~~=#',
  '#:::::::..#.......#...=~~~~~=#',
  '#:p:::::#.#.#####.#.#.=~~~~~=#',
  '#:::::::#...#...#.....=======#',
  '#::h::::###.#.#.###.#.##.###.#',
  '#::::p::......#.......#......#',
  '#:::::::#.###.###.###.#.####.#',
  '#:h:::::#...#.......#...#....#',
  '#:::::::#.#.#.==.==.#.#.#.##.#',
  '#:::p:::..#...=....=..#......#',
  '#:::::::#.###.=....=.####.##.#',
  '#::h:h::#.....==..==......#..#',
  '#:::::::...#..........#......#',
  '##############################',
];

export const FANGEN = {
  TILE: 16,
  COLS: 30,
  ROWS: 16,
  /** Oberkante des Labyrinths in der 480 × 270-Welt (darüber: HUD-Leiste) */
  OY: 14,
  /** Kollisions-Halbbreite einer Figur */
  R: 5,
  CATCH_DIST: 11,
  RUNNER_SPEED: 70,
  HUNTER_SPEED: 60,
  SPRINT_SPEED: 104,
  SPRINT_MS: 900,
  SPRINT_COOLDOWN: 5000,
  DECOY_COOLDOWN: 12000,
  /** Alle x ms hinterlässt der Flüchtling eine kurz sichtbare Fußspur */
  PRINT_EVERY: 3200,
  PRINT_TTL: 2600,
  INTRO_MS: 5000,
  ROUND_END_MS: 4500,
  MAX_ROUNDS: 4,
  /** Punkte: Flüchtling 1 pro 2 s + Bonus fürs Entkommen; Fänger: Team-Punkte + Bonus für den Fänger */
  SURVIVE_MS_PER_POINT: 2000,
  WIN_BONUS: 20,
  TEAM_POINTS: 20,
  CATCH_BONUS: 10,
  /** Abstände (px) für "heiß / warm / lau" – sonst "kalt" */
  HEAT: [40, 80, 140],
  /** Startpunkt der Fänger: Rezeption (Holzdeck in der Mitte unten) */
  HUNTER_SPAWN: { col: 16, row: 11 },
};

export const HEAT_LABELS = ['kalt', 'lau', 'warm', 'heiß'] as const;

/** Rundenzeit: mit vielen Fängern etwas kürzer (75 s bei 2 Fängern … 60 s ab 9) */
export const fangenRoundMs = (hunters: number) => Math.max(60000, Math.min(75000, 75000 - (hunters - 2) * 2000));

export const tileAt = (col: number, row: number) => FANGEN_MAZE[row]?.[col] ?? '#';
export const isWalkTile = (col: number, row: number) => '.:='.includes(tileAt(col, row));

export const tileOf = (x: number, y: number) => ({ col: Math.floor(x / FANGEN.TILE), row: Math.floor((y - FANGEN.OY) / FANGEN.TILE) });
export const tileCenter = (col: number, row: number) => ({ x: col * FANGEN.TILE + FANGEN.TILE / 2, y: FANGEN.OY + row * FANGEN.TILE + FANGEN.TILE / 2 });

/** Ist das Quadrat (Mitte x/y, Halbbreite r) frei von Hindernissen? */
export function boxFree(x: number, y: number, r = FANGEN.R) {
  const T = FANGEN.TILE;
  const c0 = Math.floor((x - r) / T);
  const c1 = Math.floor((x + r - 0.001) / T);
  const r0 = Math.floor((y - r - FANGEN.OY) / T);
  const r1 = Math.floor((y + r - 0.001 - FANGEN.OY) / T);
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) if (!isWalkTile(col, row)) return false;
  return true;
}

/**
 * Bewegt eine Figur um (dx, dy) und lässt sie an Hecken entlanggleiten.
 * Hilft an Ecken nach: wer knapp an einem Gang vorbeiläuft, wird hineingeschoben.
 */
export function moveInMaze(p: { x: number; y: number }, dx: number, dy: number) {
  const T = FANGEN.TILE;
  const step = (ax: number, ay: number) => {
    // in kleinen Schritten, damit man nicht durch Ecken tunnelt
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(ax), Math.abs(ay)) / 3));
    let moved = false;
    for (let i = 0; i < n; i++) {
      const nx = p.x + ax / n;
      const ny = p.y + ay / n;
      if (!boxFree(nx, ny)) break;
      p.x = nx;
      p.y = ny;
      moved = true;
    }
    return moved;
  };
  const okX = dx === 0 || step(dx, 0);
  const okY = dy === 0 || step(0, dy);
  // Ecken-Hilfe: blockiert in einer Achse → zur Mitte der aktuellen Kachel rutschen
  const assist = (blockedAxis: 'x' | 'y', amount: number) => {
    const { col, row } = tileOf(p.x, p.y);
    const c = tileCenter(col, row);
    if (blockedAxis === 'x') {
      const off = c.y - p.y;
      if (Math.abs(off) > 0.5 && isWalkTile(col + Math.sign(dx), row)) step(0, Math.sign(off) * Math.min(Math.abs(off), amount));
    } else {
      const off = c.x - p.x;
      if (Math.abs(off) > 0.5 && isWalkTile(col, row + Math.sign(dy))) step(Math.sign(off) * Math.min(Math.abs(off), amount), 0);
    }
  };
  if (!okX && Math.abs(dx) > Math.abs(dy) * 0.6) assist('x', Math.abs(dx));
  if (!okY && Math.abs(dy) > Math.abs(dx) * 0.6) assist('y', Math.abs(dy));
  p.x = Math.max(T, Math.min(FANGEN.COLS * T - T, p.x));
}

const idx = (col: number, row: number) => row * FANGEN.COLS + col;
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Breitensuche ab (mehreren) Startkacheln → Schrittzahl pro Kachel (Infinity = unerreichbar) */
export function bfsFrom(starts: { col: number; row: number }[]): number[] {
  const dist = new Array<number>(FANGEN.COLS * FANGEN.ROWS).fill(Infinity);
  const queue: [number, number][] = [];
  for (const s of starts) {
    if (!isWalkTile(s.col, s.row) || dist[idx(s.col, s.row)] === 0) continue;
    dist[idx(s.col, s.row)] = 0;
    queue.push([s.col, s.row]);
  }
  for (let i = 0; i < queue.length; i++) {
    const [c, r] = queue[i];
    const d = dist[idx(c, r)];
    for (const [dc, dr] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (!isWalkTile(nc, nr) || dist[idx(nc, nr)] <= d + 1) continue;
      dist[idx(nc, nr)] = d + 1;
      queue.push([nc, nr]);
    }
  }
  return dist;
}

export const distAt = (dist: number[], col: number, row: number) => dist[idx(col, row)] ?? Infinity;

/** Alle begehbaren Kacheln */
export const WALK_TILES: { col: number; row: number }[] = (() => {
  const out: { col: number; row: number }[] = [];
  for (let row = 0; row < FANGEN.ROWS; row++) for (let col = 0; col < FANGEN.COLS; col++) if (isWalkTile(col, row)) out.push({ col, row });
  return out;
})();

/** Nächster Schritt (Kachelmitte) auf dem kürzesten Weg von `from` nach `to` */
export function nextStepTowards(from: { x: number; y: number }, to: { col: number; row: number }): { x: number; y: number } {
  const dist = bfsFrom([to]);
  const me = tileOf(from.x, from.y);
  let best = me;
  let bestD = distAt(dist, me.col, me.row);
  for (const [dc, dr] of DIRS) {
    const d = distAt(dist, me.col + dc, me.row + dr);
    if (d < bestD) {
      bestD = d;
      best = { col: me.col + dc, row: me.row + dr };
    }
  }
  return tileCenter(best.col, best.row);
}

export const heatLevel = (d: number) => (d < FANGEN.HEAT[0] ? 3 : d < FANGEN.HEAT[1] ? 2 : d < FANGEN.HEAT[2] ? 1 : 0);
