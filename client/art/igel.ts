import type { Look } from '../../shared/types';
import { HAIRS, SHIRTS } from '../../shared/avatar';
import { IGEL, type Mask } from '../../shared/igel';
import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintSky } from './ground';

// ------------------------------------------------------------------ Figuren

/** Igel (schaut nach rechts) mit Halstuch in Shirtfarbe und Frisur/Cap in Haarfarbe */
export function hedgehog(look: Look, frame = 0): Pix {
  const p = new Pix(18, 15);
  const spike = '#6e4a2c';
  const spikeL = '#9a6c42';
  const spikeD = '#4a2f1a';
  const face = '#f1d2a6';
  const faceS = '#d9b07c';
  const shirt = SHIRTS[look.shirt] ?? SHIRTS[0];
  const hair = HAIRS[look.hair] ?? HAIRS[0];
  // Stachelkleid
  p.ellipse(7.5, 9, 6.5, 5, spike);
  p.overlayOn(() => {
    p.ellipse(6.5, 7.5, 4.5, 3, spikeL);
    for (const [x, y] of [[3, 6], [5, 5], [7, 5], [4, 8], [6, 8], [2, 9], [8, 7]]) p.px(x, y, spikeD);
  });
  // Stachelspitzen am Rücken
  for (const [x, y] of [[1, 6], [2, 4], [4, 3], [6, 3], [8, 3], [0, 9], [10, 4]]) p.px(x, y, spikeD);
  // Gesicht/Schnauze
  p.ellipse(12, 10, 3.6, 3, face);
  p.rect(14, 10, 2, 2, face);
  p.px(16, 10, C.outline);
  p.px(12, 12, faceS).px(13, 12, faceS);
  p.px(12, 8, C.outline).px(12, 9, C.outline);
  p.px(13, 10, '#f0928a');
  // Halstuch
  p.rect(9, 11, 3, 2, shirt).px(8, 12, shade(shirt, 0.8)).px(8, 13, shirt);
  // Füße (2 Laufbilder)
  const fy = 13;
  if (frame === 0) p.rect(5, fy, 2, 1, spikeD).rect(10, fy, 2, 1, spikeD);
  else p.rect(4, fy, 2, 1, spikeD).rect(11, fy - 1, 2, 1, spikeD);
  // Kopfbedeckung
  if (look.hairStyle === 3) {
    p.rect(8, 4, 5, 2, hair).rect(12, 5, 3, 1, shade(hair, 0.75)).px(9, 4, shade(hair, 1.3));
  } else if (look.hairStyle === 4) {
    p.rect(9, 3, 3, 3, hair).px(10, 3, shade(hair, 1.3));
  } else if (look.hairStyle !== 7) {
    p.px(10, 4, hair).px(11, 5, hair).px(9, 5, shade(hair, 0.8)).px(12, 6, hair);
  }
  p.outline(C.outline);
  return p;
}

/** Sandburg als „Grabstein“ für K.o.-Igel */
export function sandcastle(): Pix {
  const p = new Pix(14, 14);
  p.rect(1, 8, 12, 5, C.sand);
  p.rect(4, 4, 6, 5, C.sand);
  p.rect(1, 6, 2, 2, C.sand).rect(5, 2, 1, 2, C.sand).rect(8, 2, 1, 2, C.sand).rect(11, 6, 2, 2, C.sand);
  p.overlayOn(() => {
    p.speckle(0, 0, 14, 14, C.sandDark, 18, rng(5));
    p.rect(6, 9, 2, 4, C.sandDark);
  });
  p.vline(7, 0, 4, C.woodDark).rect(8, 0, 3, 2, C.red);
  p.outline(C.outline);
  return p;
}

/** Schwimmring – K.o. im Wasser: Igel treibt davon */
export function swimRing(look: Look): Pix {
  const p = new Pix(18, 12);
  const shirt = SHIRTS[look.shirt] ?? SHIRTS[0];
  p.ellipse(8.5, 6, 6, 4, '#7a5030');
  p.ellipse(11, 6, 3, 2.5, '#f1d2a6');
  p.px(13, 6, C.outline).px(11, 5, C.outline);
  p.ellipse(8.5, 9, 8.5, 3, C.red);
  p.overlayOn(() => {
    p.rect(3, 6, 2, 6, C.white).rect(12, 6, 2, 6, C.white);
  });
  p.rect(8, 9, 2, 1, shirt);
  p.outline(C.outline);
  return p;
}

export function coconut(): Pix {
  const p = new Pix(8, 8);
  p.disc(4, 4, 3.4, '#7a4a26');
  p.overlayOn(() => {
    p.disc(3, 3, 1.6, '#a8703c');
    p.px(5, 5, '#4a2c14').px(4, 6, '#4a2c14');
  });
  p.outline(C.outline);
  return p;
}

export function waterBomb(): Pix {
  const p = new Pix(9, 10);
  p.ellipse(4.5, 5.5, 3.5, 3.6, '#4ab4f0');
  p.overlayOn(() => p.disc(3.5, 4.5, 1.3, '#bfe9ff'));
  p.rect(4, 1, 1, 2, '#2b6ba6');
  p.outline(C.outline);
  return p;
}

// ------------------------------------------------------------------ Hintergrund

export function paintIslandSky(p: Pix, seed: number) {
  const { W, H } = IGEL;
  const r = rng(seed);
  paintSky(p, 0, 0, W, H, ['#7ec8f2', '#a9dcf6', '#d6efff', '#ffe9c4']);
  // Sonne
  p.disc(400, 46, 16, '#ffe9a0').disc(400, 46, 12, '#fff3c4');
  // Wolken
  for (let i = 0; i < 5; i++) {
    const cx = r() * W;
    const cy = 22 + r() * 70;
    for (let k = 0; k < 4; k++) p.ellipse(cx + k * 9 - 14, cy + (k % 2) * 2, 10, 5, k % 2 ? '#f5fbff' : C.white);
  }
  // Ferne Inseln am Horizont
  for (let i = 0; i < 3; i++) {
    const cx = r() * W;
    p.ellipse(cx, 214, 30 + r() * 30, 12, '#8fb8c9');
    p.vline(cx, 196, 12, '#7aa3b5').ellipse(cx + 2, 196, 6, 2, '#7aa3b5');
  }
  // Meer weit hinten
  p.rect(0, 212, W, H - 212, '#5fb3e3');
  for (let i = 0; i < 80; i++) p.hline(r() * W, 214 + r() * 50, 2 + r() * 4, '#93d3f3');
}

// ------------------------------------------------------------------ Terrain

const hex = (s: string) => {
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};

const COLS = {
  grass: hex(C.grass),
  grassL: hex(C.grassLight),
  grassD: hex(C.grassDark),
  sand: hex(C.sand),
  sandD: hex(C.sandDark),
  dirt: hex(C.dirt),
  dirtD: hex(C.dirtDark),
  dirtL: hex(C.dirtLight),
  stone: hex(C.stone),
  stoneD: hex(C.stoneDark),
  edge: hex('#7a5232'),
  burn: hex('#8a5a32'),
  burnD: hex('#6e4426'),
  deep: hex('#b5844d'),
  deepD: hex('#946437'),
};

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Malt die Inselmaske in ein ImageData (Gras oben, Sand am Strand, Erde mit Steinen innen). */
export function paintTerrain(img: ImageData, m: Mask) {
  const { W, H } = IGEL;
  const d = img.data;
  for (let x = 0; x < W; x++) {
    let depth = 0;
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      if (!m[y * W + x]) {
        depth = 0;
        d[i + 3] = 0;
        continue;
      }
      depth++;
      const h = hash(x, y);
      const beach = y > IGEL.WATER_Y - 26;
      const airBelow = y + 1 < H && !m[(y + 1) * W + x];
      const airSide = (x > 0 && !m[y * W + x - 1]) || (x < W - 1 && !m[y * W + x + 1]);
      let c: readonly [number, number, number];
      if (depth <= 3 && !beach) c = depth === 1 ? (h < 0.3 ? COLS.grassL : COLS.grass) : depth === 2 ? COLS.grass : COLS.grassD;
      else if (depth <= 5 && beach) c = h < 0.2 ? COLS.sandD : COLS.sand;
      else if (depth <= 6) c = COLS.dirtL;
      else {
        // Kleine runde Kiesel + dunklere Erdschichten weiter unten
        const cx = (x >> 2) * 4 + 2;
        const cy = (y >> 2) * 4 + 2;
        const pebble = hash(x >> 2, y >> 2) < 0.045 && (x - cx) ** 2 + (y - cy) ** 2 <= 3;
        const deep = depth > 26 + ((hash(x >> 4, 7) * 10) | 0);
        if (pebble) c = y - cy < 0 ? COLS.stone : COLS.stoneD;
        else if (deep) c = h < 0.1 ? COLS.deepD : h > 0.94 ? COLS.dirt : COLS.deep;
        else c = h < 0.08 ? COLS.dirtD : h > 0.93 ? COLS.dirtL : COLS.dirt;
      }
      if (airBelow || (airSide && depth > 3)) c = COLS.edge;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
  }
}

/** Nach einem Krater: Pixel im Bereich neu setzen (weg = transparent, Rand = angekokelt) */
export function paintCrater(img: ImageData, ox: number, oy: number, m: Mask, cx: number, cy: number, r: number) {
  const { W } = IGEL;
  const d = img.data;
  const w = img.width;
  const h = img.height;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = ox + i;
      const y = oy + j;
      const k = (j * w + i) * 4;
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (!m[y * W + x]) {
        // Nur im Krater selbst löschen – Deko (Palmen) daneben bleibt stehen
        if (dist <= r + 0.5) d[k + 3] = 0;
        continue;
      }
      if (dist <= r + 3) {
        const c = dist <= r + 1.5 ? COLS.burnD : COLS.burn;
        d[k] = c[0];
        d[k + 1] = c[1];
        d[k + 2] = c[2];
      }
    }
  }
}
