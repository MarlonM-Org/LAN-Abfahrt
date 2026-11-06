import { C } from './palette';
import { type BgLayer, Pix, bgLayers, rng, shade } from './pix';
import { paintSky, paintWater } from './ground';
import { palm } from './objects';
import { BOGEN, BOGEN_STAGES, bogenTile } from '../../shared/bogen';

const T = BOGEN.TILE;

// ================================================================== Hintergrund + Kacheln

/**
 * Bild einer Arena (480 × 270, Arena ab y = AY) – `layer` = Parallax-Ebene:
 * far (Himmel, Sonne, Wolken), mid (Meer bzw. Villa, Palmen, Lichter), near (Mauern/Plattformen) oder alles
 */
export function bogenBackdrop(stage: number, layer: BgLayer = 'all'): Pix {
  const p = new Pix(480, 270);
  const st = BOGEN_STAGES[stage];
  const L = bgLayers(layer);
  if (st.id === 'dach') paintSunset(p, L);
  else paintPoolDay(p, L);
  if (L.near) paintTiles(p, st.tiles, st.id);
  return p;
}

type Layers = ReturnType<typeof bgLayers>;

function paintSunset(p: Pix, L: Layers) {
  const r = rng(4101);
  if (L.far) {
    paintSky(p, 0, 0, 480, 190, ['#3b2d6b', '#7a3f7d', '#d0586a', '#f0975a', '#ffd38a']);
    if (!L.mid) p.rect(0, 190, 480, 80, '#f0975a');
    // Sonne knapp über dem Meer
    p.disc(300, 186, 30, 'rgba(255,220,140,0.25)');
    p.disc(300, 186, 21, '#ffc76a');
    p.disc(298, 183, 15, '#ffe3a0');
    // Sterne oben
    for (let i = 0; i < 26; i++) p.px(Math.floor(r() * 480), 20 + Math.floor(r() * 50), r() < 0.5 ? '#fff4d6' : '#c9b8f0');
    // Wolkenstreifen
    for (const [cx, cy, w] of [[80, 112, 70], [210, 92, 50], [400, 124, 80], [330, 70, 40]]) {
      p.ellipse(cx, cy, w / 2, 3, '#f7a37a');
      p.hline(cx - w / 2 + 6, cy + 2, w - 12, '#c9606a');
    }
  }
  if (!L.mid) return;
  // Meer
  paintWater(p, 0, 192, 480, 78, 4102);
  for (let y = 192; y < 270; y++) {
    // Sonnenglitzern auf dem Wasser
    if (y % 3) continue;
    const w = 6 + Math.floor(r() * 18);
    p.hline(300 - w / 2 + Math.floor(r() * 8 - 4), y, w, y < 220 ? '#ffd38a' : '#f0975a');
  }
  // Hügel/Insel am Horizont
  p.ellipse(60, 194, 70, 9, '#4b3a6b');
  p.ellipse(430, 195, 50, 6, '#5a4277');
  // Palmen-Silhouetten hinter dem Dach
  for (const [x, flip] of [[70, false], [380, true], [160, true]] as [number, boolean][]) {
    const pl = palm(x);
    const sil = new Pix(pl.w, pl.h);
    sil.draw(pl, 0, 0, flip);
    sil.overlayOn(() => sil.rect(0, 0, pl.w, pl.h, '#3a2650'));
    p.draw(sil, x - 22, 140);
  }
  // Lichterkette über der Terrasse
  for (let x = 20; x < 460; x++) {
    const y = 40 + Math.round(Math.abs(Math.sin(((x - 20) / 440) * Math.PI * 2)) * 14);
    p.px(x, y, '#2d1b12');
    if (x % 14 === 0) p.disc(x, y + 2, 1.6, ['#ffd25e', '#f07aa8', '#7fd4ff', '#9ad65a'][(x / 14) % 4]);
  }
}

function paintPoolDay(p: Pix, L: Layers) {
  const r = rng(4201);
  if (L.far) {
    paintSky(p, 0, 0, 480, 150, ['#4fa8e3', '#7cc5ef', '#b5e1f6', '#e8f4f0']);
    if (!L.mid) p.rect(0, 150, 480, 120, '#e8f4f0');
    p.disc(70, 50, 16, '#ffe58a');
    p.disc(68, 48, 10, '#fff3c0');
    for (const [cx, cy, s] of [[200, 46, 1], [360, 34, 0.8], [440, 80, 0.6]]) {
      p.ellipse(cx, cy, 22 * s, 7 * s, '#ffffff');
      p.ellipse(cx - 10 * s, cy - 4 * s, 10 * s, 7 * s, '#ffffff');
      p.ellipse(cx + 9 * s, cy - 5 * s, 12 * s, 8 * s, '#ffffff');
    }
  }
  if (!L.mid) return;
  // Villa-Fassade im Hintergrund
  p.rect(24, 110, 432, 160, '#f2e6cf');
  for (let y = 112; y < 270; y += 6) p.hline(24, y, 432, '#e8d9bd');
  // Fenster mit Fensterläden
  for (const x of [50, 120, 330, 400]) {
    for (const y of [130, 196]) {
      p.rect(x, y, 22, 26, '#7fbce0');
      p.rect(x + 10, y, 2, 26, '#f2e6cf');
      p.rect(x - 6, y, 5, 26, '#2fb5a5').rect(x + 23, y, 5, 26, '#2fb5a5');
    }
  }
  // Bougainvillea
  for (let i = 0; i < 60; i++) p.disc(30 + r() * 40, 112 + r() * 14, 2, r() < 0.5 ? '#e0508f' : '#f07aa8');
  for (let i = 0; i < 60; i++) p.disc(410 + r() * 40, 112 + r() * 14, 2, r() < 0.5 ? '#e0508f' : '#f07aa8');
  // Palmen vor der Villa
  p.draw(palm(31), 186, 70);
  p.draw(palm(33), 252, 74, true);
  // Pool unten in der Mitte (Deko hinter dem Poolhaus)
  p.rect(30, 252, 420, 18, '#46b8e0');
  for (let i = 0; i < 40; i++) p.hline(30 + Math.floor(r() * 410), 254 + Math.floor(r() * 14), 4, '#bfeaf7');
  // leichter Dunst, damit sich die Plattformen vom Hintergrund abheben
  p.rect(0, 0, 480, 270, 'rgba(30,50,80,0.22)');
}

function paintTiles(p: Pix, tiles: string, id: 'dach' | 'pool') {
  const at = (c: number, r: number) => bogenTile(tiles, c, r);
  const r = rng(id === 'dach' ? 4301 : 4302);
  for (let row = 0; row < BOGEN.ROWS; row++) {
    for (let col = 0; col < BOGEN.COLS; col++) {
      const t = at(col, row);
      const x = col * T;
      const y = BOGEN.AY + row * T;
      if (t === '#') {
        const top = at(col, row - 1) !== '#' && row > 0;
        const bottom = at(col, row + 1) !== '#' && row < BOGEN.ROWS - 1;
        const left = at(col - 1, row) !== '#';
        const right = at(col + 1, row) !== '#';
        if (id === 'dach') {
          // weiß verputzte Mauer
          p.rect(x, y, T, T, '#f1e4cc');
          if ((row + Math.floor(col / 2)) % 2 === 0) p.rect(x + 1, y + 4, T - 2, 1, '#e3d1b0');
          if (r() < 0.25) p.px(x + 2 + Math.floor(r() * 6), y + 2 + Math.floor(r() * 6), '#d9c39c');
          if (left) p.vline(x, y, T, '#c9b089');
          if (right) p.vline(x + T - 1, y, T, '#bfa57c');
          if (bottom) p.rect(x, y + T - 2, T, 2, '#bfa57c');
          if (top) {
            // Terrakotta-Dachziegel
            p.rect(x, y, T, 4, C.roof);
            p.px(x + 2, y + 1, C.roofLight).px(x + 7, y + 1, C.roofLight);
            p.rect(x, y + 4, T, 1, C.roofDark);
            p.px(x + 4, y + 4, '#6e2620').px(x + 9, y + 4, '#6e2620');
          }
        } else {
          // heller Kalkstein mit türkisen Kacheln
          p.rect(x, y, T, T, '#e9e4da');
          if ((col + row) % 2 === 0) p.rect(x + 1, y + 1, T - 2, T - 2, '#f4f1ea');
          p.px(x, y, '#d3ccbe');
          if (left) p.vline(x, y, T, '#c5bdac');
          if (right) p.vline(x + T - 1, y, T, '#b8af9c');
          if (bottom) p.rect(x, y + T - 2, T, 2, '#b8af9c');
          if (top) {
            p.rect(x, y, T, 3, '#2fb5a5');
            p.hline(x, y, T, '#6fdccd');
            p.rect(x, y + 3, T, 1, '#1f7f73');
          }
        }
        if (top && left) p.px(x, y, C.outline);
        if (top && right) p.px(x + T - 1, y, C.outline);
      } else if (t === '=') {
        const l = at(col - 1, row) !== '=';
        const rr = at(col + 1, row) !== '=';
        if (id === 'dach') {
          // Holzplanke mit Palmwedeln
          p.rect(x, y, T, 4, C.wood);
          p.hline(x, y, T, C.woodLight);
          p.hline(x, y + 4, T, C.woodDarker);
          p.vline(x + (col % 2 ? 3 : 7), y + 1, 3, C.woodDark);
          if (l) p.rect(x, y, 2, 7, C.woodDark);
          if (rr) p.rect(x + T - 2, y, 2, 7, C.woodDark);
          if (col % 3 === 0) {
            p.rect(x + 2, y + 5, 1, 3, C.leaf).rect(x + 4, y + 5, 1, 2, C.leafLight).rect(x + 6, y + 5, 1, 4, C.leafDark);
          }
        } else {
          // Sprungbrett / Liegestuhl: weiß-blau
          p.rect(x, y, T, 4, '#f4efe2');
          p.hline(x, y + 3, T, '#3f8fe0');
          p.hline(x, y + 4, T, '#2d64a8');
          if (l || rr) p.rect(l ? x + 1 : x + T - 3, y + 4, 2, 4, C.stoneDark);
        }
      }
    }
  }
  // dunkle Kontur nur entlang freier Kanten
  const solid = (c: number, r2: number) => at(c, r2) === '#';
  for (let row = 0; row < BOGEN.ROWS; row++) {
    for (let col = 0; col < BOGEN.COLS; col++) {
      if (!solid(col, row)) continue;
      const x = col * T;
      const y = BOGEN.AY + row * T;
      if (row > 0 && !solid(col, row - 1)) p.hline(x, y - 1, T, shade(C.outline, 1));
      if (row < BOGEN.ROWS - 1 && !solid(col, row + 1)) p.hline(x, y + T, T, 'rgba(45,27,18,0.45)');
    }
  }
}

// ================================================================== Sprites

/** Saugnapfpfeil, Spitze rechts (Ursprung am rechten Rand) – 14 × 5 */
export function arrowPix(bomb: boolean): Pix {
  const p = new Pix(14, 5);
  // Federn
  p.rect(0, 0, 3, 1, '#f4efe2').rect(1, 1, 3, 1, '#e0503f').rect(1, 3, 3, 1, '#e0503f').rect(0, 4, 3, 1, '#f4efe2');
  // Schaft
  p.rect(1, 2, 10, 1, '#d39a5c');
  p.px(4, 2, '#8d5629');
  if (bomb) {
    // Wasserbombe als Spitze
    p.disc(11.5, 2.5, 2.4, '#3f8fe0');
    p.px(11, 1, '#bfe6f7');
  } else {
    // Saugnapf
    p.rect(11, 1, 1, 3, '#a8342a');
    p.rect(12, 0, 2, 5, '#e0503f');
    p.vline(13, 1, 3, '#f08a7e');
  }
  return p;
}

/** Bogen (Mitte links, Sehne rechts) – 6 × 15, zeigt nach rechts */
export function bowPix(): Pix {
  const p = new Pix(6, 15);
  for (let i = 0; i < 15; i++) {
    const t = (i - 7) / 7;
    const x = Math.round(4 - (1 - t * t) * 3.2);
    p.rect(x, i, 2, 1, i % 4 === 0 ? C.woodDarker : C.wood);
  }
  p.vline(5, 1, 13, '#f4efe2');
  return p;
}

/** Schatztruhe (Strandkiste) – 16 × 13 */
export function chestPix(): Pix {
  const p = new Pix(16, 13);
  p.rect(1, 5, 14, 8, C.wood);
  p.ellipse(8, 5, 7, 4, C.woodLight);
  p.rect(1, 5, 14, 1, C.woodDarker);
  p.rect(1, 9, 14, 1, C.woodDark);
  p.rect(3, 1, 2, 12, C.gold).rect(11, 1, 2, 12, C.gold);
  p.rect(7, 5, 3, 3, C.gold);
  p.px(8, 6, C.outline);
  p.outline(C.outline);
  return p;
}

/** Kleines Pfeil-Symbol für die HUD-Leiste – 3 × 9 (senkrecht) */
export function quiverIconPix(bomb: boolean): Pix {
  const p = new Pix(5, 11);
  p.rect(2, 2, 1, 7, '#d39a5c');
  p.rect(1, 8, 1, 2, '#e0503f').rect(3, 8, 1, 2, '#e0503f');
  if (bomb) p.disc(2.5, 1.5, 1.6, '#3f8fe0');
  else p.rect(1, 0, 3, 2, '#e0503f');
  p.outline(C.outline);
  return p;
}
