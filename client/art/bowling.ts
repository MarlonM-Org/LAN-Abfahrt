import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintSand, paintShore, paintSky, paintWater } from './ground';
import { palm } from './objects';

/** Bowling-Pin von vorn (Ursprung unten mittig), 12 × 30 */
export function bowlingPin(): Pix {
  const p = new Pix(12, 30);
  const w = [2, 3, 3.4, 3.4, 3, 2.4, 1.8, 1.6, 1.6, 1.8, 2.6, 3.6, 4.4, 4.9, 5.1, 5.2, 5.2, 5.1, 4.9, 4.6, 4.3, 4, 3.7, 3.4, 3.1, 2.8, 2.6];
  w.forEach((hw, j) => {
    const y = j + 1;
    p.hline(6 - hw, y, hw * 2, C.white);
  });
  p.overlayOn(() => {
    p.rect(0, 7, 12, 1, C.red).rect(0, 9, 12, 1, C.red);
    for (let y = 2; y < 27; y++) p.px(3 + (y > 10 ? -1 : 0), y, '#ffffff');
    p.rect(8, 11, 4, 16, '#dcd6cb');
  });
  p.outline(C.outline);
  return p;
}

/** Bowlingkugel in Spielerfarbe, 16 × 16 */
export function bowlingBall(color: string): Pix {
  const p = new Pix(16, 16);
  p.disc(8, 8, 7, color);
  p.overlayOn(() => {
    p.disc(10, 11, 6, shade(color, 0.75));
    p.disc(8, 8, 5.2, color);
    p.ellipse(5.5, 5, 2.5, 1.6, shade(color, 1.45));
    p.px(5, 4, '#ffffff');
    // Fingerlöcher
    p.px(9, 6, C.outline).px(11, 6, C.outline).px(10, 9, C.outline);
  });
  p.outline(C.outline);
  return p;
}

/** Tiki-Fackel (Ursprung unten mittig), 8 × 34 */
export function tikiTorch(frame = 0): Pix {
  const p = new Pix(10, 34);
  p.rect(4, 12, 2, 22, '#8d5629');
  p.rect(3, 9, 4, 5, '#c9a46a').hline(3, 10, 4, '#a07a44').hline(3, 12, 4, '#a07a44');
  p.ellipse(5, 5 + frame * 0.5, 3, 4.5, C.orange);
  p.ellipse(5 + (frame ? 0.5 : -0.5), 6, 1.8, 2.8, C.gold);
  p.px(5, 7, '#fff4c2');
  p.outline(C.outline);
  return p;
}

/** Hintergrund: Sonnenuntergang am Meer, Strand im Vordergrund */
export function paintBeachAlley(p: Pix, w: number, h: number, horizon: number) {
  paintSky(p, 0, 0, w, horizon - 14, ['#3b3f86', '#8a4f8f', '#e0705a', '#f5a35a', '#ffd27a']);
  // Sonne
  p.disc(212, horizon - 18, 13, '#ffe7a0');
  p.disc(212, horizon - 18, 10, '#fff4c8');
  paintWater(p, 0, horizon - 14, w, 14, 811);
  for (let x = 196; x < 230; x += 3) p.hline(x + ((x / 3) % 2), horizon - 13 + ((x * 7) % 11), 3, '#ffd27a');
  paintSand(p, 0, horizon, w, h - horizon, 812);
  paintShore(p, 0, horizon + 1, w, 813);
  const r = rng(814);
  // ein paar ferne Palmen am Horizont
  for (const [x, s] of [[14, 0.55], [44, 0.42], [262, 0.5], [292, 0.4], [340, 0.5]] as [number, number][]) {
    const pl = palm(Math.floor(r() * 9));
    const c = document.createElement('canvas');
    c.width = Math.round(pl.w * s);
    c.height = Math.round(pl.h * s);
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(pl.canvas, 0, 0, c.width, c.height);
    p.g.drawImage(c, x - c.width / 2, horizon + 4 - c.height);
  }
}
