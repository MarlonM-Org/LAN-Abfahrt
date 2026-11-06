import { C } from './palette';
import { Pix } from './pix';

/** Requisiten für "Verräter im Ferienhaus" – alles schön harmlos */

export function waterPistol(): Pix {
  const p = new Pix(13, 9);
  p.map(0, 0, [
    '.....tt......',
    'gggggggggggg.',
    'gGGGGGGGGGgg.',
    'gggggggggggg.',
    '....oog......',
    '....oo.g.....',
    '...ooo.......',
    '...oo........',
  ], { g: '#2fb5a5', G: '#6fdccd', o: C.orange, t: C.blue });
  p.outline(C.outline);
  return p;
}

export function coconut(): Pix {
  const p = new Pix(10, 10);
  p.disc(5, 5, 4, '#7a4a26');
  p.overlayOn(() => {
    p.disc(4, 4, 2, '#9a6a3a');
    p.px(3, 6, '#3a2010').px(5, 7, '#3a2010').px(6, 5, '#3a2010');
  });
  p.outline(C.outline);
  return p;
}

export function medkit(): Pix {
  const p = new Pix(12, 10);
  p.rect(0, 2, 12, 8, C.white);
  p.rect(4, 0, 4, 2, C.stoneDark);
  p.rect(5, 3, 2, 6, C.red).rect(3, 5, 6, 2, C.red);
  p.hline(0, 9, 12, '#d9d2c2');
  p.outline(C.outline);
  return p;
}

export function bananaPeel(): Pix {
  const p = new Pix(14, 9);
  p.map(0, 0, [
    '......yy......',
    '.....yYYy.....',
    '..yy.yYYy.yy..',
    '.yYYyyYYyyYYy.',
    'yY..yyYYyy..Yy',
    'y....yyyy....y',
    '......bb......',
  ], { y: C.gold, Y: '#fff2b0', b: '#5a3418' });
  p.outline(C.outline);
  return p;
}

/** Detektiv-Hut (sitzt auf dem Kopf der 16 × 27-Figur) */
export function detectiveHat(): Pix {
  const p = new Pix(16, 7);
  p.rect(4, 0, 8, 4, '#6b4a2b');
  p.rect(4, 3, 8, 1, '#2d1b12');
  p.rect(1, 4, 14, 2, '#7d5833');
  p.hline(5, 0, 6, '#8d6a43');
  p.outline(C.outline);
  return p;
}

/** Sterne über dem Kopf, wenn jemand ausgerutscht/betäubt ist */
export function dizzy(): Pix {
  const p = new Pix(13, 5);
  p.map(0, 0, ['.y.....y....y', 'yYy...yYy..yY', '.y.....y....y'], { y: C.gold, Y: '#fff2b0' });
  return p;
}

export const NOODLE_COLORS = [0xf07aa8, 0x7cc04a, 0xffd25e, 0x4aa2dc, 0xf0973a];

/** Stromausfall: namenloser Umriss mit leuchtenden Augen (schaut nach rechts) – für alle gleich */
export function silhouette(): Pix {
  const p = new Pix(14, 30);
  const body = '#262d48';
  p.disc(7, 6, 5, body);
  p.rect(2, 12, 10, 12, body);
  p.rect(1, 13, 2, 8, body).rect(11, 13, 2, 8, body);
  p.rect(3, 24, 3, 6, body).rect(8, 24, 3, 6, body);
  p.outline('#4b5684');
  p.px(8, 5, '#fff4c2').px(10, 5, '#fff4c2');
  return p;
}
