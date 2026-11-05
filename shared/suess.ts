/**
 * Süßigkeiten-Klau: Grundriss des Ferienhauses bei Nacht, Konstanten, Bewegung/Wegfindung und Typen.
 * Wird vom Server (Spiellogik), von den Bots, vom TV und vom Handy benutzt.
 *
 * Legende (begehbar): '.' Holzboden, ',' Fliesen (Küche/Bad), ':' Rasen (Garten), 'S' Versteck (nur Naschkatzen)
 * Hindernisse: '#' Wand, 'b' Bett, 'k' Küchenzeile, 'K' Kühlschrank, 'M' Minibar, 't' Tisch, 's' Sofa,
 *              'w' Badewanne, 'p' Topfpflanze, 'T' Baum
 */
export const SUESS_MAP = [
  '##############################',
  '#SS..b.b#kkkKkkkk#bb..#bbb..p#',
  '#SS.....#,,,,,,,,#bb..#bbb...#',
  '#.......#,,,tt,,,#....#......#',
  '#..tt......,tt,,,..t.........#',
  '#..tt...#,,,,,,,,#....#...t..#',
  '#p......#,,,,,,,,#...p#......#',
  '###.#########.####.#######.###',
  '#............................#',
  '####.####.#######.#####.######',
  '#ww,,,,,#.......M.....#::T:::#',
  '#,,,,,,,#..sss........#::::::#',
  '#,,,,,,,..........tt..:::::SS#',
  '#ww,,,,,#..ttt........#:T::SS#',
  '#,,,,,,p#.............#::::::#',
  '##############################',
];

export const SUESS = {
  TILE: 16,
  COLS: 30,
  ROWS: 16,
  /** Oberkante der Karte in der 480 × 270-Welt (darüber: HUD-Leiste) */
  OY: 14,
  /** Kollisions-Halbbreite einer Figur */
  R: 5,
  CATCH_DIST: 11,
  PICK_DIST: 10,
  /** Tempo einer Naschkatze mit leeren Taschen; pro Süßigkeit (Wert) langsamer, mindestens MIN_FACTOR */
  THIEF_SPEED: 78,
  SLOW_PER_CANDY: 0.055,
  MIN_FACTOR: 0.42,
  CARRY_MAX: 12,
  GUARD_SPEED: 64,
  SPRINT_SPEED: 112,
  SPRINT_MS: 900,
  SPRINT_COOLDOWN: 5000,
  /** Geschnappt: so lange weg, danach im Versteck wieder da + kurz unverwundbar */
  RESPAWN_MS: 3500,
  SHIELD_MS: 1600,
  /** Geschnappt: so viel der Beute fällt auf den Boden, der Rest wandert zurück in die Minibar */
  CATCH_SPILL: 0.5,
  /** Nach "Ablegen"/Fallenlassen kann der Werfer seine Sachen erst nach dieser Zeit wieder aufheben */
  DROP_LOCK_MS: 1500,
  /** Süßigkeiten auf der Karte: Grundmenge + pro Naschkatze */
  CANDY_BASE: 8,
  CANDY_PER_THIEF: 3,
  SPAWN_EVERY: 650,
  INTRO_MS: 5000,
  ROUND_END_MS: 5000,
  ROUND_MS: 110000,
  MAX_ROUNDS: 3,
  /** Ziel (Gesamtwert) = TARGET_BASE + TARGET_PER_THIEF × Naschkatzen */
  TARGET_BASE: 4,
  TARGET_PER_THIEF: 13,
  /** Punkte: Siegerteam pro Kopf, + pro abgelieferter Süßigkeit / pro Fang */
  WIN_POINTS: 15,
  POINT_PER_CANDY: 1,
  POINT_PER_CATCH: 1,
  /** Startpunkt der Wächter: Flur in der Mitte */
  GUARD_SPAWN: { col: 14, row: 8 },
};

/** Zahl der Wächter: 1, ab 6 Spielern 2 */
export const suessGuardCount = (players: number) => (players >= 6 ? 2 : 1);
/** Ziel: wächst mit der Zahl der Naschkatzen – ab 5 etwas langsamer (es bleibt bei 2 Wächtern, aber die Wege werden voller) */
export const suessTarget = (thieves: number) => SUESS.TARGET_BASE + SUESS.TARGET_PER_THIEF * thieves - Math.max(0, thieves - 4);
/** Nachschub-Takt: mit vielen Naschkatzen kommt öfter etwas nach */
export const suessSpawnEvery = (thieves: number) => Math.round((SUESS.SPAWN_EVERY * 4) / Math.max(4, thieves));
export const suessSpeedFactor = (carry: number) => Math.max(SUESS.MIN_FACTOR, 1 - carry * SUESS.SLOW_PER_CANDY);

/** Süßigkeiten-Sorten (Index = `t` im Zustand): Name, Wert/Gewicht */
export const CANDY_KINDS = [
  { name: 'Bonbon', v: 1 },
  { name: 'Lolli', v: 1 },
  { name: 'Schokoriegel', v: 2 },
  { name: 'Riesen-Tafel', v: 3 },
] as const;

export const SUESS_ROOMS: { name: string; col: number; row: number }[] = [
  { name: 'Kinderzimmer', col: 4, row: 3 },
  { name: 'Küche', col: 12, row: 5 },
  { name: 'Gästezimmer', col: 20, row: 3 },
  { name: 'Schlafzimmer', col: 25, row: 3 },
  { name: 'Flur', col: 14, row: 8 },
  { name: 'Bad', col: 4, row: 12 },
  { name: 'Wohnzimmer', col: 15, row: 12 },
  { name: 'Garten', col: 25, row: 12 },
];

export const tileAt = (col: number, row: number) => SUESS_MAP[row]?.[col] ?? '#';
/** Begehbar? Wächter dürfen nicht ins Versteck ('S') */
export const isWalk = (col: number, row: number, guard = false) => {
  const t = tileAt(col, row);
  return t === '.' || t === ',' || t === ':' || (t === 'S' && !guard);
};

export const tileOf = (x: number, y: number) => ({ col: Math.floor(x / SUESS.TILE), row: Math.floor((y - SUESS.OY) / SUESS.TILE) });
export const tileCenter = (col: number, row: number) => ({ x: col * SUESS.TILE + SUESS.TILE / 2, y: SUESS.OY + row * SUESS.TILE + SUESS.TILE / 2 });
export const inStash = (x: number, y: number) => {
  const t = tileOf(x, y);
  return tileAt(t.col, t.row) === 'S';
};

/** Ist das Quadrat (Mitte x/y, Halbbreite r) frei? */
export function boxFree(x: number, y: number, guard = false, r = SUESS.R) {
  const T = SUESS.TILE;
  const c0 = Math.floor((x - r) / T);
  const c1 = Math.floor((x + r - 0.001) / T);
  const r0 = Math.floor((y - r - SUESS.OY) / T);
  const r1 = Math.floor((y + r - 0.001 - SUESS.OY) / T);
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) if (!isWalk(col, row, guard)) return false;
  return true;
}

/** Bewegt eine Figur um (dx, dy), gleitet an Wänden entlang und rutscht an Türen hinein */
export function moveSuess(p: { x: number; y: number }, dx: number, dy: number, guard = false) {
  const step = (ax: number, ay: number) => {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(ax), Math.abs(ay)) / 3));
    let moved = false;
    for (let i = 0; i < n; i++) {
      const nx = p.x + ax / n;
      const ny = p.y + ay / n;
      if (!boxFree(nx, ny, guard)) break;
      p.x = nx;
      p.y = ny;
      moved = true;
    }
    return moved;
  };
  const okX = dx === 0 || step(dx, 0);
  const okY = dy === 0 || step(0, dy);
  const assist = (axis: 'x' | 'y', amount: number) => {
    const { col, row } = tileOf(p.x, p.y);
    const c = tileCenter(col, row);
    if (axis === 'x') {
      const off = c.y - p.y;
      if (Math.abs(off) > 0.5 && isWalk(col + Math.sign(dx), row, guard)) step(0, Math.sign(off) * Math.min(Math.abs(off), amount));
    } else {
      const off = c.x - p.x;
      if (Math.abs(off) > 0.5 && isWalk(col, row + Math.sign(dy), guard)) step(Math.sign(off) * Math.min(Math.abs(off), amount), 0);
    }
  };
  if (!okX && Math.abs(dx) > Math.abs(dy) * 0.6) assist('x', Math.abs(dx));
  if (!okY && Math.abs(dy) > Math.abs(dx) * 0.6) assist('y', Math.abs(dy));
}

const idx = (col: number, row: number) => row * SUESS.COLS + col;
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Breitensuche ab (mehreren) Startkacheln → Schrittzahl pro Kachel (Infinity = unerreichbar) */
export function suessBfs(starts: { col: number; row: number }[], guard = false): number[] {
  const dist = new Array<number>(SUESS.COLS * SUESS.ROWS).fill(Infinity);
  const queue: [number, number][] = [];
  for (const s of starts) {
    if (!isWalk(s.col, s.row, guard) || dist[idx(s.col, s.row)] === 0) continue;
    dist[idx(s.col, s.row)] = 0;
    queue.push([s.col, s.row]);
  }
  for (let i = 0; i < queue.length; i++) {
    const [c, r] = queue[i];
    const d = dist[idx(c, r)];
    for (const [dc, dr] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (!isWalk(nc, nr, guard) || dist[idx(nc, nr)] <= d + 1) continue;
      dist[idx(nc, nr)] = d + 1;
      queue.push([nc, nr]);
    }
  }
  return dist;
}

export const distAt = (dist: number[], col: number, row: number) => dist[idx(col, row)] ?? Infinity;

const tilesWhere = (fn: (ch: string, col: number, row: number) => boolean) => {
  const out: { col: number; row: number }[] = [];
  SUESS_MAP.forEach((line, row) => [...line].forEach((ch, col) => fn(ch, col, row) && out.push({ col, row })));
  return out;
};

/** Alle von Naschkatzen begehbaren Kacheln */
export const SUESS_WALK = tilesWhere((_, col, row) => isWalk(col, row));
export const STASH_TILES = tilesWhere((ch) => ch === 'S');
/** Die zwei Verstecke (Mittelpunkt) – Kissenburg im Kinderzimmer, Zelt im Garten */
export const STASHES = (() => {
  const groups = [STASH_TILES.filter((t) => t.col < 15), STASH_TILES.filter((t) => t.col >= 15)];
  return groups.map((g, i) => {
    const xs = g.map((t) => tileCenter(t.col, t.row));
    return {
      name: i === 0 ? 'Kissenburg' : 'Zelt',
      x: xs.reduce((a, b) => a + b.x, 0) / xs.length,
      y: xs.reduce((a, b) => a + b.y, 0) / xs.length,
      tiles: g,
    };
  });
})();
/** Kacheln direkt neben Minibar und Kühlschrank – dort tauchen besonders oft (und große) Süßigkeiten auf */
export const SOURCE_TILES = SUESS_WALK.filter((t) =>
  DIRS.some(([dc, dr]) => 'MK'.includes(tileAt(t.col + dc, t.row + dr))) || DIRS.some(([dc, dr]) => 'MK'.includes(tileAt(t.col + dc * 2, t.row + dr * 2))),
);
export const SOURCES = tilesWhere((ch) => ch === 'M' || ch === 'K');

/** Nächster Schritt (Kachelmitte) auf dem kürzesten Weg; `dist` = BFS vom Ziel aus */
export function stepAlong(from: { x: number; y: number }, dist: number[], guard = false): { x: number; y: number } | null {
  const me = tileOf(from.x, from.y);
  let best = me;
  let bestD = distAt(dist, me.col, me.row);
  if (bestD === 0) return tileCenter(me.col, me.row);
  for (const [dc, dr] of DIRS) {
    if (!isWalk(me.col + dc, me.row + dr, guard)) continue;
    const d = distAt(dist, me.col + dc, me.row + dr);
    if (d < bestD) {
      bestD = d;
      best = { col: me.col + dc, row: me.row + dr };
    }
  }
  if (bestD === Infinity) return null;
  return tileCenter(best.col, best.row);
}

export const roomNameAt = (x: number, y: number) => {
  const t = tileOf(x, y);
  if (t.row <= 6) return t.col <= 8 ? 'Kinderzimmer' : t.col <= 17 ? 'Küche' : t.col <= 22 ? 'Gästezimmer' : 'Schlafzimmer';
  if (t.row <= 8) return 'Flur';
  return t.col <= 8 ? 'Bad' : t.col <= 22 ? 'Wohnzimmer' : 'Garten';
};

// ------------------------------------------------------------------ Zustand

export interface SuessThief {
  x: number;
  y: number;
  dir: 1 | -1;
  moving: boolean;
  /** Getragener Wert (macht langsamer und dicker) */
  carry: number;
  /** 'out' = geschnappt, taucht gleich im Versteck wieder auf */
  state: 'run' | 'out';
  respawnIn: number;
  shield: boolean;
  safe: boolean;
}

export interface SuessGuard {
  x: number;
  y: number;
  dir: 1 | -1;
  /** Blickrichtung (Taschenlampe), Bogenmaß */
  a: number;
  moving: boolean;
  sprinting: boolean;
  sprintLeft: number;
}

export interface SuessCandy {
  id: number;
  x: number;
  y: number;
  /** Sorte (Index in CANDY_KINDS) */
  t: number;
}

export interface SuessEvent {
  seq: number;
  kind: 'catch' | 'deposit' | 'drop';
  id: string;
  by?: string;
  n: number;
  x: number;
  y: number;
}

export interface SuessOutcome {
  winner: 'thieves' | 'guards';
  total: number;
  target: number;
  catches: number;
  /** Restzeit beim Sieg der Naschkatzen (ms) */
  leftMs: number;
}

export interface SuessStats {
  delivered: number;
  caught: number;
  catches: number;
}

export interface SuessState {
  sub: 'intro' | 'play' | 'roundEnd' | 'over';
  endsIn: number;
  round: number;
  rounds: number;
  target: number;
  total: number;
  thieves: Record<string, SuessThief>;
  guards: Record<string, SuessGuard>;
  candy: SuessCandy[];
  events: SuessEvent[];
  points: Record<string, number>;
  stats: Record<string, SuessStats>;
  outcome: SuessOutcome | null;
  history: SuessOutcome[];
}
