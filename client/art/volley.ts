import { C } from './palette';
import { type BgLayer, Pix, bgLayers, rng, shade } from './pix';
import { paintSand, paintShore, paintSky, paintWater } from './ground';
import { palm, towel, umbrella } from './objects';
import { VOLLEY } from '../../shared/volley';

/** Pixel-Art für den Strand-Volleyball (Sonnenuntergang, Seitenansicht) */

const HORIZON = 150;

function scaled(src: Pix, s: number) {
  const c = document.createElement('canvas');
  c.width = Math.round(src.w * s);
  c.height = Math.round(src.h * s);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(src.canvas, 0, 0, c.width, c.height);
  return c;
}

/** Strand von der Seite – `layer`: far (Abendhimmel, Sonne), mid (Meer, Glitzerbahn, ferne Palmen), near (Sand, Schirme, Feld) */
export function paintVolleyBeach(p: Pix, w: number, h: number, layer: BgLayer = 'all') {
  const V = VOLLEY;
  const L = bgLayers(layer);
  const r = rng(901);
  if (L.far) {
    paintSky(p, 0, 0, w, HORIZON, ['#2f3478', '#6e4a8e', '#c85a6a', '#f08a5a', '#ffc36e', '#ffe0a0']);
    if (!L.mid) p.rect(0, HORIZON, w, h - HORIZON, '#f08a5a');
    // ein paar Wolkenstreifen im Abendlicht
    for (let i = 0; i < 7; i++) {
      const cx = r() * w;
      const cy = 46 + r() * 70;
      const len = 20 + r() * 40;
      p.rect(cx, cy, len, 2, i % 2 ? '#f6a07a' : '#e47f78');
      p.rect(cx + 4, cy + 2, len - 10, 1, '#b65a72');
    }
    // Sonne halb im Meer
    p.disc(372, HORIZON - 6, 17, '#ffd37a');
    p.disc(372, HORIZON - 6, 14, '#fff0b8');
  }
  if (L.mid) {
    paintWater(p, 0, HORIZON, w, 26, 902);
    // Glitzerbahn der Sonne
    for (let y = HORIZON + 1; y < HORIZON + 26; y += 2) {
      const half = 6 + (y - HORIZON) * 0.7;
      for (let x = 372 - half; x < 372 + half; x += 4) if (r() < 0.55) p.hline(x, y, 2 + Math.floor(r() * 3), '#ffd27a');
    }
    // ferne Palmen am Ufer (stehen im Sand der nahen Ebene)
    for (const [x, s, seed] of [[30, 0.6, 3], [70, 0.45, 5], [150, 0.4, 7], [300, 0.42, 2], [430, 0.58, 8]] as [number, number, number][]) {
      const c = scaled(palm(seed), s);
      p.g.drawImage(c, x - c.width / 2, HORIZON + 30 - c.height);
    }
  }
  if (!L.near) return;
  paintSand(p, 0, HORIZON + 26, w, h - HORIZON - 26, 903);
  paintShore(p, 0, HORIZON + 27, w, 904);
  // Sonnenschirme und Handtücher hinter dem Feld
  const u1 = scaled(umbrella(C.red, C.white), 0.9);
  p.g.drawImage(u1, 96, V.GROUND - 30 - u1.height);
  const u2 = scaled(umbrella('#3fa7e0', C.white), 0.9);
  p.g.drawImage(u2, 352, V.GROUND - 32 - u2.height);
  const t1 = towel('#f4c542');
  const t2 = towel('#3fa7e0');
  p.g.save();
  p.g.translate(60, V.GROUND - 22);
  p.g.rotate(-Math.PI / 2);
  p.g.drawImage(t1.canvas, 0, 0);
  p.g.restore();
  p.g.save();
  p.g.translate(398, V.GROUND - 24);
  p.g.rotate(-Math.PI / 2);
  p.g.drawImage(t2.canvas, 0, 0);
  p.g.restore();

  // Spielfeld: Linie im Sand, vorne etwas dunklerer, nasser Sand
  p.rect(0, V.GROUND, w, h - V.GROUND, C.sandDark);
  const r2 = rng(905);
  for (let i = 0; i < 260; i++) p.px(r2() * w, V.GROUND + 2 + r2() * (h - V.GROUND - 2), r2() < 0.5 ? shade(C.sandDark, 0.88) : C.sand);
  p.hline(V.WALL_L, V.GROUND, V.WALL_R - V.WALL_L, '#fdf2d6');
  p.hline(V.WALL_L, V.GROUND + 1, V.WALL_R - V.WALL_L, shade(C.sandDark, 0.8));
  // Begrenzungsstangen links und rechts (Bambus), außen an den Feldwänden
  for (const x of [V.WALL_L - V.POLE, V.WALL_R]) {
    for (let y = 30; y < V.GROUND + 4; y++) {
      p.rect(x, y, V.POLE, 1, y % 14 === 0 ? '#7a8a2a' : y % 2 ? '#c9c45a' : '#b5b04a');
    }
    p.vline(x, 30, V.GROUND - 26, '#5e6a1e');
    p.vline(x + V.POLE - 1, 30, V.GROUND - 26, '#5e6a1e');
  }
}

/** Netz von der Seite: Pfosten bis in den Sand, oben das Netz mit weißer Kante. Ursprung: Mitte der Netzkante oben (+1 px Rand) */
export function volleyNet(): Pix {
  const V = VOLLEY;
  const h = V.GROUND - V.NET_TOP + 8;
  const p = new Pix(14, h);
  // Pfosten
  p.rect(5, 1, 4, h - 3, C.wood);
  p.vline(5, 1, h - 3, C.woodLight);
  p.vline(8, 1, h - 3, C.woodDark);
  for (let y = 31; y < h - 2; y += 9) p.hline(5, y, 4, C.woodDark);
  // weiße Netzkante
  p.rect(3, 1, 8, 4, C.white);
  p.hline(3, 4, 8, '#d3c9b0');
  p.outline(C.outline);
  // Netz (Maschen, ohne Kontur, damit es luftig bleibt)
  const mesh = 27;
  for (let y = 6; y < mesh; y++) {
    for (let x = 3; x < 11; x++) {
      if ((x + y) % 3 === 0 || (x - y + 30) % 3 === 0) p.px(x, y, 'rgba(253,247,234,0.8)');
    }
  }
  p.hline(3, mesh, 8, 'rgba(211,201,176,0.9)');
  p.rect(5, 1, 4, 1, '#e04a3f');
  return p;
}

/** Beachvolleyball (gelb/blau/weiß), Durchmesser 2 · BALL_R inkl. Kontur */
export function volleyBall(): Pix {
  const n = VOLLEY.BALL_R * 2;
  const c = n / 2;
  const r = c - 0.5;
  const p = new Pix(n, n);
  p.disc(c, c, r, C.white);
  // Panels als gebogene Streifen
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      if (dx * dx + dy * dy > (r - 0.3) * (r - 0.3)) continue;
      const a = Math.atan2(dy, dx) + Math.hypot(dx, dy) * (2.1 / r);
      const seg = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 3) % 3;
      if (seg === 0) p.px(x, y, '#f4c542');
      else if (seg === 1) p.px(x, y, '#3f8fe0');
    }
  }
  // Glanzlicht oben links
  const g = Math.round(c * 0.6);
  p.px(g, g - 1, '#ffffff').px(g - 1, g, '#ffffff').px(g, g, '#ffffff');
  p.outline(C.outline);
  return p;
}

/** Landepunkt im Sand: flacher Ring mit Kontur und Mittelpunkt (weiß – wird in der Teamfarbe der Seite eingefärbt) */
export function volleyMark(): Pix {
  const w = 25;
  const h = 9;
  const p = new Pix(w, h);
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ox = (x + 0.5 - cx) / (cx - 1);
      const oy = (y + 0.5 - cy) / (cy - 1);
      const ix = (x + 0.5 - cx) / (cx - 3.5);
      const iy = (y + 0.5 - cy) / (cy - 2.6);
      if (ox * ox + oy * oy <= 1 && ix * ix + iy * iy > 1) p.px(x, y, '#ffffff');
    }
  }
  p.rect(Math.floor(cx) - 1, Math.floor(cy), 3, 1, '#ffffff');
  p.outline(C.outline);
  return p;
}

/** Kleiner Pfeil, wenn der Ball über dem Bildrand ist */
export function volleyArrow(): Pix {
  const p = new Pix(9, 6);
  for (let i = 0; i < 4; i++) p.hline(4 - i, 1 + i, 1 + i * 2, C.white);
  p.outline(C.outline);
  return p;
}
