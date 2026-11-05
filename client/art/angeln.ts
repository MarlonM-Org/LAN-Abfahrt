import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintGrass, paintSand } from './ground';
import type { FishKind } from '../../shared/angeln';

/** Angeln: See am Ferienhaus von oben – Steg unten, tiefes Wasser oben (alles prozedural) */

export const LAKE = {
  /** Ufer gegenüber (oben) */
  TOP: 40,
  /** Vorderkante des Stegs */
  JETTY_TOP: 222,
  JETTY_BOTTOM: 244,
  /** Ufer vorne (Namensschilder) */
  SHORE: 250,
  /** Ab hier beginnt links das Ufer mit dem Ferienhaus */
  LEFT: 58,
};

/** Linkes Ufer: Kante des Wassers (x) abhängig von y */
const leftEdge = (y: number) => (y < 96 ? 0 : Math.round((LAKE.LEFT + 4) * Math.sqrt(Math.min(1, (y - 96) / 50))));

/** Tiefe des Wassers an einer Stelle (0 = flach … 1 = tief), für die Farbe */
function depthAt(x: number, y: number): number {
  const t = (LAKE.JETTY_TOP - y) / (LAKE.JETTY_TOP - LAKE.TOP - 30);
  // zu den Ufern hin (oben und links) wieder flacher – mit welligen Höhenlinien
  const far = Math.max(0, (LAKE.TOP + 34 - y) / 34);
  const left = Math.max(0, (leftEdge(y) + 46 - x) / 46);
  const wobble = Math.sin(x / 19 + y / 13) * 0.05 + Math.sin(x / 7 - y / 17) * 0.03;
  return Math.max(0, Math.min(1, t + wobble - far * far * 0.9 - left * left * 0.8));
}

const WATER = ['#5fb4e2', '#4aa2dc', '#3f95d0', '#3784c2', '#2f76b4', '#2b6ba6', '#255f98', '#20548a'];

export function paintLake(p: Pix, w: number, h: number) {
  const r = rng(5150);
  // Ufer gegenüber und Garten des Ferienhauses links: Wiese
  paintGrass(p, 0, 0, w, LAKE.TOP + 6, 5151, true);
  paintGrass(p, 0, 90, LAKE.LEFT + 8, h - 90, 5152, true);
  // See mit Tiefenverlauf (leicht gerastert)
  for (let y = LAKE.TOP; y < LAKE.JETTY_BOTTOM + 10; y++) {
    const e = leftEdge(y);
    for (let x = e; x < w; x++) {
      const d = depthAt(x, y);
      const dither = ((x + y * 3) % 4) / 4 - 0.4;
      const k = Math.max(0, Math.min(WATER.length - 1, Math.floor(d * (WATER.length - 1) + 0.5 + dither * 0.6)));
      p.px(x, y, WATER[k]);
    }
    // Uferkante links: Sand, Schaum
    if (e > 0) {
      p.px(e - 1, y, C.sandDark).px(e - 2, y, C.sand).px(e - 3, y, C.sand);
      p.px(e, y, C.foam);
      if ((y * 7) % 3) p.px(e + 1, y, '#93d3f3');
    }
  }
  // Uferkante oben (Sand + Schaum)
  for (let x = 0; x < w; x++) {
    const yy = LAKE.TOP + Math.round(Math.sin(x / 23) * 2 + Math.sin(x / 7) * 1);
    p.vline(x, yy - 3, 3, C.sandDark);
    p.px(x, yy, C.foam);
    if (x % 3) p.px(x, yy + 1, '#93d3f3');
  }
  // Wellenstriche, im Tiefen dunkler
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(r() * w);
    const y = LAKE.TOP + 6 + Math.floor(r() * (LAKE.JETTY_TOP - LAKE.TOP - 6));
    if (x < leftEdge(y) + 4) continue;
    const d = depthAt(x, y);
    p.hline(x, y, 2 + Math.floor(r() * 4), d > 0.55 ? '#3c7fbc' : '#8fd0f2');
  }
  // Seerosen am Rand
  for (const [lx, ly] of [
    [70, 70],
    [420, 58],
    [96, 150],
    [452, 120],
    [300, 64],
  ]) {
    p.ellipse(lx, ly, 6, 3, '#3f8a32');
    p.px(lx + 2, ly, WATER[1]).px(lx + 3, ly, WATER[1]);
    if ((lx + ly) % 3 === 0) p.px(lx - 2, ly - 1, '#f07aa8').px(lx - 1, ly - 1, '#ffd2e4');
  }
  // Vorderes Ufer (Sand) unter dem Steg
  paintSand(p, 0, LAKE.SHORE, w, h - LAKE.SHORE, 5153);
  for (let x = 0; x < w; x++) {
    p.px(x, LAKE.SHORE, C.foam);
    if (x % 4) p.px(x, LAKE.SHORE + 1, C.sandDark);
  }
  paintJetty(p, w);
}

/** Langer Steg quer über das Bild (Bretter laufen quer zur Blickrichtung) */
function paintJetty(p: Pix, w: number) {
  const r = rng(5160);
  const x0 = LAKE.LEFT - 18;
  const y0 = LAKE.JETTY_TOP;
  const hgt = LAKE.JETTY_BOTTOM - y0;
  // Schatten aufs Wasser
  p.rect(x0 + 2, LAKE.JETTY_BOTTOM, w - x0, 4, 'rgba(20,50,90,0.35)');
  const tones = [C.wood, '#b27238', '#bf8146', '#ad6f39'];
  for (let x = x0; x < w; x += 6) {
    const base = tones[Math.floor(r() * tones.length)];
    p.rect(x, y0, 6, hgt, base);
    p.vline(x, y0, hgt, shade(base, 1.15));
    p.vline(x + 5, y0, hgt, C.woodDark);
    p.speckle(x + 1, y0 + 1, 4, hgt - 2, C.woodLight, 3, r);
    if (r() < 0.25) p.px(x + 2 + Math.floor(r() * 2), y0 + 4 + Math.floor(r() * (hgt - 8)), C.woodDarker);
    // Nägel auf den Querbalken
    p.px(x + 2, y0 + 3, C.stoneDark).px(x + 2, y0 + hgt - 4, C.stoneDark);
  }
  // Querbalken (Kanten)
  p.hline(x0, y0, w - x0, C.woodLight);
  p.rect(x0, y0 + hgt - 2, w - x0, 2, C.woodDarker);
  // Pfähle vorne im Wasser
  for (let x = x0 + 10; x < w; x += 44) {
    p.rect(x, LAKE.JETTY_BOTTOM, 4, 5, C.trunk);
    p.px(x, LAKE.JETTY_BOTTOM, '#9a6436');
    p.hline(x - 1, LAKE.JETTY_BOTTOM + 5, 6, C.foam);
  }
  // Steg-Anfang am Ufer
  p.rect(x0 - 2, y0 - 1, 2, hgt + 2, C.woodDarker);
}

// ------------------------------------------------------------------ Kleinkram

/** Pose: oben in Spielerfarbe, unten weiß */
export function bobber(color: string): Pix {
  const p = new Pix(7, 10);
  p.vline(3, 0, 2, C.outline);
  p.ellipse(3.5, 5, 2.5, 3, C.white);
  p.overlayOn(() => p.rect(0, 0, 7, 5, color));
  p.outline(C.outline);
  p.px(2, 3, 'rgba(255,255,255,0.7)');
  return p;
}

/** Fischschatten unter Wasser (Draufsicht, Kopf nach rechts) */
export function fishShadow(len: number): Pix {
  const p = new Pix(len + 4, 7);
  p.ellipse(len / 2 + 2, 3.5, len / 2, 2.2, 'rgba(15,40,70,0.5)');
  p.rect(0, 1, 3, 5, 'rgba(15,40,70,0.4)');
  return p;
}

/** Angelrute (schräg nach oben rechts), Ursprung = Griff */
export function rod(): Pix {
  const p = new Pix(14, 22);
  for (let i = 0; i < 20; i++) {
    const x = 1 + Math.round(i * 0.55);
    const y = 21 - i;
    p.px(x, y, i < 6 ? C.woodDarker : i < 14 ? '#3b3b4f' : '#5a5a6e');
  }
  p.rect(0, 18, 3, 3, C.woodDark);
  p.px(4, 15, C.stoneLight).px(5, 15, C.stone);
  return p;
}

/** Holzkiste mit Ködern (Deko) */
export function baitBox(): Pix {
  const p = new Pix(14, 10);
  p.rect(0, 2, 14, 8, C.woodDark);
  p.rect(1, 3, 12, 6, C.wood);
  p.rect(2, 4, 4, 4, '#6b4a2a');
  p.px(3, 5, '#e07a8a').px(4, 6, '#e07a8a');
  p.rect(8, 4, 4, 4, '#4f7a3a');
  p.rect(0, 0, 14, 2, C.woodLight);
  p.outline(C.outline);
  return p;
}

/** Ruderboot von oben */
export function rowBoat(): Pix {
  const p = new Pix(40, 16);
  p.ellipse(20, 8, 19, 7, '#e9e1cf');
  p.overlayOn(() => {
    p.rect(0, 0, 40, 3, '#3f8fe0');
    p.rect(0, 13, 40, 3, '#3f8fe0');
  });
  p.ellipse(20, 8, 15, 4.5, C.woodDark);
  p.rect(13, 4, 3, 9, C.wood).rect(25, 4, 3, 9, C.wood);
  p.outline(C.outline);
  // Ruder
  p.hline(10, 1, 6, C.woodLight).hline(26, 14, 6, C.woodLight);
  return p;
}

// ------------------------------------------------------------------ Fänge (Seitenansicht, Kopf nach rechts)

interface FishLook {
  len: number;
  h: number;
  body: string;
  belly: string;
  fin: string;
  eye?: string;
}

const LOOKS: Record<Exclude<FishKind, 'alge' | 'schuh'>, FishLook> = {
  rotauge: { len: 14, h: 6, body: '#aebdc8', belly: '#e8eef2', fin: '#e0503f', eye: '#e0503f' },
  barsch: { len: 15, h: 7, body: '#8fae4a', belly: '#e8e2b0', fin: '#f0973a' },
  forelle: { len: 17, h: 6, body: '#a7b08a', belly: '#f2e8da', fin: '#9a9a6a' },
  karpfen: { len: 19, h: 8, body: '#c9a046', belly: '#f0dca0', fin: '#a87a2a' },
  zander: { len: 20, h: 6, body: '#8a9a8a', belly: '#dfe6dc', fin: '#6f7f6f', eye: '#f2e8da' },
  hecht: { len: 26, h: 6, body: '#5f8a3a', belly: '#d8e0a0', fin: '#7a6a2a' },
  wels: { len: 30, h: 9, body: '#5a524a', belly: '#a89a8a', fin: '#3f3a34' },
  goldfisch: { len: 12, h: 7, body: '#f0973a', belly: '#ffd25e', fin: '#ffb867' },
};

export function catchSprite(kind: FishKind): Pix {
  if (kind === 'schuh') return shoe();
  if (kind === 'alge') return weed();
  const L = LOOKS[kind];
  const tail = kind === 'goldfisch' ? 7 : kind === 'wels' ? 6 : 5;
  const W = L.len + tail + 2;
  const H = L.h + 6;
  const p = new Pix(W, H);
  const cy = H / 2;
  const bx = tail + 1;
  // Schwanzflosse
  for (let i = 0; i < tail; i++) {
    const s = Math.round(((tail - i) / tail) * (L.h / 2 + (kind === 'goldfisch' ? 2 : 1)));
    p.vline(i + 1, cy - s, s * 2, L.fin);
  }
  // Rückenflosse
  const dorsal = kind === 'hecht' ? bx + L.len * 0.15 : bx + L.len * 0.35;
  p.rect(dorsal, cy - L.h / 2 - 2, kind === 'barsch' || kind === 'zander' ? 6 : 4, 2, kind === 'barsch' ? '#3d5a2a' : L.fin);
  // Körper
  p.ellipse(bx + L.len / 2, cy, L.len / 2, L.h / 2, L.body);
  p.overlayOn(() => {
    p.rect(0, cy + 1, W, L.h, L.belly);
    p.hline(0, Math.floor(cy - L.h / 2) + 1, W, shade(L.body, 1.2));
  });
  // Muster
  const rr = rng(kind.length * 31);
  if (kind === 'barsch') for (let x = bx + 3; x < bx + L.len - 3; x += 3) p.vline(x, cy - L.h / 2 + 1, L.h - 2, '#3d5a2a');
  if (kind === 'forelle') {
    p.hline(bx + 2, cy, L.len - 4, '#e88a9a');
    for (let i = 0; i < 7; i++) p.px(bx + 2 + rr() * (L.len - 4), cy - 2 + rr() * 2, '#3d3a2a');
  }
  if (kind === 'karpfen') for (let x = bx + 3; x < bx + L.len - 3; x += 3) for (let y = cy - 2; y <= cy + 1; y += 2) p.px(x + ((y | 0) % 2), y, '#a87a2a');
  if (kind === 'zander') for (let x = bx + 4; x < bx + L.len - 4; x += 4) p.vline(x, cy - L.h / 2 + 1, 3, '#5f6f5f');
  if (kind === 'hecht') for (let i = 0; i < 10; i++) p.px(bx + 2 + rr() * (L.len - 6), cy - 2 + rr() * 3, '#d8e0a0');
  if (kind === 'goldfisch') p.px(bx + 4, cy - 2, '#fff6c8').px(bx + 5, cy - 2, '#fff6c8');
  // Brust-/Bauchflosse
  p.rect(bx + L.len * 0.55, cy + L.h / 2 - 1, 3, 2, L.fin);
  // Maul: Hecht mit Entenschnabel, Wels mit Barteln
  if (kind === 'hecht') p.rect(bx + L.len - 1, cy - 1, 3, 2, L.body);
  p.outline(C.outline);
  if (kind === 'wels' || kind === 'karpfen') {
    p.px(W - 2, cy + 2, C.outline).px(W - 3, cy + 3, C.outline);
    if (kind === 'wels') p.px(W - 4, cy + 4, C.outline).px(W - 1, cy - 2, C.outline).px(W - 1, cy - 3, C.outline);
  }
  // Auge + Kiemen
  const ex = bx + L.len - (kind === 'hecht' ? 5 : 4);
  p.px(ex, cy - 1, L.eye ?? '#fdf7ea').px(ex + 1, cy - 1, C.outline);
  p.vline(ex - 2, cy - 1, 3, shade(L.body, 0.75));
  return p;
}

function shoe(): Pix {
  const p = new Pix(16, 12);
  p.rect(2, 1, 6, 7, '#6b4a2a');
  p.rect(2, 6, 12, 4, '#7a5532');
  p.ellipse(12, 8, 3, 2, '#7a5532');
  p.rect(1, 10, 15, 2, '#3d2a1a');
  p.hline(3, 2, 4, '#8a6a42');
  p.px(4, 4, C.white).px(6, 4, C.white).px(5, 5, C.white);
  p.outline(C.outline);
  // Wasser tropft
  p.px(9, 0, '#93d3f3');
  return p;
}

function weed(): Pix {
  const p = new Pix(14, 14);
  const r = rng(77);
  for (let i = 0; i < 9; i++) {
    let x = 3 + r() * 8;
    for (let y = 1; y < 13; y++) {
      x += (r() - 0.5) * 1.6;
      p.px(x, y, [C.leafDark, C.leaf, '#6f9a3a', C.leafLight][i % 4]);
    }
  }
  p.outline(C.outline);
  return p;
}
