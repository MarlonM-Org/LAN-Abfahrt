import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintSand, paintShore, paintSky } from './ground';

/** Ententeich: Lagune mit Schilf, Vögel, Badegäste, Strandkrabbe (alles prozedural) */

export const LAGOON = { HORIZON: 112, SHORE: 230 };

// ------------------------------------------------------------------ Hintergrund

export function paintLagoon(p: Pix, w: number, h: number) {
  const r = rng(808);
  paintSky(p, 0, 0, w, LAGOON.HORIZON, ['#6fbfee', '#94d2f4', '#c4e8f7', '#f7e3c0']);
  // Sonne
  p.disc(64, 36, 17, 'rgba(255,236,160,0.35)');
  p.disc(64, 36, 12, '#ffe88a');
  p.disc(62, 34, 8, '#fff6c8');
  // Wolken
  for (const [cx, cy, s] of [
    [150, 30, 1],
    [300, 18, 1.3],
    [395, 52, 0.9],
    [230, 66, 0.7],
  ]) {
    p.ellipse(cx, cy, 16 * s, 5 * s, '#ffffff');
    p.ellipse(cx - 9 * s, cy + 1, 9 * s, 4 * s, '#ffffff');
    p.ellipse(cx + 6 * s, cy - 3 * s, 9 * s, 5 * s, '#ffffff');
    p.hline(cx - 18 * s, cy + 4 * s, 34 * s, '#dbeef8');
  }
  // Meer am Horizont
  p.rect(0, LAGOON.HORIZON, w, 8, '#2f7fbf');
  p.hline(0, LAGOON.HORIZON, w, '#5aa6d8');
  // Inselchen mit Palmen
  p.ellipse(318, LAGOON.HORIZON + 1, 30, 6, '#e9c98a');
  p.ellipse(318, LAGOON.HORIZON - 1, 22, 5, '#4f9a3c');
  for (const [px, ph] of [
    [308, 15],
    [322, 19],
    [334, 13],
  ]) {
    for (let i = 0; i < ph; i++) p.px(px + Math.round(Math.sin(i / 6) * 1.5), LAGOON.HORIZON - 3 - i, '#7a4a26');
    const tx = px + Math.round(Math.sin(ph / 6) * 1.5);
    const ty = LAGOON.HORIZON - 3 - ph;
    for (const [dx, dy] of [
      [-5, 1],
      [-4, -1],
      [4, -1],
      [5, 1],
      [0, -2],
    ]) {
      p.hline(tx + Math.min(0, dx), ty + dy, Math.abs(dx) + 1, '#2d6a28');
    }
  }
  // Segelboot
  p.rect(150, LAGOON.HORIZON + 2, 10, 2, C.woodDark);
  for (let i = 0; i < 8; i++) p.hline(154 - Math.floor(i / 3), LAGOON.HORIZON + 1 - i, Math.floor(i / 2) + 1, C.white);
  // Lagune (türkis, nach vorne heller)
  const top = LAGOON.HORIZON + 8;
  const lh = LAGOON.SHORE - top;
  const bands = ['#2f9fbf', '#38adc6', '#45bccd', '#55c8d3', '#6fd5da', '#8adfdf'];
  for (let j = 0; j < lh; j++) {
    const t = j / lh;
    const k = Math.min(bands.length - 1, Math.floor(t * bands.length + (((j * 7) % 3) - 1) * 0.08));
    p.hline(0, top + j, w, bands[k]);
  }
  for (let i = 0; i < (w * lh) / 70; i++) {
    const wx = Math.floor(r() * w);
    const wy = top + Math.floor(r() * lh);
    p.hline(wx, wy, 2 + Math.floor(r() * 5), r() < 0.6 ? '#b8f0f0' : '#2a8fb0');
  }
  // Sonnenglitzern
  for (let i = 0; i < 40; i++) p.hline(40 + r() * 50, top + r() * 40, 2 + r() * 3, '#fff6c8');
  // Seerosen
  for (const [lx, ly] of [
    [40, 150],
    [372, 140],
    [250, 196],
  ]) {
    p.ellipse(lx, ly, 6, 2.5, '#3f8a32');
    p.px(lx + 2, ly - 1, '#f07aa8').px(lx + 3, ly - 1, '#ffd2e4');
  }
  // Strand
  paintSand(p, 0, LAGOON.SHORE, w, h - LAGOON.SHORE, 809);
  paintShore(p, 0, LAGOON.SHORE, w, 810);
}

/** Schilf-Büschel mit Rohrkolben */
export function reeds(seed: number): Pix {
  const p = new Pix(40, 44);
  const r = rng(seed);
  for (let i = 0; i < 16; i++) {
    const bx = 4 + r() * 32;
    const hgt = 18 + r() * 22;
    const lean = (r() - 0.5) * 10;
    const col = [C.leafDark, C.leaf, C.leafLight, '#6f9a3a'][Math.floor(r() * 4)];
    for (let y = 0; y < hgt; y++) {
      const t = y / hgt;
      p.rect(bx + lean * t * t, 43 - y, t < 0.7 ? 2 : 1, 1, col);
    }
    if (r() < 0.45) {
      const tx = bx + lean;
      const ty = 43 - hgt;
      p.rect(tx - 1, ty - 1, 3, 6, '#7a4a26').px(tx, ty - 1, '#9a6a3a').px(tx, ty - 3, C.leafDark).px(tx, ty - 2, C.leafDark);
    }
  }
  p.outline(C.outline);
  return p;
}

// ------------------------------------------------------------------ Vögel (Blickrichtung rechts)

export function duck(frame: 0 | 1, hen = false): Pix {
  const p = new Pix(22, 18);
  const body = hen ? '#a07a52' : '#cfcac0';
  const dark = hen ? '#7a5634' : '#9a968c';
  const wing = hen ? '#8a6440' : '#a9a398';
  p.rect(3, 9, 4, 3, hen ? '#6a4a2c' : '#3a3a40'); // Schwanz
  p.ellipse(10, 10.5, 6.5, 3.6, body);
  p.ellipse(14, 10.5, 3.2, 3, hen ? '#b08458' : '#8a4a2a'); // Brust
  p.rect(14, 6, 3, 4, hen ? '#a07a52' : '#2f8a4a'); // Hals
  p.disc(16.5, 5.5, 3, hen ? '#a07a52' : '#2f8a4a'); // Kopf
  if (!hen) p.hline(14, 9, 3, C.white);
  p.rect(19, 5, 3, 2, '#f2b53a').px(21, 6, '#d9952b');
  p.px(17, 4, C.outline);
  p.overlayOn(() => p.hline(6, 13, 9, dark));
  if (frame === 0) {
    // Flügel oben
    p.ellipse(9, 5, 3, 4.5, wing);
    p.rect(8, 2, 3, 2, shade(wing, 1.15));
    p.px(10, 7, '#3f6fd0').px(9, 7, '#3f6fd0');
  } else {
    p.ellipse(9, 14.5, 3.2, 3.2, wing);
    p.px(10, 13, '#3f6fd0').px(9, 13, '#3f6fd0');
  }
  p.outline(C.outline);
  return p;
}

export function gull(frame: 0 | 1): Pix {
  const p = new Pix(26, 16);
  p.ellipse(11, 9, 7, 3, C.white);
  p.rect(2, 8, 4, 2, '#cfd6dc');
  p.disc(17, 7, 3, C.white);
  p.rect(20, 7, 3, 1, '#f0b13a');
  p.px(22, 8, '#e04a3f');
  p.px(18, 6, C.outline);
  // Pommes im Schnabel
  p.rect(22, 8, 3, 3, '#e04a3f');
  p.vline(22, 5, 3, '#ffd25e').vline(23, 4, 4, '#ffe88a').vline(24, 6, 2, '#ffd25e');
  if (frame === 0) {
    p.ellipse(10, 4, 6, 2.5, '#b9c2cc');
    p.rect(4, 2, 3, 2, '#3a3a40');
    p.px(7, 2, '#3a3a40');
  } else {
    p.ellipse(10, 12, 6, 2.5, '#b9c2cc');
    p.rect(4, 12, 3, 2, '#3a3a40');
  }
  p.outline(C.outline);
  return p;
}

export function flamingo(frame: 0 | 1): Pix {
  const p = new Pix(40, 20);
  const pink = '#f07aa8';
  // lange Beine gerade nach hinten
  p.hline(1, 10, 11, '#e0607e').rect(0, 9, 2, 3, '#e0607e');
  p.ellipse(16, 10, 5.5, 3, pink);
  // langer, dünner Hals nach vorn
  for (let i = 0; i < 13; i++) p.rect(20 + i, 9 - Math.round(Math.sin((i / 12) * Math.PI) * 1.5), 1, 2, pink);
  p.disc(34, 8.5, 2.3, pink);
  // geknickter Schnabel mit schwarzer Spitze
  p.rect(36, 8, 2, 2, C.white).px(38, 9, C.outline).px(38, 10, C.outline).px(37, 10, C.outline);
  p.px(34, 7, C.outline);
  if (frame === 0) {
    p.ellipse(15, 4.5, 6, 3.5, '#e05a8a');
    p.rect(9, 2, 3, 2, C.outline);
  } else {
    p.ellipse(15, 15.5, 6, 3.5, '#e05a8a');
    p.rect(9, 16, 3, 2, C.outline);
  }
  p.outline('#7e2553');
  return p;
}

// ------------------------------------------------------------------ Badegäste

const SKINS = ['#f1c7a0', '#d39a6a', '#8d5a3a'];

export function floater(look: number): Pix {
  const p = new Pix(32, 22);
  const skin = SKINS[look % SKINS.length];
  // Person (Kopf + Arme), sitzt im Ring
  p.rect(9, 9, 12, 4, skin);
  p.disc(15, 7, 3.6, skin);
  if (look === 0) {
    p.hline(12, 6, 7, C.outline).rect(12, 6, 3, 2, C.outline).rect(16, 6, 3, 2, C.outline); // Sonnenbrille
    p.rect(12, 2, 7, 2, '#7a4a26');
  } else if (look === 1) {
    p.rect(11, 2, 9, 3, '#3f8fe0').rect(18, 4, 4, 1, '#3f8fe0'); // Cap
    p.px(14, 7, C.outline).px(17, 7, C.outline);
  } else {
    p.ellipse(15, 4, 7, 1.5, '#f2d27a').rect(12, 1, 7, 3, '#f2d27a'); // Sonnenhut
    p.px(14, 7, C.outline).px(17, 7, C.outline);
  }
  // Schwimmring
  const ring = look === 0 ? '#ffd23f' : look === 1 ? '#e04a3f' : '#3fa7e0';
  p.ellipse(15, 15, 13, 4.5, ring);
  p.overlayOn(() => {
    if (look !== 0) for (let x = 2; x < 30; x += 7) p.rect(x, 10, 3, 10, C.white);
    p.hline(4, 13, 22, shade(ring, 1.3));
  });
  p.ellipse(15, 14, 6, 1.6, '#45bccd');
  p.rect(9, 12, 12, 2, skin);
  if (look === 0) {
    // Quietscheenten-Kopf vorne dran
    p.disc(27, 9, 3.6, '#ffd23f');
    p.rect(29, 9, 3, 2, '#f0973a');
    p.px(28, 8, C.outline);
  }
  p.outline(C.outline);
  return p;
}

// ------------------------------------------------------------------ Strandkrabbe

export function crab(frame: 0 | 1): Pix {
  const p = new Pix(30, 22);
  const red = '#e0503f';
  // Beine
  for (const x of [8, 11, 18, 21]) p.rect(x, 17, 1, 4, '#b03a2c');
  p.ellipse(15, 14, 9, 5, red);
  p.overlayOn(() => p.ellipse(13, 12, 5, 2, '#f07a6c'));
  // Augen auf Stielen
  p.vline(12, 5, 5, red).vline(18, 5, 5, red);
  p.disc(12, 4, 2.2, C.white).disc(18, 4, 2.2, C.white);
  p.px(12, 4, C.outline).px(18, 4, C.outline);
  // Scheren
  const cy = frame === 1 ? 4 : 10;
  p.disc(3.5, cy, 3.2, red).disc(26.5, cy, 3.2, red);
  p.rect(2, cy - 3, 2, 2, '#f7f0e0').rect(26, cy - 3, 2, 2, '#f7f0e0');
  p.rect(5, cy + 2, 2, 12 - cy, red).rect(23, cy + 2, 2, 12 - cy, red);
  if (frame === 1) {
    p.rect(12, 14, 6, 3, C.outline);
    p.hline(13, 16, 4, '#ff8a7a');
  } else {
    p.hline(13, 15, 4, C.outline);
  }
  p.outline(C.outline);
  return p;
}

// ------------------------------------------------------------------ UI

/** Weißes Fadenkreuz (wird per Tint eingefärbt) */
export function crosshair(): Pix {
  const p = new Pix(19, 19);
  const c = 9;
  for (let a = 0; a < 360; a += 4) {
    const rad = (a * Math.PI) / 180;
    const near = a % 90;
    if (near < 18 || near > 72) continue;
    p.px(Math.round(c + Math.cos(rad) * 6), Math.round(c + Math.sin(rad) * 6), C.white);
  }
  p.rect(c, 1, 1, 5, C.white).rect(c, 13, 1, 5, C.white).rect(1, c, 5, 1, C.white).rect(13, c, 5, 1, C.white);
  p.px(c, c, C.white);
  p.outline('#1a1a1a');
  return p;
}

export function feather(): Pix {
  const p = new Pix(5, 3);
  p.hline(0, 1, 5, C.white).hline(1, 0, 3, C.white).px(2, 2, C.white);
  return p;
}
