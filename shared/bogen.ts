/**
 * Bogen-Arena: gemeinsame Konstanten und Geometrie (Server, TV, Handy, Bots).
 * Die Arena ist ein Kachel-Raster (48 × 25 Kacheln à 10 px) unter der HUD-Leiste
 * (Arena-Koordinaten 0…480 × 0…250, auf dem TV um AY nach unten verschoben).
 * Links/rechts und oben/unten geht es durch die Lücken in den Wänden auf die
 * andere Seite – wie bei TowerFall.
 *
 * Kacheln: '#' fest (Dach, Mauer), '=' Plattform (von unten durchspringbar,
 * mit ▼ durchfallen), '.' frei.
 */

export const BOGEN = {
  TICK_MS: 50,
  SUBSTEPS: 4,
  COLS: 48,
  ROWS: 25,
  TILE: 10,
  /** Arena-Versatz auf dem TV (darüber liegt die HUD-Leiste) */
  AY: 20,
  AW: 480,
  AH: 250,

  /** Hitbox (Ursprung = Füße, Mitte) */
  W: 10,
  H: 22,

  GRAVITY: 950,
  MAX_FALL: 330,
  /** Langsamer rutschen, wenn man sich an eine Wand drückt */
  WALL_SLIDE: 90,
  RUN: 108,
  GROUND_ACCEL: 1300,
  AIR_ACCEL: 800,
  JUMP_V: 365,
  WALL_JUMP_VX: 150,
  /** Nach dem Loslassen von SPRUNG wird der Sprung abgeschnitten (kleine Hüpfer) */
  JUMP_CUT: 0.45,
  COYOTE_MS: 90,
  JUMP_BUFFER_MS: 130,

  DASH_V: 300,
  DASH_MS: 190,
  DASH_CD_MS: 1100,

  ARROW_V: 390,
  ARROW_G: 240,
  /** Fliegt ein Pfeil länger (z. B. endlos durch die Wand-Lücken), fällt er herunter */
  ARROW_FLY_MS: 2600,
  LOOSE_G: 700,
  START_ARROWS: 3,
  MAX_ARROWS: 6,
  SHOT_CD_MS: 280,
  /** Eigene Pfeile treffen einen erst nach dieser Zeit */
  OWN_SAFE_MS: 140,

  STOMP_BOUNCE: 300,
  BOMB_R: 30,
  SHIELD_INV_MS: 900,
  /** Bombenpfeile pro Truhe */
  CHEST_BOMBS: 2,
  /** Doppelpfeil-Schüsse pro Truhe */
  CHEST_DOUBLE: 3,

  COUNTDOWN_MS: 3000,
  ROUND_MS: 50_000,
  ROUND_OVER_MS: 3400,
  /** Kurz warten, bevor die Runde ausgewertet wird (gleichzeitige Treffer = Unentschieden) */
  END_DELAY_MS: 700,
  WIN_ROUNDS: 3,
  MAX_ROUNDS: 6,
  CHEST_MIN_MS: 5000,
  CHEST_MAX_MS: 11000,
};

/** Die acht Schussrichtungen (0 = rechts, im Uhrzeigersinn, y nach unten) */
export const BOGEN_DIRS: { x: number; y: number }[] = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { x: r(Math.cos(a)), y: r(Math.sin(a)) };
});

/** Joystick → Richtung 0–7 (8 Richtungen eingerastet), −1 = Stick in Ruhe */
export function bogenSnap(x: number, y: number): number {
  if (Math.hypot(x, y) < 0.35) return -1;
  const i = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  return ((i % 8) + 8) % 8;
}

export type BogenPower = 'doppel' | 'schild' | 'bombe';

export const BOGEN_POWERS: Record<BogenPower, { name: string; text: string }> = {
  doppel: { name: 'Doppelpfeil', text: 'Die nächsten 3 Schüsse fliegen doppelt!' },
  schild: { name: 'Schwimmring-Schild', text: 'Hält einen Treffer aus.' },
  bombe: { name: 'Wasserbomben-Pfeil', text: 'Die nächsten 2 Pfeile machen PLATSCH – Abstand halten!' },
};

// ------------------------------------------------------------------ Arenen

type Rect = [col: number, row: number, w: number, h: number, ch: '#' | '='];

export interface BogenStage {
  id: 'dach' | 'pool';
  name: string;
  /** COLS × ROWS Zeichen */
  tiles: string;
  /** Startpunkte (Füße), mindestens 8 */
  spawns: { x: number; y: number }[];
  /** Hier kann die Schatztruhe auftauchen (Füße) */
  chests: { x: number; y: number }[];
}

function build(rects: Rect[]): string {
  const g = Array.from({ length: BOGEN.ROWS }, () => Array<string>(BOGEN.COLS).fill('.'));
  for (const [c0, r0, w, h, ch] of rects) {
    for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) g[r][c] = ch;
  }
  return g.map((row) => row.join('')).join('');
}

/** Punkt auf einer Oberfläche: Spalte (Mitte) + Reihe der Kachel, auf der man steht */
const on = (col: number, row: number) => ({ x: col * BOGEN.TILE + BOGEN.TILE / 2, y: row * BOGEN.TILE });

export const BOGEN_STAGES: BogenStage[] = [
  {
    id: 'dach',
    name: 'Dachterrasse',
    tiles: build([
      // Dachkante oben + Boden, je mit Lücke in der Mitte (oben ↔ unten)
      [0, 0, 20, 1, '#'], [28, 0, 20, 1, '#'],
      [0, 24, 20, 1, '#'], [28, 24, 20, 1, '#'],
      // Mauern mit Durchgang in der Mitte (links ↔ rechts)
      [0, 0, 2, 9, '#'], [46, 0, 2, 9, '#'],
      [0, 14, 2, 11, '#'], [46, 14, 2, 11, '#'],
      // Mauer-Absätze unter den Durchgängen
      [0, 14, 9, 1, '#'], [39, 14, 9, 1, '#'],
      // Palmen-Plattformen oben
      [6, 6, 7, 1, '='], [35, 6, 7, 1, '='],
      // Schornstein in der Mitte
      [21, 5, 6, 2, '#'],
      // Mittlere Dachgauben
      [13, 11, 6, 1, '#'], [29, 11, 6, 1, '#'],
      // Sonnensegel in der Mitte
      [20, 16, 8, 1, '='],
      // Untere Planken
      [8, 19, 7, 1, '='], [33, 19, 7, 1, '='],
      // Blumenkübel am Boden
      [2, 22, 3, 2, '#'], [43, 22, 3, 2, '#'],
      // kleine Absätze an den Bodenlücken
      [17, 21, 3, 3, '#'], [28, 21, 3, 3, '#'],
    ]),
    spawns: [on(6, 24), on(41, 24), on(9, 6), on(38, 6), on(15, 11), on(32, 11), on(24, 16), on(24, 5)],
    chests: [on(24, 5), on(24, 16), on(5, 14), on(42, 14), on(11, 19), on(36, 19)],
  },
  {
    id: 'pool',
    name: 'Pool-Villa',
    tiles: build([
      // Dach oben und Boden: Lücken an beiden Seiten (oben ↔ unten)
      [8, 0, 32, 1, '#'],
      [8, 24, 32, 1, '#'],
      [0, 0, 2, 3, '#'], [46, 0, 2, 3, '#'],
      [0, 20, 2, 5, '#'], [46, 20, 2, 5, '#'],
      // Durchgang links ↔ rechts zwischen den Mauerstücken
      [0, 3, 2, 6, '#'], [46, 3, 2, 6, '#'],
      [0, 15, 2, 5, '#'], [46, 15, 2, 5, '#'],
      // Absätze unter den Durchgängen (fangen auch alles auf, was durch die Dach-Lücken fällt)
      [0, 15, 8, 1, '#'], [40, 15, 8, 1, '#'],
      // Poolhaus in der Mitte
      [17, 18, 14, 2, '#'],
      [19, 20, 10, 4, '#'],
      // Sprungbretter
      [9, 12, 7, 1, '='], [32, 12, 7, 1, '='],
      // Dachterrasse oben
      [20, 9, 8, 1, '#'],
      [12, 5, 6, 1, '='], [30, 5, 6, 1, '='],
      // Liegestühle unten
      [9, 21, 5, 1, '='], [34, 21, 5, 1, '='],
      // Planken über den Durchgängen
      [3, 8, 5, 1, '='], [40, 8, 5, 1, '='],
    ]),
    spawns: [on(11, 24), on(36, 24), on(12, 12), on(35, 12), on(24, 9), on(24, 18), on(15, 5), on(33, 5)],
    chests: [on(24, 9), on(24, 18), on(4, 15), on(43, 15), on(11, 21), on(36, 21)],
  },
];

// ------------------------------------------------------------------ Kachel-Abfragen (mit Wrap)

export const bogenWrapX = (x: number) => ((x % BOGEN.AW) + BOGEN.AW) % BOGEN.AW;
export const bogenWrapY = (y: number) => ((y % BOGEN.AH) + BOGEN.AH) % BOGEN.AH;
/** Kürzester Abstand a → b über die Ränder hinweg */
export const bogenDx = (from: number, to: number) => bogenWrapX(to - from + BOGEN.AW / 2) - BOGEN.AW / 2;
export const bogenDy = (from: number, to: number) => bogenWrapY(to - from + BOGEN.AH / 2) - BOGEN.AH / 2;

export function bogenTile(tiles: string, col: number, row: number): string {
  const c = ((col % BOGEN.COLS) + BOGEN.COLS) % BOGEN.COLS;
  const r = ((row % BOGEN.ROWS) + BOGEN.ROWS) % BOGEN.ROWS;
  return tiles[r * BOGEN.COLS + c];
}

/** Kachel an einem Punkt (Arena-Koordinaten, beliebig außerhalb → Wrap) */
export const bogenTileAt = (tiles: string, x: number, y: number) => bogenTile(tiles, Math.floor(x / BOGEN.TILE), Math.floor(y / BOGEN.TILE));
export const bogenSolidAt = (tiles: string, x: number, y: number) => bogenTileAt(tiles, x, y) === '#';

/** Ist das Rechteck (x0…x1, y0…y1) irgendwo fest? */
export function bogenRectSolid(tiles: string, x0: number, y0: number, x1: number, y1: number): boolean {
  const T = BOGEN.TILE;
  const c0 = Math.floor(x0 / T);
  const c1 = Math.floor((x1 - 0.001) / T);
  const r0 = Math.floor(y0 / T);
  const r1 = Math.floor((y1 - 0.001) / T);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (bogenTile(tiles, c, r) === '#') return true;
  return false;
}

/** Freie Sichtlinie (für Bots): tastet die Strecke in 5-px-Schritten ab */
export function bogenLineFree(tiles: string, x0: number, y0: number, dx: number, dy: number): boolean {
  const n = Math.ceil(Math.hypot(dx, dy) / 5);
  for (let i = 1; i < n; i++) if (bogenSolidAt(tiles, x0 + (dx * i) / n, y0 + (dy * i) / n)) return false;
  return true;
}
