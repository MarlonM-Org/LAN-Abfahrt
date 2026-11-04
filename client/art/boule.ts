import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintSand, paintShore, paintSky, paintWater } from './ground';
import { palm } from './objects';
import { BOULE } from '../../shared/boule';

/** Boule-Kugel (Metall, in Spielerfarbe getönt), 11 × 11 */
export function bouleBall(color: string): Pix {
  const p = new Pix(11, 11);
  p.disc(5.5, 5.5, 4.6, color);
  p.overlayOn(() => {
    p.disc(6.8, 7, 4, shade(color, 0.72));
    p.disc(5.3, 5.3, 3.4, color);
    // Rillen wie bei echten Kugeln
    p.hline(2, 6, 7, shade(color, 0.85));
    p.ellipse(4, 3.6, 1.6, 1.1, shade(color, 1.55));
    p.px(3, 3, '#ffffff');
  });
  p.outline(C.outline);
  return p;
}

/** Schweinchen: kleine Kokosnuss, 7 × 7 */
export function cochonnet(): Pix {
  const p = new Pix(7, 7);
  p.disc(3.5, 3.5, 2.7, '#7a4a26');
  p.overlayOn(() => {
    p.disc(4.2, 4.3, 2, '#5a3418');
    p.px(2, 2, '#b07a48').px(3, 2, '#b07a48');
    p.px(3, 4, '#2d1b12').px(4, 3, '#2d1b12');
  });
  p.outline(C.outline);
  return p;
}

/**
 * Hintergrund: Sonnenuntergang am Meer oben, darunter der Bouleplatz im Sand mit Holzbande und Wurfkreis.
 */
export function paintBoulePitch(p: Pix, w: number, h: number) {
  const horizon = 44;
  paintSky(p, 0, 0, w, horizon - 12, ['#3b3f86', '#8a4f8f', '#e0705a', '#f5a35a', '#ffd27a']);
  p.disc(330, horizon - 14, 12, '#ffe7a0');
  p.disc(330, horizon - 14, 9, '#fff4c8');
  paintWater(p, 0, horizon - 12, w, 12, 911);
  for (let x = 314; x < 348; x += 3) p.hline(x + ((x / 3) % 2), horizon - 11 + ((x * 7) % 10), 3, '#ffd27a');
  paintSand(p, 0, horizon, w, h - horizon, 912);
  paintShore(p, 0, horizon + 1, w, 913);
  // Palmen am Rand (ragen über den Horizont)
  const r = rng(914);
  for (const [x, s] of [[8, 0.5], [470, 0.55], [150, 0.36], [410, 0.38]] as [number, number][]) {
    const pl = palm(Math.floor(r() * 9));
    const c = document.createElement('canvas');
    c.width = Math.round(pl.w * s);
    c.height = Math.round(pl.h * s);
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(pl.canvas, 0, 0, c.width, c.height);
    p.g.drawImage(c, x - c.width / 2, horizon + 16 - c.height);
  }
  // Spielfeld: etwas festerer, dunklerer Sand mit Harkspuren
  const x0 = BOULE.X0;
  const y0 = BOULE.Y0;
  const fw = BOULE.X1 - BOULE.X0;
  const fh = BOULE.Y1 - BOULE.Y0;
  p.rect(x0, y0, fw, fh, '#e6c27f');
  p.speckle(x0, y0, fw, fh, '#d4ad6a', (fw * fh) / 14, r);
  p.speckle(x0, y0, fw, fh, '#f1d49a', (fw * fh) / 20, r);
  for (let y = y0 + 6; y < y0 + fh; y += 9) {
    for (let x = x0 + 2; x < x0 + fw - 2; x += 1) if ((x + y) % 5 !== 0 && r() < 0.5) p.px(x, y, '#dab675');
  }
  // Holzbande
  const B = 4;
  p.rect(x0 - B, y0 - B, fw + 2 * B, B, C.wood).rect(x0 - B, y0 + fh, fw + 2 * B, B, C.woodDark);
  p.rect(x0 - B, y0, B, fh, C.wood).rect(x0 + fw, y0, B, fh, C.woodDark);
  p.hline(x0 - B, y0 - B, fw + 2 * B, C.woodLight).hline(x0 - B, y0 + fh + B - 1, fw + 2 * B, C.woodDarker);
  for (let x = x0 + 30; x < x0 + fw; x += 60) p.rect(x, y0 - B, 1, B, C.woodDarker).rect(x, y0 + fh, 1, B, C.woodDarker);
  // Wurfkreis
  const cx = BOULE.CIRCLE.x;
  const cy = BOULE.CIRCLE.y;
  for (let a = 0; a < Math.PI * 2; a += 0.06) p.px(Math.round(cx + Math.cos(a) * BOULE.CIRCLE_R), Math.round(cy + Math.sin(a) * BOULE.CIRCLE_R), '#fff4d6');
  // Entfernungsmarken am oberen Rand (alle 2 m ≈ 72 px)
  for (let d = 72; cx + d < x0 + fw; d += 72) p.rect(Math.round(cx + d), y0 + 1, 1, 3, '#b48a4e');
}
