import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintSky, paintWater } from './ground';
import { palm } from './objects';
import { DARTS, dartSegmentIndex } from '../../shared/darts';

/** Lage der Scheibe in der TV-Welt (480 × 270) */
export const DART_TV = {
  CX: 198,
  CY: 143,
  /** Pixel pro mm: Doppelring außen (170 mm) = 96 px */
  S: 96 / DARTS.DOUBLE_OUT,
  /** Zahlenring bis hier, dann Metallrand */
  NUM_R: 113,
  RIM_R: 116,
};

export const DART_COLORS = {
  dark: '#2a2420',
  light: '#ecdcb4',
  red: '#d0412f',
  green: '#2f9150',
  wire: '#b9b4a8',
  surround: '#1f1916',
  numbers: '#f2ead8',
};

/**
 * Dartscheibe als Pixel-Art (Mitte = Bildmitte). `S` = Pixel pro mm, `numR`/`rimR` = Radien von Zahlenring und Rand.
 * Gezeichnet wird pixelweise (Polarkoordinaten), damit die Ringe sauber rund und pixelscharf sind.
 */
export function dartboardPix(S = DART_TV.S, numR = DART_TV.NUM_R, rimR = DART_TV.RIM_R): Pix {
  const size = Math.ceil(rimR) * 2 + 2;
  const c = size / 2;
  const p = new Pix(size, size);
  const img = p.g.createImageData(size, size);
  const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const cols = Object.fromEntries(Object.entries(DART_COLORS).map(([k, v]) => [k, rgb(v)])) as Record<keyof typeof DART_COLORS, number[]>;
  const rim = rgb('#9aa0a8');
  const rimHi = rgb('#d6dae0');
  const rimLo = rgb('#5d626b');
  const r = rng(4711);
  const wireW = 0.55; // px
  const ringEdges = [DARTS.BULL_IN, DARTS.BULL_OUT, DARTS.TRIPLE_IN, DARTS.TRIPLE_OUT, DARTS.DOUBLE_IN, DARTS.DOUBLE_OUT];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const rp = Math.hypot(dx, dy);
      if (rp > rimR) continue;
      let col: number[];
      if (rp > numR) {
        // Metallrand mit Licht oben links
        const lit = (-dx - dy) / rp;
        col = lit > 0.45 ? rimHi : lit < -0.45 ? rimLo : rim;
      } else {
        const mm = rp / S;
        if (mm > DARTS.DOUBLE_OUT) col = cols.surround;
        else if (mm <= DARTS.BULL_IN) col = cols.red;
        else if (mm <= DARTS.BULL_OUT) col = cols.green;
        else {
          const idx = dartSegmentIndex({ x: dx, y: dy });
          const even = idx % 2 === 0;
          const scoring = (mm >= DARTS.TRIPLE_IN && mm <= DARTS.TRIPLE_OUT) || mm >= DARTS.DOUBLE_IN;
          col = scoring ? (even ? cols.red : cols.green) : even ? cols.dark : cols.light;
          // Segmentdrähte
          const deg = (Math.atan2(dx, -dy) * 180) / Math.PI + 9;
          const m = ((deg % 18) + 18) % 18;
          const toEdge = Math.min(m, 18 - m);
          if (rp * Math.sin((toEdge * Math.PI) / 180) < wireW) col = cols.wire;
        }
        if (mm > DARTS.BULL_IN - 2 && ringEdges.some((e) => Math.abs(rp - e * S) < wireW)) col = cols.wire;
      }
      // leichte Sisal-Struktur
      const k = col === rim || col === rimHi || col === rimLo ? 0 : (r() - 0.5) * 14;
      const o = (y * size + x) * 4;
      img.data[o] = Math.max(0, Math.min(255, col[0] + k));
      img.data[o + 1] = Math.max(0, Math.min(255, col[1] + k));
      img.data[o + 2] = Math.max(0, Math.min(255, col[2] + k));
      img.data[o + 3] = 255;
    }
  }
  p.g.putImageData(img, 0, 0);
  return p;
}

/** Dart von vorn-schräg: Spitze unten links (Pixel 0,10), Flight in Spielerfarbe oben rechts. 11 × 11 */
export function dartPix(color: string): Pix {
  const p = new Pix(11, 11);
  const steel = '#c9ced6';
  const barrel = '#8a9099';
  p.px(0, 10, '#eef1f5').px(1, 9, steel);
  p.rect(2, 7, 2, 2, barrel).px(2, 8, steel).px(3, 7, '#6c727b');
  p.px(4, 6, '#3b3b4f').px(5, 5, '#3b3b4f');
  // Flight: zwei Flügel
  p.map(5, 0, ['..XXX.', '.XXXXX', 'XXXXX.', 'XXXX..', '.XX...'], { X: color });
  p.overlayOn(() => {
    p.px(7, 1, shade(color, 1.45)).px(8, 1, shade(color, 1.45));
    p.px(6, 3, shade(color, 0.7)).px(7, 4, shade(color, 0.7));
  });
  p.px(5, 5, '#3b3b4f');
  p.outline(C.outline);
  return p;
}

/**
 * Hintergrund: Bambuswand einer Strandbar mit Strohdach, Lichterkette, Fenster mit Meerblick,
 * Theke unten und Surfbrett – die Scheibe wird darüber gelegt.
 */
export function paintDartsBar(p: Pix, w: number, h: number) {
  const r = rng(808);
  // Bambuswand
  for (let x = 0; x < w; x += 7) {
    const base = (x / 7) % 2 === 0 ? '#c9a35a' : '#bb9450';
    p.rect(x, 0, 6, h, base);
    p.vline(x + 1, 0, h, shade(base, 1.15));
    p.vline(x + 5, 0, h, shade(base, 0.85));
    p.vline(x + 6, 0, h, '#7a5a2c');
    let ny = 10 + Math.floor(r() * 30);
    while (ny < h) {
      p.hline(x, ny, 6, '#8d6a33').hline(x, ny + 1, 6, shade(base, 1.2));
      ny += 34 + Math.floor(r() * 18);
    }
  }
  // Schatten der Scheibe auf der Wand
  p.g.save();
  p.g.globalAlpha = 0.35;
  p.g.fillStyle = '#2d1b12';
  p.g.beginPath();
  p.g.arc(DART_TV.CX + 4, DART_TV.CY + 5, DART_TV.RIM_R + 1, 0, Math.PI * 2);
  p.g.fill();
  p.g.restore();

  // Fenster mit Meerblick (links unten)
  const fx = 8;
  const fy = 140;
  const fw = 66;
  const fh = 80;
  paintSky(p, fx, fy, fw, 44, ['#3b3f86', '#8a4f8f', '#e0705a', '#f5a35a', '#ffd27a']);
  p.disc(fx + 44, fy + 40, 9, '#ffe7a0');
  p.disc(fx + 44, fy + 40, 6, '#fff4c8');
  paintWater(p, fx, fy + 44, fw, fh - 44, 809);
  for (let x = fx + 34; x < fx + 56; x += 3) p.hline(x, fy + 46 + ((x * 7) % 9), 3, '#ffd27a');
  const pl = palm(3);
  const sc = 0.45;
  const pc = document.createElement('canvas');
  pc.width = Math.round(pl.w * sc);
  pc.height = Math.round(pl.h * sc);
  const pg = pc.getContext('2d')!;
  pg.imageSmoothingEnabled = false;
  pg.drawImage(pl.canvas, 0, 0, pc.width, pc.height);
  p.clip(fx, fy, fw, fh, () => p.g.drawImage(pc, fx - 6, fy + fh - pc.height + 6));
  // Fensterrahmen + Kreuz
  p.rect(fx - 3, fy - 3, fw + 6, 3, C.woodDark).rect(fx - 3, fy + fh, fw + 6, 4, C.woodDark);
  p.rect(fx - 3, fy, 3, fh, C.woodDark).rect(fx + fw, fy, 3, fh, C.woodDark);
  p.rect(fx + fw / 2 - 1, fy, 2, fh, C.wood).rect(fx, fy + 38, fw, 2, C.wood);
  p.hline(fx - 3, fy - 3, fw + 6, C.woodLight);

  // Surfbrett rechts unten (lehnt an der Wand)
  p.ellipse(458, 205, 10, 48, '#3fb5c0');
  p.ellipse(458, 205, 7, 45, '#5fd3dc');
  p.rect(452, 200, 13, 4, '#f07aa8');
  p.vline(458, 162, 88, '#2f8f98');

  // Theke
  const ty = 252;
  p.rect(0, ty, w, h - ty, C.wood);
  p.hline(0, ty, w, C.woodLight).hline(0, ty + 1, w, C.woodLight);
  p.hline(0, ty + 2, w, C.woodDark);
  for (let x = 0; x < w; x += 24) p.vline(x, ty + 3, h - ty - 3, C.woodDark);
  // Cocktail auf der Theke
  const cx = 40;
  p.map(cx, ty - 7, ['XXXXXXXX', '.XOOOOX.', '..XOOX..', '...XX...', '...XX...', '...XX...', '..XXXX..'], { X: '#d8f0f4', O: '#f0973a' });
  p.px(cx + 6, ty - 9, '#46b04a').px(cx + 7, ty - 10, '#46b04a').px(cx + 1, ty - 8, '#e04a3f');

  // Strohdach
  for (let x = 0; x < w; x++) {
    const len = 13 + Math.round(Math.sin(x * 0.9) * 1.5 + r() * 4);
    for (let y = 0; y < len; y++) p.px(x, y, (x + Math.floor(y / 3)) % 4 === 0 ? '#a87f35' : y > len - 3 ? '#b88f3f' : '#d9b45a');
  }
  p.hline(0, 3, w, '#8d6a33');

  // Lichterkette
  const bulbs = ['#ff6a5c', '#ffd25e', '#7fe07f', '#6fb8ff', '#ff8fd0'];
  let prev: [number, number] | null = null;
  for (let x = -4; x <= w + 4; x += 2) {
    const seg = ((x % 120) + 120) % 120;
    const y = 20 + Math.round(Math.sin((seg / 120) * Math.PI) * 6);
    if (prev) p.px(x, y, '#3d2414').px(x + 1, y, '#3d2414');
    prev = [x, y];
    if (x % 16 === 0) {
      const col = bulbs[(x / 16) % bulbs.length | 0];
      p.rect(x, y + 1, 2, 3, col).px(x, y + 1, shade(col, 1.5));
    }
  }
}
