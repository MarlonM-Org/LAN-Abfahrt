import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintSky } from './ground';

/** Nachthimmel mit Sternen */
export function paintNightSky(p: Pix, x: number, y: number, w: number, h: number, seed = 71) {
  paintSky(p, x, y, w, h, ['#0d1230', '#18204a', '#2a2f66', '#4a3f78']);
  const r = rng(seed);
  for (let i = 0; i < (w * h) / 260; i++) {
    const sx = x + Math.floor(r() * w);
    const sy = y + Math.floor(r() * h * 0.85);
    p.px(sx, sy, r() < 0.2 ? '#fff7c9' : 'rgba(255,255,255,0.7)');
  }
}

/** Gegenüberliegendes Ufer: Häuser-Silhouetten mit erleuchteten Fenstern */
export function paintSkyline(p: Pix, baseY: number, seed = 72) {
  const r = rng(seed);
  let x = 0;
  while (x < p.w) {
    const w = 10 + Math.floor(r() * 22);
    const h = 10 + Math.floor(r() * 30);
    const col = r() < 0.5 ? '#1a1838' : '#221f45';
    p.rect(x, baseY - h, w, h, col);
    if (r() < 0.3) p.rect(x + w / 2 - 1, baseY - h - 6, 2, 6, col);
    for (let wy = baseY - h + 3; wy < baseY - 3; wy += 5) {
      for (let wx = x + 2; wx < x + w - 2; wx += 4) if (r() < 0.35) p.rect(wx, wy, 2, 2, r() < 0.8 ? '#ffd77a' : '#ffeab0');
    }
    x += w + Math.floor(r() * 3);
  }
}

/** Rhein mit Lichtspiegelungen */
export function paintRiver(p: Pix, y: number, h: number, seed = 73) {
  const r = rng(seed);
  for (let j = 0; j < h; j++) p.hline(0, y + j, p.w, j < h * 0.4 ? '#141d45' : j < h * 0.75 ? '#19255a' : '#1f2e6a');
  for (let i = 0; i < p.w / 3; i++) {
    const sx = Math.floor(r() * p.w);
    const sy = y + 2 + Math.floor(r() * (h - 4));
    p.hline(sx, sy, 2 + Math.floor(r() * 4), r() < 0.35 ? 'rgba(255,215,122,0.75)' : 'rgba(140,170,255,0.35)');
  }
}

/** Unterseite einer Stahlbrücke (oben im Bild) */
export function paintBridgeUnderside(p: Pix, h: number) {
  p.rect(0, 0, p.w, h, '#2b2d38');
  p.rect(0, h - 6, p.w, 6, '#3c3f4d');
  p.hline(0, h - 6, p.w, '#555a6c');
  for (let x = 0; x < p.w; x += 24) {
    // Fachwerk-Diagonalen
    for (let i = 0; i < h - 8; i++) {
      p.px(x + (i * 24) / (h - 8), i, '#3c3f4d');
      p.px(x + 24 - (i * 24) / (h - 8), i, '#3c3f4d');
    }
    p.rect(x, 0, 2, h - 6, '#454959');
    for (let ry = 4; ry < h - 6; ry += 6) p.px(x + 1, ry, '#6a7084');
  }
  for (let x = 4; x < p.w; x += 8) p.px(x, h - 4, '#6a7084');
  // warmes Licht einer Lampe
  p.rect(p.w * 0.62, h, 3, 3, '#ffe08a');
}

/** Brückenpfeiler aus Stein */
export function paintPillar(p: Pix, x: number, y: number, w: number, h: number) {
  const r = rng(x + y);
  p.rect(x, y, w, h, '#6d6a66');
  for (let yy = y; yy < y + h; yy += 6) {
    p.hline(x, yy, w, '#57544f');
    for (let xx = x + ((yy / 6) % 2) * 5; xx < x + w; xx += 10) p.vline(xx, yy, 6, '#57544f');
  }
  p.speckle(x, y, w, h, '#86827c', (w * h) / 20, r);
  p.vline(x + w - 2, y, h, '#4a4744');
}

/** Steinschüttung (Abhang aus Wasserbausteinen) */
export function paintBoulders(p: Pix, x: number, y: number, w: number, h: number, seed = 74, night = true) {
  const r = rng(seed);
  const base = night ? '#4b4a58' : C.stone;
  p.rect(x, y, w, h, shade(base, 0.7));
  p.clip(x, y, w, h, () => {
    for (let i = 0; i < (w * h) / 40; i++) {
      const bx = x + r() * w;
      const by = y + r() * h;
      const rx = 4 + r() * 6;
      const ry = 3 + r() * 4;
      const c = shade(base, 0.85 + r() * 0.35);
      p.ellipse(bx, by, rx, ry, shade(c, 0.6));
      p.ellipse(bx - 0.5, by - 0.8, rx - 1, ry - 1, c);
      p.ellipse(bx - rx * 0.3, by - ry * 0.4, rx * 0.4, ry * 0.3, shade(c, 1.25));
    }
  });
}

/** Ebener Weg aus flachen Steinplatten entlang eines Polygonzugs */
export function paintStoneWalk(p: Pix, pts: { x: number; y: number }[], width: number, seed = 75) {
  const r = rng(seed);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      p.rect(x - 2, y - width / 2 + 2, 4, width, '#3a3946');
      p.rect(x - 2, y - width / 2, 4, width - 2, '#8f8c99');
      if (s % 5 === 0) p.vline(x, y - width / 2, width - 2, '#77748a');
      if (r() < 0.25) p.px(x, y - width / 2 + 1, '#b4b1c0');
    }
  }
}

// ------------------------------------------------------------------ Sprites

export function pigeon(): Pix {
  const p = new Pix(14, 11);
  p.map(0, 0, [
    '.....gg.......',
    '....gGgg......',
    '...gggwg......',
    '..oggggg......',
    '.....gggggg...',
    '....ggGGGGgg..',
    '....gGGGGGggg.',
    '.....ggggggg..',
    '......y..y....',
    '......y..y....',
  ], { g: '#8f93a8', G: '#6f738a', w: '#2d1b12', o: '#f0b13a', y: '#f0973a' });
  p.px(5, 4, '#7fd4a0').px(6, 4, '#a07fd4');
  p.outline(C.outline);
  return p;
}

export function puddle(): Pix {
  const p = new Pix(18, 6);
  p.ellipse(9, 3, 8.5, 2.6, '#33427e');
  p.overlayOn(() => {
    p.hline(4, 2, 4, '#8fa6ff');
    p.hline(11, 3, 3, '#5c6fb8');
  });
  return p;
}

export function boulder(): Pix {
  const p = new Pix(11, 10);
  p.ellipse(5.5, 5, 5, 4.5, '#8a8798');
  p.overlayOn(() => {
    p.ellipse(4, 3.5, 2.5, 2, '#b4b1c0');
    p.rect(0, 7, 11, 3, '#5c5a6a');
    p.px(7, 4, '#5c5a6a').px(3, 6, '#5c5a6a');
  });
  p.outline(C.outline);
  return p;
}

export function blanket(): Pix {
  const p = new Pix(130, 44);
  const a = '#d65a5a';
  const b = '#f4efe2';
  for (let y = 0; y < 44; y++) {
    const inset = Math.round((44 - y) * 0.35);
    for (let x = inset; x < 130 - inset; x++) {
      const cx = Math.floor((x - inset) / 10) % 2;
      const cy = Math.floor(y / 8) % 2;
      p.px(x, y, cx === cy ? a : b);
    }
  }
  p.outline(C.outline);
  return p;
}

/** Sitzende Figur: Kopf + Oberkörper eines Avatars, Beine nach vorne */
export function sittingFrom(avatar: HTMLCanvasElement, facing: 1 | -1): Pix {
  const p = new Pix(22, 22);
  const top = new Pix(16, 21);
  top.g.drawImage(avatar, 0, 0, 16, 21, 0, 0, 16, 21);
  if (facing === -1) p.draw(top, 6, 0, true);
  else p.draw(top, 0, 0);
  const lx = facing === 1 ? 8 : 2;
  p.rect(lx, 19, 12, 3, '#4a5a86');
  p.rect(facing === 1 ? lx + 10 : lx, 19, 2, 3, '#5b3a24');
  return p;
}
