import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintSand, paintShore, paintSky, paintWater } from './ground';

/**
 * Pixel-Art für die Strand-Band: Bühne am Strand bei Sonnenuntergang (Hintergrund) und die Instrumente,
 * die die Avatare halten. Instrumente sind im Avatar-Raster (16 × 27) gezeichnet und werden wie die Avatare
 * doppelt skaliert; `BAND_PROP_AT` sagt, wo sie relativ zur linken oberen Ecke des Avatars sitzen.
 */

export const BAND_STAGE = {
  HORIZON: 124,
  SAND: 148,
  /** Podest der hinteren Reihe (Oberkante) und Bühnenboden (Oberkante) */
  RISER: 156,
  FLOOR: 212,
  LEFT: 52,
  RIGHT: 428,
  BEAM: 34,
};

const BAMBOO = ['#c9b25a', '#b59c48', '#8f7a32'];

function bamboo(p: Pix, x: number, y: number, w: number, h: number, vertical: boolean) {
  if (vertical) {
    for (let j = 0; j < h; j++) {
      const knot = j % 14 === 0;
      p.rect(x, y + j, w, 1, knot ? BAMBOO[2] : j % 2 ? BAMBOO[0] : BAMBOO[1]);
    }
    p.vline(x, y, h, BAMBOO[2]).vline(x + w - 1, y, h, '#6e5c22');
    p.vline(x + 1, y, h, '#e1cd7a');
  } else {
    for (let i = 0; i < w; i++) {
      const knot = i % 18 === 0;
      p.rect(x + i, y, 1, h, knot ? BAMBOO[2] : i % 2 ? BAMBOO[0] : BAMBOO[1]);
    }
    p.hline(x, y, w, '#e1cd7a').hline(x, y + h - 1, w, '#6e5c22');
  }
}

function planks(p: Pix, x: number, y: number, w: number, h: number, seed: number, top: boolean) {
  const r = rng(seed);
  if (top) {
    // Draufsicht schräg: Bretter quer, nach hinten heller
    for (let j = 0; j < h; j++) p.hline(x, y + j, w, j < 2 ? C.woodLight : j % 4 === 3 ? C.woodDark : C.wood);
    for (let i = x + 10; i < x + w; i += 22 + Math.floor(r() * 10)) p.vline(i, y + 2, h - 2, C.woodDark);
  } else {
    // Vorderkante: senkrechte Bretter
    for (let i = 0; i < w; i++) {
      const b = Math.floor(i / 9);
      p.vline(x + i, y, h, i % 9 === 0 ? C.woodDarker : b % 2 ? '#9a6232' : '#a96c37');
    }
    p.hline(x, y, w, C.woodDarker);
    p.speckle(x, y, w, h, C.woodDarker, (w * h) / 40, r);
  }
}

function speaker(p: Pix, x: number, y: number) {
  for (const [dy, h] of [[0, 26], [26, 28]] as [number, number][]) {
    p.rect(x, y + dy, 26, h, '#2b2733');
    p.rect(x + 1, y + dy + 1, 24, h - 2, '#3a3544');
    const cy = y + dy + h / 2;
    p.disc(x + 13, cy, h / 2 - 4, '#1d1a24');
    p.disc(x + 13, cy, h / 2 - 7, '#4d4759');
    p.disc(x + 13, cy, 2, '#8a8296');
  }
  p.hline(x, y + 26, 26, '#16131c');
}

/** Hintergrund 480 × 270: Abendhimmel, Meer, Strand, Bambusbühne mit Podest, Lautsprechern und Banner-Rahmen */
export function paintBandStage(p: Pix, w = 480, h = 270) {
  const S = BAND_STAGE;
  const r = rng(77);
  paintSky(p, 0, 0, w, S.HORIZON, ['#26245e', '#4d3a84', '#9a4f86', '#e0745e', '#ffb86a', '#ffdd99']);
  for (let i = 0; i < 26; i++) p.px(Math.floor(r() * w), Math.floor(r() * 40), r() < 0.5 ? '#e9d7ff' : C.white);
  p.disc(404, S.HORIZON - 2, 20, '#ffd37a');
  p.disc(404, S.HORIZON - 2, 16, '#fff0b8');
  paintWater(p, 0, S.HORIZON, w, S.SAND - S.HORIZON, 78);
  for (let y = S.HORIZON + 1; y < S.SAND; y += 2) {
    const half = 8 + (y - S.HORIZON) * 0.8;
    for (let x = 404 - half; x < 404 + half; x += 4) if (r() < 0.55) p.hline(x, y, 2 + Math.floor(r() * 3), '#ffd27a');
  }
  paintSand(p, 0, S.SAND, w, h - S.SAND, 79);
  paintShore(p, 0, S.SAND + 1, w, 80);

  // Bühne: hinteres Podest (Rückwand mit Vorhang), Boden, Vorderkante
  p.rect(S.LEFT + 10, S.BEAM + 30, S.RIGHT - S.LEFT - 20, S.RISER - S.BEAM - 30, '#3b2a4a');
  for (let x = S.LEFT + 10; x < S.RIGHT - 10; x += 8) {
    p.vline(x, S.BEAM + 30, S.RISER - S.BEAM - 30, '#2e2140');
    p.vline(x + 4, S.BEAM + 30, S.RISER - S.BEAM - 30, '#4a3660');
  }
  planks(p, S.LEFT + 14, S.RISER, S.RIGHT - S.LEFT - 28, 6, 81, true);
  planks(p, S.LEFT + 14, S.RISER + 6, S.RIGHT - S.LEFT - 28, S.FLOOR - S.RISER - 6, 82, false);
  planks(p, S.LEFT, S.FLOOR, S.RIGHT - S.LEFT, 12, 83, true);
  planks(p, S.LEFT, S.FLOOR + 12, S.RIGHT - S.LEFT, 16, 84, false);
  p.hline(S.LEFT, S.FLOOR + 28, S.RIGHT - S.LEFT, '#5e3518');
  // Bambus-Rahmen + Querbalken
  bamboo(p, S.LEFT, S.BEAM, 6, S.FLOOR + 14 - S.BEAM, true);
  bamboo(p, S.RIGHT - 6, S.BEAM, 6, S.FLOOR + 14 - S.BEAM, true);
  bamboo(p, S.LEFT - 6, S.BEAM, S.RIGHT - S.LEFT + 12, 6, false);
  // Banner (Schrift kommt von der Szene)
  p.rect(176, S.BEAM + 6, 128, 18, '#f2e3c0');
  p.rect(176, S.BEAM + 6, 128, 2, '#d9c08a');
  for (let x = 176; x < 304; x += 8) p.rect(x, S.BEAM + 24, 4, 3, x % 16 ? '#e0503f' : '#3f8fe0');
  p.rect(172, S.BEAM + 4, 3, 6, BAMBOO[2]).rect(305, S.BEAM + 4, 3, 6, BAMBOO[2]);
  // Lautsprecher-Türme links und rechts
  speaker(p, 18, S.FLOOR - 26);
  speaker(p, w - 44, S.FLOOR - 26);
  // Fackeln
  for (const x of [10, w - 14]) {
    p.rect(x + 1, S.FLOOR - 50, 2, 54, '#6e4521');
    p.rect(x - 1, S.FLOOR - 56, 6, 6, '#5a3a1c');
  }
}

// ------------------------------------------------------------------ Instrumente (Avatar-Raster, ×2 skaliert)

/** Position (Avatar-Pixel, links oben) der Instrument-Grafik */
export const BAND_PROP_AT: Record<string, [number, number]> = {
  drums: [-5, 16],
  bass: [1, 9],
  chords: [2, 12],
  melody: [8, 10],
  shaker: [11, 12],
};

export function drumKit(): Pix {
  const p = new Pix(26, 12);
  // Becken links auf Ständer
  p.vline(3, 3, 9, '#8a857c');
  p.hline(0, 2, 7, '#e8c25a').hline(1, 1, 5, '#ffd25e');
  // Snare rechts
  p.rect(18, 4, 7, 4, '#f4efe2').hline(18, 4, 7, '#c9c3b5').hline(18, 7, 7, '#a7a39a');
  p.vline(21, 8, 4, '#8a857c');
  // Bassdrum vorne Mitte
  p.disc(12.5, 7, 5.6, '#e0503f');
  p.disc(12.5, 7, 4.2, '#f4efe2');
  p.disc(12.5, 7, 1.6, '#e0503f');
  // Sticks
  p.px(8, 1, C.woodLight).px(9, 2, C.woodLight).px(17, 1, C.woodLight).px(16, 2, C.woodLight);
  p.outline(C.outline);
  return p;
}

export function bassGuitar(): Pix {
  const p = new Pix(16, 14);
  // Hals diagonal nach rechts oben
  for (let i = 0; i < 10; i++) p.px(6 + i, 9 - Math.floor(i * 0.9), '#5e3518');
  p.rect(14, 0, 2, 2, '#2d1b12');
  // Korpus
  p.ellipse(4.5, 10, 4, 3.2, '#7a3fb0');
  p.ellipse(4, 9.5, 2.4, 1.8, '#9b5fc0');
  p.px(5, 10, '#f4efe2');
  p.outline(C.outline);
  return p;
}

export function ukulele(): Pix {
  const p = new Pix(12, 10);
  for (let i = 0; i < 7; i++) p.px(5 + i, 6 - Math.floor(i * 0.8), '#8d5629');
  p.rect(10, 0, 2, 2, '#5e3518');
  p.ellipse(3.5, 6.5, 3.2, 2.8, '#d39a5c');
  p.disc(4, 6, 1, '#5e3518');
  p.outline(C.outline);
  return p;
}

export function trumpet(): Pix {
  const p = new Pix(13, 6);
  p.hline(0, 3, 9, '#e8c25a');
  p.hline(0, 2, 2, '#c99a2b');
  p.rect(3, 1, 4, 1, '#d99a2b');
  p.px(4, 0, '#ffd25e').px(6, 0, '#ffd25e');
  // Schalltrichter
  p.rect(9, 1, 2, 5, '#ffd25e');
  p.rect(11, 0, 2, 6, '#ffe39a');
  p.outline(C.outline);
  return p;
}

export function coconutShaker(): Pix {
  const p = new Pix(6, 8);
  p.vline(3, 5, 3, '#8d5629');
  p.disc(3, 3, 2.6, '#7a4a26');
  p.px(2, 2, '#a97a43').px(3, 1, '#a97a43');
  p.outline(C.outline);
  return p;
}

export const BAND_PROPS: Record<string, () => Pix> = { drums: drumKit, bass: bassGuitar, chords: ukulele, melody: trumpet, shaker: coconutShaker };

/** Grünes „bereit“-Abzeichen mit Haken (über dem Kopf, solange die Instrumente gewählt werden) */
export function readyBadge(): Pix {
  const p = new Pix(13, 13);
  p.disc(6.5, 6.5, 5, '#46b04a');
  p.disc(6.5, 5.5, 3.5, '#5fc45e');
  for (const [x, y] of [[3, 6], [4, 7], [5, 8], [6, 7], [7, 6], [8, 5], [9, 4]]) p.px(x, y, '#fdf7ea').px(x, y + 1, '#fdf7ea');
  p.outline(C.outline);
  return p;
}

/** Achtelnote (weiß, wird eingefärbt) */
export function noteGlyph(): Pix {
  const p = new Pix(7, 9);
  p.vline(4, 0, 7, '#ffffff');
  p.px(5, 0, '#ffffff').px(6, 1, '#ffffff').px(6, 2, '#ffffff');
  p.rect(1, 6, 4, 3, '#ffffff');
  p.outline(shade('#2d1b12', 1));
  return p;
}

/** Lichtkegel (weiß, halbtransparent, wird eingefärbt und additiv geblendet) */
export function lightCone(): HTMLCanvasElement {
  const w = 70;
  const h = 170;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    const half = 2 + (y / h) * (w / 2 - 2);
    const a = 0.55 * (1 - y / h) ** 0.8;
    g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    g.fillRect(Math.round(w / 2 - half), y, Math.round(half * 2), 1);
  }
  return c;
}
