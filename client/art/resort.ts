import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintGrass, paintSand, paintWater, paintWoodFloor } from './ground';
import { palm } from './objects';
import { FANGEN, FANGEN_MAZE, tileAt } from '../../shared/fangen';

const T = FANGEN.TILE;
const HUT_COLORS = [C.red, C.blue, '#2fb5a5', C.orange, C.pink, C.purple];

/** Ganze Ferienanlage (480 × 270) als ein Hintergrundbild – für TV und Handy-Karte */
export function paintResort(w = 480, h = 270): Pix {
  const p = new Pix(w, h);
  const OY = FANGEN.OY;
  const mazeH = FANGEN.ROWS * T;

  // Bodenschichten einmal komplett malen, dann kachelweise übernehmen (keine Nähte)
  const layer = (paint: (l: Pix) => void) => {
    const l = new Pix(w, h);
    paint(l);
    return l;
  };
  const grass = layer((l) => paintGrass(l, 0, OY, w, mazeH, 901, true));
  const sand = layer((l) => paintSand(l, 0, OY, w, mazeH, 902));
  const deck = layer((l) => paintWoodFloor(l, 0, OY, w, mazeH, 903, '#c48a4f'));
  const water = layer((l) => paintWater(l, 0, OY, w, mazeH, 904));
  const copy = (src: Pix, col: number, row: number) => p.g.drawImage(src.canvas, col * T, OY + row * T, T, T, col * T, OY + row * T, T, T);

  p.rect(0, 0, w, h, C.leafDarker);
  FANGEN_MAZE.forEach((line, row) =>
    [...line].forEach((ch, col) => {
      if (ch === ':' || ch === 'h' || ch === 'p') copy(sand, col, row);
      else if (ch === '=') copy(deck, col, row);
      else if (ch === '~') copy(water, col, row);
      else copy(grass, col, row);
    }),
  );

  // Pool: Fliesenkante + Schaum
  FANGEN_MAZE.forEach((line, row) =>
    [...line].forEach((ch, col) => {
      if (ch !== '~') return;
      const x = col * T;
      const y = OY + row * T;
      if (tileAt(col, row - 1) !== '~') p.rect(x, y, T, 3, '#e9f1f2').hline(x, y + 3, T, C.foam);
      if (tileAt(col, row + 1) !== '~') p.rect(x, y + T - 2, T, 2, '#d4e3e6');
      if (tileAt(col - 1, row) !== '~') p.rect(x, y, 3, T, '#e9f1f2').vline(x + 3, y, T, C.foam);
      if (tileAt(col + 1, row) !== '~') p.rect(x + T - 2, y, 2, T, '#d4e3e6');
    }),
  );
  // Leiter + Schwimmring im Pool
  const pool = findTiles('~');
  if (pool.length) {
    const left = Math.min(...pool.map((t) => t.col));
    const top = Math.min(...pool.map((t) => t.row));
    const lx = left * T + 6;
    const ly = OY + top * T;
    p.vline(lx, ly, 10, C.stoneLight).vline(lx + 5, ly, 10, C.stoneLight);
    for (let y = ly + 3; y < ly + 10; y += 3) p.hline(lx, y, 6, C.stoneLight);
    const rx = (left + 3) * T;
    const ry = OY + (top + 1) * T + 8;
    p.disc(rx, ry, 6, C.red);
    p.disc(rx, ry, 3, C.water);
    for (const [dx, dy] of [[-5, 0], [5, 0], [0, -5], [0, 5]]) p.rect(rx + dx - 1, ry + dy - 1, 2, 2, C.white);
  }

  // Hecken: Oberseite hell, Vorderkante dunkel, Schatten auf dem Boden darunter
  const r = rng(905);
  FANGEN_MAZE.forEach((line, row) =>
    [...line].forEach((ch, col) => {
      if (ch !== '#') return;
      const x = col * T;
      const y = OY + row * T;
      const below = tileAt(col, row + 1) !== '#';
      p.rect(x, y, T, T, C.leaf);
      p.speckle(x, y, T, T, C.leafLight, 14, r);
      p.speckle(x, y, T, T, C.leafDark, 12, r);
      p.speckle(x, y, T, T, C.leafTip, 4, r);
      if (below) {
        p.rect(x, y + T - 5, T, 5, C.leafDark);
        p.speckle(x, y + T - 5, T, 4, C.leafDarker, 6, r);
        p.hline(x, y + T - 1, T, C.outline);
        if (row + 1 < FANGEN.ROWS) p.rect(x, y + T, T, 3, 'rgba(0,0,0,0.18)');
      }
      if (tileAt(col, row - 1) !== '#') p.hline(x, y, T, C.outline).hline(x, y + 1, T, C.leafTip);
      if (tileAt(col - 1, row) !== '#') p.vline(x, y, T, C.outline);
      if (tileAt(col + 1, row) !== '#') p.vline(x + T - 1, y, T, C.outline);
    }),
  );

  // Ein paar Handtücher und Muscheln auf dem Sand (flach = begehbar)
  const towels: [number, number, string][] = [
    [3, 5, C.red],
    [5, 11, C.blue],
    [2, 8, '#2fb5a5'],
  ];
  for (const [col, row, c] of towels) {
    const x = col * T + 3;
    const y = OY + row * T + 3;
    p.rect(x, y, 10, 10, c);
    for (let j = y + 2; j < y + 10; j += 4) p.hline(x, j, 10, C.white);
    p.hline(x, y, 10, shade(c, 1.2));
  }
  // Blumenbeete am Holzdeck der Rezeption
  for (const t of findTiles('=')) {
    if (t.col < 12 || t.col > 20 || t.row < 9) continue;
    const x = t.col * T;
    const y = OY + t.row * T;
    if (tileAt(t.col, t.row - 1) === '#') for (let i = 2; i < T; i += 4) p.px(x + i, y + 1, i % 8 ? '#f6a7c9' : '#ffe36b');
  }

  // Strandhütten
  findTiles('h').forEach((t, i) => p.draw(beachHut(HUT_COLORS[i % HUT_COLORS.length]), t.col * T - 1, OY + t.row * T - 10));
  // Palmen (Stamm auf der Kachel, Krone ragt drüber)
  findTiles('p').forEach((t, i) => p.draw(palm(20 + i), t.col * T + T / 2 - 24, OY + t.row * T + T - 62));

  // HUD-Leiste oben
  p.rect(0, 0, w, OY, C.woodDarker);
  p.hline(0, OY - 1, w, C.outline);
  return p;
}

function findTiles(ch: string) {
  const out: { col: number; row: number }[] = [];
  FANGEN_MAZE.forEach((line, row) => [...line].forEach((c, col) => c === ch && out.push({ col, row })));
  return out;
}

/** Bunte Strandhütte (18 × 26), Unterkante = Kachelunterkante */
export function beachHut(color: string): Pix {
  const p = new Pix(18, 26);
  // Dach
  for (let y = 0; y < 8; y++) p.hline(8 - y, y + 1, 2 + y * 2, y % 2 ? shade(color, 0.7) : C.white);
  // Wände (gestreift)
  p.rect(2, 9, 14, 15, C.white);
  for (let x = 2; x < 16; x += 4) p.rect(x, 9, 2, 15, color);
  // Tür
  p.rect(7, 15, 4, 9, C.woodDark).px(10, 19, C.gold);
  p.hline(2, 9, 14, shade(color, 0.6));
  p.outline(C.outline);
  return p;
}

/** Großer Sonnenhut des Animateurs (20 × 9) */
export function animateurHat(): Pix {
  const p = new Pix(20, 9);
  p.ellipse(10, 6.5, 9, 2, '#f2d27a');
  p.rect(5, 1, 10, 5, '#f2d27a');
  p.rect(5, 4, 10, 2, C.red);
  p.hline(6, 1, 8, '#fbe7a6');
  p.px(13, 3, C.white).px(14, 2, C.white);
  p.outline(C.outline);
  return p;
}

/** Fußspur-Paar (13 × 11), zeigt nach rechts – helle Kontur, damit es auf Rasen und Sand auffällt */
export function footprints(): Pix {
  const p = new Pix(13, 11);
  const c = '#4a2a14';
  p.ellipse(4.5, 3, 3, 1.7, c).rect(8, 2, 2, 2, c);
  p.ellipse(6.5, 8, 3, 1.7, c).rect(10, 7, 2, 2, c);
  p.outline('#fff4d6');
  return p;
}
