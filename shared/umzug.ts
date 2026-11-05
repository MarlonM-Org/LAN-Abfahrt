/**
 * Umzugschaos (à la Moving Out): gemeinsame Konstanten, Haus-Grundrisse, Möbel-Katalog,
 * Wegfindung und Zustandstypen – für Server (Physik), TV (Zeichnen), Handy (Anzeige) und Bots.
 *
 * Draufsicht in Welt-Pixeln (480 × 270). Ein Haus ist ein Kachelraster (TILE px), Spalte c / Zeile r
 * liegt bei x0 + c·TILE … x0 + (c+1)·TILE bzw. Y0 + r·TILE. Ab 7 Spielern gibt es zwei gespiegelte
 * Häuser nebeneinander (Team Sonne links, Team Meer rechts).
 */
import type { Team } from './types';

export const UMZUG = {
  TIME_MS: 180000,
  COUNTDOWN_MS: 4000,
  /** Sterne-Panel + Vermieter kommt, bevor der Ergebnis-Screen folgt */
  OVER_MS: 4500,
  TILE: 12,
  /** Oberkante des Spielfelds (darüber HUD) */
  Y0: 30,
  PLAYER_R: 5,
  /** Laufgeschwindigkeit (Welt-Pixel pro Sekunde) */
  SPEED: 78,
  /** So weit (px, ab Figurmitte) reicht man an Gegenstände heran */
  REACH: 13,
  /** Wurf: Reichweite (px) und Flugdauer (ms) */
  THROW_RANGE: 84,
  THROW_MS: 520,
  /** Sprint ohne Gegenstand: Dauer und Abklingzeit */
  DASH_MS: 220,
  DASH_CD_MS: 1400,
  /** GREIFEN gilt als losgelassen, wenn das Handy so lange nichts schickt */
  GRAB_LATCH_MS: 900,
  /** Ab dieser Aufprallgeschwindigkeit (px/Schritt) geht Zerbrechliches kaputt */
  BREAK_V: 2.4,
  /** Zerbrochen = so viele Punkte Abzug */
  BREAK_PENALTY: 1,
  /** Zeitbonus: pro angefangene 10 s Restzeit ein Punkt, wenn alles draußen ist */
  BONUS_PER_S: 0.1,
  /** Ab so vielen Spielern zwei Häuser (Teams) */
  TEAM_FROM: 7,
  /** Sterne bei diesem Anteil der möglichen Punkte */
  STARS: [0.4, 0.7, 0.95] as const,
};

// ------------------------------------------------------------------ Möbel

export interface UmzugKind {
  name: string;
  /** Maße in Welt-Pixeln (unrotiert: w entlang der x-Achse) */
  w: number;
  h: number;
  /** Punkte beim Abliefern */
  pts: number;
  /** Muss von zwei Leuten getragen werden */
  heavy: boolean;
  fragile: boolean;
  /** Dichte relativ zum Standard (schwere Teile lassen sich kaum allein schieben) */
  density: number;
}

export const UMZUG_KINDS: UmzugKind[] = [
  { name: 'Karton', w: 12, h: 12, pts: 1, heavy: false, fragile: false, density: 0.5 }, // 0
  { name: 'Lampe', w: 9, h: 9, pts: 1, heavy: false, fragile: false, density: 0.4 }, // 1
  { name: 'Pflanze', w: 10, h: 10, pts: 1, heavy: false, fragile: false, density: 0.5 }, // 2
  { name: 'Gartenzwerg', w: 8, h: 8, pts: 1, heavy: false, fragile: false, density: 0.6 }, // 3
  { name: 'Vase', w: 8, h: 8, pts: 2, heavy: false, fragile: true, density: 0.4 }, // 4
  { name: 'ZERBRECHLICH-Karton', w: 12, h: 12, pts: 2, heavy: false, fragile: true, density: 0.5 }, // 5
  { name: 'Kühlschrank', w: 16, h: 18, pts: 3, heavy: true, fragile: false, density: 2.2 }, // 6
  { name: 'Sofa', w: 36, h: 14, pts: 3, heavy: true, fragile: false, density: 1.5 }, // 7
  { name: 'Bett', w: 30, h: 20, pts: 4, heavy: true, fragile: false, density: 1.3 }, // 8
  { name: 'Klavier', w: 32, h: 16, pts: 5, heavy: true, fragile: false, density: 1.8 }, // 9
];
export const K = { KARTON: 0, LAMPE: 1, PFLANZE: 2, ZWERG: 3, VASE: 4, FRAGILE: 5, KUEHL: 6, SOFA: 7, BETT: 8, KLAVIER: 9 } as const;

/** Griffpunkte eines schweren Teils (lokal, unrotiert): die beiden schmalen Enden */
export function grabPoints(kind: number): { x: number; y: number }[] {
  const k = UMZUG_KINDS[kind];
  return k.w >= k.h
    ? [
        { x: -k.w / 2, y: 0 },
        { x: k.w / 2, y: 0 },
      ]
    : [
        { x: 0, y: -k.h / 2 },
        { x: 0, y: k.h / 2 },
      ];
}

// ------------------------------------------------------------------ Grundrisse

/**
 * Zeichen: '#' Wand, '.' Boden, 'g' Garten, 'p' Weg, 'W' Fenster (Wand, zerbrechlich),
 * 'D' Tür (Boden), 't' Laster (Wand), 'T' Ladefläche (begehbar, hier zählt alles als abgeliefert),
 * 'k' Küchenboden, 'h' Hecke (Wand).
 */
export const UMZUG_LAYOUTS = {
  /** Bis 6 Spieler: ein großes Haus über die ganze Breite (40 × 20 Kacheln) */
  wide: {
    grid: [
      'gggggggggggggggggggggggggggggggggggggggg',
      'g#########W#####WW###W####Wggggggggggggg',
      'g#........#.......#.......#ggggggggggggg',
      'g#........D.......#.......#ggggggggggggg',
      'g#........D.......#.......#ggggggttttttt',
      'g#........D.......D.......#ggggggTTTTTTt',
      'g#........#.......D.......WggggggTTTTTTt',
      'g#........#.......D.......WggggggTTTTTTt',
      'g###DDD####.......#########ppppppTTTTTTt',
      'g#kkkkkkkk#.......D.......DppppppTTTTTTt',
      'g#kkkkkkkkD.......D.......DppppppTTTTTTt',
      'g#kkkkkkkkD.......D.......DppppppTTTTTTt',
      'g#kkkkkkkkD.......#.......WggggggTTTTTTt',
      'g#kkkkkkkkW.......#.......#ggggggttttttt',
      'g#kkkkkkkk#.......#.......#ggggggggggggg',
      'g#########WW####WW#########ggggggggggggg',
      'gggggggggggggggggggggggggggggggggggggggg',
      'gggggggggggggggggggggggggggggggggggggggg',
      'hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh',
      'hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh',
    ],
    /** Möbel: [Art, Spalte, Zeile (Mitte, Kacheln), Winkel °, ab Spielerzahl] */
    items: [
      [K.BETT, 5, 3.5, 90, 2],
      [K.SOFA, 14, 12, 0, 2],
      [K.KUEHL, 3, 12.5, 0, 2],
      [K.KLAVIER, 22.5, 3.2, 0, 4],
      [K.KARTON, 4, 6.5, 10, 2],
      [K.KARTON, 7.5, 6.5, -5, 2],
      [K.KARTON, 20, 6.8, 0, 2],
      [K.KARTON, 24.5, 13.5, 20, 2],
      [K.LAMPE, 8.5, 2.5, 0, 2],
      [K.PFLANZE, 12, 2.5, 0, 2],
      [K.ZWERG, 30, 3, 0, 2],
      [K.VASE, 24.5, 10, 0, 2],
      [K.FRAGILE, 16.5, 6, 0, 2],
      [K.KARTON, 13, 9.5, 0, 3],
      [K.KARTON, 8.5, 12.5, 0, 3],
      [K.PFLANZE, 20.5, 13.5, 0, 3],
      [K.KARTON, 2.5, 9.5, 0, 4],
      [K.VASE, 12.5, 13.5, 0, 4],
      [K.ZWERG, 4, 17, 0, 4],
      [K.KARTON, 6, 9.5, 0, 5],
      [K.KARTON, 22, 9.5, 0, 5],
      [K.LAMPE, 16.5, 13.5, 0, 5],
      [K.KARTON, 20, 2.5, 0, 6],
      [K.FRAGILE, 2.5, 6.5, 0, 6],
      [K.PFLANZE, 30, 15, 0, 6],
    ] as [number, number, number, number, number][],
  },
  /** Ab 7 Spielern: zwei kleine Häuser nebeneinander (je 20 × 20 Kacheln, Team Meer gespiegelt) */
  small: {
    grid: [
      'gggggggggggggggggggg',
      'g####W###W###ggggggg',
      'g#..........#ggggggg',
      'g#..........#ggggggg',
      'g#..........Wggttttt',
      'g#..........WggTTTTt',
      'g#..........#ggTTTTt',
      'g###DDD######ggTTTTt',
      'g#kkkkk.....#ppTTTTt',
      'g#kkkkk.....DppTTTTt',
      'g#kkkkk.....DppTTTTt',
      'g#kkkkk.....DppTTTTt',
      'g#kkkkk.....#ggTTTTt',
      'g#kkkkk.....#ggttttt',
      'g####WW###W##ggggggg',
      'gggggggggggggggggggg',
      'gggggggggggggggggggg',
      'gggggggggggggggggggg',
      'hhhhhhhhhhhhhhhhhhhh',
      'hhhhhhhhhhhhhhhhhhhh',
    ],
    items: [
      [K.BETT, 4, 3.5, 90, 2],
      [K.SOFA, 8, 11, 0, 2],
      [K.KUEHL, 3, 11.5, 0, 2],
      [K.KLAVIER, 8.5, 3, 0, 4],
      [K.KARTON, 9.5, 5.8, 10, 2],
      [K.KARTON, 3, 5.8, -5, 2],
      [K.KARTON, 9.5, 8.6, 0, 2],
      [K.LAMPE, 6.5, 2.5, 0, 2],
      [K.PFLANZE, 11, 8.6, 0, 2],
      [K.ZWERG, 15, 3, 0, 2],
      [K.VASE, 10.5, 12.5, 0, 2],
      [K.FRAGILE, 6, 5.8, 0, 3],
      [K.KARTON, 4.5, 8.6, 0, 3],
      [K.KARTON, 7.5, 12.5, 0, 4],
      [K.PFLANZE, 2.5, 8.6, 0, 4],
      [K.VASE, 11, 2.5, 0, 5],
      [K.KARTON, 2.5, 2.5, 0, 5],
      [K.ZWERG, 3, 16, 0, 5],
      [K.KARTON, 11, 5.8, 0, 6],
      [K.LAMPE, 4.5, 12.5, 0, 6],
    ] as [number, number, number, number, number][],
  },
};
export type UmzugLayoutId = keyof typeof UMZUG_LAYOUTS;

export const umzugRows = (layout: UmzugLayoutId) => UMZUG_LAYOUTS[layout].grid.length;
export const umzugCols = (layout: UmzugLayoutId) => UMZUG_LAYOUTS[layout].grid[0].length;

/** Raster eines Hauses, Team Meer gespiegelt (Zeilen rückwärts) */
export function umzugGrid(layout: UmzugLayoutId, mirror: boolean): string[] {
  const g = UMZUG_LAYOUTS[layout].grid;
  return mirror ? g.map((row) => [...row].reverse().join('')) : g;
}

export interface UmzugGeo {
  x0: number;
  layout: UmzugLayoutId;
  mirror: boolean;
  grid: string[];
}

export const umzugTileCh = (g: UmzugGeo, c: number, r: number) => g.grid[r]?.[c] ?? '#';
export const umzugIsWall = (ch: string) => ch === '#' || ch === 'W' || ch === 't' || ch === 'h';
export const umzugTileOf = (g: { x0: number }, x: number, y: number) => ({ c: Math.floor((x - g.x0) / UMZUG.TILE), r: Math.floor((y - UMZUG.Y0) / UMZUG.TILE) });
export const umzugCenter = (g: { x0: number }, c: number, r: number) => ({ x: g.x0 + (c + 0.5) * UMZUG.TILE, y: UMZUG.Y0 + (r + 0.5) * UMZUG.TILE });
/** Möbelposition eines Grundriss-Eintrags in Welt-Pixeln (Spiegelung beachtet) */
export function umzugItemPos(g: UmzugGeo, c: number, r: number) {
  const cc = g.mirror ? umzugCols(g.layout) - c : c;
  return { x: g.x0 + cc * UMZUG.TILE, y: UMZUG.Y0 + r * UMZUG.TILE };
}

/** Ladefläche (Welt-Rechteck) */
export function umzugTruckZone(g: UmzugGeo) {
  let minC = Infinity;
  let maxC = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  g.grid.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch !== 'T') return;
      minC = Math.min(minC, c);
      maxC = Math.max(maxC, c);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }),
  );
  return { x: g.x0 + minC * UMZUG.TILE, y: UMZUG.Y0 + minR * UMZUG.TILE, w: (maxC - minC + 1) * UMZUG.TILE, h: (maxR - minR + 1) * UMZUG.TILE };
}

export const inRect = (x: number, y: number, z: { x: number; y: number; w: number; h: number }) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h;

/** Begehbar (für Spieler und Bots)? Zerbrochene Fenster werden begehbar. */
export function umzugWalkable(g: UmzugGeo, c: number, r: number, broken?: Set<string>) {
  const ch = umzugTileCh(g, c, r);
  if (ch === 'W') return !!broken?.has(`${c},${r}`);
  return !umzugIsWall(ch);
}

/**
 * Breitensuche auf dem Kachelraster: nächster Schritt von `from` zu einem der Ziele.
 * Nur gerade Schritte (keine Diagonalen durch Türpfosten).
 */
export function umzugNextTile(g: UmzugGeo, from: { c: number; r: number }, goal: (c: number, r: number) => boolean, broken?: Set<string>): { c: number; r: number } | null {
  const cols = umzugCols(g.layout);
  const rows = umzugRows(g.layout);
  if (goal(from.c, from.r)) return from;
  const prev = new Int32Array(cols * rows).fill(-1);
  const idx = (c: number, r: number) => r * cols + c;
  const queue = [from];
  prev[idx(from.c, from.r)] = idx(from.c, from.r);
  let found: { c: number; r: number } | null = null;
  while (queue.length && !found) {
    const cur = queue.shift()!;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const c = cur.c + dc;
      const r = cur.r + dr;
      if (c < 0 || r < 0 || c >= cols || r >= rows || prev[idx(c, r)] >= 0 || !umzugWalkable(g, c, r, broken)) continue;
      prev[idx(c, r)] = idx(cur.c, cur.r);
      if (goal(c, r)) {
        found = { c, r };
        break;
      }
      queue.push({ c, r });
    }
  }
  if (!found) return null;
  let cur = found;
  for (;;) {
    const p = prev[idx(cur.c, cur.r)];
    const pc = p % cols;
    const pr = Math.floor(p / cols);
    if (pc === from.c && pr === from.r) return cur;
    cur = { c: pc, r: pr };
  }
}

/** Sichtlinie frei von Wänden (für Würfe durch Türen/Fenster)? Fenster zählen als frei. */
export function umzugLineFree(g: UmzugGeo, x0: number, y0: number, x1: number, y1: number) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const { c, r } = umzugTileOf(g, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    const ch = umzugTileCh(g, c, r);
    if (ch === 'W') continue;
    if (umzugIsWall(ch)) return false;
  }
  return true;
}

// ------------------------------------------------------------------ Zustand

export interface UmzugHouse {
  team: Team | null;
  layout: UmzugLayoutId;
  mirror: boolean;
  x0: number;
  score: number;
  /** Maximal mögliche Punkte (alle Möbel) */
  max: number;
  /** Zeitbonus (wenn alles draußen war) */
  bonus: number;
  /** Abgelieferte Möbel (Art-Index, in Reihenfolge) – füllt den Laster */
  delivered: number[];
  /** Noch im Haus (abzuliefernde) Teile */
  left: number;
  broken: number;
  /** Zerbrochene Fenster „c,r“ */
  glass: string[];
  /** Zeitpunkt (Restzeit ms), zu dem alles draußen war */
  doneAt: number;
}

export interface UmzugPlayer {
  x: number;
  y: number;
  /** Haus-Index */
  k: number;
  fx: number;
  fy: number;
  /** läuft */
  m: boolean;
  /** Farbe (Shirt bzw. Team) */
  c: number;
  /** Getragenes/gegriffenes Teil (Item-ID) */
  g: number | null;
  /** Sprint-Abklingzeit (ms) */
  cd: number;
  /** sprintet gerade */
  d: boolean;
  /** Fehlversuch-Zähler (nichts greifbar) */
  no: number;
  /** Statistik: leicht getragen, schwer geschleppt, geworfen, zerbrochen, Fenster */
  st: [number, number, number, number, number];
  /** Beitrag (gewichtete Lieferungen) */
  pts: number;
}

export interface UmzugItem {
  id: number;
  /** Art (Index in UMZUG_KINDS) */
  k: number;
  x: number;
  y: number;
  /** Winkel in Grad */
  a: number;
  /** 0 am Boden, 1 getragen (leicht, über dem Kopf), 2 fliegt */
  s: 0 | 1 | 2;
  /** Flughöhe 0–1 */
  z?: number;
  /** Träger (bei schweren Teilen bis zu zwei: Index = Griffende) */
  by: (string | null)[];
  /** Haus-Index */
  h: number;
}

export interface UmzugEvent {
  seq: number;
  kind: 'deliver' | 'break' | 'glass' | 'bonus' | 'throw' | 'bonk';
  x: number;
  y: number;
  pts?: number;
  /** Art des Teils */
  k?: number;
  who?: string;
}

export interface UmzugState {
  sub: 'countdown' | 'play' | 'over';
  endsIn: number;
  teams: boolean;
  houses: UmzugHouse[];
  players: Record<string, UmzugPlayer>;
  items: UmzugItem[];
  events: UmzugEvent[];
  /** Sterne (ohne Teams) bzw. Gewinner (mit Teams) – erst am Ende gesetzt */
  stars: number;
  winner: Team | null;
}

/** Sterne für einen Punktestand */
export function umzugStars(score: number, max: number) {
  if (max <= 0) return 0;
  const f = score / max;
  return UMZUG.STARS.filter((s) => f >= s - 1e-9).length;
}

/** Punkte, ab denen es den jeweiligen Stern gibt */
export const umzugGoals = (max: number) => UMZUG.STARS.map((s) => Math.ceil(max * s)) as [number, number, number];

/** Kurzname fürs Handy („Du trägst: Karton“) */
export const umzugName = (k: number) => UMZUG_KINDS[k]?.name ?? '?';
