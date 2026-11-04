import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintSky, paintWater } from './ground';
import { BASE_SOLIDS, GOAL, PART_DEFS, type PartType, WATER_Y } from '../../shared/parcours';

/**
 * Fallen-Parcours: Teile in Pixel-Art. Jedes Teil wird ungedreht in Größe (w × h)
 * plus 1 px Kontur gemalt – gedreht wird in Phaser.
 */
export function partPix(type: PartType): Pix {
  const d = PART_DEFS[type];
  const pad = type === 'urchin' ? 3 : type === 'bomb' ? 3 : 1;
  const p = new Pix(d.w + pad * 2, d.h + pad * 2);
  const x = pad;
  const y = pad;
  const { w, h } = d;
  switch (type) {
    case 'platform':
      p.rect(x, y, w, h, C.wood);
      p.hline(x, y, w, C.woodLight).hline(x, y + h - 2, w, C.woodDark).hline(x, y + h - 1, w, C.woodDarker);
      for (let i = 6; i < w; i += 10) p.vline(x + i, y + 1, h - 2, C.woodDark);
      p.px(x + 2, y + 3, C.woodDarker).px(x + w - 3, y + 3, C.woodDarker);
      break;
    case 'plank':
      p.rect(x, y, w, h, '#c98d4e');
      p.hline(x, y, w, C.woodLight).hline(x, y + h - 1, w, C.woodDark);
      for (let i = 8; i < w; i += 13) p.px(x + i, y + 1, C.woodDarker);
      // Seilenden
      p.rect(x, y - 1, 2, h + 2, '#e8d8a8').rect(x + w - 2, y - 1, 2, h + 2, '#e8d8a8');
      break;
    case 'spring':
      p.rect(x + 1, y + 3, 2, h - 3, C.stoneDark).rect(x + w - 3, y + 3, 2, h - 3, C.stoneDark);
      p.rect(x, y + 1, w, 3, C.red);
      p.hline(x + 1, y + 1, w - 2, '#ff8a7a');
      for (let i = 3; i < w - 3; i += 2) p.px(x + i, y + 5 + (i % 4 === 1 ? 1 : 0), C.stoneLight);
      break;
    case 'urchin': {
      const cx = x + w / 2;
      const cy = y + h / 2 + 1;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        for (let s = 3; s < 8; s++) p.px(cx + Math.cos(a) * s, cy + Math.sin(a) * s * 0.85, '#3a1f4d');
      }
      p.ellipse(cx, cy, 5, 4, '#5b2d7a');
      p.ellipse(cx - 1.5, cy - 1.5, 2, 1.4, '#9b5fc0');
      p.px(cx - 2, cy - 2, '#d8b4f0');
      break;
    }
    case 'cannon':
      // Holzsockel + Kokosschale-Rohr (zeigt nach rechts)
      p.rect(x + 1, y + h - 4, w - 4, 4, C.woodDark);
      p.hline(x + 1, y + h - 4, w - 4, C.wood);
      p.ellipse(x + 6, y + 5, 5.5, 4.5, '#6b4522');
      p.rect(x + 6, y + 2, w - 6, 6, '#7a4f2a');
      p.rect(x + w - 2, y + 1, 2, 8, '#4a2e15');
      p.hline(x + 6, y + 3, w - 8, '#a0703f');
      p.px(x + 4, y + 3, '#c49a64');
      break;
    case 'fan':
      // Gehäuse links, Flügel rechts (pustet nach rechts)
      p.rect(x, y + 2, 5, h - 4, C.stoneDark);
      p.rect(x + 1, y + 3, 3, h - 6, C.stone);
      p.rect(x + 4, y + h / 2 - 1, 3, 2, C.stoneDark);
      p.ellipse(x + 9, y + h / 2, 3, h / 2 - 0.5, '#bfe6ff');
      p.rect(x + 8, y + 1, 2, 4, C.white).rect(x + 8, y + h - 5, 2, 4, C.white);
      p.disc(x + 9, y + h / 2, 1.5, C.red);
      p.vline(x + w - 1, y, h, 'rgba(255,255,255,0.6)');
      break;
    case 'ice':
      p.rect(x, y, w, h, '#a8e4ff');
      p.hline(x, y, w, C.white).hline(x, y + h - 1, w, '#6fb8e0');
      for (let i = 3; i < w; i += 9) p.px(x + i, y + 2, C.white).px(x + i + 1, y + 3, C.white);
      p.rect(x + w - 6, y + 2, 3, 3, '#d8f4ff');
      break;
    case 'bomb':
      p.disc(x + 8, y + 9, 6.5, '#2b2b35');
      p.disc(x + 6, y + 7, 2, '#5a5a6a');
      p.rect(x + 7, y + 1, 3, 2, C.stoneDark);
      p.px(x + 10, y, C.orange).px(x + 11, y - 1, C.gold).px(x + 12, y, C.gold);
      break;
    case 'mover':
      // Aufblasbare Luftmatratze
      p.rect(x + 1, y, w - 2, h, C.pink);
      p.rect(x, y + 1, w, h - 2, C.pink);
      for (let i = 4; i < w; i += 8) p.rect(x + i, y + 1, 3, h - 2, C.white);
      p.hline(x + 2, y + 1, w - 4, '#ffb3d1');
      p.hline(x + 2, y + h - 1, w - 4, shade(C.pink, 0.7));
      break;
  }
  p.outline(C.outline);
  return p;
}

export function coconutPix(): Pix {
  const p = new Pix(8, 8);
  p.disc(4, 4, 3, '#6b4522');
  p.px(3, 3, '#a0703f').px(5, 5, '#3f2611');
  p.outline(C.outline);
  return p;
}

/** Hintergrund: Himmel, Meer, Strand (Start), Felsen und Steg mit Cocktailbar (Ziel) */
export function paintParcours(p: Pix) {
  const r = rng(808);
  paintSky(p, 0, 0, 480, 200, ['#7ec8f0', '#a8dcf5', '#d2effa', '#ffe9c4']);
  // Sonne + Wolken
  p.disc(300, 70, 18, '#fff1b0').disc(300, 70, 14, '#ffe27a');
  for (const [cx, cy, s] of [[60, 50, 1], [180, 38, 0.8], [390, 56, 1.1], [250, 110, 0.7]] as const) {
    p.ellipse(cx, cy, 16 * s, 5 * s, '#ffffff').ellipse(cx - 8 * s, cy - 3 * s, 8 * s, 5 * s, '#ffffff').ellipse(cx + 7 * s, cy - 2 * s, 7 * s, 4 * s, '#f4fbff');
  }
  // Horizont + ferne Insel
  p.ellipse(150, 200, 40, 9, '#7fb07a').ellipse(150, 198, 26, 6, '#5f9a5a');
  paintWater(p, 0, 196, 480, 74, 811);
  for (let x = 0; x < 480; x++) p.px(x, 196, '#bfe6ff');
  // Grundstrecke
  for (const [i, b] of BASE_SOLIDS.entries()) {
    if (i === 0) {
      // Strand
      p.rect(b.x, b.y, b.w, 270 - b.y, C.sand);
      p.speckle(b.x, b.y, b.w, 270 - b.y, C.sandDark, 140, r);
      p.speckle(b.x, b.y, b.w, 270 - b.y, C.sandLight, 100, r);
      p.hline(b.x, b.y, b.w, C.sandLight);
      p.vline(b.x + b.w - 1, b.y, 270 - b.y, C.sandDark);
      // Handtuch (Start)
      p.rect(10, b.y - 2, 54, 3, C.red);
      for (let x = 10; x < 64; x += 8) p.rect(x, b.y - 2, 4, 3, C.white);
      // Sonnenschirm
      p.vline(66, b.y - 34, 34, C.woodDark);
      p.ellipse(66, b.y - 34, 15, 5, C.red).rect(51, b.y - 34, 30, 2, 'rgba(0,0,0,0)');
      for (let k = -12; k <= 12; k += 8) p.ellipse(66 + k, b.y - 35, 2.5, 3, C.white);
    } else if (i === BASE_SOLIDS.length - 1) {
      // Steg auf Pfählen + Bar
      for (let x = b.x + 4; x < b.x + b.w; x += 14) p.rect(x, b.y + 6, 4, 270 - b.y, C.woodDarker);
      p.rect(b.x, b.y, b.w, 7, C.wood);
      p.hline(b.x, b.y, b.w, C.woodLight).hline(b.x, b.y + 6, b.w, C.woodDarker);
      for (let x = b.x; x < b.x + b.w; x += 9) p.vline(x, b.y + 1, 5, C.woodDark);
    } else {
      // Felsen im Wasser
      p.rect(b.x, b.y, b.w, 270 - b.y, C.stoneDark);
      p.rect(b.x + 2, b.y, b.w - 6, 270 - b.y, C.stone);
      p.rect(b.x + 3, b.y + 1, b.w - 12, 4, C.stoneLight);
      p.speckle(b.x, b.y + 6, b.w, 270 - b.y - 6, '#6b675f', 40, r);
      p.hline(b.x - 1, b.y, b.w + 2, C.leafLight).hline(b.x, b.y + 1, b.w, C.leaf);
      for (let k = 0; k < 4; k++) p.px(b.x + 2 + Math.floor(r() * (b.w - 4)), b.y - 1, C.leafTip);
    }
  }
  // Cocktailbar am Ziel
  const bx = 404;
  const by = BASE_SOLIDS[BASE_SOLIDS.length - 1].y;
  p.rect(bx, by - 18, 30, 18, C.woodDark);
  p.rect(bx - 2, by - 20, 34, 3, C.woodLight);
  for (let x = bx + 2; x < bx + 30; x += 5) p.vline(x, by - 16, 15, C.woodDarker);
  p.vline(bx + 1, by - 42, 22, C.woodDarker).vline(bx + 28, by - 42, 22, C.woodDarker);
  for (let k = 0; k < 9; k++) p.rect(bx - 4 + k * 4, by - 46 + Math.abs(k - 4), 4, 5, k % 2 ? '#e3c26a' : '#c9a24a');
  // Fahnenmast (Ziel)
  const fx = GOAL.x + 18;
  p.vline(fx, GOAL.y + 4, by - GOAL.y - 4, C.outline).vline(fx + 1, GOAL.y + 4, by - GOAL.y - 4, C.stoneLight);
  p.disc(fx + 1, GOAL.y + 3, 2, C.gold);
  for (let j = 0; j < 14; j++) for (let i = 0; i < 20 - j * 0.6; i++) p.px(fx + 2 + i, GOAL.y + 6 + j, (Math.floor(i / 4) + Math.floor(j / 4)) % 2 ? C.white : C.outline);
  // Wasserkante vorne (tödlich)
  for (let x = 0; x < 480; x++) {
    const off = Math.round(Math.sin(x / 6) * 1.2);
    p.px(x, WATER_Y + off, C.foam).px(x, WATER_Y + off + 1, C.waterLight);
  }
  p.rect(0, WATER_Y + 3, 480, 270 - WATER_Y - 3, 'rgba(43,107,166,0.55)');
}
