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

/**
 * Pose für Animations-Frames – leer = Standbild (Porträts, Listen, alte Texturen bleiben unverändert).
 * Alle Frames entstehen prozedural aus denselben Look-Daten.
 */
export interface AvatarPose {
  /** Oberkörper + Kopf vertikal versetzen (+1 = geduckt, −1 = gestreckt) */
  dy?: number;
  /** Beine: stehen, linken/rechten Fuß anheben (Laufen), angezogen (Sprung) */
  legs?: 'stand' | 'liftL' | 'liftR' | 'tuck';
  /** Arme: hängen, linke/rechte Hand vorn (Laufen), seitlich hoch (Sprung, Treffer), Arme hoch (Jubel) */
  arms?: 'down' | 'swingL' | 'swingR' | 'out' | 'up';
  /** Gesicht: normal, Augen zu (Blinzeln), zugekniffen + Mund auf (Treffer), Grinsen (Jubel) */
  face?: 'normal' | 'blink' | 'hit' | 'happy';
  /** Ansicht: von vorn (Standard) oder von hinten – dann Hinterkopf mit Haaren statt Gesicht (Glatze: glatte Haut) */
  view?: 'front' | 'back';
}

/** Baut das Pixel-Raster (null = transparent) */
export function avatarGrid(look: Look, pose: AvatarPose = {}): (string | null)[][] {
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
  const dy = Math.max(-1, Math.min(1, Math.round(pose.dy ?? 0)));
  const U = Y + dy; // Oberkörper + Kopf (Beine bleiben am Boden)
  const legs = pose.legs ?? 'stand';
  const arms = pose.arms ?? 'down';
  const face = pose.face ?? 'normal';
  const back = pose.view === 'back';

  // Beine & Schuhe
  const leg = (x: number, lift: number, shoe: number) => {
    rect(x, Y + 19, 3, 3 - lift, PANTS);
    set(x + 2, Y + 19, shade(PANTS, 0.8));
    rect(x, Y + 22 - lift, 3, 1, SHOES);
    set(shoe, Y + 22 - lift, SHOES);
  };
  if (legs === 'tuck') {
    // Sprung: Füße angezogen und leicht gegrätscht
    rect(4, Y + 18, 8, 1, PANTS);
    leg(3, 1, 2);
    leg(10, 1, 13);
  } else {
    rect(4, Y + 18, 8, 1, PANTS);
    leg(4, legs === 'liftL' ? 1 : 0, 3);
    leg(9, legs === 'liftR' ? 1 : 0, 12);
  }
  // Gestreckt (Oberkörper höher): Hosenbund nachziehen, damit keine Lücke entsteht
  if (dy < 0) rect(4, Y + 17, 8, -dy, PANTS);

  // Oberkörper
  rect(4, U + 12, 8, 6, shirt);
  rect(11, U + 12, 1, 6, shirtS);
  rect(4, U + 17, 8, 1, shirtS);
  rect(5, U + 12, 1, 4, shirtL);
  set(7, U + 12, skinS);
  set(8, U + 12, skinS);
  // Arme (hängend/schwingend; hochgereckte Arme kommen nach der Frisur, damit sie davor liegen)
  const armDown = (x: number, len: number, c: string, hand: string, out = 0) => {
    rect(x, U + 12, 1, Math.min(len, 3), c);
    if (len > 3) rect(x + out, U + 15, 1, len - 3, c);
    set(x + out, U + 12 + len, hand);
  };
  if (arms === 'down') {
    armDown(3, 4, shirt, skin);
    armDown(12, 4, shirtS, skinS);
  } else if (arms === 'swingL' || arms === 'swingR') {
    // vordere Hand kürzer und etwas nach außen, hintere hängt einen Pixel tiefer
    const l = arms === 'swingL';
    armDown(3, l ? 3 : 5, shirt, skin, 0);
    armDown(12, l ? 5 : 3, shirtS, skinS, 0);
    if (l) set(2, U + 15, skin);
    else set(13, U + 15, skinS);
    if (l) g[U + 15][3] = null;
    else g[U + 15][12] = null;
  }

  // Kopf (abgerundet)
  rect(4, U + 3, 8, 8, skin);
  rect(3, U + 5, 1, 4, skin);
  rect(12, U + 5, 1, 4, skinS);
  rect(5, U + 10, 6, 1, skinSoft);
  rect(11, U + 4, 1, 6, skinSoft);
  g[U + 3][4] = null;
  g[U + 3][11] = null;
  g[U + 10][4] = null;
  g[U + 10][11] = null;
  // Hals
  rect(6, U + 11, 4, 1, skinSoft);

  if (!back) {
    // Gesicht
    set(6, U + 7, EYE);
    set(6, U + 8, EYE);
    set(9, U + 7, EYE);
    set(9, U + 8, EYE);
    set(5, U + 9, '#f0928a');
    set(10, U + 9, '#f0928a');
    set(7, U + 9, shade(skin, 0.7));
    set(8, U + 9, shade(skin, 0.7));

    // Bart (in Haarfarbe)
    const bc = look.beard === 1 ? shade(hair, 1.15) : hair;
    switch (look.beard) {
      case 1: // 3-Tage
        for (const [x, y] of [[4, 9], [5, 10], [7, 10], [9, 10], [11, 9], [6, 10], [10, 10], [8, 10]]) set(x, U + y, bc);
        break;
      case 2: // Vollbart
        rect(4, U + 8, 1, 3, hair);
        rect(11, U + 8, 1, 3, hairS);
        rect(5, U + 10, 6, 2, hair);
        rect(6, U + 9, 1, 1, hair);
        rect(9, U + 9, 1, 1, hair);
        set(7, U + 9, shade(skin, 0.7));
        set(8, U + 9, shade(skin, 0.7));
        break;
      case 3: // Schnauzer
        rect(6, U + 9, 4, 1, hair);
        set(5, U + 9, hairS);
        set(10, U + 9, hairS);
        break;
      case 4: // Kinnbart
        rect(7, U + 10, 2, 2, hair);
        break;
    }

  }

  // Frisuren
  const cap = () => {
    rect(4, U + 1, 8, 1, hair);
    rect(3, U + 2, 10, 2, hair);
    rect(3, U + 4, 2, 2, hair);
    rect(11, U + 4, 2, 2, hairS);
    rect(5, U + 4, 6, 1, hair);
    set(6, U + 2, hairL);
    set(7, U + 2, hairL);
    rect(3, U + 3, 10, 1, hairS);
    rect(4, U + 2, 8, 1, hair);
  };
  // Hinterkopf: Haare über dem ganzen Kopf, kein Gesicht (Glatze: glatte Haut mit Glanzpunkt)
  const backHair = () => {
    const style = look.hairStyle;
    if (style === 7) {
      set(6, U + 4, shade(skin, 1.25));
      set(7, U + 4, shade(skin, 1.15));
      rect(5, U + 9, 6, 1, skinS);
      return;
    }
    if (style === 3) {
      // Cap von hinten: Kappe bis über die Ohren, darunter der Hinterkopf, Verstellband
      rect(5, U + 1, 6, 1, hair);
      rect(3, U + 2, 10, 4, hair);
      rect(11, U + 2, 2, 4, hairS);
      rect(4, U + 6, 8, 1, hairS);
      set(7, U + 6, hairL);
      set(8, U + 6, hairL);
      set(6, U + 2, hairL);
      set(7, U + 1, hairL);
      return;
    }
    rect(4, U + 1, 8, 1, hair);
    rect(3, U + 2, 10, 7, hair);
    rect(4, U + 9, 8, style === 1 ? 4 : 1, hair);
    rect(11, U + 2, 2, 8, hairS);
    set(6, U + 2, hairL);
    set(7, U + 2, hairL);
    set(5, U + 3, hairL);
    set(8, U + 4, hairS);
    set(8, U + 5, hairS);
    set(7, U + 6, hairS);
    if (style === 1) {
      // lang: Haar fällt über den Nacken auf die Schultern
      rect(3, U + 9, 1, 4, hair);
      rect(12, U + 9, 1, 4, hairS);
      set(6, U + 11, hairS);
      set(9, U + 12, hairS);
      set(5, U + 13, hair);
    } else {
      // Nacken: Haaransatz, darunter Haut
      rect(5, U + 10, 6, 1, skinSoft);
    }
    if (style === 2) for (const [x, y] of [[4, 0], [7, 0], [10, 0], [5, 1], [8, 1]]) set(x, U + y, y === 0 ? hair : hairL);
    if (style === 4) {
      rect(6, U - 2, 4, 3, hair);
      set(7, U - 2, hairL);
    }
    if (style === 5) {
      // Zopf: hängt in der Mitte den Rücken hinunter
      rect(7, U + 10, 2, 7, hair);
      set(7, U + 12, hairS);
      set(8, U + 14, hairS);
      set(7, U + 16, hairL);
    }
    if (style === 6) {
      for (const [x, y] of [[2, 3], [2, 6], [13, 3], [13, 6], [5, 0], [9, 0], [3, 8], [12, 8]]) {
        set(x, U + y, hair);
        set(x, U + y + 1, hairS);
      }
    }
  };
  if (back) backHair();
  else switch (look.hairStyle) {
    case 0: // kurz
      cap();
      set(5, U + 5, hair);
      break;
    case 1: // lang
      cap();
      rect(2, U + 4, 2, 9, hair);
      rect(12, U + 4, 2, 9, hairS);
      set(4, U + 5, hair);
      break;
    case 2: // stachelig
      cap();
      set(4, U, hair);
      set(7, U, hair);
      set(10, U, hair);
      set(5, U + 1, hairL);
      set(8, U + 1, hairL);
      break;
    case 3: {
      // Cap (Mütze in Haarfarbe) mit Schirm
      rect(4, U + 1, 8, 1, hair);
      rect(3, U + 2, 10, 2, hair);
      set(5, U + 2, hairL);
      rect(3, U + 4, 12, 1, hairS);
      set(7, U + 1, hairL);
      break;
    }
    case 4: // Dutt
      cap();
      rect(6, U - 2, 4, 3, hair);
      set(7, U - 2, hairL);
      break;
    case 5: // Zopf
      cap();
      rect(12, U + 6, 2, 3, hairS);
      rect(13, U + 9, 2, 4, hair);
      break;
    case 6: // Locken
      cap();
      for (const [x, y] of [
        [2, 3], [2, 6], [13, 3], [13, 6], [5, 0], [9, 0], [3, 8], [12, 8],
      ]) {
        set(x, U + y, hair);
        set(x, U + y + 1, hairS);
      }
      break;
    default:
      // Glatze mit Glanzpunkt
      set(6, U + 4, shade(skin, 1.25));
      break;
  }

  // Hochgereckte Arme (Sprung/Treffer: schräg nach außen, Jubel: senkrecht neben dem Kopf)
  if (arms === 'out') {
    set(3, U + 12, shirt);
    set(2, U + 11, shirt);
    set(1, U + 10, skin);
    set(12, U + 12, shirtS);
    set(13, U + 11, shirtS);
    set(14, U + 10, skinS);
  } else if (arms === 'up') {
    // \o/ – Ärmel schräg nach außen, Unterarme senkrecht bis über die Stirn
    set(3, U + 12, shirt);
    set(2, U + 11, shirt);
    rect(1, U + 9, 1, 2, shirt);
    rect(1, U + 2, 1, 7, skin);
    set(12, U + 12, shirtS);
    set(13, U + 11, shirtS);
    rect(14, U + 9, 1, 2, shirtS);
    rect(14, U + 2, 1, 7, skinS);
  }

  // Gesichtsausdruck (über Bart und Frisur)
  const mouth = '#7a2a20';
  if (face === 'blink') {
    // Augen zu: waagrechter Strich auf Höhe der Unterkante
    set(6, U + 7, skin);
    set(9, U + 7, skin);
    set(5, U + 8, EYE);
    set(10, U + 8, EYE);
  } else if (face === 'hit') {
    // > <  zugekniffen, Mund offen
    for (const [x, y] of [[6, 7], [6, 8], [9, 7], [9, 8]]) set(x, U + y, skin);
    set(5, U + 7, EYE);
    set(6, U + 8, EYE);
    set(5, U + 9, EYE);
    set(10, U + 7, EYE);
    set(9, U + 8, EYE);
    set(10, U + 9, EYE);
    rect(7, U + 9, 2, 2, mouth);
  } else if (face === 'happy') {
    // breites Grinsen
    rect(6, U + 9, 4, 1, mouth);
    set(7, U + 10, '#e0605a');
    set(8, U + 10, '#e0605a');
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

export function drawAvatar(ctx: CanvasRenderingContext2D, look: Look, ox = 0, oy = 0, scale = 1, pose?: AvatarPose) {
  const grid = avatarGrid(look, pose);
  for (let y = 0; y < AV_H; y++) {
    for (let x = 0; x < AV_W; x++) {
      const c = grid[y][x];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
}

// ------------------------------------------------------------------ Animations-Frames

export type AvatarAnim = 'idle' | 'walk' | 'jump' | 'hit' | 'cheer';

/**
 * Spritesheet-Zeilen (je eine Animation, Frames à AV_W × AV_H). Zeile 0 Frame 0 ist das Standbild.
 * idle: Standbild + Blinzeln · walk: 4 Frames (Fuß hoch / Mitte geduckt, Arme gegengleich) ·
 * jump: angezogene Beine, Arme hoch · hit: Treffer-Gesicht · cheer: Arme hoch, zweiter Frame mit Hüpfer.
 */
export const AV_SHEET_ROWS: { anim: AvatarAnim; poses: AvatarPose[] }[] = [
  { anim: 'idle', poses: [{}, { face: 'blink' }] },
  {
    anim: 'walk',
    poses: [
      { legs: 'liftL', arms: 'swingR' },
      { dy: 1 },
      { legs: 'liftR', arms: 'swingL' },
      { dy: 1 },
    ],
  },
  { anim: 'jump', poses: [{ legs: 'tuck', arms: 'out', dy: -1 }] },
  { anim: 'hit', poses: [{ arms: 'out', face: 'hit' }] },
  { anim: 'cheer', poses: [{ arms: 'up', face: 'happy' }, { arms: 'up', face: 'happy', dy: -1, legs: 'tuck' }] },
];
export const AV_SHEET_COLS = Math.max(...AV_SHEET_ROWS.map((r) => r.poses.length));

/** Frame-Nummern (zeilenweise durchgezählt) einer Animation */
export function avatarFrames(anim: AvatarAnim): number[] {
  const row = Math.max(0, AV_SHEET_ROWS.findIndex((r) => r.anim === anim));
  return AV_SHEET_ROWS[row].poses.map((_, i) => row * AV_SHEET_COLS + i);
}

/** Zeichnet das ganze Spritesheet (AV_SHEET_COLS × Zeilen) – leere Zellen bleiben transparent */
export function drawAvatarSheet(ctx: CanvasRenderingContext2D, look: Look, scale = 1, gap = 0) {
  AV_SHEET_ROWS.forEach((row, r) =>
    row.poses.forEach((pose, i) => drawAvatar(ctx, look, i * (AV_W + gap) * scale, r * (AV_H + gap) * scale, scale, pose)),
  );
}
