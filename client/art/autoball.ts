import { AFB, AFB_CX, AFB_CY, afbWalls } from '../../shared/autoball';
import { TEAM_INFO } from '../../shared/flunky';
import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintSand } from './ground';
import { beachHut } from './resort';
import { deckchair, palm, towel, umbrella } from './objects';

/** Auto-Fußball: Sandplatz neben dem Ferienhaus, Meer am unteren Rand */

const CHALK = '#fdf7ea';

function inside(pts: [number, number][], x: number, y: number) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Dicke Linie aus Quadraten entlang a→b */
function line(p: Pix, ax: number, ay: number, bx: number, by: number, c: string, w = 1) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    p.rect(Math.round(ax + (bx - ax) * t - (w - 1) / 2), Math.round(ay + (by - ay) * t - (w - 1) / 2), w, w, c);
  }
}

/** Kleines Ferienhaus (weiße Wände, Ziegeldach, blaue Fensterläden) – 74 × 42 */
export function holidayHouse(): Pix {
  const p = new Pix(74, 42);
  // Dach
  for (let y = 0; y < 16; y++) {
    const inset = Math.max(0, 14 - y);
    p.hline(2 + inset, y, 70 - inset * 2, y % 4 === 3 ? C.roofDark : y % 2 ? C.roof : C.roofLight);
  }
  // Wand
  p.rect(6, 16, 62, 24, C.white);
  p.hline(6, 16, 62, '#d9d0bf');
  for (let x = 6; x < 68; x += 7) p.px(x + 3, 30 + (x % 3), '#ece3d0');
  // Fenster mit Läden
  for (const wx of [12, 48]) {
    p.rect(wx, 21, 12, 10, '#7fc4ea').rect(wx + 5, 21, 2, 10, C.white).rect(wx, 25, 12, 1, C.white);
    p.rect(wx - 4, 20, 4, 12, '#2d64a8').rect(wx + 12, 20, 4, 12, '#2d64a8');
    p.hline(wx - 4, 32, 20, C.woodDark);
    p.rect(wx - 2, 33, 16, 2, '#46b04a').px(wx, 33, '#f07aa8').px(wx + 6, 33, '#f2c33a').px(wx + 11, 33, '#f07aa8');
  }
  // Tür
  p.rect(32, 24, 10, 16, C.woodDark).rect(33, 25, 8, 15, C.wood).px(39, 32, C.gold);
  p.outline(C.outline);
  return p;
}

/**
 * Hintergrund (480 × 270): Strand, Ferienhaus, Palmen, Meer – und der Sandplatz mit Kreidelinien,
 * Holzbande und Toren (links Team Sonne, rechts Team Meer).
 */
export function paintAutoballPitch(p: Pix, goalHalf: number) {
  const W = p.w;
  const H = p.h;
  const r = rng(707);
  paintSand(p, 0, 0, W, H, 31);

  // Meer unten
  const shoreY = 251;
  const bands = ['#93d3f3', '#5fb6e6', '#4aa2dc', '#3c8dca', '#3380bc', '#2b6ba6'];
  for (let y = shoreY; y < H; y++) p.hline(0, y, W, bands[Math.min(bands.length - 1, Math.floor(((y - shoreY) / (H - shoreY)) * bands.length))]);
  for (let i = 0; i < 120; i++) p.hline(Math.floor(r() * W), shoreY + 3 + Math.floor(r() * (H - shoreY - 3)), 2 + Math.floor(r() * 4), r() < 0.6 ? C.waterLight : C.foam);
  for (let x = 0; x < W; x++) {
    const off = Math.round(Math.sin(x / 9) * 1.5 + Math.sin(x / 3.7) * 0.7);
    p.vline(x, shoreY + off - 1, 2, C.foam);
    p.px(x, shoreY + off - 2, '#e3d2a6');
  }

  const { pts, segs } = afbWalls(goalHalf);
  const { X0, X1, Y0, Y1, GOAL_DEPTH: D } = AFB;
  const g0 = AFB_CY - goalHalf;
  const g1 = AFB_CY + goalHalf;

  // Spielfläche: fester, geharkter Sand in Bahnen
  for (let y = Y0 - 1; y <= Y1 + 1; y++) {
    for (let x = X0 - D - 1; x <= X1 + D + 1; x++) {
      if (!inside(pts, x + 0.5, y + 0.5)) continue;
      const band = Math.floor((x - X0) / 38) % 2 === 0;
      p.px(x, y, band ? '#e8c98d' : '#dfbd80');
    }
  }
  p.clip(X0, Y0, X1 - X0, Y1 - Y0, () => {
    for (let i = 0; i < 900; i++) p.px(X0 + r() * (X1 - X0), Y0 + r() * (Y1 - Y0), r() < 0.5 ? '#d4b071' : '#f0d49c');
    // Harkspuren
    for (let y = Y0 + 3; y < Y1; y += 4) for (let x = X0; x < X1; x += 1) if ((x + y * 3) % 11 < 2) p.px(x, y, 'rgba(160,120,60,0.18)');
  });

  // Tore: Netz im Torkasten
  for (const [side, team] of [[-1, 'A'], [1, 'B']] as const) {
    const lx = side < 0 ? X0 - D : X1;
    p.rect(lx, g0, D, g1 - g0, '#c9a56a');
    for (let x = lx; x < lx + D; x += 3) p.vline(x, g0, g1 - g0, 'rgba(253,247,234,0.75)');
    for (let y = g0; y < g1; y += 3) p.hline(lx, y, D, 'rgba(253,247,234,0.75)');
    // Pfosten + Latte in Teamfarbe
    const col = TEAM_INFO[team].color;
    const bx = side < 0 ? X0 - D : X1 + D - 2;
    p.rect(bx, g0 - 1, 2, g1 - g0 + 2, shade(col, 0.8));
    p.rect(lx, g0 - 2, D, 2, col).rect(lx, g1, D, 2, col);
    const px = side < 0 ? X0 - 2 : X1;
    p.rect(px, g0 - 3, 3, 4, CHALK).rect(px, g1 - 1, 3, 4, CHALK);
  }

  // Kreidelinien
  line(p, AFB_CX, Y0 + 1, AFB_CX, Y1 - 1, CHALK);
  for (let a = 0; a < Math.PI * 2; a += 0.02) p.px(Math.round(AFB_CX + Math.cos(a) * 28), Math.round(AFB_CY + Math.sin(a) * 28), CHALK);
  p.disc(AFB_CX, AFB_CY, 2, CHALK);
  const boxH = goalHalf + 20;
  for (const side of [-1, 1]) {
    const gx = side < 0 ? X0 : X1;
    const bx = gx - side * 36;
    line(p, gx, AFB_CY - boxH, bx, AFB_CY - boxH, CHALK);
    line(p, bx, AFB_CY - boxH, bx, AFB_CY + boxH, CHALK);
    line(p, bx, AFB_CY + boxH, gx, AFB_CY + boxH, CHALK);
    p.disc(gx - side * 26, AFB_CY, 1.2, CHALK);
    // Torlinie
    line(p, gx, g0, gx, g1, CHALK);
  }

  // Holzbande außen um das Feld (nicht vor den Toren)
  for (const s of segs) {
    const l = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
    const nx = (s.by - s.ay) / l;
    const ny = -(s.bx - s.ax) / l;
    line(p, s.ax + nx * 2, s.ay + ny * 2, s.bx + nx * 2, s.by + ny * 2, C.wood, 3);
  }
  for (const s of segs) {
    const l = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
    const nx = (s.by - s.ay) / l;
    const ny = -(s.bx - s.ax) / l;
    line(p, s.ax + nx * 4, s.ay + ny * 4, s.bx + nx * 4, s.by + ny * 4, C.woodDarker);
    line(p, s.ax + nx * 1, s.ay + ny * 1, s.bx + nx * 1, s.by + ny * 1, C.woodLight);
  }

  // Deko: Ferienhaus oben links, Strandkram, Palmen
  p.draw(holidayHouse(), 2, 0);
  p.draw(umbrella(C.red, C.white), 86, 4);
  p.draw(deckchair('#3f8fe0'), 116, 18);
  p.draw(towel('#46b04a'), 338, 10);
  p.draw(umbrella('#3f8fe0', C.white), 352, 2);
  p.draw(beachHut('#f07aa8'), 392, 12);
  p.draw(palm(3), 434, -20);
  p.draw(palm(8), -10, 186);
  p.draw(palm(5), 446, 178);
  p.draw(palm(11), -16, 30);
}

/** Großer Wasserball (Ø 20 + Kontur = 23 × 23) mit bunten Segmenten */
export function beachBall(): Pix {
  const p = new Pix(23, 23);
  const cols = ['#e04a3f', CHALK, '#3f8fe0', '#f2c33a', CHALK, '#46b04a'];
  for (let y = 0; y < 23; y++) {
    for (let x = 0; x < 23; x++) {
      const dx = x + 0.5 - 11.5;
      const dy = y + 0.5 - 11.5;
      const d = Math.hypot(dx, dy);
      if (d > 10) continue;
      const seg = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * 6) % 6;
      let c = cols[seg];
      if (d < 2.6) c = CHALK;
      p.px(x, y, c);
    }
  }
  p.outline(C.outline);
  return p;
}

/** Licht + Schatten über dem (sich drehenden) Ball – dreht sich nicht mit */
export function ballShine(): Pix {
  const p = new Pix(23, 23);
  for (let y = 0; y < 23; y++) {
    for (let x = 0; x < 23; x++) {
      const dx = x + 0.5 - 11.5;
      const dy = y + 0.5 - 11.5;
      if (Math.hypot(dx, dy) > 10) continue;
      if (dx + dy > 8) p.px(x, y, 'rgba(45,27,18,0.28)');
    }
  }
  p.px(7, 6, '#ffffff').px(8, 6, '#ffffff').px(7, 7, '#ffffff').px(6, 8, 'rgba(255,255,255,0.7)');
  return p;
}
