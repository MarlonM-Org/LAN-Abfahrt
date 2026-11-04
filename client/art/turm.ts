import { C } from './palette';
import { Pix, shade } from './pix';
import { TURM_SHAPES } from '../../shared/games';

/** Grundfarben je Form und Farbvariante (0–2) */
const BASE: string[][] = [
  ['#2fb5a5', '#f0973a', '#f07aa8'], // Surfbrett
  ['#3f8fe0', '#e04a3f', '#46b04a'], // Kühlbox
  ['#f2c33a', '#e04a3f', '#3f8fe0'], // Liegestuhl (Stoff)
  ['#a5602a', '#b9493a', '#5f6bd6'], // Koffer
  ['#9b5fc0', '#2fb5a5', '#f2c33a'], // Reisetasche
  ['#b8783f', '#c99a5e', '#a97a43'], // Cocktailkiste (Holz)
  ['#b8783f', '#c99a5e', '#a97a43'], // Sangriakiste (Holz)
];

export const turmColor = (shape: number, v: number) => BASE[shape][v % 3];

/**
 * Ein Urlaubs-Teil als Pixel-Art. `cell` = Pixel pro Block (klein auf dem TV bei vielen Spielern).
 * Die Kontur liegt innerhalb der Form, damit Bild und Physik-Körper genau übereinstimmen.
 */
export function turmPiece(shape: number, v: number, cell: number): Pix {
  const cells = TURM_SHAPES[shape].cells;
  const cols = Math.max(...cells.map(([c]) => c)) + 1;
  const rows = Math.max(...cells.map(([, r]) => r)) + 1;
  const W = cols * cell;
  const H = rows * cell;
  const p = new Pix(W, H);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && cells.some(([c, r]) => c === Math.floor(x / cell) && r === Math.floor(y / cell));
  const base = turmColor(shape, v);
  const light = shade(base, 1.35);
  const dark = shade(base, 0.7);
  for (const [c, r] of cells) p.rect(c * cell, r * cell, cell, cell, base);
  const big = cell >= 7;
  const u = Math.max(1, Math.round(cell / 8));

  p.overlayOn(() => {
    switch (shape) {
      case 0: {
        // Surfbrett: Mittelstreifen + Spitze
        p.rect(0, Math.floor(H / 2) - u, W, u * 2, C.white);
        if (big) p.rect(Math.floor(W * 0.15), Math.floor(H / 2) - u, u * 2, u * 2, shade(base, 0.6));
        p.rect(W - cell, 0, cell, H, light);
        break;
      }
      case 1: {
        // Kühlbox: weißer Deckel, Griff, Etikett
        p.rect(0, 0, W, Math.ceil(H * 0.3), C.white);
        p.rect(0, Math.ceil(H * 0.3), W, u, dark);
        if (big) {
          p.rect(Math.floor(W / 2) - cell / 2, u * 2, cell, u * 2, '#9aa3ad');
          p.rect(Math.floor(W * 0.2), Math.floor(H * 0.55), Math.floor(W * 0.6), Math.max(2, u * 3), C.white);
        }
        break;
      }
      case 2: {
        // Liegestuhl: gestreifter Stoff, Holzbeine
        for (let x = 0; x < W; x += Math.max(2, u * 3)) p.rect(x, 0, Math.max(1, Math.round(u * 1.5)), cell, C.white);
        p.rect(0, cell - u, W, u, C.woodDark);
        p.rect(cell, cell, cell, cell, C.wood);
        if (big) p.rect(cell + Math.floor(cell / 2) - u, cell, u * 2, cell, C.woodDark);
        break;
      }
      case 3: {
        // Koffer: Gurt, Griff, Rollen
        p.rect(0, Math.floor(H * 0.45), W, u * 2, C.woodDarker);
        p.rect(Math.floor(cell / 2) - u, 0, u * 2, H, shade(base, 0.8));
        if (big) {
          p.rect(Math.floor(cell * 0.3), u, Math.floor(cell * 0.4), u * 2, C.outline);
          p.disc(Math.floor(cell * 1.5), H - u * 2, u * 1.5, C.outline);
          p.rect(cell + u * 2, Math.floor(cell * 2.3), u * 2, u * 2, C.gold);
        }
        break;
      }
      case 4: {
        // Reisetasche: Reißverschluss, Seitentasche
        p.rect(cell + Math.floor(cell / 2) - u, 0, u, H, C.gold);
        p.rect(0, 2 * cell + Math.floor(cell / 3), cell, Math.max(1, u), dark);
        if (big) for (let y = u * 2; y < H; y += u * 3) p.rect(cell + Math.floor(cell / 2) - u * 2, y, u * 3, u, shade(C.gold, 0.7));
        break;
      }
      default: {
        // Cocktailkisten: Holzlatten + Flaschen/Gläser
        for (let y = 0; y < H; y += Math.max(2, Math.floor(cell / 2))) p.rect(0, y, W, u, dark);
        const drink = shape === 5 ? ['#7fd47f', '#ffd25e'] : ['#c0392b', '#f07aa8'];
        for (const [c, r] of cells) {
          const x = c * cell;
          const y = r * cell;
          if (big) {
            p.rect(x + u * 2, y + u * 2, u * 2, cell - u * 4, drink[0]);
            p.rect(x + cell - u * 4, y + u * 3, u * 2, cell - u * 5, drink[1]);
            p.rect(x + u * 2, y + u, u * 2, u, '#e8e8e8');
          } else p.rect(x + Math.floor(cell / 3), y + Math.floor(cell / 3), Math.max(1, Math.ceil(cell / 3)), Math.max(1, Math.ceil(cell / 3)), drink[0]);
        }
      }
    }
    // Lichtkante oben/links
    if (big) for (const [c, r] of cells) {
      if (!inside(c * cell, r * cell - 1)) p.rect(c * cell, r * cell, cell, u, shade(base === C.white ? '#dddddd' : light, 1.1));
    }
  });

  // Innenkontur
  const img = p.g.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) {
        const i = (y * W + x) * 4;
        img.data[i] = 0x2d;
        img.data[i + 1] = 0x1b;
        img.data[i + 2] = 0x12;
        img.data[i + 3] = 255;
      }
    }
  }
  p.g.putImageData(img, 0, 0);
  return p;
}

/** Gipfelkreuz mit Fähnchen (Ursprung: Fuß unten Mitte) */
export function summitCross(): Pix {
  const p = new Pix(15, 20);
  p.rect(6, 2, 3, 18, C.woodDark).rect(2, 6, 11, 3, C.woodDark);
  p.overlayOn(() => p.vline(6, 2, 18, C.woodLight).hline(2, 6, 11, C.woodLight));
  p.outline(C.outline);
  const out = new Pix(22, 21);
  out.draw(p, 0, 0);
  out.map(9, 1, ['rrrrrr', 'rWWrr.', 'rrrr..'], { r: C.red, W: C.white });
  return out;
}

/** Kleine Windböen-Schliere */
export function gustStreak(): Pix {
  const p = new Pix(18, 7);
  p.hline(0, 3, 12, 'rgba(255,255,255,0.9)').hline(12, 2, 3, 'rgba(255,255,255,0.9)').px(15, 1, 'rgba(255,255,255,0.9)').px(16, 2, 'rgba(255,255,255,0.8)');
  p.hline(4, 6, 8, 'rgba(255,255,255,0.6)');
  return p;
}
