import { C } from './palette';
import { Pix } from './pix';
import { palm } from './objects';

/** Ferienflieger in Seitenansicht (Nase nach rechts) */
export function plane(): Pix {
  const p = new Pix(72, 34);
  // Seitenleitwerk mit Sonne
  for (let j = 0; j < 13; j++) p.rect(6 + j * 0.7, 3 + j, 12 - j * 0.4, 1, C.red);
  p.disc(12, 8, 2.2, C.gold);
  // Rumpf
  p.ellipse(38, 19, 32, 6.5, C.white);
  p.rect(6, 15, 20, 8, C.white);
  p.overlayOn(() => {
    p.rect(0, 22, 72, 4, '#d9d2c2');
    p.hline(4, 20, 66, C.orange).hline(4, 21, 66, C.pink);
  });
  // Cockpit + Fenster
  p.rect(60, 15, 5, 2, '#2b4a6b').px(65, 16, '#2b4a6b');
  for (let x = 18; x <= 54; x += 4) p.rect(x, 16, 2, 2, '#5fa8d8');
  p.rect(28, 15, 3, 6, '#cfc6b0'); // Tür
  // Höhenleitwerk
  p.rect(2, 17, 12, 3, '#d9d2c2');
  // Flügel + Triebwerk
  for (let j = 0; j < 6; j++) p.rect(30 + j * 1.5, 23 + j, 18 - j * 2, 1, '#b9c2cc');
  p.ellipse(42, 26, 5, 2.5, '#8d96a3');
  p.rect(46, 25, 2, 3, '#4b5563');
  p.outline(C.outline);
  return p;
}

/** Weiche Pixel-Wolke */
export function cloud(seed: number): Pix {
  const w = 40 + (seed % 3) * 12;
  const p = new Pix(w, 22);
  const bumps = 3 + (seed % 3);
  for (let i = 0; i < bumps; i++) {
    const cx = 8 + ((w - 16) * i) / Math.max(1, bumps - 1);
    const r = 5 + ((seed * 7 + i * 3) % 5);
    p.disc(cx, 15 - r / 2, r, C.white);
  }
  p.rect(6, 13, w - 12, 7, C.white);
  p.overlayOn(() => p.rect(0, 17, w, 5, '#dcefff'));
  p.outline('#b9dcf2');
  return p;
}

/** Kleine Insel mit Palme für Zwischenlandungen */
export function island(): Pix {
  const p = new Pix(96, 60);
  p.ellipse(48, 54, 46, 6, C.waterLight);
  p.ellipse(48, 52, 40, 6, C.sand);
  p.ellipse(48, 50, 30, 4, C.sandLight);
  const t = palm(9);
  p.draw(t, 30 - t.w / 2 + 6, 50 - t.h + 2);
  const t2 = palm(4);
  p.draw(t2, 66 - t2.w / 2, 52 - t2.h + 2);
  // Landebahn-Schild
  p.rect(48, 40, 1, 10, C.woodDark).rect(44, 37, 10, 5, C.white);
  return p;
}
