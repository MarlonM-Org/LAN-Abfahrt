import { KART, type Track, type TrackDef, project } from '../../shared/kart';
import { C } from './palette';
import { Pix, rng } from './pix';
import * as O from './objects';
import { buoy } from './props2';
import { paintGrass, paintSand, paintShore, paintTiles, paintWater } from './ground';

// ------------------------------------------------------------------ Strecke

/** Zeichnet die geschlossene Mittellinie als dicken Strich auf eine Maske (harte Kanten) */
function strokeMask(track: Track, w: number, h: number, width: number): Pix {
  const m = new Pix(w, h);
  const g = m.g;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = '#000';
  g.lineWidth = width;
  g.beginPath();
  track.samples.forEach((s, i) => (i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y)));
  g.closePath();
  g.stroke();
  const img = g.getImageData(0, 0, w, h);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 110 ? 255 : 0;
  g.putImageData(img, 0, 0);
  return m;
}

function masked(p: Pix, mask: Pix, texture: (m: Pix) => void) {
  mask.overlayOn(() => texture(mask));
  p.draw(mask, 0, 0);
}

const THEME = {
  beach: { road: '#8a8690', roadDark: '#77737d', roadLight: '#a29ea8', band: 'sand' },
  harbor: { road: '#6f6b75', roadDark: '#5c5862', roadLight: '#88848e', band: 'quay' },
  pool: { road: '#c9bba0', roadDark: '#b3a486', roadLight: '#ddd2bb', band: 'lawn' },
} as const;

/** Aufrecht stehende Deko (Palme, Schirm …) mit Fußpunkt in Weltkoordinaten – für die Verfolger-Ansicht als Billboard */
export interface KartProp {
  x: number;
  y: number;
  img: Pix;
}

/** Komplette Strecke als Hintergrundbild (480 × 270) */
export function paintKartTrack(track: Track, W: number, H: number): Pix {
  return paintKartScene(track, W, H).ground;
}

/**
 * Strecke als Bodentextur plus aufrecht stehende Deko getrennt (Mode-7-Ansicht).
 * Mit `flat = true` wird alles in den Boden gemalt (Draufsicht auf dem TV).
 */
export function paintKartScene(track: Track, W: number, H: number, flat = true): { ground: Pix; props: KartProp[] } {
  const props: KartProp[] = [];
  const p = new Pix(W, H);
  const theme = track.def.theme;
  const T = THEME[theme];
  const r = rng(900 + track.samples.length);
  const half = track.half;
  const band = half + KART.SAND;

  // 1) Untergrund
  if (theme === 'beach') {
    paintSand(p, 0, 0, W, H, 901);
    paintWater(p, 0, H - 24, W, 24, 902);
    paintShore(p, 0, H - 24, W, 903);
  } else if (theme === 'harbor') {
    paintWater(p, 0, 0, W, H, 911);
    for (let y = 0; y < H; y += 3) for (let x = (y * 7) % 11; x < W; x += 11) if (r() < 0.25) p.hline(x, y, 3, C.waterLight);
  } else {
    paintGrass(p, 0, 0, W, H, 921);
  }

  // 2) Randstreifen (bremst): Sand / Kaimauer / Rasen
  const bandMask = strokeMask(track, W, H, band * 2);
  if (T.band === 'sand') {
    masked(p, bandMask, (m) => {
      paintSand(m, 0, 0, W, H, 904);
      m.speckle(0, 0, W, H, '#e6c27e', (W * H) / 30, r);
    });
  } else if (T.band === 'quay') {
    masked(p, bandMask, (m) => {
      m.rect(0, 0, W, H, C.stone);
      for (let y = 0; y < H; y += 5) {
        const off = (y / 5) % 2 ? 4 : 0;
        for (let x = -off; x < W; x += 8) {
          m.rect(x, y, 7, 4, r() < 0.5 ? C.stone : C.stoneLight);
          m.hline(x, y + 4, 8, C.stoneDark).vline(x + 7, y, 4, C.stoneDark);
        }
      }
    });
    const edge = strokeMask(track, W, H, band * 2 + 4);
    edge.overlayOn(() => edge.rect(0, 0, W, H, '#5e5a54'));
    // Kante unter die Pflastersteine legen
    const cut = new Pix(W, H);
    cut.draw(edge, 0, 0);
    cut.g.globalCompositeOperation = 'destination-out';
    cut.draw(strokeMask(track, W, H, band * 2), 0, 0);
    cut.g.globalCompositeOperation = 'source-over';
    p.draw(cut, 0, 0);
  } else {
    masked(p, bandMask, (m) => {
      m.rect(0, 0, W, H, '#7cbf4c');
      for (let y = 0; y < H; y += 6) m.hline(0, y, W, '#86c957');
      m.speckle(0, 0, W, H, '#6aa83f', (W * H) / 20, r);
    });
  }

  // 3) Fahrbahn
  masked(p, strokeMask(track, W, H, half * 2), (m) => {
    m.rect(0, 0, W, H, T.road);
    if (theme === 'pool') {
      for (let y = 0; y < H; y += 8) m.hline(0, y, W, T.roadDark);
      for (let x = 0; x < W; x += 8) m.vline(x, 0, H, T.roadDark);
      m.speckle(0, 0, W, H, T.roadLight, (W * H) / 25, r);
    } else {
      m.speckle(0, 0, W, H, T.roadDark, (W * H) / 9, r);
      m.speckle(0, 0, W, H, T.roadLight, (W * H) / 16, r);
    }
  });

  // 4) Curbs in Kurven, weiße Linie auf Geraden
  const S = track.samples;
  const n = S.length;
  for (let i = 0; i < n; i++) {
    const s = S[i];
    const a = S[(i + 4) % n].a - S[(i - 4 + n) % n].a;
    const curv = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
    const nx = Math.cos(s.a + Math.PI / 2);
    const ny = Math.sin(s.a + Math.PI / 2);
    for (const side of [-1, 1]) {
      for (const d of [half - 2, half - 1]) {
        const x = s.x + nx * side * d;
        const y = s.y + ny * side * d;
        if (curv > 0.32) p.rect(x - 1, y - 1, 2, 2, Math.floor(s.s / 5) % 2 ? C.red : C.white);
        else if (d === half - 2) p.px(x, y, 'rgba(253,247,234,0.7)');
      }
    }
  }

  // 4b) Absperrung an der Bande (Seil mit Pfosten bzw. Hecke) – dort ist Schluss
  if (theme !== 'harbor') {
    for (let i = 0; i < n; i++) {
      const s = S[i];
      for (const side of [-1, 1]) {
        const x = s.x + Math.cos(s.a + Math.PI / 2) * side * (band + 1.5);
        const y = s.y + Math.sin(s.a + Math.PI / 2) * side * (band + 1.5);
        if (project(track, x, y).dist < band) continue;
        if (theme === 'beach') {
          p.px(x, y, '#b98a52');
          if (i % 5 === 0) p.rect(x - 1, y - 2, 2, 3, C.woodDark).px(x - 1, y - 2, C.woodLight);
        } else {
          p.rect(x - 1, y - 1, 3, 3, C.leafDark).px(x, y - 1, C.leafLight);
        }
      }
    }
  }

  // 5) Start/Ziel (Schachbrett) + Startaufstellung
  const s0 = S[0];
  const tx = Math.cos(s0.a);
  const ty = Math.sin(s0.a);
  const nx = -ty;
  const ny = tx;
  for (let k = -half + 1; k < half - 1; k += 2) {
    for (let row = 0; row < 3; row++) {
      const col = (Math.floor(k / 2) + row) % 2 ? C.outline : C.white;
      p.rect(s0.x + nx * k + tx * (row * 2 - 3), s0.y + ny * k + ty * (row * 2 - 3), 2, 2, col);
    }
  }
  for (const g of track.grid) {
    const gx = Math.cos(g.a);
    const gy = Math.sin(g.a);
    for (let k = -4; k <= 4; k++) p.px(g.x + gx * 6 - gy * k, g.y + gy * 6 + gx * k, 'rgba(253,247,234,0.75)');
  }

  // 6) Deko neben der Strecke
  const free = (x: number, y: number, rad: number) => project(track, x, y).dist > band + rad;
  const spots: { x: number; y: number; r: number }[] = [];
  const place = (img: Pix, x: number, y: number, rad: number, tall: boolean) => {
    const cy = y - img.h / 2;
    if (spots.some((o) => Math.hypot(o.x - x, o.y - cy) < o.r + Math.max(img.w, img.h) / 2)) return false;
    if (x - img.w / 2 < 2 || x + img.w / 2 > W - 2 || y > H - 2) return false;
    if (y - img.h < 20 || !free(x, y, rad) || !free(x, y - img.h / 2, Math.max(rad, img.w / 2)) || !free(x, y - img.h + 4, rad)) return false;
    if (tall && !flat) props.push({ x, y, img });
    else p.draw(img, x - img.w / 2, y - img.h);
    spots.push({ x, y: cy, r: Math.max(img.w, img.h) / 2 - 4 });
    return true;
  };
  // `tall`: steht aufrecht (wird in der Verfolger-Ansicht als Billboard gezeichnet)
  const scatter = (count: number, make: (i: number) => Pix, rad: number, tall = true, region = { x: 0, y: 24, w: W, h: H - 24 }) => {
    let placed = 0;
    for (let tries = 0; tries < count * 30 && placed < count; tries++) {
      const x = region.x + r() * region.w;
      const y = region.y + r() * region.h;
      if (place(make(placed), x, y, rad, tall)) placed++;
    }
  };
  if (theme === 'beach') {
    const cols = [C.red, C.blue, C.green, C.orange, C.pink];
    scatter(6, (i) => O.towel(cols[i % cols.length]), 10, false);
    scatter(4, (i) => O.umbrella(cols[(i + 2) % cols.length]), 14);
    scatter(4, (i) => O.palm(30 + i), 18);
    scatter(3, (i) => O.deckchair(cols[i % cols.length]), 12);
  } else if (theme === 'harbor') {
    scatter(5, (i) => boat(['#e0503f', '#3f8fe0', '#f2c33a', '#f4efe2', '#46b04a'][i % 5]), 16);
    scatter(6, () => buoy(), 7);
    // Kisten und Poller auf der Kaimauer
    for (let i = 0; i < n; i += 37) {
      const s = S[i];
      const side = i % 74 === 0 ? 1 : -1;
      const d = half + KART.SAND - 4;
      const x = s.x + Math.cos(s.a + Math.PI / 2) * side * d;
      const y = s.y + Math.sin(s.a + Math.PI / 2) * side * d;
      if (project(track, x, y).dist > half + 5) p.disc(x, y, 2.2, '#3a3440').px(x - 1, y - 1, '#7f7b73');
    }
  } else {
    const pr = pool(p, track);
    if (pr) spots.push({ x: pr.x + pr.w / 2, y: pr.y + pr.h / 2, r: Math.max(pr.w, pr.h) / 2 + 4 });
    scatter(4, (i) => O.deckchair([C.blue, C.white, C.orange, C.pink][i % 4]), 12);
    scatter(4, () => O.plant(), 8);
    scatter(3, (i) => O.umbrella([C.blue, C.red, C.green][i % 3]), 14);
  }
  return { ground: p, props };
}

/** Kachel (32 × 32) für das Gelände außerhalb der 480 × 270-Welt (Mode-7-Ansicht bis zum Horizont) */
export function paintKartOutside(theme: TrackDef['theme']): Pix {
  const p = new Pix(32, 32);
  const r = rng(950);
  if (theme === 'beach') paintSand(p, 0, 0, 32, 32, 951);
  else if (theme === 'harbor') {
    p.rect(0, 0, 32, 32, C.waterDark);
    p.speckle(0, 0, 32, 32, C.water, 40, r, 2);
    p.speckle(0, 0, 32, 32, C.waterLight, 14, r, 3);
  } else paintGrass(p, 0, 0, 32, 32, 953, false);
  return p;
}

function boat(color: string): Pix {
  const p = new Pix(30, 14);
  p.ellipse(15, 7, 14, 5.5, color);
  p.overlayOn(() => {
    p.ellipse(15, 7, 11, 3.5, '#b8783f');
    p.hline(4, 7, 22, '#8d5629');
  });
  p.rect(12, 4, 6, 6, C.white);
  p.outline(C.outline);
  const out = new Pix(30, 18);
  out.ellipse(15, 13, 15, 4, 'rgba(234,248,255,0.5)');
  out.draw(p, 0, 2);
  return out;
}

/** Pool im Innenfeld der Pool-Runde: größtes freies Rechteck (auf 6-px-Raster) suchen */
function pool(p: Pix, track: Track): { x: number; y: number; w: number; h: number } | null {
  const band = track.half + KART.SAND + 8;
  const G = 6;
  const cols = Math.floor(p.w / G);
  const rows = Math.floor(p.h / G);
  const ok: boolean[][] = [];
  for (let j = 0; j < rows; j++) {
    ok.push([]);
    for (let i = 0; i < cols; i++) ok[j].push(j * G > 40 && project(track, i * G + G / 2, j * G + G / 2).dist > band);
  }
  let best = { i: 0, j: 0, w: 0, h: 0 };
  const score = (w: number, h: number) => Math.min(w, 22) * Math.min(h, 11);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let maxW = Infinity;
      for (let h = 1; j + h - 1 < rows; h++) {
        let w = 0;
        while (i + w < cols && w < maxW && ok[j + h - 1][i + w]) w++;
        maxW = w;
        if (!w) break;
        if (h >= 5 && score(w, h) > score(best.w, best.h)) best = { i, j, w, h };
      }
    }
  }
  if (!best.w) return null;
  const w = Math.min(best.w, 22) * G - 8;
  const h = Math.min(best.h, 11) * G - 8;
  const x = best.i * G + Math.floor((best.w * G - w) / 2);
  const y = best.j * G + Math.floor((best.h * G - h) / 2);
  paintTiles(p, x - 4, y - 4, w + 8, h + 8, '#e8e2d6', '#d8d0c0', 4);
  paintWater(p, x, y, w, h, 931);
  p.rect(x, y, w, 2, '#2b6ba6');
  // Leiter
  p.rect(x + w - 10, y - 4, 2, 8, C.stoneLight).rect(x + w - 6, y - 4, 2, 8, C.stoneLight).hline(x + w - 10, y + 1, 6, C.stoneLight);
  // Luftmatratze
  p.rect(x + 12, y + h / 2 - 3, 16, 7, C.pink).hline(x + 12, y + h / 2, 16, '#f6a7c9');
  return { x, y, w, h };
}
