/**
 * Sektkorken: Strandbar bei Sonnenuntergang (links, eine TV-Breite) und der lange Strand dahinter, auf dem die
 * Korken landen; dazu Flasche (zu / offen / geplatzt), Korken, Daumen, Fähnchen und Weiten-Pfosten.
 */
import { Pix, rng, shade } from './pix';
import { C } from './palette';
import { paintSand, paintShore, paintSky, paintWater } from './ground';

/** Geometrie der Szene (Welt-Pixel) */
export const SEKT_TV = {
  /** Gesamtbreite: Bar (0 … 480) + Strand */
  W: 1280,
  H: 270,
  HORIZON: 92,
  SHORE: 128,
  /** Oberkante der Bartheke (Flaschenböden) */
  BAR_TOP: 194,
  /** Ende der Theke / Abwurflinie (0 m) */
  LAUNCH_X: 490,
  /** Pixel pro Meter am Strand */
  PXM: 14.5,
  /** Hier landen die Korken */
  SAND_Y: 214,
};

const GLASS = '#2f7d3a';
const GLASS_DARK = '#1f5a2a';
const GLASS_LIGHT = '#6cc07a';
const FOIL = C.gold;
const FOIL_DARK = C.goldDark;
const LABEL = '#fbf3dc';

/** Hintergrund 1280 × 270: Himmel, Meer, Strand und links die Strandbar mit Lichterkette */
export function paintSektWorld(p: Pix) {
  const { W, H, HORIZON, SHORE, BAR_TOP } = SEKT_TV;
  paintSky(p, 0, 0, W, HORIZON, ['#3b3f7a', '#7a4f95', '#d66f8f', '#f4a46f', '#ffd38a']);
  // Sonne halb im Meer, über dem Strand
  p.clip(0, 0, W, HORIZON, () => {
    p.disc(860, HORIZON + 2, 26, '#ffe7a6');
    p.disc(860, HORIZON + 2, 21, '#fff3c9');
  });
  // ein paar Wolkenstreifen
  const r = rng(41);
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(r() * W);
    const y = 12 + Math.floor(r() * 50);
    const w = 20 + Math.floor(r() * 50);
    p.rect(x, y, w, 2, 'rgba(255, 214, 190, 0.55)');
    p.rect(x + 6, y - 2, Math.floor(w * 0.5), 2, 'rgba(255, 230, 210, 0.45)');
  }
  paintWater(p, 0, HORIZON, W, SHORE - HORIZON, 23);
  // Sonnen-Glitzer auf dem Wasser
  for (let j = 0; j < 14; j++) {
    const y = HORIZON + 3 + j * 2.4;
    const w = 30 - j;
    p.rect(860 - w / 2 + Math.floor(r() * 6 - 3), y, w, 1, 'rgba(255, 231, 166, 0.7)');
  }
  paintSand(p, 0, SHORE, W, H - SHORE, 29);
  paintShore(p, 0, SHORE, W, 31);
  // feuchter Sand am Ufer
  p.rect(0, SHORE + 1, W, 4, 'rgba(201, 154, 94, 0.35)');

  // ---- Strandbar (links): Theke mit Bambus-Front, Strohdach-Kante oben
  const front = BAR_TOP + 4;
  p.rect(0, BAR_TOP - 2, 482, 6, C.woodLight);
  p.hline(0, BAR_TOP - 2, 482, '#e7b77a');
  p.hline(0, BAR_TOP + 3, 482, C.woodDarker);
  p.rect(0, front, 480, H - front, '#6a3d1c');
  for (let x = 0; x < 480; x += 8) {
    p.rect(x, front, 7, H - front, x % 16 === 0 ? '#8a5527' : '#7d4a22');
    p.vline(x + 1, front, H - front, '#a8703a');
    for (let y = front + 14; y < H; y += 22) p.hline(x, y, 7, C.woodDarker);
  }
  p.rect(476, BAR_TOP - 6, 6, H - BAR_TOP + 6, C.woodDark);
  p.vline(477, BAR_TOP - 6, H - BAR_TOP + 6, C.woodLight);

  // Lichterkette über der Bar
  const bulbs = ['#ffd25e', '#e0503f', '#7fd4ff', '#46b04a', '#f07aa8'];
  for (let x = 0; x <= 480; x++) {
    const seg = x % 120;
    const y = 30 + Math.round(Math.sin((seg / 120) * Math.PI) * 14);
    p.px(x, y, '#2d1b12');
    if (seg % 15 === 7) {
      p.rect(x - 1, y + 1, 3, 4, bulbs[(x / 15) % bulbs.length | 0]);
      p.px(x, y + 1, '#fff4d6');
    }
  }
  // Dünen-Grasbüschel am Strand
  for (let i = 0; i < 26; i++) {
    const x = 500 + Math.floor(r() * (W - 520));
    const y = SHORE + 20 + Math.floor(r() * 40);
    for (let k = 0; k < 4; k++) p.vline(x + k * 2, y - 2 - (k % 2) * 2, 3 + (k % 2) * 2, k % 2 ? C.grassDark : C.grassLight);
  }
}

/** Flasche 14 × 40 (Etikett in Spielerfarbe): zu (ohne Korken – der ist ein eigenes Bild), offen oder geplatzt */
export function bottlePix(color: string, variant: 'closed' | 'open' | 'broken'): Pix {
  const p = new Pix(16, 42);
  const ox = 1;
  const oy = 1;
  const body = () => {
    p.ellipse(ox + 7, oy + 17, 6, 5, GLASS);
    p.rect(ox + 1, oy + 17, 12, 22, GLASS);
    p.rect(ox + 2, oy + 39, 10, 1, GLASS_DARK);
    p.vline(ox + 3, oy + 16, 22, GLASS_LIGHT);
    p.vline(ox + 4, oy + 18, 4, GLASS_LIGHT);
    p.vline(ox + 11, oy + 17, 22, GLASS_DARK);
    // Etikett: creme, breiter Streifen in Spielerfarbe
    p.rect(ox + 1, oy + 23, 12, 10, LABEL);
    p.rect(ox + 1, oy + 26, 12, 4, color);
    p.hline(ox + 1, oy + 25, 12, shade(color, 0.7));
    p.hline(ox + 1, oy + 30, 12, shade(color, 0.7));
    p.hline(ox + 1, oy + 33, 12, '#d9c79a');
  };
  if (variant === 'broken') {
    // nur der Boden steht noch, oben gezackt
    p.rect(ox + 1, oy + 26, 12, 13, GLASS);
    p.rect(ox + 2, oy + 39, 10, 1, GLASS_DARK);
    p.vline(ox + 3, oy + 27, 11, GLASS_LIGHT);
    p.vline(ox + 11, oy + 26, 13, GLASS_DARK);
    p.rect(ox + 1, oy + 28, 12, 5, LABEL);
    p.rect(ox + 1, oy + 29, 12, 3, color);
    const teeth = [3, 0, 2, 4, 1, 3, 0, 2, 4, 1, 3, 2];
    teeth.forEach((d, i) => p.vline(ox + 1 + i, oy + 26 - d, d, GLASS));
    p.outline(C.outline);
    return p;
  }
  body();
  // Hals mit Folie
  p.rect(ox + 5, oy + 4, 4, 10, GLASS);
  const foilTop = variant === 'open' ? 3 : 0;
  p.rect(ox + 4, oy + foilTop, 6, 10 - foilTop, FOIL);
  p.vline(ox + 5, oy + foilTop + 1, 8 - foilTop, '#fff1b0');
  p.vline(ox + 9, oy + foilTop, 10 - foilTop, FOIL_DARK);
  p.hline(ox + 4, oy + 9, 6, FOIL_DARK);
  if (variant === 'open') {
    // Schaum quillt aus dem Hals
    p.rect(ox + 4, oy + 1, 6, 2, '#fdf7ea');
    p.px(ox + 3, oy + 2, '#fdf7ea').px(ox + 10, oy + 2, '#f6e7a8');
  } else {
    // Agraffe (Draht)
    p.hline(ox + 4, oy + 3, 6, '#b8b2a6');
    p.px(ox + 6, oy + 1, '#b8b2a6').px(ox + 7, oy + 2, '#b8b2a6');
  }
  p.outline(C.outline);
  return p;
}

/** Korken (Pilzform) 8 × 8 */
export function corkPix(): Pix {
  const p = new Pix(8, 8);
  p.map(1, 1, ['.cccc.', 'cCcccc', 'cccccd', '.cddc.', '.cddc.', '.cddc.'], { c: '#d9a868', C: '#f0cf98', d: '#b07a40' });
  p.outline(C.outline);
  return p;
}

/** Daumen von oben auf dem Korken 10 × 7 */
export function thumbPix(): Pix {
  const p = new Pix(10, 7);
  p.map(1, 1, ['.ssssss.', 'sssnnsss', 'sssnnsss', 'ssssssss', '.SSSSSS.'], { s: '#f2c7a0', n: '#fde9da', S: '#d9a27a' });
  p.outline(C.outline);
  return p;
}

/** Fähnchen in Spielerfarbe (Stiel 14 px) 9 × 16 */
export function flagPix(color: string): Pix {
  const p = new Pix(9, 16);
  p.vline(1, 1, 14, '#5e3518');
  p.map(2, 1, ['ffffff', 'fffff.', 'ffff..', 'fff...'], { f: color });
  p.hline(2, 1, 6, shade(color, 1.35));
  p.outline(C.outline);
  return p;
}

/** Weiten-Pfosten mit Schild (Text kommt von Phaser) 30 × 26 */
export function postPix(): Pix {
  const p = new Pix(30, 26);
  p.rect(14, 9, 3, 16, C.woodDark);
  p.vline(14, 9, 16, C.wood);
  p.rect(1, 1, 28, 9, C.paper);
  p.hline(1, 9, 28, C.paperDark);
  p.outline(C.outline);
  return p;
}

/** Kleiner Pflock alle 5 m 3 × 8 */
export function pegPix(): Pix {
  const p = new Pix(3, 8);
  p.rect(1, 1, 1, 6, C.woodDark);
  p.outline(C.outline);
  return p;
}
