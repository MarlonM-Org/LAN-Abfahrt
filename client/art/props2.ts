import { C } from './palette';
import { Pix, shade } from './pix';

/** SUP-Board von oben (zeigt nach rechts) */
export function supBoard(color: string): Pix {
  const p = new Pix(34, 12);
  p.ellipse(17, 6, 16, 5, C.white);
  p.overlayOn(() => {
    p.hline(2, 6, 30, color).hline(2, 5, 30, color);
    p.ellipse(15, 4, 10, 1.5, '#ffffff');
    p.rect(12, 4, 10, 4, shade(color, 0.8));
  });
  p.outline(C.outline);
  return p;
}

export function buoy(): Pix {
  const p = new Pix(14, 14);
  p.disc(7, 7, 6, C.red);
  p.overlayOn(() => {
    p.rect(0, 5, 14, 4, C.white);
    p.disc(5, 5, 2, '#ff8a7a');
  });
  p.outline(C.outline);
  return p;
}

export function seaRock(): Pix {
  const p = new Pix(26, 22);
  p.ellipse(13, 12, 12, 9, '#7f7b73');
  p.overlayOn(() => {
    p.ellipse(10, 9, 7, 5, '#a7a39a');
    p.ellipse(8, 7, 3, 2, '#cfcbc1');
    p.rect(0, 17, 26, 5, '#5e5a54');
  });
  p.outline(C.outline);
  const out = new Pix(30, 26);
  out.ellipse(15, 16, 15, 10, 'rgba(234,248,255,0.55)');
  out.draw(p, 2, 1);
  return out;
}

export function jellyfish(): Pix {
  const p = new Pix(16, 16);
  p.ellipse(8, 6, 6, 5, 'rgba(240,122,168,0.85)');
  p.overlayOn(() => p.ellipse(6, 4, 2.5, 1.6, 'rgba(255,220,235,0.9)'));
  for (const x of [4, 7, 10, 12]) for (let y = 10; y < 15; y++) p.px(x + (y % 2), y, 'rgba(240,122,168,0.7)');
  p.outline('#7e2553');
  return p;
}

export function basket(ribbon: string): Pix {
  const p = new Pix(36, 30);
  p.ellipse(18, 16, 17, 13, '#b8834a');
  p.overlayOn(() => {
    for (let y = 0; y < 30; y += 3) p.hline(0, y, 36, '#9a6a35');
    for (let x = 0; x < 36; x += 4) p.vline(x, 0, 30, 'rgba(120,80,40,0.5)');
  });
  p.ellipse(18, 14, 12, 8, '#5a3a1c');
  p.rect(4, 22, 28, 3, ribbon);
  p.outline(C.outline);
  return p;
}

/** Herumliegende Sachen (12 × 12) */
export function clutter(type: string): Pix {
  const p = new Pix(12, 12);
  switch (type) {
    case 'shirt':
      p.rect(3, 3, 6, 7, C.blue).rect(1, 3, 2, 3, C.blue).rect(9, 3, 2, 3, C.blue).rect(5, 3, 2, 1, '#2d64a8');
      break;
    case 'sock':
      p.rect(3, 1, 3, 7, C.white).rect(3, 7, 6, 3, C.white).rect(3, 1, 3, 2, C.red);
      break;
    case 'can':
      p.rect(3, 2, 6, 8, '#d0d0d8').rect(3, 4, 6, 4, C.red).hline(4, 2, 4, '#a0a0a8');
      break;
    case 'pizza':
      p.rect(1, 2, 10, 8, '#c99a5e').rect(2, 3, 8, 6, '#ddb47a').px(4, 5, C.red).px(7, 4, C.red);
      break;
    case 'bottle':
      p.rect(4, 3, 4, 8, '#2f7d32').rect(5, 1, 2, 2, '#2f7d32').px(5, 5, '#5fb35f');
      break;
    case 'book':
      p.rect(2, 2, 8, 8, '#9b5fc0').vline(2, 2, 8, '#6e3f8a').hline(4, 5, 5, C.white);
      break;
    case 'towel':
      p.rect(1, 3, 10, 6, C.orange).hline(1, 5, 10, C.white);
      break;
    case 'cap':
      p.disc(6, 6, 4, C.green).rect(6, 7, 5, 2, '#2f7d32');
      break;
  }
  p.outline(C.outline);
  return p;
}
