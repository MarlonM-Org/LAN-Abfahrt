import type { KartItem } from '../../shared/types';
import { C } from './palette';
import { Pix, shade } from './pix';

/** Kart-Rennen: kleine Sprites (auch fürs Handy – deshalb ohne die großen Deko-Module) */

/** Kart von oben (zeigt nach rechts), Karosserie in Shirt-Farbe */
export function kartSprite(color: string): Pix {
  const p = new Pix(16, 12);
  // Reifen
  for (const [x, y] of [[2, 0], [10, 0], [2, 9], [10, 9]]) p.rect(x, y, 4, 3, '#2b2630');
  p.hline(3, 0, 2, '#4a4452').hline(11, 0, 2, '#4a4452');
  // Karosserie
  p.rect(1, 2, 13, 8, color);
  p.rect(13, 3, 2, 6, color);
  p.hline(1, 2, 13, shade(color, 1.25));
  p.hline(1, 9, 13, shade(color, 0.7));
  // Sitz + Lenkrad
  p.rect(4, 4, 4, 4, '#3a3440');
  p.vline(10, 4, 4, '#3a3440');
  // Frontspoiler + Auspuff
  p.rect(15, 4, 1, 4, '#e8e2d6');
  p.rect(0, 5, 1, 2, '#9a948a');
  p.outline(C.outline);
  return p;
}

export function itemBox(frame = 0): Pix {
  const p = new Pix(12, 12);
  const cols = ['#f07aa8', '#f2c33a', '#46b04a', '#3f8fe0', '#9b5fc0'];
  for (let y = 1; y < 11; y++) for (let x = 1; x < 11; x++) p.px(x, y, cols[(Math.floor((x + y) / 3) + frame) % cols.length]);
  p.rect(2, 2, 8, 8, 'rgba(255,255,255,0.45)');
  p.map(4, 3, ['.##.', '#..#', '..#.', '.#..', '....', '.#..'], { '#': C.white });
  p.outline(C.outline);
  return p;
}

export function coconut(): Pix {
  const p = new Pix(9, 9);
  p.disc(4.5, 4.5, 4, '#7a4a26');
  p.overlayOn(() => {
    p.disc(3, 3, 1.6, '#a8703e');
    p.px(5, 5, '#3d2414').px(6, 4, '#3d2414').px(5, 6, '#3d2414');
  });
  p.outline(C.outline);
  return p;
}

export function bananaPeel(): Pix {
  const p = new Pix(11, 9);
  p.map(0, 0, [
    '....#......',
    '...###.....',
    '..##.##....',
    '.##...##...',
    '##.....##..',
    '#..###..##.',
    '..#####..#.',
    '...###.....',
  ], { '#': '#f6d54a' });
  p.overlayOn(() => p.hline(0, 6, 11, '#d9a92a'));
  p.px(4, 0, '#7a5a20');
  p.outline(C.outline);
  return p;
}

/** Möwe von oben, zwei Flügelschläge */
export function seagull(frame: number): Pix {
  const p = new Pix(15, 9);
  if (frame === 0) {
    p.map(0, 0, [
      '##...........##',
      '.###.......###.',
      '..####.#.####..',
      '....#######....',
      '......###o.....',
      '.......#.......',
    ], { '#': C.white, o: '#f0973a' });
    p.px(0, 0, '#7f7b73').px(14, 0, '#7f7b73');
  } else {
    p.map(0, 2, [
      '.......#.......',
      '.###########...',
      '###...###o.###.',
      '.......#.......',
    ], { '#': C.white, o: '#f0973a' });
    p.px(0, 4, '#7f7b73').px(14, 4, '#7f7b73');
  }
  p.outline('#3a3a44');
  return p;
}

export function iceCone(): Pix {
  const p = new Pix(10, 14);
  p.disc(5, 4, 3.5, '#f7a8c8');
  p.disc(3.5, 6, 2.6, '#fdf2d8');
  p.disc(6.8, 6, 2.6, '#9ad6f0');
  for (let y = 0; y < 6; y++) p.hline(2 + y * 0.5, 8 + y, 6 - y, y % 2 ? '#c98a3e' : '#e0a95a');
  p.px(4, 2, C.white);
  p.outline(C.outline);
  return p;
}

/** Item-Symbol fürs Handy (16 × 16) */
export function itemIcon(item: KartItem | null): Pix {
  const p = new Pix(16, 16);
  if (!item) {
    p.rect(2, 2, 12, 12, 'rgba(61,36,20,0.12)');
    return p;
  }
  const src = item === 'coconut' ? coconut() : item === 'banana' ? bananaPeel() : item === 'ice' ? iceCone() : seagull(0);
  p.draw(src, Math.floor((16 - src.w) / 2), Math.floor((16 - src.h) / 2));
  return p;
}
