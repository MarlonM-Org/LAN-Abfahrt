/**
 * Umzugschaos: Pixel-Art für Möbel (Draufsicht), Grundstück mit Haus, Garten und Umzugslaster,
 * Fensterscherben und den Vermieter.
 */
import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintGrass, paintTiles, paintWoodFloor } from './ground';
import { K, UMZUG, UMZUG_KINDS, type UmzugGeo, umzugTruckZone } from '../../shared/umzug';

const T = UMZUG.TILE;
const WALL = '#e7d6b4';
const WALL_DARK = '#a98e68';
const WALL_TOP = '#f6ecd6';
const GLASS = '#9fd8f5';

/** Ein Möbelstück von oben, Größe = Physik-Körper (+1 px Kontur rundum) */
export function umzugItemPix(k: number): Pix {
  const kind = UMZUG_KINDS[k];
  const W = kind.w;
  const H = kind.h;
  const p = new Pix(W + 2, H + 2);
  const g = (fn: () => void) => {
    p.g.save();
    p.g.translate(1, 1);
    fn();
    p.g.restore();
  };
  g(() => {
    switch (k) {
      case K.KARTON:
      case K.FRAGILE: {
        const base = k === K.FRAGILE ? '#d9b98a' : '#c99a5e';
        p.rect(0, 0, W, H, base);
        p.rect(0, 0, W, 1, shade(base, 1.25)).rect(0, H - 1, W, 1, shade(base, 0.75));
        p.rect(W / 2 - 1, 0, 2, H, '#b98a4e'); // Klebeband
        p.rect(0, H / 2 - 1, W, 2, '#b98a4e');
        if (k === K.FRAGILE) {
          p.rect(1, 2, 4, 3, C.white).rect(1, 2, 4, 1, C.red).rect(1, 4, 4, 1, C.red);
          p.rect(W - 5, H - 5, 4, 3, C.white).rect(W - 5, H - 5, 4, 1, C.red).rect(W - 5, H - 3, 4, 1, C.red);
        }
        break;
      }
      case K.LAMPE:
        p.disc(W / 2, H / 2, W / 2, '#f2c33a');
        p.disc(W / 2, H / 2, W / 2 - 2, '#ffe08a');
        p.disc(W / 2, H / 2, 1.3, '#f0973a');
        break;
      case K.PFLANZE:
        p.disc(W / 2, H / 2, W / 2, '#c0643a');
        p.disc(W / 2, H / 2, W / 2 - 1.5, C.leafDark);
        p.disc(W / 2 - 2, H / 2 - 1, 2, C.leaf).disc(W / 2 + 2, H / 2 + 1, 2, C.leafLight).px(W / 2, H / 2 - 2, C.leafTip);
        break;
      case K.ZWERG:
        p.disc(W / 2, H / 2, W / 2, '#f3c89b');
        p.rect(0, 0, W, 3, C.red).rect(W / 2 - 1, 0, 2, 2, '#ff8a7a');
        p.rect(1, 5, W - 2, 3, C.white);
        p.px(2, 3, C.outline).px(W - 3, 3, C.outline);
        break;
      case K.VASE:
        p.disc(W / 2, H / 2, W / 2, '#5aa9e6');
        p.disc(W / 2, H / 2, W / 2 - 2, '#2d64a8');
        p.disc(W / 2, H / 2, 1.2, '#9fd8f5');
        p.px(2, 2, C.white);
        break;
      case K.KUEHL:
        p.rect(0, 0, W, H, '#f1efe8');
        p.rect(0, 0, W, 1, C.white).rect(0, H - 1, W, 1, '#bfbcb3');
        p.rect(1, 1, W - 2, 1, '#d7d4cb');
        p.rect(W - 3, 3, 1, H - 6, '#8a8780'); // Griff
        p.rect(2, 3, 4, 2, '#cfe9f5').rect(2, 7, 3, 1, '#cfe9f5');
        break;
      case K.SOFA: {
        const c = '#8f4a7d';
        p.rect(0, 0, W, H, c);
        p.rect(0, 0, W, 4, shade(c, 0.75)); // Lehne
        p.rect(0, 0, 5, H, shade(c, 0.8)).rect(W - 5, 0, 5, H, shade(c, 0.8)); // Armlehnen
        p.rect(5, 4, W - 10, H - 5, shade(c, 1.15));
        p.rect(W / 2 - 1, 4, 1, H - 5, shade(c, 0.7)); // Kissenfuge
        p.rect(7, 6, 5, 4, '#f2c33a'); // Kissen
        break;
      }
      case K.BETT: {
        p.rect(0, 0, W, H, C.woodDark);
        p.rect(1, 1, W - 2, H - 2, '#eae3d2');
        p.rect(2, 2, 6, H - 4, C.white).rect(2, 2, 6, 1, '#d9d2c2'); // Kopfkissen
        p.rect(9, 1, W - 10, H - 2, C.blue);
        p.rect(9, 1, W - 10, 2, shade(C.blue, 1.25));
        for (let x = 13; x < W - 2; x += 4) p.rect(x, 3, 1, H - 4, shade(C.blue, 0.8));
        break;
      }
      case K.KLAVIER: {
        p.rect(0, 0, W, H, '#2e2a2a');
        p.rect(0, 0, W, 1, '#5a5454');
        p.rect(2, H - 6, W - 4, 5, '#f4f1ea'); // Tasten
        for (let x = 4; x < W - 2; x += 3) p.rect(x, H - 6, 1, 3, '#2e2a2a');
        p.rect(3, 3, W - 6, 2, '#4a4444');
        break;
      }
    }
  });
  p.outline(C.outline);
  return p;
}

export const umzugItemKey = (k: number) => `um_item_${k}`;

/** Ein Haus mit Garten, Weg und Umzugslaster auf den Hintergrund malen */
export function paintUmzugLot(p: Pix, houses: UmzugGeo[], W: number, H: number) {
  paintGrass(p, 0, 0, W, H, 31, true);
  for (const g of houses) {
    const rows = g.grid.length;
    const cols = g.grid[0].length;
    const X = (c: number) => g.x0 + c * T;
    const Y = (r: number) => UMZUG.Y0 + r * T;
    // Böden
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = g.grid[r][c];
        if (ch === '.' || ch === 'D') paintWoodFloor(p, X(c), Y(r), T, T, 17 + r * 3 + c, '#c9955a');
        else if (ch === 'k') paintTiles(p, X(c), Y(r), T, T, '#dfe6e3', '#c3cfcb', 6);
        else if (ch === 'p') p.rect(X(c), Y(r), T, T, C.sandDark).speckle(X(c), Y(r), T, T, C.sand, 10, rng(c * 7 + r));
        else if (ch === 'h') p.rect(X(c), Y(r), T, T, C.leafDark).speckle(X(c), Y(r), T, T, C.leaf, 14, rng(c * 3 + r * 5)).speckle(X(c), Y(r), T, T, C.leafTip, 6, rng(c + r * 11));
      }
    }
    // Hecke oben abschließen
    const hedgeRow = g.grid.findIndex((row) => row[0] === 'h');
    if (hedgeRow > 0) p.rect(X(0), Y(hedgeRow), cols * T, 1, C.leafTip);
    // Fußmatten vor den Türen
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (g.grid[r][c] === 'D') p.rect(X(c) + 2, Y(r) + 2, T - 4, T - 4, '#b5473a').rect(X(c) + 4, Y(r) + 4, T - 8, T - 8, '#d9674f');
    // Wände (leicht schräge Draufsicht: helle Oberkante, Schatten unten)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = g.grid[r][c];
        if (ch !== '#' && ch !== 'W') continue;
        p.rect(X(c), Y(r), T, T, WALL);
        p.rect(X(c), Y(r), T, 2, WALL_TOP);
        p.rect(X(c), Y(r) + T - 2, T, 2, WALL_DARK);
        if (ch === 'W') {
          const vertical = (g.grid[r][c - 1] === '#' || g.grid[r][c - 1] === 'W') && (g.grid[r][c + 1] === '#' || g.grid[r][c + 1] === 'W');
          if (vertical) {
            p.rect(X(c) + 1, Y(r) + 4, T - 2, 4, GLASS).rect(X(c) + T / 2, Y(r) + 4, 1, 4, C.white).rect(X(c) + 1, Y(r) + 5, T - 2, 1, '#d7f0fb');
            p.rect(X(c), Y(r) + 3, T, 1, C.outline).rect(X(c), Y(r) + 8, T, 1, C.outline);
          } else {
            p.rect(X(c) + 4, Y(r) + 1, 4, T - 2, GLASS).rect(X(c) + 4, Y(r) + T / 2, 4, 1, C.white).rect(X(c) + 5, Y(r) + 1, 1, T - 2, '#d7f0fb');
            p.rect(X(c) + 3, Y(r), 1, T, C.outline).rect(X(c) + 8, Y(r), 1, T, C.outline);
          }
        }
      }
    }
    // Umriss der Wände
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = g.grid[r][c];
        const wall = ch === '#' || ch === 'W';
        if (wall) continue;
        const nb = (dc: number, dr: number) => {
          const n = g.grid[r + dr]?.[c + dc];
          return n === '#' || n === 'W';
        };
        if (nb(0, -1)) p.rect(X(c), Y(r) - 1, T, 1, C.outline);
        if (nb(0, 1)) p.rect(X(c), Y(r) + T, T, 1, C.outline);
        if (nb(-1, 0)) p.rect(X(c) - 1, Y(r), 1, T, C.outline);
        if (nb(1, 0)) p.rect(X(c) + T, Y(r), 1, T, C.outline);
      }
    }
    // Laster: Kasten um die Ladefläche, Fahrerhaus oben, Räder
    const z = umzugTruckZone(g);
    const openLeft = !g.mirror;
    const bx = openLeft ? z.x - 2 : z.x - T;
    const bw = z.w + T + 2;
    const by = z.y - T;
    const bh = z.h + 2 * T;
    p.rect(bx, by, bw, bh, '#d8d4cc');
    p.rect(bx, by, bw, 3, '#f1efe8');
    p.rect(bx, by + bh - 3, bw, 3, '#9a968e');
    // Ladefläche
    p.rect(z.x, z.y, z.w, z.h, '#7a6a52');
    for (let y = z.y + 3; y < z.y + z.h; y += 6) p.rect(z.x, y, z.w, 1, '#5e4f3a');
    // offene Seite: Rampe
    if (openLeft) p.rect(z.x - 6, z.y + 4, 6, z.h - 8, '#a7a39a').rect(z.x - 6, z.y + 4, 1, z.h - 8, '#cfcbc1');
    else p.rect(z.x + z.w, z.y + 4, 6, z.h - 8, '#a7a39a').rect(z.x + z.w + 5, z.y + 4, 1, z.h - 8, '#cfcbc1');
    // Fahrerhaus
    const cabX = openLeft ? z.x + z.w - 16 : z.x;
    p.rect(cabX, by - 8, 16, 9, '#e04a3f').rect(cabX + 2, by - 6, 12, 4, GLASS).rect(cabX, by - 8, 16, 1, '#ff8a7a');
    // Räder
    for (const wx of [bx + 6, bx + bw - 10]) {
      p.rect(wx, by - 2, 5, 3, '#2e2a2a').rect(wx, by + bh - 1, 5, 3, '#2e2a2a');
    }
    // Streifen „UMZUG“ wird in der Szene als Text gesetzt
    p.rect(bx + 2, by + 4, bw - 4, 1, '#e04a3f');
    p.rect(bx + 2, by + bh - 5, bw - 4, 1, '#e04a3f');
  }
  // Straße unten (über der Hecke)
  const street = houses[0];
  const hedgeRow = street.grid.findIndex((row) => row[0] === 'h');
  if (hedgeRow > 0) {
    const y = UMZUG.Y0 + hedgeRow * T;
    p.rect(0, y + T, W, H - y - T, '#6f6b66');
    for (let x = 4; x < W; x += 16) p.rect(x, y + T + 6, 8, 1, '#f2c33a');
  }
}

/** Zerbrochenes Fenster (Overlay auf die Fensterkachel) */
export function umzugBrokenWindow(vertical: boolean): Pix {
  const p = new Pix(T, T);
  if (vertical) {
    p.rect(1, 4, T - 2, 4, '#3a3028');
    p.px(2, 5, GLASS).px(5, 6, GLASS).px(9, 5, GLASS).px(7, 4, C.white);
  } else {
    p.rect(4, 1, 4, T - 2, '#3a3028');
    p.px(5, 2, GLASS).px(6, 6, GLASS).px(5, 9, GLASS).px(4, 7, C.white);
  }
  return p;
}

/** Scherbenhaufen (bleibt liegen, wo etwas zerbrochen ist) */
export function umzugShards(k: number): Pix {
  const p = new Pix(14, 10);
  const r = rng(k * 13 + 5);
  const col = k === K.VASE ? ['#5aa9e6', '#2d64a8', C.white] : ['#d9b98a', '#b98a4e', C.white];
  for (let i = 0; i < 9; i++) p.rect(1 + Math.floor(r() * 12), 1 + Math.floor(r() * 8), 1 + Math.floor(r() * 2), 1 + Math.floor(r() * 2), col[i % 3]);
  return p;
}

/** Der Vermieter: Anzug, Hut, Aktentasche */
export function umzugLandlord(): Pix {
  const p = new Pix(14, 22);
  p.rect(3, 1, 8, 3, '#3a3028').rect(1, 4, 12, 1, '#3a3028'); // Hut
  p.rect(4, 5, 6, 5, '#f3c89b'); // Gesicht
  p.px(5, 7, C.outline).px(8, 7, C.outline).rect(5, 9, 4, 1, '#a8342a');
  p.rect(3, 10, 8, 8, '#4a4a5a'); // Anzug
  p.rect(6, 10, 2, 6, C.white).rect(6, 11, 2, 3, '#e04a3f');
  p.rect(3, 18, 3, 3, '#2e2a2a').rect(8, 18, 3, 3, '#2e2a2a');
  p.rect(11, 14, 3, 5, '#8d5629').rect(12, 13, 1, 1, '#5e3518'); // Aktentasche
  p.outline(C.outline);
  return p;
}

/** Griff-Markierung („hier anfassen“) */
export function umzugHandMark(): Pix {
  const p = new Pix(8, 8);
  p.disc(4, 4, 3.5, '#ffd25e');
  p.disc(4, 4, 2, '#fff2b0');
  p.outline(C.outline);
  return p;
}

export function umzugStar(filled: boolean): Pix {
  const p = new Pix(13, 13);
  const col = filled ? '#ffd25e' : '#6e6a62';
  const rows = ['......x......', '.....xxx.....', '.....xxx.....', 'xxxxxxxxxxxxx', '.xxxxxxxxxxx.', '..xxxxxxxxx..', '...xxxxxxx...', '...xxxxxxx...', '..xxxx.xxxx..', '.xxx.....xxx.', 'xx.........xx'];
  p.map(0, 1, rows, { x: col });
  if (filled) p.px(5, 4, '#fff2b0').px(6, 5, '#fff2b0');
  p.outline(C.outline);
  return p;
}
