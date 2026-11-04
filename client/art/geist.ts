import { C } from './palette';
import { Pix } from './pix';

/** Niedlicher Bettlaken-Geist (16 × 18). `mood`: normal, erwischt (im Licht) oder "Buh!" */
export function ghostSprite(mood: 'idle' | 'hit' | 'boo' = 'idle'): Pix {
  const p = new Pix(18, 20);
  const body = mood === 'hit' ? '#fff3c4' : '#f4f1ff';
  const shade = mood === 'hit' ? '#e8cf86' : '#c9c2ea';
  p.map(1, 1, [
    '.....xxxxxx.....',
    '...xxxxxxxxxx...',
    '..xxxxxxxxxxxx..',
    '.xxxxxxxxxxxxxx.',
    '.xxxxxxxxxxxxxx.',
    'xxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxxx',
    'xxx.xxxx.xxxx.xx',
    '.x...xx...xx...x',
  ], { x: body });
  // Schattierung rechts
  for (let y = 7; y < 15; y++) p.px(15, y, shade).px(16, y, shade);
  p.hline(3, 14, 12, shade);
  const eye = '#2a2340';
  if (mood === 'hit') {
    // zugekniffene Augen + Schweißtropfen
    p.hline(4, 7, 3, eye).px(5, 6, eye).hline(10, 7, 3, eye).px(11, 6, eye);
    p.ellipse(8.5, 11, 2, 1.5, eye);
    p.px(15, 3, C.waterLight).px(15, 4, C.waterLight);
  } else if (mood === 'boo') {
    p.rect(4, 5, 3, 3, eye).rect(10, 5, 3, 3, eye);
    p.px(5, 5, C.white).px(11, 5, C.white);
    p.ellipse(8.5, 11, 2.5, 2.5, eye);
    p.ellipse(8.5, 12, 1.5, 1, '#e46e98');
  } else {
    p.rect(5, 6, 2, 3, eye).rect(10, 6, 2, 3, eye);
    p.px(5, 6, C.white).px(10, 6, C.white);
    p.hline(7, 10, 3, eye);
    p.px(3, 9, '#f6a5c0').px(13, 9, '#f6a5c0');
  }
  p.outline('#2a2340');
  return p;
}

/** Kleiderschrank (18 × 26) */
export function wardrobe(): Pix {
  const p = new Pix(18, 26);
  p.rect(0, 0, 18, 26, C.woodDark);
  p.rect(1, 1, 16, 23, C.wood);
  p.vline(9, 1, 23, C.woodDarker);
  p.px(7, 12, C.gold).px(11, 12, C.gold);
  p.hline(1, 1, 16, C.woodLight);
  p.rect(1, 24, 3, 2, C.woodDarker).rect(14, 24, 3, 2, C.woodDarker);
  p.outline(C.outline);
  return p;
}

/** Spinnennetz für Ecken (16 × 16, oben links verankert) */
export function cobweb(): Pix {
  const p = new Pix(16, 16);
  const c = 'rgba(230,230,255,0.55)';
  for (let i = 0; i < 16; i++) p.px(i, i, c);
  for (let i = 0; i < 16; i++) p.px(i, 0, c).px(0, i, c);
  for (let i = 0; i < 12; i++) p.px(i, Math.floor(i / 2), c).px(Math.floor(i / 2), i, c);
  for (const r of [5, 9, 13]) for (let a = 0; a <= 16; a++) {
    const t = (a / 16) * (Math.PI / 2);
    p.px(Math.round(Math.cos(t) * r), Math.round(Math.sin(t) * r), c);
  }
  return p;
}

/** Kleine Kerze / Notlicht für die Stimmung (6 × 10) */
export function candle(): Pix {
  const p = new Pix(7, 12);
  p.rect(2, 5, 3, 6, '#f4ecd8').rect(2, 5, 1, 6, '#fffaf0');
  p.ellipse(3.5, 2.5, 1.5, 2.5, C.gold).px(3, 3, '#fff4c2');
  p.rect(1, 11, 5, 1, C.stoneDark);
  return p;
}
