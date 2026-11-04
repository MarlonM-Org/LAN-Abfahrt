import type { Look } from './types';

/**
 * Prozedurale Pixel-Figuren (16 × 27) im Cozy-Farm-Look:
 * großer Kopf, Schattierung und automatische dunkle Kontur.
 * Später können hier echte, aus Fotos erzeugte Sprites eingehängt werden.
 */
export const AV_W = 16;
export const AV_H = 27;

export const SKINS = ['#f9d8bd', '#efbf98', '#d79b6a', '#a8693f', '#7a4a2b', '#5a3420'];
export const HAIRS = ['#3a2418', '#6e4426', '#a8642e', '#e2b65a', '#c0442e', '#ece6dc', '#2d2d3a', '#4c7ad8', '#d65a9c', '#4fa36a'];
export const SHIRTS = ['#e0503f', '#3f8fe0', '#46b04a', '#f2c33a', '#9b5fc0', '#f0973a', '#2fb5a5', '#f4efe2', '#3b3b4f', '#f07aa8'];
export const HAIR_STYLES = ['Kurz', 'Lang', 'Stachelig', 'Cap', 'Dutt', 'Zopf', 'Locken', 'Glatze'];
export const BEARDS = ['Kein Bart', '3-Tage', 'Vollbart', 'Schnauzer', 'Kinnbart'];

const OUTLINE = '#2d1b12';
const EYE = '#2d1b12';
const PANTS = '#4a5a86';
const SHOES = '#5b3a24';

export function randomLook(): Look {
  const r = (n: number) => Math.floor(Math.random() * n);
  return { skin: r(SKINS.length), hair: r(HAIRS.length), hairStyle: r(HAIR_STYLES.length), shirt: r(SHIRTS.length), beard: Math.random() < 0.3 ? 1 + r(BEARDS.length - 1) : 0 };
}

export function sanitizeLook(look: Partial<Look> | undefined): Look {
  const fix = (v: unknown, n: number) => {
    const i = Math.floor(Number(v));
    return Number.isFinite(i) ? ((i % n) + n) % n : 0;
  };
  return {
    skin: fix(look?.skin, SKINS.length),
    hair: fix(look?.hair, HAIRS.length),
    hairStyle: fix(look?.hairStyle, HAIR_STYLES.length),
    shirt: fix(look?.shirt, SHIRTS.length),
    beard: fix(look?.beard, BEARDS.length),
  };
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f > 1 ? v + (255 - v) * (f - 1) : v * f)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Baut das Pixel-Raster (null = transparent) */
export function avatarGrid(look: Look): (string | null)[][] {
  const g: (string | null)[][] = Array.from({ length: AV_H }, () => Array<string | null>(AV_W).fill(null));
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < AV_W && y < AV_H) g[y][x] = c;
  };
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c);
  };

  const skin = SKINS[look.skin] ?? SKINS[0];
  const skinS = shade(skin, 0.82);
  const skinSoft = shade(skin, 0.92);
  const shirt = SHIRTS[look.shirt] ?? SHIRTS[0];
  const shirtS = shade(shirt, 0.78);
  const shirtL = shade(shirt, 1.18);
  const hair = HAIRS[look.hair] ?? HAIRS[0];
  const hairS = shade(hair, 0.75);
  const hairL = shade(hair, 1.3);
  const Y = 3; // vertikaler Versatz, damit Frisuren oben Platz haben

  // Beine & Schuhe
  rect(4, Y + 19, 3, 3, PANTS);
  rect(9, Y + 19, 3, 3, PANTS);
  rect(4, Y + 18, 8, 1, PANTS);
  set(6, Y + 19, shade(PANTS, 0.8));
  set(11, Y + 19, shade(PANTS, 0.8));
  rect(4, Y + 22, 3, 1, SHOES);
  rect(9, Y + 22, 3, 1, SHOES);
  set(3, Y + 22, SHOES);
  set(12, Y + 22, SHOES);

  // Oberkörper
  rect(4, Y + 12, 8, 6, shirt);
  rect(11, Y + 12, 1, 6, shirtS);
  rect(4, Y + 17, 8, 1, shirtS);
  rect(5, Y + 12, 1, 4, shirtL);
  set(7, Y + 12, skinS);
  set(8, Y + 12, skinS);
  // Arme
  rect(3, Y + 12, 1, 4, shirt);
  rect(12, Y + 12, 1, 4, shirtS);
  set(3, Y + 16, skin);
  set(12, Y + 16, skinS);

  // Kopf (abgerundet)
  rect(4, Y + 3, 8, 8, skin);
  rect(3, Y + 5, 1, 4, skin);
  rect(12, Y + 5, 1, 4, skinS);
  rect(5, Y + 10, 6, 1, skinSoft);
  rect(11, Y + 4, 1, 6, skinSoft);
  g[Y + 3][4] = null;
  g[Y + 3][11] = null;
  g[Y + 10][4] = null;
  g[Y + 10][11] = null;
  // Hals
  rect(6, Y + 11, 4, 1, skinSoft);

  // Gesicht
  set(6, Y + 7, EYE);
  set(6, Y + 8, EYE);
  set(9, Y + 7, EYE);
  set(9, Y + 8, EYE);
  set(5, Y + 9, '#f0928a');
  set(10, Y + 9, '#f0928a');
  set(7, Y + 9, shade(skin, 0.7));
  set(8, Y + 9, shade(skin, 0.7));

  // Bart (in Haarfarbe)
  const bc = look.beard === 1 ? shade(hair, 1.15) : hair;
  switch (look.beard) {
    case 1: // 3-Tage
      for (const [x, y] of [[4, 9], [5, 10], [7, 10], [9, 10], [11, 9], [6, 10], [10, 10], [8, 10]]) set(x, Y + y, bc);
      break;
    case 2: // Vollbart
      rect(4, Y + 8, 1, 3, hair);
      rect(11, Y + 8, 1, 3, hairS);
      rect(5, Y + 10, 6, 2, hair);
      rect(6, Y + 9, 1, 1, hair);
      rect(9, Y + 9, 1, 1, hair);
      set(7, Y + 9, shade(skin, 0.7));
      set(8, Y + 9, shade(skin, 0.7));
      break;
    case 3: // Schnauzer
      rect(6, Y + 9, 4, 1, hair);
      set(5, Y + 9, hairS);
      set(10, Y + 9, hairS);
      break;
    case 4: // Kinnbart
      rect(7, Y + 10, 2, 2, hair);
      break;
  }

  // Frisuren
  const cap = () => {
    rect(4, Y + 1, 8, 1, hair);
    rect(3, Y + 2, 10, 2, hair);
    rect(3, Y + 4, 2, 2, hair);
    rect(11, Y + 4, 2, 2, hairS);
    rect(5, Y + 4, 6, 1, hair);
    set(6, Y + 2, hairL);
    set(7, Y + 2, hairL);
    rect(3, Y + 3, 10, 1, hairS);
    rect(4, Y + 2, 8, 1, hair);
  };
  switch (look.hairStyle) {
    case 0: // kurz
      cap();
      set(5, Y + 5, hair);
      break;
    case 1: // lang
      cap();
      rect(2, Y + 4, 2, 9, hair);
      rect(12, Y + 4, 2, 9, hairS);
      set(4, Y + 5, hair);
      break;
    case 2: // stachelig
      cap();
      set(4, Y, hair);
      set(7, Y, hair);
      set(10, Y, hair);
      set(5, Y + 1, hairL);
      set(8, Y + 1, hairL);
      break;
    case 3: {
      // Cap (Mütze in Haarfarbe) mit Schirm
      rect(4, Y + 1, 8, 1, hair);
      rect(3, Y + 2, 10, 2, hair);
      set(5, Y + 2, hairL);
      rect(3, Y + 4, 12, 1, hairS);
      set(7, Y + 1, hairL);
      break;
    }
    case 4: // Dutt
      cap();
      rect(6, Y - 2, 4, 3, hair);
      set(7, Y - 2, hairL);
      break;
    case 5: // Zopf
      cap();
      rect(12, Y + 6, 2, 3, hairS);
      rect(13, Y + 9, 2, 4, hair);
      break;
    case 6: // Locken
      cap();
      for (const [x, y] of [
        [2, 3], [2, 6], [13, 3], [13, 6], [5, 0], [9, 0], [3, 8], [12, 8],
      ]) {
        set(x, Y + y, hair);
        set(x, Y + y + 1, hairS);
      }
      break;
    default:
      // Glatze mit Glanzpunkt
      set(6, Y + 4, shade(skin, 1.25));
      break;
  }

  // Kontur
  const out = g.map((row) => [...row]);
  for (let y = 0; y < AV_H; y++) {
    for (let x = 0; x < AV_W; x++) {
      if (g[y][x]) continue;
      const n = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < AV_W && yy < AV_H && !!g[yy][xx];
      if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) out[y][x] = OUTLINE;
    }
  }
  return out;
}

export function drawAvatar(ctx: CanvasRenderingContext2D, look: Look, ox = 0, oy = 0, scale = 1) {
  const grid = avatarGrid(look);
  for (let y = 0; y < AV_H; y++) {
    for (let x = 0; x < AV_W; x++) {
      const c = grid[y][x];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
}
