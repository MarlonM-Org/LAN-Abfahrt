/**
 * Grill-Chaos: Pixel-Art für Zutaten, Teller/Gläser, Stationen und die Garten-Küche.
 * Wird vom TV (Phaser-Texturen) und vom Handy ("Du trägst") benutzt.
 */
import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintGrass } from './ground';
import { GRILL, GRILL_CRATES, type GrillIng, type GrillItem, type GrillStep } from '../../shared/grill';

const T = GRILL.TILE;

// ------------------------------------------------------------------ Zutaten (10 × 10)

const GRILLED = '#5a3418';

export function grillIngPix(t: GrillIng, s: GrillStep): Pix {
  const p = new Pix(10, 10);
  if (s === 'burnt') {
    p.ellipse(5, 6, 4.5, 3.2, '#2b2522');
    p.overlayOn(() => {
      p.px(3, 5, '#4a403a').px(6, 4, '#4a403a').px(7, 7, '#3a322d');
    });
    p.px(2, 2, '#8a8580').px(6, 1, '#a8a39d');
    p.outline(C.outline);
    return p;
  }
  switch (t) {
    case 'paprika':
      if (s === 'raw') {
        p.ellipse(5, 6, 4, 3.6, '#e0503f');
        p.overlayOn(() => p.ellipse(3.6, 5, 1.2, 2, '#f58a7a'));
        p.rect(4, 0, 2, 3, C.green);
      } else {
        const c = s === 'grill' ? '#b5392f' : '#e0503f';
        for (const [x, y] of [[1, 2], [5, 1], [2, 6], [6, 5]]) p.rect(x, y, 3, 3, c);
        if (s === 'grill') for (const [x, y] of [[2, 3], [6, 2], [3, 7], [7, 6]]) p.px(x, y, GRILLED);
      }
      break;
    case 'zucchini':
      if (s === 'raw') {
        for (let i = 0; i < 8; i++) p.disc(1.5 + i, 7.5 - i * 0.6, 1.8, '#3f8a32');
        p.overlayOn(() => {
          for (let i = 1; i < 7; i += 2) p.px(1 + i, 6 - i * 0.6, '#86cc55');
        });
        p.rect(8, 1, 2, 2, '#c9a24a');
      } else {
        const ring = s === 'grill' ? '#2d6a28' : '#3f8a32';
        const flesh = s === 'grill' ? '#c9b26a' : '#d8eca0';
        for (const [x, y] of [[3, 3], [7, 4], [4, 7]]) {
          p.disc(x, y, 2.6, ring);
          p.disc(x, y, 1.6, flesh);
          if (s === 'grill') p.px(x - 1, y, GRILLED).px(x, y - 1, GRILLED);
        }
      }
      break;
    case 'mais': {
      const k = s === 'grill' ? '#e8a830' : '#f2c33a';
      p.ellipse(5, 5, 2.6, 4.6, k);
      p.overlayOn(() => {
        for (let y = 1; y < 10; y += 2) for (let x = 3; x < 8; x += 2) p.px(x + (y % 4 === 1 ? 1 : 0), y, s === 'grill' ? '#c07a1c' : '#ffe27a');
      });
      if (s === 'raw') p.rect(1, 5, 2, 5, '#86cc55').rect(7, 5, 2, 5, '#5fae42');
      else p.px(2, 4, GRILLED).px(7, 6, GRILLED);
      break;
    }
    case 'tofu': {
      const c = s === 'grill' ? '#b9783f' : '#e8cfa0';
      for (let i = 0; i < 7; i++) p.disc(2 + i, 6.5 - i * 0.5, 1.8, c);
      p.overlayOn(() => {
        if (s === 'grill') for (let i = 0; i < 3; i++) p.px(3 + i * 2, 6 - i, GRILLED).px(3 + i * 2, 5 - i, GRILLED);
        else p.px(3, 5, '#f8ead0').px(5, 4, '#f8ead0');
      });
      break;
    }
    case 'broetchen':
      p.ellipse(5, 6, 4.5, 3.4, '#d9a35c');
      p.overlayOn(() => {
        p.ellipse(4, 5, 3, 1.6, '#ebc17e');
        p.hline(2, 6, 6, '#b07a36');
      });
      break;
    case 'zitrone':
      if (s === 'raw') {
        p.ellipse(5, 5.5, 4.4, 3.4, '#f4d43a');
        p.overlayOn(() => p.ellipse(3.6, 4.6, 1.4, 1, '#fff2a0'));
        p.px(9, 5, '#d8b42a').px(0, 6, '#d8b42a');
      } else {
        p.disc(5, 5, 4.2, '#f4d43a');
        p.disc(5, 5, 3.2, '#fff2a0');
        p.overlayOn(() => {
          p.vline(5, 2, 7, '#f4d43a').hline(2, 5, 7, '#f4d43a');
          p.px(3, 3, '#f4d43a').px(7, 7, '#f4d43a').px(7, 3, '#f4d43a').px(3, 7, '#f4d43a');
        });
      }
      break;
    case 'minze':
      if (s === 'raw') {
        p.vline(5, 3, 7, '#2d6a28');
        p.ellipse(3, 4, 2.4, 1.6, '#46b04a').ellipse(7, 4, 2.4, 1.6, '#46b04a').ellipse(3, 7, 2.2, 1.5, '#5fae42').ellipse(7, 7, 2.2, 1.5, '#5fae42');
        p.ellipse(5, 1.8, 1.6, 1.6, '#86cc55');
      } else {
        for (const [x, y] of [[2, 3], [6, 2], [4, 6], [7, 6], [2, 7]]) p.rect(x, y, 2, 2, x % 3 ? '#46b04a' : '#86cc55');
      }
      break;
    case 'eis':
      for (const [x, y] of [[1, 4], [5, 2], [4, 6]]) {
        p.rect(x, y, 4, 4, '#cfeefc');
        p.px(x, y, C.white).px(x + 1, y, C.white);
        p.px(x + 3, y + 3, '#93d3f3');
      }
      break;
  }
  p.outline(C.outline);
  return p;
}

// ------------------------------------------------------------------ Teller, Glas, Feuerlöscher

export function extinguisherPix(): Pix {
  const p = new Pix(10, 15);
  p.rect(2, 4, 6, 10, '#d8352a');
  p.rect(3, 4, 1, 9, '#f07466');
  p.rect(2, 8, 6, 2, C.white);
  p.rect(3, 1, 4, 3, '#3b3b4f');
  p.rect(6, 0, 3, 2, '#3b3b4f').px(9, 2, '#3b3b4f');
  p.outline(C.outline);
  return p;
}

function platePix(): Pix {
  const p = new Pix(22, 9);
  p.ellipse(11, 4.5, 10, 3.8, '#f4efe2');
  p.ellipse(11, 4.2, 7, 2.4, '#e2dccb');
  p.outline(C.outline);
  return p;
}

const LIQUID: Partial<Record<GrillIng, string>> = { zitrone: '#fbe98a', minze: '#bfe8a0' };

function glassPix(parts: GrillItem['p']): Pix {
  const p = new Pix(14, 18);
  // Glas
  p.rect(2, 2, 10, 15, '#d8f1fc');
  const types = parts.map((x) => x.t);
  const liquid = types.includes('minze') ? LIQUID.minze : types.includes('zitrone') ? LIQUID.zitrone : null;
  if (liquid) p.rect(3, 6, 8, 10, liquid);
  if (types.includes('eis')) {
    p.rect(3, 7, 3, 3, C.white).rect(7, 9, 3, 3, C.white).rect(5, 12, 3, 3, '#eaf8ff');
  }
  if (types.includes('minze')) p.rect(4, 4, 2, 2, '#46b04a').rect(8, 5, 2, 2, '#2d6a28');
  p.vline(3, 3, 13, '#ffffff');
  p.outline(C.outline);
  // Zitronenscheibe am Rand
  if (types.includes('zitrone')) {
    p.disc(11, 3, 2.6, '#f4d43a');
    p.disc(11, 3, 1.6, '#fff2a0');
  }
  if (types.length) p.rect(9, 0, 1, 7, '#e0503f');
  return p;
}

/** Ein Gegenstand als Bild (22 × 20) */
export function grillItemPix(i: GrillItem): Pix {
  const p = new Pix(22, 20);
  if (i.x) {
    p.draw(extinguisherPix(), 6, 3);
    return p;
  }
  if (i.b === 'glass') {
    p.draw(glassPix(i.p), 4, 1);
    return p;
  }
  if (i.b === 'plate') {
    p.draw(platePix(), 0, 10);
    const n = i.p.length;
    const xs = n === 1 ? [6] : n === 2 ? [2, 10] : [0, 6, 12];
    i.p.forEach((part, k) => p.draw(grillIngPix(part.t, part.s), xs[k] ?? 6, n === 3 && k === 1 ? 2 : 5));
    return p;
  }
  if (i.p.length > 1) {
    // Spieß
    p.hline(1, 11, 20, '#8d5629').hline(1, 12, 20, '#5e3518');
    i.p.forEach((part, k) => {
      const ic = grillIngPix(part.t, part.s);
      p.draw(ic, 2 + k * 9, 6);
    });
    return p;
  }
  if (i.p.length === 1) p.draw(grillIngPix(i.p[0].t, i.p[0].s), 6, 6);
  return p;
}

/** Schlüssel für Textur-Caches */
export const grillItemKey = (i: GrillItem) => (i.x ? 'gx' : `g_${i.b ?? 'n'}_${i.p.map((p) => `${p.t}${p.s}`).join('_')}`);

// ------------------------------------------------------------------ Kleine Symbole

export function knifeIcon(): Pix {
  const p = new Pix(9, 9);
  // Klinge diagonal, Griff oben rechts
  for (let i = 0; i < 5; i++) {
    p.px(1 + i, 7 - i, '#e8edf0');
    p.px(1 + i, 6 - i, '#b8c0c6');
  }
  p.px(0, 8, '#e8edf0');
  p.rect(6, 1, 2, 2, '#8d5629').px(7, 0, '#8d5629').px(8, 0, '#5e3518');
  p.outline(C.outline);
  return p;
}

export function flameIcon(): Pix {
  const p = new Pix(9, 9);
  p.ellipse(4.5, 6, 3.4, 2.6, '#e0503f');
  p.rect(3, 3, 3, 2, '#e0503f').rect(4, 1, 2, 2, '#e0503f').px(5, 0, '#e0503f');
  p.ellipse(4.5, 6.3, 2, 1.8, '#f0973a');
  p.rect(4, 5, 1, 2, '#ffd25e');
  p.outline(C.outline);
  return p;
}

export function starPix(filled: boolean): Pix {
  const p = new Pix(13, 13);
  const pts: [number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 ? 2.6 : 6;
    pts.push([6.5 + Math.cos(a) * r, 6.8 + Math.sin(a) * r]);
  }
  p.g.fillStyle = filled ? C.gold : '#8f7a5a';
  p.g.beginPath();
  pts.forEach(([x, y], k) => (k ? p.g.lineTo(x, y) : p.g.moveTo(x, y)));
  p.g.closePath();
  p.g.fill();
  // harte Kanten
  const img = p.g.getImageData(0, 0, 13, 13);
  for (let k = 3; k < img.data.length; k += 4) img.data[k] = img.data[k] > 100 ? 255 : 0;
  p.g.putImageData(img, 0, 0);
  if (filled) p.overlayOn(() => p.rect(4, 3, 3, 3, '#fff0a8'));
  p.outline(C.outline);
  return p;
}

export function smokePuff(): Pix {
  const p = new Pix(6, 6);
  p.disc(3, 3, 2.8, '#cfcbc1');
  p.overlayOn(() => p.disc(2, 2, 1.4, '#eeeae2'));
  return p;
}

// ------------------------------------------------------------------ Küche

function counterTop(p: Pix, x: number, y: number, top = C.woodLight, front = C.woodDark) {
  p.rect(x, y, T, T - 4, top);
  p.hline(x, y, T, shade(top, 1.15));
  p.hline(x, y + 6, T, shade(top, 0.92));
  p.rect(x, y + T - 4, T, 4, front);
  p.hline(x, y + T - 4, T, C.woodDarker);
  p.vline(x, y, T, shade(top, 0.85));
}

function paintStation(p: Pix, ch: string, x: number, y: number, seed: number) {
  const r = rng(seed);
  switch (ch) {
    case 'K':
      counterTop(p, x, y);
      p.rect(x + 2, y + 2, 14, 9, '#e9d2a3');
      p.hline(x + 2, y + 2, 14, '#f6e6c0').hline(x + 2, y + 10, 14, '#c9a46a');
      p.px(x + 13, y + 4, '#c9a46a');
      // Messer
      p.rect(x + 4, y + 12, 7, 1, '#d8dde2').rect(x + 11, y + 12, 3, 1, C.woodDarker);
      break;
    case 'G':
      // Grill: rote Wanne, Glut unter dem Rost
      p.rect(x, y, T, T - 4, '#3b3836');
      p.rect(x + 1, y + 1, T - 2, T - 6, '#4a1f14');
      for (let k = 0; k < 14; k++) p.px(x + 2 + Math.floor(r() * 14), y + 2 + Math.floor(r() * 9), ['#e0503f', '#f0973a', '#ffd25e', '#8a2a1a'][k % 4]);
      for (let gy = y + 2; gy < y + T - 5; gy += 2) p.hline(x + 1, gy, T - 2, '#9a958f');
      p.hline(x, y, T, '#c3beb6');
      p.rect(x, y + T - 4, T, 4, '#a8342a');
      p.hline(x, y + T - 4, T, '#5e1a12');
      p.px(x + 3, y + T - 2, '#e0503f').px(x + 14, y + T - 2, '#e0503f');
      break;
    case 'P':
      counterTop(p, x, y);
      for (let k = 0; k < 3; k++) {
        p.ellipse(x + 9, y + 9 - k * 2, 7, 2.6, '#f4efe2');
        p.hline(x + 3, y + 10 - k * 2, 12, '#c8c2b2');
      }
      p.ellipse(x + 9, y + 5, 4.5, 1.4, '#e2dccb');
      break;
    case 'W':
      counterTop(p, x, y);
      for (const gx of [x + 3, x + 10]) {
        p.rect(gx, y + 2, 5, 9, '#d8f1fc');
        p.vline(gx, y + 2, 9, C.white);
        p.hline(gx, y + 11, 5, '#93d3f3');
      }
      break;
    case 'S': {
      // Ausgabe: rot-weiß karierte Decke mit Glocke
      for (let j = 0; j < T - 4; j += 3) for (let i = 0; i < T; i += 3) p.rect(x + i, y + j, 3, 3, ((i + j) / 3) % 2 ? '#fdf7ea' : '#e0503f');
      p.rect(x, y + T - 4, T, 4, '#a8342a');
      p.hline(x, y + T - 4, T, C.woodDarker);
      break;
    }
    case 'X':
      p.rect(x, y, T, T, '#6aa84f');
      paintGrass(p, x, y, T, T, seed, false);
      p.rect(x + 3, y + 3, 12, 13, '#7f8a8f');
      p.rect(x + 2, y + 1, 14, 4, '#9aa5aa');
      p.hline(x + 2, y + 1, 14, '#c3ccd0');
      for (let k = 0; k < 3; k++) p.vline(x + 5 + k * 3, y + 6, 9, '#6a7478');
      p.rect(x + 7, y, 4, 1, '#3b3b4f');
      break;
    default:
      if (GRILL_CRATES[ch]) {
        counterTop(p, x, y, C.wood, C.woodDarker);
        // Kiste mit Zutat obendrauf
        p.rect(x + 1, y + 1, T - 2, T - 6, C.woodDark);
        p.rect(x + 2, y + 2, T - 4, T - 8, '#7a4a26');
        p.hline(x + 1, y + 1, T - 2, C.woodLight);
        p.draw(grillIngPix(GRILL_CRATES[ch], 'raw'), x + 4, y + 2);
      } else {
        counterTop(p, x, y);
        if (r() < 0.35) p.px(x + 3 + Math.floor(r() * 12), y + 3 + Math.floor(r() * 8), C.wood);
      }
  }
}

export interface GrillPaintKitchen {
  x0: number;
  y0: number;
  grid: string[];
  /** Teamfarbe für Wimpel (oder null) */
  color: string | null;
}

/** Garten mit Terrasse und Küchen (alles Statische) */
export function paintGrillGarden(p: Pix, kitchens: GrillPaintKitchen[], W: number, H: number) {
  paintGrass(p, 0, 0, W, H, 811, true);
  // Holzzaun hinten
  p.rect(0, 26, W, 3, C.woodDark);
  for (let x = 2; x < W; x += 8) p.rect(x, 18, 5, 14, x % 16 ? C.wood : C.woodLight).hline(x, 18, 5, C.woodLight);
  p.rect(0, 22, W, 2, C.woodDark);
  for (const k of kitchens) {
    const cols = k.grid[0].length;
    const rows = k.grid.length;
    const kw = cols * T;
    const kh = rows * T;
    // Schatten + Terrassenplatten
    p.rect(k.x0 + 2, k.y0 + 3, kw, kh, 'rgba(0,0,0,0.25)');
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = k.x0 + c * T;
        const y = k.y0 + r * T;
        const rr = rng(r * 97 + c * 13 + 5);
        const base = (c + r) % 2 ? '#c9bfae' : '#d6ccba';
        p.rect(x, y, T, T, base);
        p.hline(x, y, T, '#e6dccb').vline(x, y, T, '#e6dccb');
        p.hline(x, y + T - 1, T, '#a99f8e').vline(x + T - 1, y, T, '#a99f8e');
        if (rr() < 0.5) p.px(x + 3 + Math.floor(rr() * 12), y + 3 + Math.floor(rr() * 12), '#b8ae9c');
      }
    }
    // Stationen
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = k.grid[r][c];
        if (ch === '.') continue;
        paintStation(p, ch, k.x0 + c * T, k.y0 + r * T, r * 31 + c * 7 + 1);
      }
    }
    // Wimpelkette über der Küche
    const colors = k.color ? [k.color, C.white] : [C.red, C.gold, C.blue, C.green, C.pink];
    const wy = k.y0 - 7;
    for (let x = k.x0 + 2; x < k.x0 + kw - 2; x++) p.px(x, wy + Math.round(Math.sin(((x - k.x0) / kw) * Math.PI * 3) * 1.5), C.woodDarker);
    for (let x = k.x0 + 6, n = 0; x < k.x0 + kw - 8; x += 12, n++) {
      const y = wy + Math.round(Math.sin(((x - k.x0) / kw) * Math.PI * 3) * 1.5) + 1;
      const c = colors[n % colors.length];
      for (let j = 0; j < 5; j++) p.hline(x + j / 2, y + j, 6 - j, c);
    }
  }
}
