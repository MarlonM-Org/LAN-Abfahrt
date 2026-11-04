import { C } from './palette';
import { Pix, rng } from './pix';

/** Gras mit Halmen, leichten Farbvariationen und vereinzelten Blümchen */
export function paintGrass(p: Pix, x: number, y: number, w: number, h: number, seed = 1, flowers = true) {
  p.clip(x, y, w, h, () => grassInner(p, x, y, w, h, seed, flowers));
}

function grassInner(p: Pix, x: number, y: number, w: number, h: number, seed: number, flowers: boolean) {
  const r = rng(seed);
  p.rect(x, y, w, h, C.grass);
  // große, weiche Flecken
  for (let i = 0; i < (w * h) / 900; i++) {
    const cx = x + r() * w;
    const cy = y + r() * h;
    p.ellipse(cx, cy, 10 + r() * 18, 6 + r() * 10, r() < 0.5 ? C.grassDark : '#68ad3d');
  }
  // Halme
  const blades = (w * h) / 22;
  for (let i = 0; i < blades; i++) {
    const bx = x + Math.floor(r() * w);
    const by = y + Math.floor(r() * h);
    const roll = r();
    if (roll < 0.45) p.rect(bx, by, 1, 2, C.grassDark);
    else if (roll < 0.8) p.rect(bx, by, 1, 2, C.grassLight);
    else if (roll < 0.93) p.px(bx, by, C.grassTip);
    else p.rect(bx, by, 1, 2, C.grassDarker);
  }
  // kleine V-Grasbüschel
  for (let i = 0; i < (w * h) / 500; i++) {
    const bx = x + Math.floor(r() * w);
    const by = y + Math.floor(r() * h);
    p.px(bx, by, C.grassDarker).px(bx + 2, by, C.grassDarker).px(bx + 1, by + 1, C.grassDarker);
    p.px(bx, by - 1, C.grassLight).px(bx + 2, by - 1, C.grassLight);
  }
  if (flowers) {
    const cols = [C.white, '#ffe36b', '#f6a7c9', '#a9c8ff'];
    for (let i = 0; i < (w * h) / 1400; i++) {
      const fx = x + 2 + Math.floor(r() * (w - 4));
      const fy = y + 2 + Math.floor(r() * (h - 4));
      const c = cols[Math.floor(r() * cols.length)];
      p.px(fx, fy - 1, c).px(fx - 1, fy, c).px(fx + 1, fy, c).px(fx, fy + 1, c).px(fx, fy, '#ffd25e');
    }
  }
}

/** Hilfsfläche: Form auf separatem Canvas zeichnen, texturieren, mit Rand einfügen */
function paintMasked(
  p: Pix,
  shape: (m: Pix) => void,
  texture: (m: Pix) => void,
  edge?: { c: string; inner?: string },
) {
  const m = new Pix(p.w, p.h);
  shape(m);
  m.overlayOn(() => texture(m));
  if (edge) {
    m.outline(edge.c);
  }
  p.draw(m, 0, 0);
}

export function dirtTexture(m: Pix, seed: number) {
  const r = rng(seed);
  m.rect(0, 0, m.w, m.h, C.dirt);
  m.speckle(0, 0, m.w, m.h, C.dirtDark, (m.w * m.h) / 14, r);
  m.speckle(0, 0, m.w, m.h, C.dirtLight, (m.w * m.h) / 20, r);
  for (let i = 0; i < (m.w * m.h) / 300; i++) {
    const sx = Math.floor(r() * m.w);
    const sy = Math.floor(r() * m.h);
    m.rect(sx, sy, 2, 1, C.stoneLight).px(sx, sy + 1, C.stoneDark);
  }
}

/** Erdweg entlang eines Polygonzugs */
export function paintPath(p: Pix, pts: { x: number; y: number }[], width: number, seed = 3, closed = false) {
  paintMasked(
    p,
    (m) => {
      const all = closed ? [...pts, pts[0]] : pts;
      for (let i = 0; i < all.length - 1; i++) {
        const a = all[i];
        const b = all[i + 1];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
        for (let s = 0; s <= steps; s++) {
          const t = s / Math.max(1, steps);
          m.disc(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, width / 2, C.dirt);
        }
      }
    },
    (m) => dirtTexture(m, seed),
    { c: C.dirtDark },
  );
  grassFringe(p, seed);
}

/** Rechteckige Erdfläche */
export function paintDirtRect(p: Pix, x: number, y: number, w: number, h: number, seed = 5) {
  paintMasked(
    p,
    (m) => m.rect(x, y, w, h, C.dirt),
    (m) => dirtTexture(m, seed),
    { c: C.dirtDark },
  );
}

/** Ein paar Grashalme, die über Wegränder ragen (macht Kanten weicher) */
function grassFringe(p: Pix, seed: number) {
  const r = rng(seed + 99);
  const img = p.g.getImageData(0, 0, p.w, p.h).data;
  const isDirtEdge = (x: number, y: number) => {
    const i = (y * p.w + x) * 4;
    return img[i] === 0xa9 && img[i + 1] === 0x7a && img[i + 2] === 0x43;
  };
  for (let y = 1; y < p.h - 1; y++) {
    for (let x = 1; x < p.w - 1; x++) {
      if (isDirtEdge(x, y) && r() < 0.18) p.rect(x, y - 1, 1, 2, r() < 0.5 ? C.grassDark : C.grassLight);
    }
  }
}

export function paintSand(p: Pix, x: number, y: number, w: number, h: number, seed = 7) {
  p.clip(x, y, w, h, () => sandInner(p, x, y, w, h, seed));
}

function sandInner(p: Pix, x: number, y: number, w: number, h: number, seed: number) {
  const r = rng(seed);
  p.rect(x, y, w, h, C.sand);
  for (let i = 0; i < (w * h) / 1200; i++) p.ellipse(x + r() * w, y + r() * h, 12 + r() * 20, 4 + r() * 6, '#eccb8c');
  p.speckle(x, y, w, h, C.sandDark, (w * h) / 18, r);
  p.speckle(x, y, w, h, C.sandLight, (w * h) / 22, r);
  // Muscheln
  for (let i = 0; i < (w * h) / 2500; i++) {
    const sx = x + Math.floor(r() * w);
    const sy = y + Math.floor(r() * h);
    p.px(sx, sy, '#f7c6c0').px(sx + 1, sy, C.white).px(sx, sy + 1, '#e59a94');
  }
}

export function paintWater(p: Pix, x: number, y: number, w: number, h: number, seed = 11) {
  const r = rng(seed);
  for (let j = 0; j < h; j++) {
    const t = j / h;
    p.hline(x, y + j, w, t < 0.33 ? C.waterDeep : t < 0.66 ? C.waterDark : C.water);
  }
  // Wellenstriche
  for (let i = 0; i < (w * h) / 60; i++) {
    const wx = x + Math.floor(r() * w);
    const wy = y + Math.floor(r() * h);
    const len = 2 + Math.floor(r() * 4);
    p.hline(wx, wy, len, r() < 0.6 ? C.waterLight : C.water);
  }
}

/** Uferlinie mit Schaum */
export function paintShore(p: Pix, x: number, y: number, w: number, seed = 13) {
  const r = rng(seed);
  for (let i = 0; i < w; i++) {
    const off = Math.round(Math.sin(i / 7) * 1.5 + Math.sin(i / 3.1) * 0.8);
    p.vline(x + i, y + off - 2, 2, C.foam);
    p.px(x + i, y + off, '#cfe9e9');
    if (r() < 0.3) p.px(x + i, y + off + 1, '#e3d2a6');
  }
}

export function paintWoodFloor(p: Pix, x: number, y: number, w: number, h: number, seed = 17, base = C.wood) {
  const r = rng(seed);
  const plank = 5;
  for (let j = 0; j < h; j += plank) {
    const rowCol = Math.floor(j / plank) % 2 === 0 ? base : '#ad6f39';
    p.rect(x, y + j, w, plank, rowCol);
    p.hline(x, y + j + plank - 1, w, C.woodDark);
    let sx = x + Math.floor(r() * 20);
    while (sx < x + w) {
      p.vline(sx, y + j, plank - 1, C.woodDark);
      p.px(sx + 2, y + j + 2, C.woodDarker);
      sx += 18 + Math.floor(r() * 14);
    }
    p.speckle(x, y + j, w, plank - 1, C.woodLight, w / 6, r);
  }
}

export function paintTiles(p: Pix, x: number, y: number, w: number, h: number, a: string, b: string, size = 8) {
  for (let j = 0; j < h; j += size) {
    for (let i = 0; i < w; i += size) {
      p.rect(x + i, y + j, size, size, ((i + j) / size) % 2 === 0 ? a : b);
      p.hline(x + i, y + j, size, 'rgba(255,255,255,0.25)');
      p.vline(x + i + size - 1, y + j, size, 'rgba(0,0,0,0.12)');
    }
  }
}

/** Gemalter Himmel mit Farbverlauf in Pixel-Bändern + Dithering */
export function paintSky(p: Pix, x: number, y: number, w: number, h: number, colors: string[]) {
  const band = h / (colors.length - 1);
  for (let j = 0; j < h; j++) {
    const k = Math.min(colors.length - 2, Math.floor(j / band));
    const t = (j - k * band) / band;
    for (let i = 0; i < w; i++) {
      const dither = ((i + j) % 2 === 0 ? 0.12 : -0.12) + (((i >> 1) + (j >> 1)) % 2 === 0 ? 0.06 : -0.06);
      p.px(x + i, y + j, t + dither > 0.5 ? colors[k + 1] : colors[k]);
    }
  }
}
