import { C } from './palette';
import { Pix } from './pix';

/** Zutaten-Icons (16 × 16) für das Wrap-Spiel */
export function ingredient(id: string): Pix {
  const p = new Pix(16, 16);
  switch (id) {
    case 'tortilla':
      p.disc(8, 8, 7, '#e9c77d');
      p.overlayOn(() => {
        p.disc(7, 7, 5, '#f3d999');
        for (const [x, y] of [[4, 5], [10, 4], [6, 11], [11, 10], [8, 8]]) p.px(x, y, '#b98a3e');
      });
      break;
    case 'salat':
      p.ellipse(8, 9, 7, 5, '#5fae42');
      p.overlayOn(() => {
        p.ellipse(6, 7, 4, 3, '#86cc55');
        p.vline(8, 4, 9, '#3f8a32');
        p.px(5, 10, '#3f8a32').px(11, 10, '#3f8a32');
      });
      break;
    case 'tomate':
      p.disc(8, 9, 6, '#e0503f');
      p.overlayOn(() => {
        p.disc(8, 9, 4, '#f07466');
        p.px(6, 8, '#ffe2a0').px(10, 8, '#ffe2a0').px(8, 11, '#ffe2a0');
      });
      p.rect(7, 2, 3, 2, '#46b04a').px(6, 3, '#46b04a').px(10, 3, '#46b04a');
      break;
    case 'gurke':
      p.disc(8, 8, 6, '#2f7d32');
      p.overlayOn(() => {
        p.disc(8, 8, 4.5, '#b9e39a');
        for (const [x, y] of [[6, 7], [10, 7], [8, 10], [8, 6]]) p.px(x, y, '#e8f6d8');
      });
      break;
    case 'paprika':
      p.ellipse(8, 9, 6, 6, '#f2c33a');
      p.overlayOn(() => {
        p.ellipse(6, 8, 2, 4, '#ffe27a');
        p.vline(8, 4, 10, '#d99a2b');
      });
      p.rect(7, 1, 2, 3, '#46b04a');
      break;
    case 'mais':
      p.ellipse(8, 8, 4, 7, '#f2c33a');
      p.overlayOn(() => {
        for (let y = 2; y < 15; y += 2) for (let x = 5; x < 12; x += 2) p.px(x + (y % 4 ? 1 : 0), y, '#ffe27a');
      });
      p.rect(3, 9, 3, 6, '#86cc55').rect(10, 9, 3, 6, '#5fae42');
      break;
    case 'sriracha':
      p.rect(5, 4, 6, 11, '#d8352a');
      p.rect(6, 1, 4, 3, '#3fa34a').rect(7, 0, 2, 1, '#3fa34a');
      p.rect(6, 7, 4, 4, C.white).px(7, 8, '#d8352a').px(8, 9, '#d8352a');
      p.vline(6, 4, 11, '#ff6b5e');
      break;
    case 'banane':
      for (let i = 0; i < 12; i++) p.disc(3 + i, 10 - Math.sin((i / 11) * Math.PI) * 5, 2, '#f2d03a');
      p.px(2, 10, '#5a3a1c').px(15, 10, '#5a3a1c');
      break;
    case 'schoko':
      p.rect(3, 3, 10, 11, '#6b3b22');
      p.overlayOn(() => {
        p.hline(3, 7, 10, '#4e2a17').hline(3, 10, 10, '#4e2a17').vline(8, 3, 11, '#4e2a17');
        p.hline(3, 3, 10, '#8f5a3a');
      });
      break;
    case 'gummi':
      p.disc(8, 5, 3, '#e04a8f');
      p.ellipse(8, 11, 4, 4, '#e04a8f');
      p.disc(5, 3, 1.5, '#e04a8f').disc(11, 3, 1.5, '#e04a8f');
      p.px(7, 4, C.white).px(9, 4, C.white);
      break;
    default:
      p.disc(8, 8, 6, C.stone);
  }
  p.outline(C.outline);
  return p;
}

/** Wrap von der Seite, mit Schichten für jede Zutat */
export function wrapStack(steps: string[]): Pix {
  const p = new Pix(44, 26);
  if (!steps.length) return p;
  // Teller
  p.ellipse(22, 21, 21, 5, '#f4efe2');
  p.ellipse(22, 20, 17, 3, '#e6e0d0');
  if (steps.includes('tortilla')) p.ellipse(22, 18, 16, 4, '#e9c77d');
  const colors: Record<string, string> = {
    salat: '#5fae42',
    tomate: '#e0503f',
    gurke: '#9ed07a',
    paprika: '#f2c33a',
    mais: '#ffe27a',
    sriracha: '#f0973a',
  };
  let y = 16;
  for (const s of steps) {
    if (s === 'tortilla') continue;
    const c = colors[s] ?? '#999';
    p.ellipse(22, y, 12, 2.2, c);
    if (s === 'sriracha') for (let x = 12; x < 33; x += 3) p.px(x, y - 2, '#e0503f');
    y -= 2;
  }
  p.outline(C.outline);
  return p;
}
