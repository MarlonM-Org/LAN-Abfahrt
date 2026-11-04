import { C } from './palette';
import { Pix, rng, shade } from './pix';

// ------------------------------------------------------------------ Natur

export function tree(seed = 1): Pix {
  const p = new Pix(34, 44);
  const r = rng(seed);
  // Stamm
  p.rect(14, 26, 7, 15, C.trunk);
  p.vline(19, 26, 15, C.trunkDark).vline(20, 26, 15, C.trunkDark);
  p.vline(15, 30, 8, '#94603a');
  p.rect(11, 39, 13, 3, C.trunk).px(11, 39, C.trunkDark).px(23, 39, C.trunkDark);
  // Krone
  const blobs: [number, number, number][] = [
    [17, 15, 11],
    [9, 19, 7],
    [25, 19, 7],
    [17, 23, 8],
    [11, 10, 6],
    [23, 10, 6],
  ];
  for (const [x, y, rr] of blobs) p.disc(x + (r() - 0.5), y, rr, C.leafDark);
  p.overlayOn(() => {
    for (const [x, y, rr] of blobs) p.disc(x - 1, y - 2, rr - 2, C.leaf);
    for (const [x, y, rr] of blobs) p.disc(x - 2, y - 4, Math.max(1, rr - 5), C.leafLight);
    p.speckle(0, 0, 34, 30, C.leafDarker, 45, r);
    p.speckle(0, 0, 34, 18, C.leafTip, 28, r);
  });
  // Stamm unten wieder sichtbar machen
  p.rect(14, 31, 7, 10, C.trunk).vline(19, 31, 10, C.trunkDark).vline(20, 31, 10, C.trunkDark);
  p.outline(C.outline);
  // Bodenschatten
  const out = new Pix(34, 46);
  out.ellipse(17, 42, 13, 3.5, 'rgba(0,0,0,0.22)');
  out.draw(p, 0, 0);
  return out;
}

export function fruitTree(seed = 2): Pix {
  const p = tree(seed);
  const r = rng(seed + 5);
  for (let i = 0; i < 7; i++) {
    const x = 6 + Math.floor(r() * 22);
    const y = 6 + Math.floor(r() * 18);
    p.px(x, y, C.red).px(x + 1, y, '#b8322a').px(x, y - 1, '#ff8a7a');
  }
  return p;
}

export function bush(seed = 3, berries = false): Pix {
  const p = new Pix(20, 15);
  const r = rng(seed);
  p.disc(6, 8, 5, C.leafDark).disc(13, 8, 5.5, C.leafDark).disc(10, 6, 5, C.leafDark);
  p.overlayOn(() => {
    p.disc(6, 6, 3, C.leaf).disc(12, 5, 3.5, C.leaf).disc(9, 4, 2, C.leafLight);
    p.speckle(0, 0, 20, 15, C.leafDarker, 14, r);
  });
  if (berries) for (let i = 0; i < 5; i++) p.px(3 + Math.floor(r() * 14), 4 + Math.floor(r() * 8), C.pink);
  p.outline(C.outline);
  return p;
}

export function flower(color: string): Pix {
  const p = new Pix(7, 9);
  p.vline(3, 4, 5, C.leafDark).px(2, 6, C.leaf).px(4, 7, C.leaf);
  p.px(3, 0, color).px(2, 1, color).px(4, 1, color).px(3, 2, color).px(1, 1, shade(color, 0.85)).px(5, 1, shade(color, 0.85));
  p.px(3, 1, C.gold);
  p.outline(C.outline);
  return p;
}

export function rock(seed = 4): Pix {
  const p = new Pix(12, 9);
  const r = rng(seed);
  p.ellipse(6, 5, 5, 3.5, C.stone);
  p.overlayOn(() => {
    p.ellipse(5, 3.5, 3, 2, C.stoneLight);
    p.rect(0, 6, 12, 3, C.stoneDark);
    p.speckle(0, 0, 12, 9, C.stoneDark, 4, r);
  });
  p.outline(C.outline);
  return p;
}

export function fence(len = 16): Pix {
  const p = new Pix(len, 15);
  p.rect(0, 4, len, 2, C.woodLight).rect(0, 6, len, 1, C.woodDark);
  p.rect(0, 9, len, 2, C.woodLight).rect(0, 11, len, 1, C.woodDark);
  for (let x = 1; x < len; x += 8) {
    p.rect(x, 1, 3, 13, C.wood).vline(x + 2, 1, 13, C.woodDark).px(x + 1, 0, C.wood);
  }
  p.outline(C.outline);
  return p;
}

export function palm(seed = 6): Pix {
  const p = new Pix(44, 62);
  const r = rng(seed);
  // Stamm (leicht gebogen)
  for (let i = 0; i < 22; i++) {
    const t = i / 21;
    const x = 22 + Math.sin(t * 1.4) * 5;
    const y = 58 - i * 2;
    p.rect(x - 2, y, 5, 2, i % 2 ? '#a9773f' : '#8f6031');
    p.px(x + 2, y, '#6e4521');
  }
  const top = { x: 27, y: 15 };
  const fronds: [number, number][] = [
    [-1, -0.25],
    [-0.8, 0.25],
    [1, -0.2],
    [0.85, 0.35],
    [-0.25, -1],
    [0.35, -0.9],
    [0, 0.6],
  ];
  for (const [dx, dy] of fronds) {
    for (let s = 0; s <= 16; s++) {
      const t = s / 16;
      const x = top.x + dx * t * 17;
      const y = top.y + dy * t * 12 + t * t * 9;
      p.disc(x, y, 2.6 * (1 - t) + 0.8, C.leafDark);
    }
  }
  p.overlayOn(() => {
    for (const [dx, dy] of fronds) {
      for (let s = 0; s <= 16; s++) {
        const t = s / 16;
        p.px(top.x + dx * t * 17, top.y + dy * t * 12 + t * t * 9 - 1, C.leafLight);
      }
    }
    p.speckle(0, 0, 44, 30, C.leafDarker, 20, r);
  });
  p.disc(25, 18, 2.2, '#6b4522').disc(29, 18, 2.2, '#5a3a1c');
  p.outline(C.outline);
  const out = new Pix(44, 64);
  out.ellipse(24, 60, 12, 3, 'rgba(0,0,0,0.2)');
  out.draw(p, 0, 0);
  return out;
}

// ------------------------------------------------------------------ Gebäude

export function cottage(): Pix {
  const W = 100;
  const p = new Pix(W, 86);
  const r = rng(21);
  // Schornstein
  p.rect(68, 4, 10, 22, C.stone).speckle(68, 4, 10, 22, C.stoneDark, 12, r).rect(66, 3, 14, 3, C.stoneDark);
  // Wände (Holzbretter)
  p.rect(8, 36, W - 16, 34, C.wood);
  for (let x = 8; x < W - 8; x += 6) p.vline(x, 36, 34, C.woodDark).vline(x + 1, 36, 34, C.woodLight);
  p.speckle(8, 36, W - 16, 34, C.woodDark, 40, r);
  // Fundament
  p.rect(6, 70, W - 12, 8, C.stone);
  for (let x = 6; x < W - 6; x += 7) p.vline(x, 70, 8, C.stoneDark);
  p.hline(6, 74, W - 12, C.stoneDark);
  p.speckle(6, 70, W - 12, 8, C.stoneLight, 20, r);
  // Dach
  for (let y = 8; y <= 38; y++) {
    const inset = Math.round((38 - y) * 1.15);
    const x0 = inset;
    const x1 = W - inset;
    const band = Math.floor((y - 8) / 4);
    p.hline(x0, y, x1 - x0, (y - 8) % 4 === 3 ? C.roofDark : band % 2 ? C.roof : '#c4543f');
    if ((y - 8) % 4 === 0) {
      for (let x = x0 + ((band * 5) % 10); x < x1; x += 10) p.vline(x, y, 4, C.roofDark);
    }
  }
  p.rect(0, 37, W, 3, C.roofDark);
  p.hline(36, 8, W - 72, C.roofLight);
  // Tür
  p.rect(43, 48, 14, 22, C.woodDarker).rect(45, 50, 10, 20, C.woodDark);
  p.vline(50, 50, 20, C.woodDarker).px(53, 60, C.gold).px(53, 61, C.goldDark);
  p.rect(41, 70, 18, 2, C.stoneLight);
  // Fenster mit warmem Licht
  for (const wx of [16, 66]) {
    p.rect(wx, 44, 18, 14, C.woodDarker);
    p.rect(wx + 1, 45, 16, 12, C.window);
    p.rect(wx + 1, 45, 16, 4, '#fff0b8');
    p.vline(wx + 8, 45, 12, C.woodDarker).hline(wx + 1, 50, 16, C.woodDarker);
    p.rect(wx - 1, 58, 20, 2, C.woodLight);
    // Blumenkasten
    p.rect(wx, 60, 18, 4, C.woodDark);
    for (let i = 0; i < 6; i++) p.px(wx + 1 + i * 3, 59, [C.red, C.pink, C.gold][i % 3]).px(wx + 2 + i * 3, 59, C.leaf);
  }
  p.outline(C.outline);
  const out = new Pix(W, 88);
  out.ellipse(W / 2, 80, W / 2 - 2, 5, 'rgba(0,0,0,0.2)');
  out.draw(p, 0, 0);
  return out;
}

/** Holzrahmen-Schild, z. B. für QR-Code oder Titel */
export function noticeBoard(w: number, h: number): Pix {
  const p = new Pix(w, h + 14);
  // Pfosten
  p.rect(6, h - 4, 5, 18, C.woodDark).rect(w - 11, h - 4, 5, 18, C.woodDark);
  p.vline(9, h - 4, 18, C.woodDarker).vline(w - 8, h - 4, 18, C.woodDarker);
  frame(p, 0, 0, w, h);
  p.outline(C.outline);
  return p;
}

/** Holzrahmen + Pergament (für Panels) */
export function frame(p: Pix, x: number, y: number, w: number, h: number, inner = C.paper) {
  p.rect(x, y, w, h, C.woodDark);
  p.rect(x + 1, y + 1, w - 2, h - 2, C.wood);
  p.hline(x + 1, y + 1, w - 2, C.woodLight).vline(x + 1, y + 1, h - 2, C.woodLight);
  p.hline(x + 1, y + h - 2, w - 2, C.woodDarker).vline(x + w - 2, y + 1, h - 2, C.woodDarker);
  // Nägel
  for (const [nx, ny] of [
    [x + 2, y + 2],
    [x + w - 4, y + 2],
    [x + 2, y + h - 4],
    [x + w - 4, y + h - 4],
  ]) p.rect(nx, ny, 2, 2, C.woodDarker).px(nx, ny, C.stoneLight);
  p.rect(x + 4, y + 4, w - 8, h - 8, C.woodDarker);
  p.rect(x + 5, y + 5, w - 10, h - 10, inner);
  p.hline(x + 5, y + 5, w - 10, shade(inner, 1.15));
  p.hline(x + 5, y + h - 6, w - 10, C.paperDark);
}

/** Pergament-Panel in beliebiger Größe (für UI) */
export function panelPix(w: number, h: number, variant: 'paper' | 'dark' = 'paper'): Pix {
  const p = new Pix(w, h);
  frame(p, 0, 0, w, h, variant === 'paper' ? C.paper : '#3b2a22');
  if (variant === 'paper') {
    const r = rng(w * 31 + h);
    p.speckle(6, 6, w - 12, h - 12, '#f0d9a3', (w * h) / 60, r);
  }
  return p;
}

/** Kleines Namensschild */
export function tagPix(w: number): Pix {
  const p = new Pix(w, 11);
  p.rect(0, 0, w, 11, C.woodDark);
  p.rect(1, 1, w - 2, 9, C.paper);
  p.hline(1, 9, w - 2, C.paperDark);
  return p;
}

// ------------------------------------------------------------------ Strand & Garten

export function umbrella(a = C.red, b = C.white): Pix {
  const p = new Pix(34, 40);
  p.rect(16, 12, 2, 27, '#d8d2c4').vline(17, 12, 27, '#a59e8f');
  for (let y = 2; y <= 14; y++) {
    const half = Math.round(Math.sqrt(Math.max(0, 1 - ((14 - y) / 13) ** 2)) * 16);
    for (let x = 17 - half; x <= 17 + half; x++) {
      const seg = Math.floor(((x - 1) / 34) * 6);
      p.px(x, y, seg % 2 ? a : b);
    }
  }
  p.hline(1, 14, 33, shade(a, 0.7));
  for (let x = 1; x < 34; x += 6) p.px(x + 2, 15, shade(a, 0.7));
  p.disc(17, 1.5, 1.5, C.gold);
  p.outline(C.outline);
  return p;
}

export function towel(a: string, b = C.white): Pix {
  const p = new Pix(16, 26);
  p.rect(1, 1, 14, 24, a);
  for (let y = 4; y < 24; y += 6) p.rect(1, y, 14, 2, b);
  p.hline(1, 1, 14, shade(a, 1.2));
  p.outline(shade(a, 0.5));
  return p;
}

export function deckchair(fabric: string): Pix {
  const p = new Pix(26, 20);
  // Gestell
  p.rect(2, 16, 22, 2, C.woodDark);
  p.rect(3, 13, 2, 5, C.wood).rect(21, 13, 2, 5, C.wood);
  // Liegefläche
  p.rect(4, 11, 20, 3, fabric).rect(4, 13, 20, 1, shade(fabric, 0.7));
  // Rückenlehne schräg
  for (let i = 0; i < 9; i++) p.rect(2 + i * 0.4, 11 - i, 6, 1, i % 3 === 0 ? C.white : fabric);
  for (let x = 6; x < 24; x += 4) p.px(x, 11, C.white);
  p.outline(C.outline);
  return p;
}

export function campfire(frame = 0): Pix {
  const p = new Pix(20, 22);
  const r = rng(40 + frame);
  // Steinring
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.ellipse(10 + Math.cos(a) * 7, 17 + Math.sin(a) * 2.5, 2, 1.6, i % 2 ? C.stone : C.stoneDark);
  }
  // Holz
  p.rect(4, 16, 12, 2, C.trunk).rect(6, 14, 8, 2, C.trunkDark);
  // Flammen
  const flick = frame % 2;
  p.ellipse(10, 11, 4.5, 6 + flick, C.orange);
  p.ellipse(10 + (flick ? 1 : -1), 12, 3, 4, C.gold);
  p.ellipse(10, 14, 1.6, 2, '#fff4c2');
  for (let i = 0; i < 3; i++) p.px(6 + Math.floor(r() * 9), 2 + Math.floor(r() * 4), C.gold);
  p.outline(C.outline);
  return p;
}

export function crate(): Pix {
  const p = new Pix(16, 16);
  p.rect(1, 1, 14, 14, C.wood);
  p.rect(1, 1, 14, 2, C.woodLight).rect(1, 13, 14, 2, C.woodDark);
  for (let i = 0; i < 10; i++) p.px(3 + i, 3 + i, C.woodDark).px(12 - i, 3 + i, C.woodDark);
  p.outline(C.outline);
  return p;
}

// ------------------------------------------------------------------ Spielbrett

/** Trittstein mit farbigem Edelstein in der Mitte */
export function fieldStone(gem: string, symbol?: 'q' | 's'): Pix {
  const p = new Pix(18, 15);
  p.ellipse(9, 8, 8, 6, C.stone);
  p.overlayOn(() => {
    p.ellipse(8, 6, 6, 4, C.stoneLight);
    p.rect(0, 10, 18, 5, C.stoneDark);
  });
  p.ellipse(9, 7, 4.5, 3.2, shade(gem, 0.75));
  p.ellipse(9, 6.5, 3.5, 2.4, gem);
  p.px(7, 5, C.white).px(8, 5, shade(gem, 1.5));
  if (symbol === 'q') p.map(8, 4, ['##.', '..#', '.#.', '...', '.#.'], { '#': C.ink });
  if (symbol === 's') p.map(8, 4, ['###', '#..', '###', '..#', '###'], { '#': C.white });
  p.outline(C.outline);
  return p;
}

export function cocktail(): Pix {
  const p = new Pix(14, 18);
  p.map(0, 0, [
    '..........y...',
    '.........yyy..',
    '..........y...',
    '.gggggggggg...',
    '..pppppppp....',
    '...pPPPPp.....',
    '....pPPp......',
    '.....pp.......',
    '......w.......',
    '......w.......',
    '......w.......',
    '....wwwww.....',
  ], { y: C.gold, g: '#c9f0ff', p: C.pink, P: '#ff9fc4', w: '#e8f6ff' });
  p.vline(9, 0, 4, C.green);
  p.outline(C.outline);
  return p;
}

export function coinIcon(): Pix {
  const p = new Pix(9, 9);
  p.disc(4.5, 4.5, 4, C.goldDark);
  p.disc(4, 4, 3, C.gold);
  p.vline(4, 2, 5, C.goldDark).px(3, 3, '#fff2b0');
  p.outline(C.outline);
  return p;
}

// ------------------------------------------------------------------ Möbel (Mörderspiel)

export function bed(blanket = C.blue): Pix {
  const p = new Pix(24, 32);
  p.rect(1, 1, 22, 30, C.woodDark);
  p.rect(3, 3, 18, 7, C.white).rect(3, 8, 18, 2, '#d9d2c2');
  p.rect(2, 11, 20, 18, blanket);
  p.rect(2, 11, 20, 2, shade(blanket, 1.25));
  for (let y = 15; y < 28; y += 4) p.hline(2, y, 20, shade(blanket, 0.8));
  p.outline(C.outline);
  return p;
}

export function sofa(c = '#8f4a7d'): Pix {
  const p = new Pix(36, 18);
  p.rect(0, 2, 36, 7, shade(c, 0.8));
  p.rect(0, 8, 36, 9, c);
  p.rect(0, 2, 5, 15, shade(c, 0.75)).rect(31, 2, 5, 15, shade(c, 0.75));
  p.vline(18, 8, 8, shade(c, 0.7));
  p.hline(5, 9, 26, shade(c, 1.2));
  p.outline(C.outline);
  return p;
}

export function bathtub(): Pix {
  const p = new Pix(32, 18);
  p.rect(0, 0, 32, 18, '#f4f1ea');
  p.rect(2, 2, 28, 14, '#d7e8ef');
  p.rect(3, 3, 26, 12, C.waterLight);
  p.hline(5, 6, 6, C.white).hline(16, 10, 5, C.white);
  p.rect(27, 7, 3, 4, C.stoneDark);
  p.outline(C.outline);
  return p;
}

export function counter(): Pix {
  const p = new Pix(44, 16);
  p.rect(0, 0, 44, 16, C.woodDark);
  p.rect(0, 0, 44, 5, '#e9e2d0').hline(0, 4, 44, '#bdb4a0');
  // Herd
  p.rect(26, 0, 14, 5, '#4d4a47');
  p.disc(30, 2.5, 1.6, '#2c2a28').disc(36, 2.5, 1.6, '#2c2a28');
  for (let x = 2; x < 44; x += 11) p.rect(x, 7, 9, 7, C.wood).px(x + 4, 10, C.gold);
  p.outline(C.outline);
  return p;
}

export function plant(): Pix {
  const p = new Pix(12, 18);
  p.rect(3, 11, 6, 6, '#c0643a').rect(2, 11, 8, 2, '#d8794b');
  p.disc(6, 7, 4, C.leafDark).disc(3, 5, 2.5, C.leaf).disc(9, 5, 2.5, C.leaf).disc(6, 3, 2.5, C.leafLight);
  p.outline(C.outline);
  return p;
}

export function rug(w = 44, h = 28, c = '#b5473a'): Pix {
  const p = new Pix(w, h);
  p.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, c);
  p.overlayOn(() => {
    p.ellipse(w / 2, h / 2, w / 2 - 4, h / 2 - 4, shade(c, 1.25));
    p.ellipse(w / 2, h / 2, w / 2 - 8, h / 2 - 7, c);
    p.ellipse(w / 2, h / 2, 4, 3, C.gold);
  });
  return p;
}

export function table(): Pix {
  const p = new Pix(26, 18);
  p.rect(1, 1, 24, 11, C.wood).hline(1, 1, 24, C.woodLight).hline(1, 11, 24, C.woodDark);
  p.rect(3, 12, 2, 5, C.woodDark).rect(21, 12, 2, 5, C.woodDark);
  p.disc(8, 5, 2, C.white).disc(17, 6, 2, C.white).px(12, 4, C.red).px(13, 4, C.leaf);
  p.outline(C.outline);
  return p;
}

export function grill(): Pix {
  const p = new Pix(18, 20);
  p.rect(2, 4, 14, 6, '#4d4a47').rect(3, 4, 12, 1, '#7a7671');
  for (let x = 4; x < 15; x += 3) p.vline(x, 4, 5, '#2c2a28');
  p.rect(4, 10, 2, 9, '#4d4a47').rect(12, 10, 2, 9, '#4d4a47');
  p.px(6, 2, '#d0d0d0').px(9, 1, '#d0d0d0').px(12, 2, '#d0d0d0');
  p.outline(C.outline);
  return p;
}

/** Anonyme Schatten-Gestalt (für das Mörderspiel) */
export function silhouette(): Pix {
  const p = new Pix(14, 22);
  p.ellipse(7, 5, 4.5, 4.5, '#3b3550');
  p.rect(3, 9, 8, 9, '#3b3550').rect(3, 18, 3, 3, '#3b3550').rect(8, 18, 3, 3, '#3b3550');
  p.px(5, 5, '#e6e1ff').px(9, 5, '#e6e1ff');
  p.outline('#14101f');
  return p;
}

export function bottle(): Pix {
  const p = new Pix(7, 17);
  p.map(0, 0, [
    '..cc...',
    '..gg...',
    '..gg...',
    '..gg...',
    '.gggg..',
    'gGgggg.',
    'gwwwwg.',
    'gwrrwg.',
    'gwrrwg.',
    'gwwwwg.',
    'gGgggg.',
    'gGgggg.',
    'gggggg.',
    'gggggg.',
    '.gggg..',
  ], { c: C.gold, g: '#2f7d32', G: '#5fb35f', w: C.white, r: C.red });
  p.outline(C.outline);
  return p;
}

export function ball(): Pix {
  const p = new Pix(6, 6);
  p.disc(3, 3, 2.5, C.white);
  p.px(2, 2, '#ffffff').px(3, 4, '#d0d0d0').px(4, 3, '#d0d0d0');
  p.outline(C.outline);
  return p;
}

export function heart(): Pix {
  const p = new Pix(9, 8);
  p.map(0, 0, ['.rr.rr...', 'rRrrrrr..', 'rrrrrrr..', '.rrrrr...', '..rrr....', '...r.....'], { r: C.red, R: '#ff9a8f' });
  p.outline(C.outline);
  return p;
}

export function crown(): Pix {
  const p = new Pix(11, 8);
  p.map(1, 1, ['g...g...g', 'gg.ggg.gg', 'ggggggggg', 'gRgBgRgBg', 'ggggggggg'], { g: C.gold, R: C.red, B: C.blue });
  p.outline(C.outline);
  return p;
}
