import type { Look } from './types';

/**
 * Prozedurale Pixel-Avatare (12 × 18 Pixel).
 * Später können hier echte, aus Fotos erzeugte Sprites eingehängt werden.
 */
export const AV_W = 12;
export const AV_H = 18;

export const SKINS = ['#f7d6b8', '#e8b48a', '#c68642', '#8d5524', '#5c3a21'];
export const HAIRS = ['#2b1d0e', '#6b4423', '#d8b25a', '#b5462b', '#e8e8e8', '#3a6fd8', '#d94fa6'];
export const SHIRTS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ecf0f1'];
export const HAIR_STYLES = ['Kurz', 'Lang', 'Stachelig', 'Cap', 'Glatze'];

const BASE = [
  '............',
  '............',
  '...ssssss...',
  '...ssssss...',
  '...sesses...',
  '...ssssss...',
  '....ssss....',
  '.....ss.....',
  '..tttttttt..',
  '.tttttttttt.',
  '.tttttttttt.',
  '.s.tttttt.s.',
  '...tttttt...',
  '...pppppp...',
  '...pp..pp...',
  '...pp..pp...',
  '..bbb..bbb..',
  '............',
];

/** Haar-Overlays: 'h' = Haarfarbe, alles andere bleibt wie BASE */
const HAIR_OVERLAYS: Record<number, string[]> = {
  0: ['', '...hhhhhh...', '..hhhhhhhh..', '..h......h..'],
  1: ['', '...hhhhhh...', '..hhhhhhhh..', '..h......h..', '..h......h..', '..h......h..', '..hh....hh..'],
  2: ['...h.h.h.h..', '...hhhhhh...', '..hhhhhhhh..'],
  3: ['', '...hhhhhh...', '..hhhhhhhhhh'],
  4: [],
};

export function randomLook(): Look {
  const r = (n: number) => Math.floor(Math.random() * n);
  return { skin: r(SKINS.length), hair: r(HAIRS.length), hairStyle: r(HAIR_STYLES.length), shirt: r(SHIRTS.length) };
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
  };
}

export function drawAvatar(ctx: CanvasRenderingContext2D, look: Look, ox = 0, oy = 0, scale = 1) {
  const colors: Record<string, string> = {
    s: SKINS[look.skin] ?? SKINS[0],
    e: '#1a1a1a',
    t: SHIRTS[look.shirt] ?? SHIRTS[0],
    p: '#2c3e50',
    b: '#3b2a1a',
    h: HAIRS[look.hair] ?? HAIRS[0],
  };
  const overlay = HAIR_OVERLAYS[look.hairStyle] ?? [];
  for (let y = 0; y < AV_H; y++) {
    for (let x = 0; x < AV_W; x++) {
      const o = overlay[y]?.[x];
      const c = o === 'h' ? 'h' : BASE[y][x];
      if (c === '.') continue;
      ctx.fillStyle = colors[c];
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
}
