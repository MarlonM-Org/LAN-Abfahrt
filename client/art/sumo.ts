import { C } from './palette';
import { Pix, rng, shade } from './pix';

/** Pixel-Art für den Sumo-Steg (Planken 16 × 16, darunter 4 px Seitenkante + Schatten) */

/** Offenes Meer mit Wellen, ein paar Bojen und Möwen-Schatten */
export function paintSumoSea(p: Pix, w: number, h: number) {
  const r = rng(4242);
  const bands = ['#2b6ba6', '#2f74b0', '#3380bc', '#3784c2', '#3c8dca', '#4396d2'];
  for (let y = 0; y < h; y++) {
    const b = Math.min(bands.length - 1, Math.floor((y / h) * bands.length));
    p.hline(0, y, w, bands[b]);
  }
  // Wellenstriche
  for (let i = 0; i < (w * h) / 90; i++) {
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * h);
    const len = 2 + Math.floor(r() * 5);
    p.hline(x, y, len, r() < 0.55 ? C.waterLight : '#5aa9de');
    if (r() < 0.3) p.hline(x + 1, y - 1, Math.max(1, len - 2), C.foam);
  }
  // Dunkle Tiefe in der Mitte unter dem Steg (sieht man, wenn Planken fehlen)
  for (let i = 0; i < 40; i++) p.ellipse(120 + r() * 240, 90 + r() * 120, 10 + r() * 20, 3 + r() * 5, 'rgba(20,60,110,0.18)');
}

/** Pfahl, der aus dem Wasser ragt (sichtbar, wenn die Planke darüber weg ist) */
export function sumoPost(): Pix {
  const p = new Pix(8, 12);
  p.rect(1, 0, 6, 9, C.trunk);
  p.vline(2, 0, 9, '#9a6436');
  p.hline(1, 0, 6, '#a5703f');
  p.rect(0, 9, 8, 3, 'rgba(234,248,255,0.85)');
  p.hline(1, 11, 6, C.waterLight);
  p.outline(C.outline);
  return p;
}

/** Eine Planke; v = Variante (Holzton/Astlöcher), cracked = Risse */
export function sumoPlank(v: number, cracked = false): Pix {
  const p = new Pix(16, 22);
  const r = rng(77 + v * 13);
  const tones = [C.wood, '#b27238', '#bf8146', '#ad6f39'];
  // Seitenkante (Balken) + Schatten im Wasser
  p.rect(0, 16, 16, 4, C.woodDarker);
  p.hline(0, 16, 16, C.woodDark);
  p.rect(0, 20, 16, 2, 'rgba(20,50,90,0.35)');
  // vier Bretter quer
  for (let b = 0; b < 4; b++) {
    const base = tones[(v + b) % tones.length];
    p.rect(0, b * 4, 16, 4, base);
    p.hline(0, b * 4, 16, shade(base, 1.18));
    p.hline(0, b * 4 + 3, 16, C.woodDark);
    const seam = 3 + Math.floor(r() * 10);
    if ((b + v) % 2 === 0) p.vline(seam, b * 4, 3, C.woodDark);
    p.speckle(0, b * 4 + 1, 16, 2, C.woodLight, 3, r);
  }
  // Nägel
  p.px(1, 1, C.stoneDark).px(14, 1, C.stoneDark).px(1, 13, C.stoneDark).px(14, 13, C.stoneDark);
  if (v % 3 === 0) p.px(6 + Math.floor(r() * 4), 6, C.woodDarker);
  if (cracked) {
    const cr = '#2d1b12';
    const pts: [number, number][] = [[2, 3], [4, 4], [5, 6], [8, 7], [9, 9], [12, 10], [13, 12]];
    for (const [x, y] of pts) p.px(x, y, cr);
    p.px(8, 6, cr).px(7, 5, cr).px(9, 10, cr).px(10, 12, cr);
    p.px(5, 7, '#e9b77a').px(12, 11, '#e9b77a');
  }
  return p;
}

/** Kleiner Schwimmring (vorne um den Kopf) */
export function sumoRing(color: string): Pix {
  const p = new Pix(20, 9);
  p.ellipse(10, 4.5, 9.5, 4, color);
  p.overlayOn(() => {
    for (let x = 1; x < 20; x += 6) p.rect(x, 0, 3, 9, C.white);
    p.hline(2, 2, 16, 'rgba(255,255,255,0.35)');
  });
  // Loch (Kopf sitzt darin)
  p.g.clearRect(5, 2, 10, 3);
  p.outline(C.outline);
  // Wasserring drumherum
  p.hline(0, 8, 20, 'rgba(234,248,255,0.8)');
  return p;
}

/** Rettungsboje am Rand (Deko) */
export function sumoBuoy(): Pix {
  const p = new Pix(12, 14);
  p.rect(5, 0, 2, 5, C.stoneDark);
  p.disc(6, 1, 1.5, C.gold);
  p.ellipse(6, 8, 5.5, 4, '#e0503f');
  p.overlayOn(() => p.rect(0, 7, 12, 2, C.white));
  p.outline(C.outline);
  p.hline(0, 12, 12, C.foam);
  p.hline(2, 13, 8, C.waterLight);
  return p;
}

/** Ruderboot als Deko */
export function sumoBoat(): Pix {
  const p = new Pix(34, 14);
  p.ellipse(17, 6, 16, 5, '#e9e1cf');
  p.overlayOn(() => {
    p.rect(0, 6, 34, 6, '#3f8fe0');
    p.hline(0, 6, 34, '#2d64a8');
  });
  p.ellipse(17, 5, 12, 2.5, C.woodDark);
  p.rect(14, 3, 6, 2, C.wood);
  p.outline(C.outline);
  p.hline(2, 12, 30, C.foam);
  p.hline(5, 13, 24, C.waterLight);
  return p;
}
