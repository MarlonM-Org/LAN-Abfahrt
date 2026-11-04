import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintSky, paintWater } from './ground';
import { palm } from './objects';

// ================================================================== Strandbar

export function beachBackdrop(): Pix {
  const p = new Pix(480, 270);
  const r = rng(901);
  paintSky(p, 0, 0, 480, 156, ['#4fa8e3', '#7cc5ef', '#b5e1f6', '#f4e6c0']);
  // Sonne
  p.disc(398, 46, 22, 'rgba(255,240,170,0.35)');
  p.disc(398, 46, 15, '#ffe58a');
  p.disc(395, 43, 10, '#fff3c0');
  // Wolken
  for (const [cx, cy, s] of [[70, 40, 1], [180, 26, 0.8], [300, 58, 0.7], [455, 90, 0.6]]) {
    p.ellipse(cx, cy, 22 * s, 7 * s, '#ffffff');
    p.ellipse(cx - 10 * s, cy - 4 * s, 10 * s, 7 * s, '#ffffff');
    p.ellipse(cx + 9 * s, cy - 5 * s, 12 * s, 8 * s, '#ffffff');
    p.hline(cx - 20 * s, cy + 5 * s, 40 * s, '#d8eef9');
  }
  // Insel am Horizont
  p.ellipse(60, 156, 46, 9, '#6f9a6a');
  p.ellipse(52, 152, 20, 7, '#5f8a5a');
  p.ellipse(430, 157, 30, 5, '#7da77a');
  // Meer
  paintWater(p, 0, 156, 480, 114, 902);
  for (let i = 0; i < 40; i++) p.hline(Math.floor(r() * 470), 158 + Math.floor(r() * 12), 6 + Math.floor(r() * 10), '#bfe6f7');
  // Strandbar-Hütte hinter der Bühne
  const hx = 188;
  const hw = 104;
  p.rect(hx + 8, 122, hw - 16, 74, '#c99a5e');
  for (let x = hx + 8; x < hx + hw - 8; x += 5) p.vline(x, 122, 74, '#b4864a');
  p.rect(hx + 14, 150, hw - 28, 20, '#5e3518');
  p.rect(hx + 14, 168, hw - 28, 4, C.woodLight);
  // Flaschen im Regal
  for (let i = 0; i < 9; i++) {
    const bx = hx + 18 + i * 8;
    const col = ['#46b04a', '#e0503f', '#f2c33a', '#3f8fe0'][i % 4];
    p.rect(bx, 156, 3, 8, col).px(bx + 1, 154, col).px(bx + 1, 155, col);
  }
  p.rect(hx + 4, 122, 5, 74, C.trunk).rect(hx + hw - 9, 122, 5, 74, C.trunk);
  // Strohdach
  for (let y = 0; y < 22; y++) {
    const inset = Math.max(0, 14 - y);
    p.hline(hx - 6 + inset, 102 + y, hw + 12 - inset * 2, y % 3 === 0 ? '#c99a3a' : '#e2b65a');
  }
  for (let x = hx - 6; x < hx + hw + 6; x += 3) p.vline(x, 122, 3 + ((x * 7) % 4), '#c99a3a');
  // Schild
  p.rect(hx + 22, 128, hw - 44, 14, '#f7e4b5');
  p.rect(hx + 22, 128, hw - 44, 1, C.woodDark).rect(hx + 22, 141, hw - 44, 1, C.woodDark);
  // Lichterkette
  for (let x = 0; x < 480; x += 2) {
    const y = 96 + Math.round(Math.abs(Math.sin((x / 480) * Math.PI * 3)) * -10 + 10);
    p.px(x, y, '#5e3518');
    if (x % 16 === 0) p.disc(x, y + 2, 1.6, ['#ffd25e', '#f07aa8', '#7fd4ff', '#9ad65a'][(x / 16) % 4]);
  }
  p.draw(palm(6), 6, 132);
  p.draw(palm(9), 430, 134, true);
  return p;
}

/** Holzsteg der Strandbar (Hauptbühne) inkl. Pfähle ins Wasser */
export function deckPix(w: number, h: number): Pix {
  const p = new Pix(w, h + 46);
  const r = rng(903);
  // Pfähle
  for (let x = 10; x < w - 6; x += 44) {
    p.rect(x, h - 2, 8, 46, C.trunk);
    p.vline(x + 1, h - 2, 46, '#9a6436');
    p.rect(x, h + 30, 8, 16, 'rgba(60,120,180,0.55)');
  }
  // Querbalken
  p.rect(0, 6, w, h - 6, C.woodDark);
  for (let y = 10; y < h; y += 7) p.hline(0, y, w, C.woodDarker);
  for (let x = 0; x < w; x += 35) p.vline(x, 6, h - 6, C.woodDarker);
  // Dielen oben
  p.rect(0, 0, w, 6, C.wood);
  p.hline(0, 0, w, C.woodLight);
  for (let x = Math.floor(r() * 10); x < w; x += 12 + Math.floor(r() * 6)) p.vline(x, 1, 5, C.woodDark);
  p.speckle(0, 1, w, 4, C.woodLight, w / 4, r);
  p.hline(0, 6, w, C.woodDarker);
  p.outline(C.outline);
  return p;
}

export function plankPix(w: number): Pix {
  const p = new Pix(w, 14);
  p.rect(0, 0, w, 6, C.wood);
  p.hline(0, 0, w, C.woodLight);
  for (let x = 9; x < w; x += 14) p.vline(x, 1, 5, C.woodDark);
  p.hline(0, 5, w, C.woodDark);
  // Laternen
  for (const lx of [6, w - 9]) {
    p.vline(lx + 1, 6, 3, C.outline);
    p.rect(lx, 9, 3, 4, '#ffd25e');
  }
  p.outline(C.outline);
  return p;
}

export function surfPix(w: number): Pix {
  const p = new Pix(w, 12);
  p.ellipse(w / 2, 3.5, w / 2 - 1, 3.2, '#f4efe2');
  p.overlayOn(() => {
    p.rect(0, 2, w, 2, '#e0503f');
    p.rect(w / 2 - 5, 0, 3, 8, '#3f8fe0');
    p.rect(w / 2 + 2, 0, 3, 8, '#3f8fe0');
    p.hline(0, 0, w, '#ffffff');
  });
  // Finne
  p.rect(10, 6, 3, 3, '#3f8fe0').px(11, 9, '#3f8fe0');
  p.outline(C.outline);
  return p;
}

// ================================================================== Pool-Party

export function poolBackdrop(): Pix {
  const p = new Pix(480, 270);
  const r = rng(911);
  paintSky(p, 0, 0, 480, 170, ['#2d2a5e', '#6a3d7d', '#c25f7a', '#f29a5a']);
  // Sterne
  for (let i = 0; i < 40; i++) p.px(Math.floor(r() * 480), Math.floor(r() * 60), r() < 0.5 ? '#ffffff' : '#ffe9b0');
  // Mond
  p.disc(72, 36, 11, '#fff3c0');
  p.disc(77, 32, 10, '#3e3268');
  // Villa
  p.rect(300, 92, 168, 106, '#f4efe2');
  p.rect(292, 84, 184, 10, '#c25f52');
  p.rect(296, 80, 176, 4, '#a8463c');
  for (let i = 0; i < 4; i++) {
    const wx = 312 + i * 40;
    p.rect(wx, 104, 22, 24, '#ffd27a');
    p.rect(wx, 104, 22, 3, '#ffeab0');
    p.vline(wx + 11, 104, 24, '#c99a5e');
    p.rect(wx, 146, 22, 30, i === 1 ? '#5e3518' : '#ffd27a');
  }
  p.rect(300, 192, 168, 6, '#d8cfc0');
  // Palmen-Silhouetten links
  for (const [x, hgt] of [[24, 120], [140, 100], [262, 110]]) {
    for (let y = 198; y > 198 - hgt; y -= 2) p.rect(x + Math.sin((198 - y) / 30) * 6, y, 4, 2, '#3a2a4a');
    const tx = x + Math.sin(hgt / 30) * 6 + 2;
    const ty = 198 - hgt;
    for (const [dx, dy] of [[-1, 0.2], [1, 0.1], [-0.7, -0.6], [0.7, -0.7], [0, 0.5]]) {
      for (let s = 0; s < 14; s++) p.disc(tx + dx * s * 1.6, ty + dy * s + (s * s) / 16, 2.2 - s * 0.1, '#2c2140');
    }
  }
  // Hecke
  for (let x = 0; x < 300; x += 6) p.ellipse(x, 192, 6, 8, x % 12 ? '#2f5a3a' : '#2a5034');
  // Lichterkette
  for (let x = 0; x < 480; x += 2) {
    const y = 64 + Math.round(Math.sin((x / 480) * Math.PI * 4) * 6);
    p.px(x, y, '#2d1b12');
    if (x % 14 === 0) p.disc(x, y + 2, 1.8, ['#ffd25e', '#f07aa8', '#7fd4ff', '#9ad65a', '#f0973a'][(x / 14) % 5]);
  }
  // Pool unten
  p.rect(0, 198, 480, 72, '#2fb5c9');
  for (let i = 0; i < 160; i++) {
    const x = Math.floor(r() * 480);
    const y = 204 + Math.floor(r() * 64);
    p.hline(x, y, 3 + Math.floor(r() * 7), r() < 0.5 ? '#7ae0ee' : '#4cc7dc');
  }
  for (let y = 206; y < 270; y += 12) for (let x = (y / 12) % 2 ? 0 : 12; x < 480; x += 24) p.px(x, y, '#a8f0f8');
  return p;
}

export function poolDeckPix(w: number, h: number): Pix {
  const p = new Pix(w, h + 6);
  // Fliesen oben
  for (let x = 0; x < w; x += 6) p.rect(x, 0, 6, 5, (x / 6) % 2 ? '#f4efe2' : '#dfe9ee');
  p.hline(0, 0, w, '#ffffff');
  // Beckenrand vorne: blaue Fliesen
  for (let y = 5; y < h; y += 5) for (let x = (y / 5) % 2 ? 0 : 3; x < w; x += 6) p.rect(x, y, 5, 4, (x + y) % 4 ? '#3f8fe0' : '#5aa5ec');
  p.rect(0, 5, w, 1, '#2d64a8');
  // Wasserlinie
  p.rect(0, h - 6, w, 6, 'rgba(120,230,240,0.55)');
  p.rect(0, h, w, 6, 'rgba(47,181,201,0.6)');
  // Leiter
  for (const lx of [24, w - 34]) {
    p.vline(lx, -1, h - 2, '#c9c9c9').vline(lx + 8, -1, h - 2, '#c9c9c9');
    for (let y = 6; y < h - 4; y += 6) p.hline(lx, y, 9, '#e8e8e8');
  }
  p.outline(C.outline);
  return p;
}

/** Sprungbrett; "stand" = auf welcher Seite der Ständer steht */
export function divingBoardPix(w: number, stand: 'left' | 'right', standH: number): Pix {
  const p = new Pix(w, standH + 6);
  const sx = stand === 'left' ? 4 : w - 14;
  p.rect(sx, 4, 10, standH, '#3f8fe0');
  p.rect(sx + 2, 4, 2, standH, '#7fbcf0');
  p.rect(sx - 2, standH, 14, 4, '#2d64a8');
  p.rect(0, 0, w, 5, '#f4efe2');
  p.hline(0, 0, w, '#ffffff');
  p.hline(0, 4, w, '#c9c2b4');
  for (let x = stand === 'left' ? w - 18 : 4; x < (stand === 'left' ? w - 4 : 18); x += 3) p.px(x, 2, '#3f8fe0');
  p.outline(C.outline);
  return p;
}

/** Aufblasbarer Flamingo – Oberkante der Plattform bei y = 18 */
export function flamingoPix(w: number): Pix {
  const p = new Pix(w + 12, 40);
  const pink = '#f07aa8';
  const dark = '#c9467e';
  p.ellipse(6 + w / 2, 25, w / 2, 8, pink);
  p.overlayOn(() => {
    p.ellipse(6 + w / 2 - 8, 21, w / 2 - 10, 3, '#ffb3d0');
    p.rect(0, 30, w + 12, 4, dark);
  });
  // Hals + Kopf rechts
  for (let i = 0; i < 16; i++) p.rect(w - 2 + Math.sin(i / 5) * 3, 19 - i, 5, 2, pink);
  p.ellipse(w + 4, 3.5, 4, 3.2, pink);
  p.rect(w + 7, 3, 4, 2, '#2d1b12').px(w + 7, 2, '#f4efe2');
  p.px(w + 3, 2, '#2d1b12');
  // Schwanz links
  p.ellipse(4, 19, 4, 3, pink);
  p.outline(shade(dark, 0.6));
  return p;
}

// ================================================================== Items & Spezial-Requisiten

export function kokosPix(): Pix {
  const p = new Pix(10, 10);
  p.disc(5, 5, 4.5, '#6b4522');
  p.overlayOn(() => {
    p.disc(3.5, 3.5, 2, '#8f6031');
    p.px(4, 6, '#3a2418').px(6, 6, '#3a2418').px(5, 7, '#3a2418');
  });
  p.outline(C.outline);
  return p;
}

export function bombePix(): Pix {
  const p = new Pix(11, 13);
  p.ellipse(5.5, 5.5, 4.8, 5.2, '#3f8fe0');
  p.overlayOn(() => p.ellipse(4, 3.5, 1.6, 2, '#bfe6f7'));
  p.rect(4.5, 10, 2, 2, '#2d64a8');
  p.outline(C.outline);
  return p;
}

export function ananasPix(): Pix {
  const p = new Pix(11, 17);
  for (const [x, y] of [[5, 0], [3, 1], [7, 1], [4, 2], [6, 2], [2, 3], [8, 3], [5, 3], [4, 4], [6, 4]]) p.px(x, y, '#46b04a');
  p.ellipse(5.5, 10.5, 4.5, 5.8, '#f2c33a');
  p.overlayOn(() => {
    for (let y = 5; y < 17; y += 3) for (let x = (y % 2) * 1.5; x < 11; x += 3) p.px(x, y, '#c98a10');
    p.rect(3, 8, 5, 3, '#ffffff').rect(4.5, 7, 2, 5, '#ffffff');
    p.rect(4, 9, 3, 1, '#e04a3f').rect(5, 8, 1, 3, '#e04a3f');
  });
  p.outline(C.outline);
  return p;
}

export function flipflopPix(): Pix {
  const p = new Pix(13, 7);
  p.ellipse(6.5, 4.5, 6, 2.2, '#f07aa8');
  p.rect(1, 5, 11, 1, '#c9467e');
  p.rect(5, 1, 1, 3, '#f2c33a').rect(6, 0, 2, 1, '#f2c33a').rect(8, 1, 1, 3, '#f2c33a');
  p.outline(C.outline);
  return p;
}

export function matratzePix(): Pix {
  const p = new Pix(30, 8);
  p.rect(1, 1, 28, 6, '#3f8fe0');
  p.overlayOn(() => {
    for (let x = 1; x < 30; x += 6) p.rect(x, 1, 3, 6, '#f4efe2');
    p.hline(1, 1, 28, 'rgba(255,255,255,0.6)');
  });
  p.rect(1, 1, 6, 6, '#f07aa8');
  p.outline(C.outline);
  return p;
}

export function wasserpistolePix(): Pix {
  const p = new Pix(13, 9);
  p.rect(1, 1, 10, 4, '#f0973a');
  p.rect(10, 2, 3, 2, '#2fb5a5');
  p.rect(2, 4, 3, 4, '#f0973a');
  p.ellipse(7, 0.8, 2, 1.4, '#3f8fe0');
  p.outline(C.outline);
  return p;
}

export function schirmPix(): Pix {
  const p = new Pix(24, 22);
  for (let y = 1; y <= 9; y++) {
    const half = Math.round(Math.sqrt(Math.max(0, 1 - ((9 - y) / 8.5) ** 2)) * 11);
    for (let x = 12 - half; x <= 12 + half; x++) p.px(x, y, Math.floor((x + 1) / 4) % 2 ? '#e0503f' : '#fdf7ea');
  }
  p.vline(12, 9, 12, '#a59e8f');
  p.rect(10, 20, 3, 1, '#a59e8f');
  p.outline(C.outline);
  return p;
}

export function cocktailGlassPix(): Pix {
  const p = new Pix(9, 12);
  p.map(0, 0, ['.......y.', 'ggggggg..', '.ppppp...', '..pPp....', '...p.....', '...w.....', '...w.....', '.wwwww...'], {
    y: C.gold,
    g: '#c9f0ff',
    p: C.pink,
    P: '#ff9fc4',
    w: '#e8f6ff',
  });
  p.outline(C.outline);
  return p;
}

/** Schwimmring zum Wiedereinstieg */
export function ringPix(): Pix {
  const p = new Pix(30, 12);
  p.ellipse(15, 6, 14, 5, '#e0503f');
  p.overlayOn(() => {
    for (let x = 0; x < 30; x += 8) p.rect(x, 0, 4, 12, '#fdf7ea');
  });
  p.ellipse(15, 5, 7, 2, 'rgba(0,0,0,0)');
  p.g.clearRect(9, 4, 12, 3);
  p.outline(C.outline);
  return p;
}
