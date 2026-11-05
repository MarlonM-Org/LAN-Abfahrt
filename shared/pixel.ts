/**
 * Pixel-Galerie: Zeiten, Raster, Palette, Themen und die kompakte Bild-Kodierung.
 *
 * Ein Bild ist ein String mit SIZE × SIZE Zeichen (Zeile für Zeile):
 * '.' = leer (Leinwand), '0' … 'b' = Farbindex in PIXEL_COLORS. 16 × 16 → 256 Bytes.
 */
export const PIXEL = {
  ROUNDS: 3,
  /** Kantenlänge des Rasters */
  SIZE: 16,
  INTRO_MS: 5000,
  PAINT_MS: 75000,
  VOTE_MS: 25000,
  /** Ab 9 Bildern etwas mehr Zeit zum Anschauen */
  VOTE_MS_MANY: 32000,
  REVEAL_MS: 11000,
  SCORES_MS: 7000,
  /** Weniger bemalte Felder → Bild kommt nicht in die Ausstellung */
  MIN_FILLED: 1,
};

export const PIXEL_CELLS = PIXEL.SIZE * PIXEL.SIZE;

/** 12 Farben: Kontur, Weiß, Rot, Orange, Gelb, Grün, Blau, Hellblau, Lila, Rosa, Braun, Haut */
export const PIXEL_COLORS = ['#2d1b12', '#ffffff', '#e04a3f', '#f0973a', '#f7d23a', '#46b04a', '#3f6fd8', '#93d3f3', '#9b5fc0', '#f07aa8', '#a8693f', '#f9d0a8'];
export const PIXEL_NAMES = ['Schwarz', 'Weiß', 'Rot', 'Orange', 'Gelb', 'Grün', 'Blau', 'Hellblau', 'Lila', 'Rosa', 'Braun', 'Haut'];
/** Leinwand (leere Felder) */
export const PIXEL_CANVAS = '#efe0bf';
export const PIXEL_CANVAS_ALT = '#e6d4ad';

const CODES = '0123456789ab';
export const PIXEL_EMPTY = '.';
export const emptyPic = () => PIXEL_EMPTY.repeat(PIXEL_CELLS);

/** Zeichen → Farbindex (−1 = leer) */
export const pixCode = (ch: string) => CODES.indexOf(ch);
/** Farbindex → Zeichen (−1 → leer) */
export const pixChar = (c: number) => (c >= 0 && c < PIXEL_COLORS.length ? CODES[c] : PIXEL_EMPTY);

/** Eingehendes Bild prüfen: falsche Länge oder fremde Zeichen → null */
export function cleanPic(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length !== PIXEL_CELLS) return null;
  return /^[.0-9ab]+$/.test(raw) ? raw : null;
}

/** Anzahl bemalter Felder */
export function filledCount(pic: string | null | undefined): number {
  if (!pic) return 0;
  let n = 0;
  for (let i = 0; i < pic.length; i++) if (pic[i] !== PIXEL_EMPTY) n++;
  return n;
}

/**
 * Bild pixelgenau auf ein Canvas malen (Handy und TV). `cell` = Größe eines Feldes in Canvas-Pixeln.
 * `checker`: leere Felder als Schachbrett (Handy, damit man sieht, was noch frei ist).
 */
export function paintPic(g: CanvasRenderingContext2D, pic: string | null | undefined, cell: number, checker = false, ox = 0, oy = 0) {
  const n = PIXEL.SIZE;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = pic ? pixCode(pic[y * n + x]) : -1;
      g.fillStyle = c >= 0 ? PIXEL_COLORS[c] : checker && (x + y) % 2 ? PIXEL_CANVAS_ALT : PIXEL_CANVAS;
      g.fillRect(ox + x * cell, oy + y * cell, cell, cell);
    }
  }
}

/** Füllt die zusammenhängende Fläche gleicher Farbe ab (x, y) mit `c` (4er-Nachbarschaft) */
export function floodFill(cells: number[], x: number, y: number, c: number): boolean {
  const n = PIXEL.SIZE;
  const from = cells[y * n + x];
  if (from === c) return false;
  const stack = [y * n + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (cells[i] !== from) continue;
    cells[i] = c;
    const cx = i % n;
    const cy = (i - cx) / n;
    if (cx > 0) stack.push(i - 1);
    if (cx < n - 1) stack.push(i + 1);
    if (cy > 0) stack.push(i - n);
    if (cy < n - 1) stack.push(i + n);
  }
  return true;
}

export const cellsToPic = (cells: number[]) => cells.map(pixChar).join('');
export const picToCells = (pic: string | null | undefined) => Array.from({ length: PIXEL_CELLS }, (_, i) => (pic ? pixCode(pic[i] ?? '.') : -1));

/** Themen – lustig, aber auf 16 × 16 Pixeln noch machbar */
export const PIXEL_PROMPTS = [
  'Ein Flamingo im Liegestuhl',
  'Oma beim Kart fahren',
  'Eine Möwe klaut eine Pommes',
  'Ein Hai mit Sonnenbrille',
  'Der Grill brennt',
  'Ein Kaktus im Urlaub',
  'Eine Ananas mit Sonnenbrand',
  'Ein Eis, das schmilzt',
  'Ein Krebs im Schwimmring',
  'Papa in Badehose',
  'Ein Cocktail mit Schirmchen',
  'Ein Pinguin am Strand',
  'Die Katze auf der Luftmatratze',
  'Ein Geist im Ferienhaus',
  'Eine Palme im Schnee',
  'Ein Bier mit Gesicht',
  'Ein Koffer, der platzt',
  'Ein Delfin mit Krone',
  'Der Mond macht Urlaub',
  'Eine Sonne mit Kater',
  'Ein Frosch mit Schnorchel',
  'Eine Pizza mit Flügeln',
  'Ein Roboter beim Grillen',
  'Ein Huhn auf dem Surfbrett',
  'Ein Schneemann in der Sauna',
  'Ein Dino im Planschbecken',
  'Eine Banane mit Schnurrbart',
  'Ein Pilz mit Sonnenhut',
  'Eine Qualle beim Tanzen',
  'Ein Kamel mit Rucksack',
  'Die Sandburg vom Bademeister',
  'Ein Wal im Whirlpool',
  'Ein Alien am Flughafen',
  'Eine Erdbeere beim Joggen',
  'Ein Elefant auf dem SUP',
  'Ein Taco mit Taucherbrille',
  'Ein Leuchtturm bei Nacht',
  'Ein Schaf im Bikini',
  'Eine Schildkröte mit Turbo',
  'Ein Würstchen auf der Rutsche',
];
