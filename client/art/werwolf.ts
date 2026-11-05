import { C } from './palette';
import { Pix, rng } from './pix';
import { cottage, tree } from './objects';
import { paintGrass, paintSky } from './ground';

/** Werwölfe im Ferienhaus: Nacht- und Tag-Kulisse, Ferienhaus bei Nacht, niedlicher Werwolf-Kopf */

const W = 480;
const H = 270;

export function paintWolfNight(p: Pix) {
  paintSky(p, 0, 0, W, 190, ['#0b1030', '#141a45', '#1f2a5e', '#2b3a72']);
  const r = rng(77);
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(r() * W);
    const y = Math.floor(r() * 150);
    p.px(x, y, r() < 0.2 ? '#fff6c8' : '#b9c3ff');
  }
  // Vollmond oben rechts
  p.disc(450, 70, 24, '#3a4680');
  p.disc(450, 70, 21, '#fff2c0');
  p.disc(443, 63, 4, '#f0dd9c').disc(458, 76, 3, '#f0dd9c').disc(454, 60, 2, '#f0dd9c');
  // Hügel + dunkle Wiese
  p.ellipse(120, 200, 200, 36, '#1d3a2a');
  p.ellipse(380, 205, 190, 30, '#1a3326');
  p.rect(0, 196, W, H - 196, '#1f4030');
  p.speckle(0, 196, W, H - 196, '#2a5440', 260, r);
  p.speckle(0, 196, W, H - 196, '#163024', 160, r);
}

export function paintWolfDay(p: Pix) {
  paintSky(p, 0, 0, W, 190, ['#7cc8f2', '#93d3f3', '#b6e2f7', '#d6f0fa']);
  p.disc(452, 64, 20, '#ffe08a');
  p.disc(452, 64, 15, '#fff0b8');
  const r = rng(78);
  for (const [cx, cy] of [[90, 46], [250, 30], [330, 80]]) {
    p.ellipse(cx, cy, 22, 7, C.white).ellipse(cx + 12, cy - 4, 12, 7, C.white).ellipse(cx - 10, cy - 2, 10, 6, C.white);
  }
  p.ellipse(120, 200, 200, 36, C.grassDark);
  p.ellipse(380, 205, 190, 30, C.grassDark);
  paintGrass(p, 0, 196, W, H - 196, 81);
  p.speckle(0, 196, W, 10, C.grassDarker, 40, r);
}

/** Ferienhaus im Mondlicht: abgedunkelt, Fenster leuchten */
export function nightCottage(): Pix {
  const p = cottage();
  p.overlayOn(() => p.rect(0, 0, p.w, p.h, 'rgba(14,20,60,0.55)'));
  for (const wx of [16, 66]) {
    p.rect(wx + 1, 45, 16, 12, '#ffd25e');
    p.rect(wx + 1, 45, 16, 4, '#fff0b8');
    p.vline(wx + 8, 45, 12, C.woodDarker).hline(wx + 1, 50, 16, C.woodDarker);
  }
  return p;
}

export function nightTree(seed = 1): Pix {
  const p = tree(seed);
  p.overlayOn(() => p.rect(0, 0, p.w, p.h, 'rgba(14,20,60,0.6)'));
  return p;
}

/** Niedlicher Werwolf-Kopf (24 × 22) */
export function wolfHead(): Pix {
  const p = new Pix(24, 22);
  const pal = { g: '#6f6a80', d: '#4e4a60', l: '#9a95ad', w: '#f4efe2', e: '#ffd25e', k: '#2d1b12', n: '#2d1b12', p: '#f07aa8' };
  p.map(0, 0, [
    '..dd..............dd....',
    '.dggd............dggd...',
    '.dgpgd..........dgpgd...',
    '.dgppgddddddddddgppgd...',
    '..dggggggggggggggggd....',
    '..dggggggggggggggggd....',
    '.dgggllggggggggllgggd...',
    '.dggggggggggggggggggd...',
    '.dgggkeegggggggeekgggd..',
    '.dgggkeegggggggeekgggd..',
    '.dggggggggggggggggggd...',
    '..dggggwwwwwwwwggggd....',
    '..dgggwwwwnnwwwwgggd....',
    '...dggwwwwnnwwwwggd.....',
    '...dggwwwwwwwwwwggd.....',
    '....dgwwkwwwwkwwgd......',
    '....dggwwkkkkwwggd......',
    '.....dggwwwwwwggd.......',
    '......ddgggggggd........',
    '........dddddd..........',
  ], pal);
  p.outline(C.outline);
  return p;
}
