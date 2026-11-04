/** Möbel fürs Versteckspiel – Größen exakt wie in shared/verstecken.ts (PROPS) */
import type { PropType } from '../../shared/verstecken';
import { C } from './palette';
import { Pix, shade } from './pix';
import { crate, deckchair, plant, umbrella } from './objects';

function lamp(v: number): Pix {
  const p = new Pix(10, 26);
  const shadeCol = v ? '#f2c33a' : '#f7e4b5';
  // Schirm
  p.rect(2, 1, 6, 1, shadeCol).rect(1, 2, 8, 6, shadeCol);
  p.rect(1, 7, 8, 1, shade(shadeCol, 0.8)).vline(1, 2, 6, shade(shadeCol, 1.15));
  // Stange + Fuß
  p.vline(5, 8, 15, C.woodDark).vline(4, 8, 15, C.wood);
  p.rect(2, 23, 6, 2, C.woodDarker);
  p.outline(C.outline);
  return p;
}

function suitcase(v: number): Pix {
  const p = new Pix(14, 16);
  const c = v ? '#3f8fe0' : '#d8473c';
  p.rect(4, 1, 6, 1, '#4d4a47').rect(4, 1, 1, 3, '#4d4a47').rect(9, 1, 1, 3, '#4d4a47');
  p.rect(1, 4, 12, 11, c);
  p.hline(1, 4, 12, shade(c, 1.25)).hline(1, 14, 12, shade(c, 0.7));
  p.vline(4, 4, 11, shade(c, 0.75)).vline(9, 4, 11, shade(c, 0.75));
  p.rect(6, 8, 2, 2, C.gold);
  p.outline(C.outline);
  return p;
}

function cooler(v: number): Pix {
  const p = new Pix(18, 14);
  const c = v ? '#e04a3f' : '#3f8fe0';
  p.rect(5, 1, 8, 2, '#d8d2c4');
  p.rect(1, 3, 16, 4, C.white).hline(1, 6, 16, '#d8d2c4');
  p.rect(1, 7, 16, 6, c).hline(1, 12, 16, shade(c, 0.7));
  p.rect(7, 8, 4, 2, shade(c, 1.3));
  p.outline(C.outline);
  return p;
}

function pineapple(): Pix {
  const p = new Pix(10, 17);
  p.map(2, 1, ['.g..g.', '.gggg.', 'ggggg.', '.ggg..', '..g...'], { g: C.leafLight });
  p.ellipse(5, 11, 3.6, 4.6, '#e9b43a');
  p.overlayOn(() => {
    for (let y = 6; y < 17; y += 2) for (let x = (y / 2) % 2 ? 2 : 3; x < 9; x += 2) p.px(x, y, '#b9802a');
    p.px(3, 8, '#ffe08a').px(4, 7, '#ffe08a');
  });
  p.outline(C.outline);
  return p;
}

function flamingo(): Pix {
  const p = new Pix(22, 18);
  const pink = '#f07aa8';
  // Ring (leicht von oben)
  p.ellipse(11, 12, 9.5, 4.8, pink);
  p.g.globalCompositeOperation = 'destination-out';
  p.ellipse(11, 12.5, 4.5, 1.8, '#000');
  p.g.globalCompositeOperation = 'source-over';
  p.hline(5, 8, 5, '#ff9fc4');
  // Hals + Kopf
  p.rect(16, 3, 2, 8, pink).rect(16, 1, 4, 3, pink).rect(20, 2, 1, 2, C.outline).px(18, 2, C.ink);
  p.rect(14, 1, 2, 1, '#ff9fc4');
  p.outline(shade(pink, 0.45));
  return p;
}

function gnome(v: number): Pix {
  const p = new Pix(10, 16);
  const hat = v ? '#3f8fe0' : '#e04a3f';
  p.map(2, 1, ['..h...', '..hh..', '.hhh..', '.hhhh.', 'hhhhhh'], { h: hat });
  p.rect(3, 6, 4, 2, '#f2c9a0').px(4, 6, C.ink).px(6, 6, C.ink);
  p.rect(2, 8, 6, 3, C.white).rect(3, 11, 4, 1, C.white);
  p.rect(2, 10, 6, 3, C.blue).rect(2, 13, 2, 2, C.woodDark).rect(6, 13, 2, 2, C.woodDark);
  p.rect(3, 8, 4, 2, C.white);
  p.outline(C.outline);
  return p;
}

function beachball(): Pix {
  const p = new Pix(11, 11);
  p.disc(5.5, 5.5, 4.6, C.white);
  p.overlayOn(() => {
    p.rect(0, 0, 4, 11, C.red);
    p.rect(7, 0, 4, 11, C.blue);
    p.rect(4, 0, 3, 3, C.gold);
    p.px(3, 3, '#ffffff').px(4, 2, '#ffffff');
  });
  p.outline(C.outline);
  return p;
}

const DECK = [C.orange, C.blue, C.red];
const UMB = [C.red, C.blue];

export function hideProp(t: PropType, v: number): Pix {
  switch (t) {
    case 'plant': return plant();
    case 'crate': return crate();
    case 'lamp': return lamp(v);
    case 'suitcase': return suitcase(v);
    case 'cooler': return cooler(v);
    case 'pineapple': return pineapple();
    case 'deckchair': return deckchair(DECK[v % DECK.length]);
    case 'umbrella': return umbrella(UMB[v % UMB.length]);
    case 'flamingo': return flamingo();
    case 'gnome': return gnome(v);
    case 'beachball': return beachball();
  }
}

export const hidePropKey = (t: PropType, v: number) => `vs_${t}_${v}`;
