import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintSky, paintWater } from './ground';
import { palm } from './objects';
import { WACKEL, type WackelStageId } from '../../shared/wackel';

/** Pixel-Art für die Wackel-Prügelei: Steg, Kutter, Kran, Welle und die Körperteile der Puppen */

const PANTS = '#4a5a86';
const SHOES = '#5b3a24';

// ================================================================== Hintergrund

export function wackelBackdrop(stage: WackelStageId): Pix {
  const p = new Pix(480, 270);
  const r = rng(stage === 'steg' ? 4711 : 4712);
  const sea = WACKEL.SEA_Y;
  paintSky(p, 0, 0, 480, sea, stage === 'steg' ? ['#5fb0e8', '#8fcdf2', '#c9e8f8', '#f6e7c3'] : ['#7a9fc8', '#a9c4de', '#d7e4ee', '#f1e4cc']);
  // Sonne / Wolken
  p.disc(72, 48, 20, 'rgba(255,240,170,0.35)');
  p.disc(72, 48, 13, '#ffe58a');
  p.disc(69, 45, 8, '#fff3c0');
  for (const [cx, cy, s] of [[150, 36, 0.9], [300, 54, 0.7], [420, 30, 1], [230, 92, 0.5]]) {
    p.ellipse(cx, cy, 22 * s, 7 * s, '#ffffff');
    p.ellipse(cx - 10 * s, cy - 4 * s, 10 * s, 7 * s, '#ffffff');
    p.ellipse(cx + 9 * s, cy - 5 * s, 12 * s, 8 * s, '#ffffff');
    p.hline(cx - 20 * s, cy + 5 * s, 40 * s, '#d8eef9');
  }
  // Möwen
  for (const [gx, gy] of [[340, 70], [352, 64], [120, 96]]) {
    p.px(gx, gy, '#3b3b4f').px(gx + 1, gy - 1, '#3b3b4f').px(gx + 2, gy, '#3b3b4f').px(gx + 3, gy - 1, '#3b3b4f').px(gx + 4, gy, '#3b3b4f');
  }
  // Küste am Horizont
  p.ellipse(430, sea, 70, 9, '#6f9a6a');
  p.ellipse(445, sea - 3, 30, 7, '#5f8a5a');
  p.ellipse(40, sea + 1, 50, 6, '#7da77a');
  // Meer
  paintWater(p, 0, sea, 480, 270 - sea, 4713);
  for (let i = 0; i < 50; i++) p.hline(Math.floor(r() * 470), sea + 2 + Math.floor(r() * 10), 6 + Math.floor(r() * 10), '#bfe6f7');
  if (stage === 'steg') {
    p.draw(palm(6), 4, sea - 102);
    p.draw(palm(9), 440, sea - 100, true);
  } else {
    wackelCrane(p);
  }
  return p;
}

/** Kran am rechten Rand: Turm, Ausleger bis zur Aufhängung in der Mitte */
function wackelCrane(p: Pix) {
  const steel = '#c9a227';
  const dark = '#8a6d12';
  // Turm
  for (let y = 26; y < WACKEL.SEA_Y + 10; y += 1) {
    p.rect(446, y, 3, 1, steel).rect(462, y, 3, 1, steel);
    if (y % 12 === 0) p.hline(449, y, 13, dark);
    if (y % 12 === 6) {
      for (let k = 0; k < 13; k++) p.px(449 + k, y + k - 6, dark);
    }
  }
  // Ausleger
  p.rect(224, 34, 240, 3, steel);
  p.rect(224, 42, 240, 2, dark);
  for (let x = 228; x < 462; x += 10) {
    p.vline(x, 36, 7, dark);
    for (let k = 0; k < 6; k++) p.px(x + 2 + k, 36 + k, dark);
  }
  p.rect(222, 32, 8, 14, steel);
  // Kabine
  p.rect(440, 20, 30, 16, '#f2c33a');
  p.rect(443, 23, 12, 8, '#9ad6f0');
  p.rect(444, 24, 4, 3, '#ffffff');
  p.rect(440, 20, 30, 1, '#ffe08a');
  p.rect(440, 35, 30, 2, dark);
}

// ================================================================== Plattformen

/** Hauptsteg mit Pfählen bis ins Wasser */
export function wackelDeckPix(w: number, h: number, postsTo: number): Pix {
  const p = new Pix(w, h + postsTo);
  const r = rng(w * 7 + h);
  for (let x = 6; x < w - 4; x += 38) {
    p.rect(x, h - 2, 7, postsTo + 2, C.trunk);
    p.vline(x + 1, h - 2, postsTo + 2, '#9a6436');
    p.rect(x - 1, h + postsTo - 14, 9, 14, 'rgba(60,120,180,0.5)');
  }
  // Querbalken
  p.rect(0, 5, w, h - 5, C.woodDark);
  for (let y = 9; y < h; y += 6) p.hline(0, y, w, C.woodDarker);
  // Dielen
  p.rect(0, 0, w, 5, C.wood);
  p.hline(0, 0, w, C.woodLight);
  for (let x = Math.floor(r() * 10); x < w; x += 11 + Math.floor(r() * 6)) p.vline(x, 1, 4, C.woodDark);
  p.speckle(0, 1, w, 3, C.woodLight, w / 4, r);
  p.hline(0, 5, w, C.woodDarker);
  p.outline(C.outline);
  return p;
}

/** Tiefer liegende, nasse Planken (werden von Wellen überspült) */
export function wackelLowPix(w: number, h: number): Pix {
  const p = new Pix(w, h + 20);
  const r = rng(w * 3 + 9);
  for (let x = 4; x < w - 2; x += 30) {
    p.rect(x, h - 2, 6, 22, C.trunkDark);
    p.vline(x + 1, h - 2, 22, C.trunk);
  }
  p.rect(0, 4, w, h - 4, '#6b4a2a');
  p.rect(0, 0, w, 4, '#8f6a3c');
  p.hline(0, 0, w, '#a8824e');
  for (let x = 3; x < w; x += 10 + Math.floor(r() * 5)) p.vline(x, 1, 3, '#5e3f22');
  // Algen und Nässe
  p.speckle(0, 1, w, 3, '#5f8a5a', w / 6, r);
  p.speckle(0, 0, w, 2, '#bfe6f7', w / 10, r);
  p.outline(C.outline);
  return p;
}

/** Kleine Aussichtsplattform mit Geländer und Stützen */
export function wackelHighPix(w: number, h: number, postsTo: number): Pix {
  const p = new Pix(w, h + postsTo + 12);
  const top = 12;
  // Geländer
  for (let x = 2; x < w - 1; x += 12) p.rect(x, 0, 2, top, C.woodDark);
  p.rect(0, 0, w, 2, C.wood);
  p.rect(0, 6, w, 1, C.woodDark);
  // Stützen
  for (const x of [4, w - 8]) p.rect(x, top + h - 2, 4, postsTo + 2, C.trunk);
  for (let k = 0; k < Math.min(postsTo, w / 2) - 4; k++) {
    p.px(8 + k, top + h + k, C.woodDarker);
    p.px(w - 9 - k, top + h + k, C.woodDarker);
  }
  // Boden
  p.rect(0, top, w, h, C.wood);
  p.hline(0, top, w, C.woodLight);
  p.rect(0, top + 4, w, h - 4, C.woodDark);
  for (let x = 5; x < w; x += 9) p.vline(x, top + 1, 3, C.woodDark);
  p.outline(C.outline);
  return p;
}

/** Fischkutter: Deck oben (Plattform), darunter Rumpf mit Bullaugen – dreht sich um die Deckmitte */
export function wackelBoatPix(w: number, h: number): Pix {
  const hull = 44;
  const p = new Pix(w + 40, h + hull);
  const ox = 20;
  const r = rng(99);
  // Rumpf (Bug rechts spitz, Heck links rund)
  for (let y = 0; y < hull; y++) {
    const t = y / hull;
    const inset = Math.round(t * t * 26);
    const x0 = ox - 14 + inset;
    const x1 = ox + w + 14 - Math.round(t * 34);
    if (x1 <= x0) break;
    const col = y < 6 ? '#2d64a8' : y < 8 ? '#f4efe2' : y < 30 ? '#e0503f' : '#a8342a';
    p.hline(x0, h + y, x1 - x0, col);
  }
  // Bullaugen
  for (let x = ox + 30; x < ox + w - 30; x += 46) {
    p.disc(x, h + 18, 4, '#f4efe2');
    p.disc(x, h + 18, 2.5, '#9ad6f0');
    p.px(x - 1, h + 17, '#ffffff');
  }
  // Name
  p.rect(ox + w - 70, h + 10, 40, 6, '#f4efe2');
  // Reling
  for (let x = ox + 4; x < ox + w - 2; x += 16) p.rect(x, 0, 2, 7, '#f4efe2');
  p.hline(ox, 0, w, '#f4efe2');
  // Deck
  p.rect(ox, 7, w, h - 7, '#c99a5e');
  p.hline(ox, 7, w, '#ddb47a');
  for (let y = 11; y < h; y += 4) p.hline(ox, y, w, '#a97a43');
  for (let x = ox + Math.floor(r() * 8); x < ox + w; x += 14 + Math.floor(r() * 8)) p.vline(x, 8, 3, '#a97a43');
  p.rect(ox - 2, h - 2, w + 4, 3, '#5e3518');
  // Rettungsring
  p.disc(ox + w - 14, 14, 5, '#f0973a');
  p.disc(ox + w - 14, 14, 2, '#e0503f');
  p.outline(C.outline);
  return p;
}

/** Schwimmende Kiste / Fass */
export function wackelCratePix(w: number, h: number): Pix {
  const p = new Pix(w, h + 14);
  p.rect(0, 0, w, h + 12, '#b27238');
  p.rect(0, 0, w, 3, '#d39a5c');
  p.rect(0, 0, 3, h + 12, '#d39a5c');
  p.rect(w - 3, 0, 3, h + 12, '#8d5629');
  p.rect(0, h + 9, w, 3, '#5e3518');
  // Kreuz-Verstrebung
  for (let k = 0; k < Math.min(w, h + 12) - 6; k++) {
    p.px(3 + k, 3 + k, '#8d5629');
    p.px(w - 4 - k, 3 + k, '#8d5629');
  }
  p.rect(0, h + 12, w, 2, 'rgba(60,120,180,0.5)');
  p.outline(C.outline);
  return p;
}

/** Ausguck-Korb mit Mast nach unten */
export function wackelNestPix(w: number, h: number, mastTo: number): Pix {
  const p = new Pix(w, h + mastTo);
  p.rect(w / 2 - 2, h, 4, mastTo, '#8d5629');
  p.vline(w / 2 - 1, h, mastTo, '#b27238');
  p.rect(0, 0, w, h, '#b27238');
  p.rect(0, 0, w, 2, '#d39a5c');
  for (let x = 4; x < w; x += 7) p.vline(x, 2, h - 2, '#8d5629');
  // Wimpel
  p.rect(w / 2 - 1, -0, 1, 1, '#e0503f');
  p.outline(C.outline);
  return p;
}

// ================================================================== Gefahren

export function wackelHookPix(): Pix {
  const p = new Pix(14, 18);
  const steel = '#9aa0a8';
  const dark = '#5c6168';
  p.rect(6, 0, 2, 4, dark);
  p.rect(4, 4, 6, 5, steel);
  p.rect(5, 9, 4, 3, steel);
  // Hakenbogen
  p.rect(3, 12, 8, 2, steel);
  p.rect(2, 13, 2, 3, steel);
  p.rect(10, 11, 2, 2, steel);
  p.rect(1, 15, 3, 2, steel);
  p.px(2, 17, steel);
  p.px(5, 5, '#d8dde3').px(6, 6, '#d8dde3');
  p.outline(C.outline);
  return p;
}

/** Brecher, der über die tiefen Planken rollt */
export function wackelWavePix(): Pix {
  const p = new Pix(64, 30);
  for (let x = 0; x < 64; x++) {
    const t = x / 64;
    const hgt = Math.round(Math.sin(t * Math.PI) * 22 + Math.sin(t * Math.PI * 3) * 3);
    p.vline(x, 30 - hgt, hgt, C.water);
    p.vline(x, 30 - hgt, Math.max(1, Math.round(hgt * 0.35)), '#5aa9de');
    p.px(x, 30 - hgt, C.foam);
    if (x % 3 === 0) p.px(x, 31 - hgt, C.foam);
  }
  // Schaumkrone, die nach vorn (rechts) überkippt
  p.ellipse(44, 8, 10, 4, C.foam);
  p.ellipse(52, 11, 6, 3, C.foam);
  p.ellipse(36, 6, 5, 3, '#ffffff');
  p.outline('rgba(45,27,18,0.5)');
  return p;
}

// ================================================================== Körperteile

export function wackelTorsoPix(shirt: string): Pix {
  const p = new Pix(10, 14);
  p.rect(1, 1, 8, 12, shirt);
  p.rect(1, 1, 2, 12, shade(shirt, 1.18));
  p.rect(7, 1, 2, 12, shade(shirt, 0.78));
  p.rect(1, 11, 8, 2, shade(shirt, 0.78));
  p.rect(3, 1, 4, 1, '#f9d8bd');
  p.outline(C.outline);
  return p;
}

export function wackelArmPix(shirt: string, skin: string): Pix {
  const p = new Pix(5, 11);
  p.rect(1, 1, 3, 6, shirt);
  p.vline(1, 1, 6, shade(shirt, 1.15));
  p.rect(1, 7, 3, 3, skin);
  p.outline(C.outline);
  return p;
}

export function wackelLegPix(): Pix {
  const p = new Pix(5, 12);
  p.rect(1, 1, 3, 8, PANTS);
  p.vline(1, 1, 8, shade(PANTS, 1.2));
  p.rect(0, 9, 5, 2, SHOES);
  p.outline(C.outline);
  return p;
}

/** Benommenes Gesicht: X-Augen und Zunge (16 × 15, passend zum Porträt) */
export function wackelDizzyPix(): Pix {
  const p = new Pix(16, 15);
  const ink = '#2d1b12';
  for (const ex of [6, 9]) {
    p.px(ex - 1, 9, ink).px(ex + 1, 9, ink).px(ex, 10, ink).px(ex - 1, 11, ink).px(ex + 1, 11, ink);
  }
  p.rect(7, 12, 2, 2, '#f0928a');
  p.px(7, 13, '#e0503f');
  return p;
}

/** Sterne beim Treffer */
export function wackelStarPix(color = C.gold): Pix {
  const p = new Pix(7, 7);
  p.map(0, 0, ['...#...', '...#...', '.#####.', '..###..', '.##.##.', '#.....#', '.......'], { '#': color });
  p.outline(C.outline);
  return p;
}
