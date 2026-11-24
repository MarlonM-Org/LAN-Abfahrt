import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintSand, paintShore, paintSky, paintWater } from './ground';
import { palm, umbrella, towel } from './objects';
import type { Look } from '../../shared/types';
import { SHIRTS, SKINS } from '../../shared/avatar';
import { KB, type KbField, type KbMode } from '../../shared/kopfball';

/**
 * Pixel-Art für Kopfball-Duell (Beach-Soccer am Mittag) und Kopf-Korb (Streetball an der Promenade bei
 * Sonnenuntergang): Kulisse, Tore mit Netz, Korb mit Brett, Bälle und der kleine Körper unter dem Riesenkopf.
 * Welt 480 × 270, Boden bei `KB.GROUND`; der TV zoomt je nach Feldgröße hinein.
 */

const HORIZON = 168;

/** Pix auf ganzzahlige Größe hochskalieren (Pixel bleiben Blöcke) */
export function scaledPix(src: Pix, s: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(src.w * s);
  c.height = Math.round(src.h * s);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(src.canvas, 0, 0, c.width, c.height);
  return c;
}

/** Kulisse ohne Tore/Körbe (die hängen an der Feldgröße und kommen als eigene Bilder) */
export function paintKopfBackdrop(p: Pix, mode: KbMode) {
  const w = p.w;
  const h = p.h;
  const G = KB.GROUND;
  const r = rng(mode === 'fuss' ? 1201 : 1301);
  if (mode === 'fuss') paintSky(p, 0, 0, w, HORIZON, ['#4f9fe0', '#6fb8ec', '#94cff2', '#bfe4f6', '#e4f4f8']);
  else paintSky(p, 0, 0, w, HORIZON, ['#2f3478', '#6e4a8e', '#c85a6a', '#f08a5a', '#ffc36e', '#ffe0a0']);
  if (mode === 'korb') {
    // Sonne halb im Meer
    p.disc(120, HORIZON - 4, 18, '#ffd37a');
    p.disc(120, HORIZON - 4, 15, '#fff0b8');
  } else {
    p.disc(400, 52, 13, '#fff6c8');
    p.disc(400, 52, 10, '#fffbe6');
  }
  // ferne Wolkenbänder
  for (let i = 0; i < 6; i++) {
    const cx = r() * w;
    const cy = 60 + r() * 70;
    const len = 24 + r() * 40;
    p.rect(cx, cy, len, 2, mode === 'fuss' ? '#f4fbff' : i % 2 ? '#f6a07a' : '#e47f78');
    p.rect(cx + 5, cy + 2, len - 12, 1, mode === 'fuss' ? '#d6ecf6' : '#b65a72');
  }
  paintWater(p, 0, HORIZON, w, 22, mode === 'fuss' ? 1202 : 1302);
  if (mode === 'korb') {
    for (let y = HORIZON + 1; y < HORIZON + 22; y += 2) {
      const half = 6 + (y - HORIZON) * 0.7;
      for (let x = 120 - half; x < 120 + half; x += 4) if (r() < 0.55) p.hline(x, y, 2 + Math.floor(r() * 3), '#ffd27a');
    }
  }
  paintSand(p, 0, HORIZON + 22, w, h - HORIZON - 22, mode === 'fuss' ? 1203 : 1303);
  paintShore(p, 0, HORIZON + 23, w, 1204);
  // Palmen, Schirme und Handtücher hinter dem Feld
  for (const [x, s, seed] of [[18, 0.75, 3], [70, 0.55, 5], [410, 0.6, 8], [462, 0.8, 2]] as [number, number, number][]) {
    const c = scaledPix(palm(seed), s);
    p.g.drawImage(c, x - c.width / 2, G - 26 - c.height);
  }
  const u1 = scaledPix(umbrella(mode === 'fuss' ? C.red : '#9b5fc0', C.white), 0.8);
  p.g.drawImage(u1, 150, G - 30 - u1.height);
  const u2 = scaledPix(umbrella('#3fa7e0', C.white), 0.8);
  p.g.drawImage(u2, 300, G - 32 - u2.height);
  const t1 = towel('#f4c542');
  p.g.drawImage(t1.canvas, 196, G - 30);
  if (mode === 'korb') {
    // Promenade: Mauer und Laternen hinter dem Platz
    p.rect(0, G - 26, w, 6, '#c9a26a');
    p.hline(0, G - 26, w, '#e2c08a');
    p.hline(0, G - 21, w, '#8d6a3e');
    for (let x = 30; x < w; x += 90) {
      p.rect(x, G - 70, 2, 44, '#3b3b4f');
      p.rect(x - 3, G - 74, 8, 5, '#3b3b4f');
      p.rect(x - 2, G - 73, 6, 3, '#ffe7a0');
    }
  }
  // Spielfläche: Fußball = Sand mit festgetretener Bahn, Korb = roter Belag
  if (mode === 'fuss') {
    p.rect(0, G, w, h - G, C.sandDark);
    for (let i = 0; i < 300; i++) p.px(r() * w, G + 2 + r() * (h - G - 2), r() < 0.5 ? shade(C.sandDark, 0.88) : C.sand);
  } else {
    p.rect(0, G, w, h - G, '#b5553f');
    p.hline(0, G, w, '#d0735a');
    for (let i = 0; i < 260; i++) p.px(r() * w, G + 2 + r() * (h - G - 2), r() < 0.5 ? '#9c4634' : '#c4654d');
  }
}

/** Linien im Boden (Mittellinie, Torraum bzw. Dreier-Grenze) – passend zur Feldgröße */
export function kopfLines(f: KbField): Pix {
  const p = new Pix(480, 270 - KB.GROUND);
  const col = f.mode === 'fuss' ? '#fdf2d6' : '#f4efe2';
  p.hline(f.x0, 0, f.w, col);
  p.hline(f.x0, 1, f.w, shade(f.mode === 'fuss' ? C.sandDark : '#b5553f', 0.8));
  // Mittelmarke
  p.rect(f.mid - 1, 0, 2, 6, col);
  if (f.mode === 'korb') {
    // Dreier: alles aus der eigenen Hälfte – die Mittellinie ist hier die Dreier-Linie
    for (let y = 2; y < 30; y += 4) p.rect(f.mid - 1, y, 2, 2, '#ffd25e');
  }
  return p;
}

/** Fußballtor von der Seite: Latte oben, Netz nach hinten bis zur Bande. Ursprung links oben = Latte. `right` spiegelt. */
export function kopfGoal(right: boolean): Pix {
  const D = KB.GOAL_D + 2;
  const H = KB.GOAL_H + KB.BAR_T;
  const p = new Pix(D + 2, H + 1);
  // Netz (Maschen ohne Kontur)
  for (let y = KB.BAR_T; y < H; y++) {
    for (let x = 1; x < D; x++) {
      if ((x + y) % 4 === 0 || (x - y + 400) % 4 === 0) p.px(x, y, 'rgba(253,247,234,0.55)');
    }
  }
  // Rückwand des Netzes an der Bande
  p.vline(1, KB.BAR_T, H - KB.BAR_T, 'rgba(253,247,234,0.8)');
  // Latte + Pfosten vorne
  p.rect(1, 0, D, KB.BAR_T, C.white);
  p.hline(1, KB.BAR_T - 1, D, '#d3c9b0');
  for (let x = 4; x < D; x += 6) p.rect(x, 0, 3, KB.BAR_T, '#e0503f');
  p.rect(D - 3, KB.BAR_T, 3, H - KB.BAR_T, C.white);
  p.vline(D - 1, KB.BAR_T, H - KB.BAR_T, '#d3c9b0');
  for (let y = KB.BAR_T + 4; y < H; y += 8) p.rect(D - 3, y, 3, 4, '#e0503f');
  if (!right) return p;
  const q = new Pix(p.w, p.h);
  q.g.save();
  q.g.scale(-1, 1);
  q.g.drawImage(p.canvas, -p.w, 0);
  q.g.restore();
  return q;
}

/** Korb von der Seite: Stange an der Bande, Brett, Ring nach vorn. Ursprung: Brett-Außenkante oben. */
export function kopfHoop(right: boolean): Pix {
  const top = KB.BOARD_TOP;
  const W = KB.BOARD_X + KB.BOARD_T + KB.RIM_W + 4;
  const p = new Pix(W, top + 2);
  const G = top; // Boden relativ zur Bildoberkante
  // Stange (an der Bande)
  p.rect(0, 8, 3, G - 8, '#5a5f6e');
  p.vline(0, 8, G - 8, '#7c8294');
  // Arm zum Brett
  p.rect(0, 20, KB.BOARD_X + 1, 3, '#5a5f6e');
  // Brett
  const bx = KB.BOARD_X;
  const bh = KB.BOARD_TOP - KB.BOARD_BOTTOM;
  p.rect(bx, 0, KB.BOARD_T, bh, '#f4efe2');
  p.vline(bx + KB.BOARD_T - 1, 0, bh, '#c9c1ad');
  p.rect(bx + 1, bh - 16, KB.BOARD_T - 2, 10, '#e0503f');
  p.outline(C.outline);
  // Ring (orange, flach von der Seite) – Höhe RIM_H über dem Boden
  const ry = top - KB.RIM_H;
  p.rect(bx + KB.BOARD_T, ry - 1, KB.RIM_W, 2, '#f0973a');
  p.hline(bx + KB.BOARD_T, ry + 1, KB.RIM_W, '#b8661c');
  // Netz unter dem Ring
  for (let y = ry + 2; y < ry + 16; y++) {
    const inset = Math.round((y - ry) * 0.35);
    for (let x = bx + KB.BOARD_T + inset; x < bx + KB.BOARD_T + KB.RIM_W - inset; x++) {
      if ((x + y) % 3 === 0 || (x - y + 300) % 3 === 0) p.px(x, y, 'rgba(253,247,234,0.85)');
    }
  }
  if (!right) return p;
  const q = new Pix(p.w, p.h);
  q.g.save();
  q.g.scale(-1, 1);
  q.g.drawImage(p.canvas, -p.w, 0);
  q.g.restore();
  return q;
}

/** Bande: Bambusstange mit Netz bis unter die Decke (x = Innenkante) */
export function kopfWall(height: number): Pix {
  const p = new Pix(5, height);
  for (let y = 0; y < height; y++) p.rect(0, y, 4, 1, y % 14 === 0 ? '#7a8a2a' : y % 2 ? '#c9c45a' : '#b5b04a');
  p.vline(0, 0, height, '#5e6a1e');
  p.vline(3, 0, height, '#5e6a1e');
  return p;
}

/** Ball: Fußball (weiß/schwarz) bzw. Basketball (orange mit Nähten), Durchmesser 2 · BALL_R */
export function kopfBall(mode: KbMode): Pix {
  const n = KB.BALL_R * 2;
  const c = n / 2;
  const r = c - 0.5;
  const p = new Pix(n, n);
  p.disc(c, c, r, mode === 'fuss' ? C.white : '#e8782e');
  if (mode === 'fuss') {
    p.rect(c - 2, c - 2, 4, 4, '#2d2d3a');
    p.px(c - 1, c - 3, '#2d2d3a').px(c, c - 3, '#2d2d3a');
    for (const [x, y] of [[2, 4], [n - 4, 4], [3, n - 4], [n - 5, n - 4], [c - 1, 1]]) p.rect(x, y, 2, 2, '#2d2d3a');
  } else {
    p.hline(1, c, n - 2, '#5a2a12');
    p.vline(c, 1, n - 2, '#5a2a12');
    for (let y = 2; y < n - 2; y++) {
      const bend = Math.round((y - c) * (y - c) * 0.08);
      p.px(c - 4 + bend, y, '#5a2a12');
      p.px(c + 3 - bend, y, '#5a2a12');
    }
  }
  p.px(c - 3, c - 3, '#ffffff').px(c - 2, c - 3, '#ffffff');
  p.outline(C.outline);
  return p;
}

/** Kleiner Körper unter dem Riesenkopf (Blick nach rechts): Shirt, Shorts in Teamfarbe, hinteres Bein. 2× skaliert. */
export function kopfBody(look: Look, team: string): HTMLCanvasElement {
  const shirt = SHIRTS[look.shirt] ?? SHIRTS[0];
  const skin = SKINS[look.skin] ?? SKINS[0];
  const shorts = team === 'A' ? '#f4c542' : '#3fa7e0';
  const p = new Pix(10, 10);
  p.map(1, 1, [
    '..SSSS..',
    '.SSSSSL.',
    'kSSSSSLk',
    '.SSSSSL.',
    '.TTTTTT.',
    '.TT.....',
    '.kk.....',
    'bbb.....',
  ], { S: shirt, L: shade(shirt, 0.78), k: skin, T: shorts, b: '#3b3b4f' });
  p.outline(C.outline);
  return scaledPix(p, 2);
}

/** Vorderes Bein (Blick nach rechts), Drehpunkt an der Hüfte = linke obere Ecke + (2, 2). 2× skaliert. */
export function kopfLeg(look: Look, team: string): HTMLCanvasElement {
  const skin = SKINS[look.skin] ?? SKINS[0];
  const shorts = team === 'A' ? '#f4c542' : '#3fa7e0';
  const p = new Pix(7, 6);
  p.map(1, 1, [
    'TT...',
    '.k...',
    '.k...',
    '.bbbb',
  ], { T: shorts, k: skin, b: team === 'A' ? '#e0503f' : '#2d2d3a' });
  p.outline(C.outline);
  return scaledPix(p, 2);
}

/** Pfeil über dem Kopf in Spielerfarbe (weiß, wird eingefärbt) */
export function kopfMarker(): Pix {
  const p = new Pix(9, 6);
  for (let i = 0; i < 4; i++) p.hline(1 + i, 1 + i, 7 - i * 2, C.white);
  p.outline(C.outline);
  return p;
}
