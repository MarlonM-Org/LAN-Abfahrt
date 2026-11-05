import { C } from './palette';
import { Pix, shade } from './pix';
import { KOFFER, KOFFER_ITEMS } from '../../shared/koffer';

/** Grundfarben je Gepäckstück und Farbvariante (0–2) */
const BASE: string[][] = [
  ['#a5602a', '#b9493a', '#5f6bd6'], // Koffer
  ['#3f8fe0', '#e04a3f', '#46b04a'], // Kühlbox
  ['#2fb5a5', '#f0973a', '#f07aa8'], // Surfbrett
  ['#f2c33a', '#e86a5c', '#5bc0eb'], // Luftmatratze
  ['#e04a3f', '#2fb5a5', '#9b5fc0'], // Sonnenschirm (Stoff)
  ['#c98a3c', '#b5473a', '#3d3d48'], // Gitarre
  ['#d8b06a', '#c99a5e', '#b98a4e'], // Katzenkorb (Weide)
  ['#46b04a', '#f0973a', '#5f6bd6'], // Rucksack
  ['#e8e2d4', '#f07aa8', '#7f7b73'], // Schuhkarton
  ['#e04a3f', '#3f8fe0', '#f2c33a'], // Bobbycar
];

export const kofferColor = (item: number, v: number) => BASE[item][v % 3];

/**
 * Ein Gepäckstück als Pixel-Art. `cell` = Pixel pro Block. Kontur liegt innerhalb der Form,
 * damit Bild und Physik-Körper genau übereinstimmen.
 */
export function kofferPiece(item: number, v: number, cell: number): Pix {
  const cells = KOFFER_ITEMS[item].cells;
  const cols = Math.max(...cells.map(([c]) => c)) + 1;
  const rows = Math.max(...cells.map(([, r]) => r)) + 1;
  const W = cols * cell;
  const H = rows * cell;
  const p = new Pix(W, H);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && cells.some(([c, r]) => c === Math.floor(x / cell) && r === Math.floor(y / cell));
  const base = kofferColor(item, v);
  const light = shade(base, 1.3);
  const dark = shade(base, 0.7);
  for (const [c, r] of cells) p.rect(c * cell, r * cell, cell, cell, base);
  const big = cell >= 7;
  const u = Math.max(1, Math.round(cell / 8));
  const half = Math.floor(cell / 2);

  p.overlayOn(() => {
    switch (item) {
      case 0: {
        // Koffer: Rillen, Griff oben, Ecken
        for (let x = Math.floor(cell * 0.5); x < W - 2; x += Math.max(3, Math.floor(cell * 0.6))) p.rect(x, u * 2, u, H - u * 4, dark);
        p.rect(Math.floor(W / 2) - cell / 2, u, cell, u * 2, C.outline);
        if (big) for (const [x, y] of [[u, u], [W - u * 3, u], [u, H - u * 3], [W - u * 3, H - u * 3]]) p.rect(x, y, u * 2, u * 2, '#c8c8c8');
        break;
      }
      case 1: {
        // Kühlbox: weißer Deckel, Griff
        p.rect(0, 0, W, Math.ceil(H * 0.3), C.white);
        p.rect(0, Math.ceil(H * 0.3), W, u, dark);
        if (big) {
          p.rect(Math.floor(W / 2) - half, u * 2, cell, u * 2, '#9aa3ad');
          p.rect(Math.floor(W * 0.2), Math.floor(H * 0.55), Math.floor(W * 0.6), Math.max(2, u * 3), C.white);
        }
        break;
      }
      case 2: {
        // Surfbrett: Stringer, helle Spitze, Finne
        p.rect(0, half - u, W, u * 2, C.white);
        p.rect(W - cell, 0, cell, H, light);
        if (big) p.rect(Math.floor(cell * 0.5), half - u, u * 2, u * 2, shade(base, 0.55));
        break;
      }
      case 3: {
        // Luftmatratze: Luftkammern
        for (let x = Math.floor(cell * 0.7); x < W - 2; x += Math.max(3, Math.floor(cell * 0.7))) p.rect(x, u, u, H - u * 2, dark);
        p.rect(0, 0, cell, H, light);
        if (big) p.rect(W - u * 3, half - u, u * 2, u * 2, C.white);
        break;
      }
      case 4: {
        // Sonnenschirm: Fuß (oben links), Stange + zusammengeklappter Stoff
        p.rect(0, 0, cell, cell, C.stone);
        p.rect(0, cell, W, cell, C.woodLight);
        p.rect(0, cell + half - u, W, u * 2, C.woodDark);
        p.rect(Math.floor(cell * 1.3), cell + u, Math.floor(cell * 2.4), cell - u * 2, base);
        for (let x = Math.floor(cell * 1.6); x < Math.floor(cell * 3.6); x += Math.max(3, u * 4)) p.rect(x, cell + u, u, cell - u * 2, dark);
        if (big) p.rect(u * 2, u * 2, cell - u * 4, u * 2, C.stoneLight);
        break;
      }
      case 5: {
        // Gitarre: Hals oben links, Korpus rechts mit Schallloch
        p.rect(0, 0, 2 * cell, cell, C.woodDark);
        p.rect(0, half - u * 2, 2 * cell, u * 4, C.woodDarker);
        p.rect(0, 0, u * 3, cell, C.outline);
        p.disc(3 * cell, cell, Math.max(1, Math.floor(cell * 0.35)), C.outline);
        if (big) for (let k = 0; k < 3; k++) p.rect(0, half - u + k * u, 3 * cell, 1, '#e8e8e8');
        break;
      }
      case 6: {
        // Katzenkorb: Weidengeflecht, Gitter vorne, Katze schaut raus
        for (let y = cell + u; y < H; y += Math.max(2, u * 2)) p.rect(0, y, W, u, dark);
        p.rect(cell + u, u, cell - u * 2, cell - u, dark);
        p.rect(cell + u * 2, u * 2, cell - u * 4, cell - u * 3, base);
        const fx = Math.floor(cell * 0.25);
        p.rect(fx, cell + u * 2, cell * 2.5 - fx, cell - u * 4, '#3a2a1e');
        p.rect(Math.floor(cell * 0.9), cell + u * 3, Math.floor(cell * 0.9), cell - u * 5, '#f0973a');
        if (big) {
          p.px(Math.floor(cell * 1.1), cell + u * 4, '#2d1b12').px(Math.floor(cell * 1.5), cell + u * 4, '#2d1b12');
          for (let x = fx + u; x < cell * 2.6; x += u * 3) p.rect(x, cell + u * 2, u, cell - u * 4, '#9aa3ad');
        }
        break;
      }
      case 7: {
        // Rucksack: Klappe oben, Fronttasche, Riemen
        p.rect(0, 0, cell, Math.floor(cell * 0.7), dark);
        p.rect(u * 2, Math.floor(cell * 1.4), W - u * 4, Math.floor(cell * 1.2), light);
        p.rect(Math.floor(cell * 0.5) - u, 0, u * 2, H, shade(base, 0.55));
        if (big) p.rect(Math.floor(W / 2), Math.floor(cell * 1.9), u * 2, u * 2, C.gold);
        break;
      }
      case 8: {
        // Schuhkarton: Deckel + Etikett
        p.rect(0, 0, W, Math.max(2, Math.floor(H * 0.3)), dark);
        if (big) p.rect(Math.floor(W * 0.55), Math.floor(H * 0.5), Math.floor(W * 0.3), Math.max(2, u * 2), C.white);
        break;
      }
      default: {
        // Bobbycar: Sitz/Lenker oben links, Räder unten
        p.rect(0, 0, cell, Math.floor(cell * 0.35), light);
        p.rect(Math.floor(cell * 0.3), u, u * 2, Math.floor(cell * 0.5), C.outline);
        p.rect(0, cell, W, u * 2, light);
        for (const cx of [Math.floor(cell * 0.6), Math.floor(W - cell * 0.6)]) p.disc(cx, H - Math.floor(cell * 0.3), Math.max(1, Math.floor(cell * 0.3)), C.outline);
        if (big) p.rect(W - u * 3, cell + u * 3, u * 2, u * 2, C.gold);
      }
    }
    if (big) for (const [c, r] of cells) if (!inside(c * cell, r * cell - 1)) p.rect(c * cell, r * cell, cell, u, shade(light, 1.05));
  });

  // Innenkontur
  const img = p.g.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      if (inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1)) continue;
      const i = (y * W + x) * 4;
      img.data[i] = 0x2d;
      img.data[i + 1] = 0x1b;
      img.data[i + 2] = 0x12;
      img.data[i + 3] = 255;
    }
  }
  p.g.putImageData(img, 0, 0);
  return p;
}

/**
 * Kombi im Querschnitt für eine Bahn ins Hintergrundbild malen.
 * ox/oy: Bildschirm-Position von (x = 0, Boden), b = Pixel pro Block.
 */
export function paintCar(p: Pix, ox: number, oy: number, b: number, color: string) {
  const K = KOFFER;
  const X = (bx: number) => Math.round(ox + bx * b);
  const Y = (by: number) => Math.round(oy - by * b);
  const body = color;
  const bodyDark = shade(color, 0.72);
  const bodyLight = shade(color, 1.25);
  // Unterboden + Seitenwand unter dem Kofferraum
  p.rect(X(-3), Y(0), X(K.W + K.LIP_T + 0.3) - X(-3), Y(-1.6) - Y(0), body);
  p.hline(X(-3), Y(0), X(K.W + K.LIP_T) - X(-3), bodyLight);
  p.rect(X(-3), Y(-1.6) - Math.max(1, Math.round(b * 0.2)), X(K.W + K.LIP_T + 0.3) - X(-3), Math.max(1, Math.round(b * 0.2)), bodyDark);
  // Stoßstange hinten + Rücklicht
  p.rect(X(K.W - 0.2), Y(-0.6), X(K.W + K.LIP_T + 0.6) - X(K.W - 0.2), Y(-1.4) - Y(-0.6), '#3d3d48');
  p.rect(X(K.W), Y(K.LIP), X(K.W + K.LIP_T) - X(K.W), Y(0) - Y(K.LIP), body);
  p.rect(X(K.W), Y(K.LIP), X(K.W + K.LIP_T) - X(K.W), Math.max(1, Math.round(b * 0.25)), bodyLight);
  p.rect(X(K.W + 0.05), Y(K.LIP - 0.4), Math.max(1, X(K.W + K.LIP_T) - X(K.W + 0.05) - 1), Math.max(2, Math.round(b * 0.6)), '#ff5a4a');
  // Kofferraum-Innenraum (dunkel, Teppich am Boden)
  p.rect(X(0), Y(K.ROOF), X(K.W) - X(0), Y(0) - Y(K.ROOF), 'rgba(45,27,18,0.22)');
  p.rect(X(0), Y(0.25), X(K.W) - X(0), Y(0) - Y(0.25), '#5a5560');
  // Rückbank: Lehne (Wand), Sitzfläche, Kopfstütze
  p.rect(X(-1), Y(K.ROOF - 2), X(0) - X(-1), Y(0) - Y(K.ROOF - 2), '#4a5a78');
  p.rect(X(-1), Y(K.ROOF - 2), Math.max(1, Math.round(b * 0.25)), Y(0) - Y(K.ROOF - 2), '#6a7a98');
  p.rect(X(-0.9), Y(K.ROOF - 0.9), X(-0.1) - X(-0.9), Y(K.ROOF - 2) - Y(K.ROOF - 0.9), '#4a5a78');
  p.rect(X(-3), Y(1.6), X(-1) - X(-3), Y(0.6) - Y(1.6), '#4a5a78');
  // Dach + C-Säule links, Seitenfenster
  p.rect(X(-3), Y(K.ROOF + 0.45), X(0.6) - X(-3), Y(K.ROOF) - Y(K.ROOF + 0.45), body);
  p.rect(X(-3), Y(K.ROOF + 0.45), X(0.6) - X(-3), Math.max(1, Math.round(b * 0.15)), bodyLight);
  p.rect(X(-2.6), Y(K.ROOF - 0.4), X(-1.3) - X(-2.6), Y(2.4) - Y(K.ROOF - 0.4), 'rgba(150,210,240,0.55)');
  // Dachlinie über dem Kofferraum (gestrichelt): bis hier zählt alles voll
  const dash = Math.max(2, Math.round(b * 0.35));
  for (let x = X(0.6); x < X(K.W); x += dash * 2) p.rect(x, Y(K.ROOF), Math.min(dash, X(K.W) - x), Math.max(1, Math.round(b * 0.12)), 'rgba(255,255,255,0.85)');
  // Scharnier der Heckklappe
  p.disc(X(K.W), Y(K.ROOF), Math.max(1, Math.round(b * 0.25)), '#3d3d48');
  // Räder
  for (const wx of [-1, K.W - 2]) {
    const r = Math.max(2, Math.round(b * 1.05));
    p.disc(X(wx), Y(-1.7), r, '#2d2a30');
    p.disc(X(wx), Y(-1.7), Math.max(1, Math.round(r * 0.5)), '#b8bcc4');
  }
}

/** Asphalt mit Mittelstreifen */
export function paintRoad(p: Pix, y: number, w: number, h: number) {
  p.rect(0, y, w, h, '#57545c');
  p.hline(0, y, w, '#7a7680');
  for (let x = 4; x < w; x += 22) p.rect(x, y + Math.floor(h / 2), 10, 1, '#e8e2c8');
}
