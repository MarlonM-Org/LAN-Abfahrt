import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintSand, paintShore, paintWater } from './ground';
import { palm, towel, umbrella } from './objects';
import { crab } from './lagoon';
import type { GolfHole } from '../../shared/golf';

/** Golfball in Spielerfarbe, 7 × 7 */
export function golfBallPix(color: string): Pix {
  const p = new Pix(7, 7);
  p.disc(3.5, 3.5, 2.9, color);
  p.overlayOn(() => {
    p.disc(4.3, 4.3, 2.2, shade(color, 0.75));
    p.disc(3.2, 3.2, 2, color);
    p.px(2, 2, '#ffffff').px(3, 2, shade(color, 1.6));
  });
  p.outline(C.outline);
  return p;
}

/** Fähnchen im Loch (Ursprung: Fuß der Stange), zwei Frames zum Flattern */
export function flagPix(frame: 0 | 1): Pix {
  const p = new Pix(12, 18);
  p.vline(2, 1, 16, '#f4efe2').vline(3, 1, 16, '#c9c2b0');
  const rows = frame === 0 ? ['RRRRRRR', 'RRRRRR.', 'RRRRR..', 'RRRR...', 'RR.....'] : ['RRRRRR.', 'RRRRRRR', 'RRRRRR.', 'RRRR...', 'RR.....'];
  p.map(4, 1, rows, { R: C.red });
  p.px(5, 2, '#ff8a7a').px(6, 2, '#ff8a7a');
  p.outline(C.outline);
  return p;
}

/** Aufblasbarer Flamingo-Ring von oben (Bumper), Radius r */
export function flamingoBumperPix(r: number): Pix {
  const s = Math.ceil(r * 2 + 8);
  const p = new Pix(s, s);
  const c = s / 2;
  const pink = '#f07aa8';
  p.disc(c, c, r, pink);
  p.overlayOn(() => {
    p.disc(c + 1, c + 1, r - 1, '#d85a8e');
    p.disc(c - 0.5, c - 0.5, r - 1.5, pink);
    p.ellipse(c - r / 3, c - r / 3, r / 3, r / 4, '#ffb3d0');
  });
  p.disc(c, c, r * 0.38, '#7fc9f0');
  // Hals + Kopf oben rechts
  p.rect(c + r * 0.4, c - r - 2, 2, 4, pink);
  p.disc(c + r * 0.4 + 2, c - r - 2, 2, pink);
  p.px(c + r * 0.4 + 4, c - r - 2, '#2d1b12').px(c + r * 0.4 + 2, c - r - 3, '#2d1b12');
  p.outline(shade('#c9467e', 0.6));
  return p;
}

/** Leuchtturm von oben (Nabe der Flügel): rot-weiß, Laterne in der Mitte */
export function lighthouseTopPix(r: number): Pix {
  const s = Math.ceil(r * 2 + 4);
  const p = new Pix(s, s);
  const c = s / 2;
  p.disc(c, c, r + 1, '#f4efe2');
  p.overlayOn(() => {
    for (let a = 0; a < 8; a += 2) {
      for (let k = 0; k < 10; k++) {
        const ang = ((a + k / 10) / 8) * Math.PI * 2;
        p.g.fillStyle = C.red;
        p.g.beginPath();
        p.g.moveTo(c, c);
        p.g.lineTo(c + Math.cos(ang) * (r + 2), c + Math.sin(ang) * (r + 2));
        p.g.lineTo(c + Math.cos(ang + 0.08) * (r + 2), c + Math.sin(ang + 0.08) * (r + 2));
        p.g.fill();
      }
    }
  });
  p.disc(c, c, r * 0.55, '#3d2414');
  p.disc(c, c, r * 0.38, C.window);
  p.px(Math.floor(c) - 1, Math.floor(c) - 1, '#ffffff');
  p.outline(C.outline);
  return p;
}

/** Surfbrett von oben, Länge × Dicke (senkrecht) */
export function surfboardPix(len: number, thick: number): Pix {
  const p = new Pix(thick + 2, len + 2);
  const cx = (thick + 2) / 2;
  p.ellipse(cx, (len + 2) / 2, thick / 2, len / 2, '#f4efe2');
  p.overlayOn(() => {
    p.rect(0, len * 0.3, thick + 2, 3, '#2fb5a5');
    p.rect(0, len * 0.3 + 4, thick + 2, 2, '#f0973a');
    p.vline(Math.floor(cx), 0, len + 2, '#e0503f');
    p.vline(1, 0, len + 2, '#ffffff');
  });
  p.outline(C.outline);
  return p;
}

/** Röhren-Öffnung (Eingang/Ausgang des Loopings) */
export function tubeMouthPix(r: number, out: boolean): Pix {
  const s = Math.ceil(r * 2 + 4);
  const p = new Pix(s, s);
  const c = s / 2;
  p.disc(c, c, r + 1, out ? '#3f8fe0' : '#f0973a');
  p.disc(c, c, r - 1.5, '#1d1410');
  p.overlayOn(() => p.ellipse(c - r / 3, c - r / 2, r / 3, 1, '#ffffff'));
  p.outline(C.outline);
  return p;
}

function shell(): Pix {
  const p = new Pix(9, 8);
  p.ellipse(4.5, 4.5, 4, 3.2, '#ffd9c0');
  p.overlayOn(() => {
    for (let x = 1; x < 9; x += 2) p.vline(x, 0, 8, '#f0b090');
  });
  p.rect(3, 6, 3, 2, '#f0b090');
  p.outline(C.outline);
  return p;
}

function boat(): Pix {
  const p = new Pix(30, 14);
  p.ellipse(15, 8, 13, 4.5, '#b8783f');
  p.overlayOn(() => {
    p.ellipse(15, 7, 11, 3, '#d39a5c');
    p.vline(10, 3, 9, '#8d5629').vline(20, 3, 9, '#8d5629');
  });
  p.outline(C.outline);
  return p;
}

const scaled = (src: Pix, s: number) => {
  const c = document.createElement('canvas');
  c.width = Math.round(src.w * s);
  c.height = Math.round(src.h * s);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(src.canvas, 0, 0, c.width, c.height);
  return c;
};

/** Pixel-Pfad (ohne Kantenglättung) aus einem Polygon füllen */
function fillPoly(p: Pix, poly: { x: number; y: number }[], color: string, grow = 0) {
  const xs = poly.map((q) => q.x);
  const ys = poly.map((q) => q.y);
  const x0 = Math.floor(Math.min(...xs)) - grow;
  const x1 = Math.ceil(Math.max(...xs)) + grow;
  const y0 = Math.floor(Math.min(...ys)) - grow;
  const y1 = Math.ceil(Math.max(...ys)) + grow;
  const inside = (x: number, y: number) => {
    let ins = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) ins = !ins;
    }
    return ins;
  };
  p.g.fillStyle = color;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let hit = inside(x + 0.5, y + 0.5);
      if (!hit && grow) {
        for (let dy = -grow; dy <= grow && !hit; dy++) for (let dx = -grow; dx <= grow && !hit; dx++) hit = inside(x + 0.5 + dx, y + 0.5 + dy);
      }
      if (hit) p.g.fillRect(x, y, 1, 1);
    }
  }
}

/**
 * Hintergrund eines Lochs: Strand mit Meer oben, die Bahn als Kunstrasen mit Holzbande, Sand, Wasser,
 * Hänge (Pfeile), Brücke, Rampe/Röhre, Abschlagmatte und Deko. Bewegliches (Flügel, Surfbrett,
 * Bälle, Fahne) zeichnet die Szene.
 */
export function paintGolfHole(p: Pix, h: GolfHole, idx: number, W: number, H: number) {
  const r = rng(700 + idx * 13);
  paintSand(p, 0, 0, W, H, 701 + idx);
  paintWater(p, 0, 0, W, 30, 702 + idx);
  paintShore(p, 0, 31, W, 703 + idx);
  // Deko unter der Bahn
  for (const d of h.deco) {
    if (d.kind === 'palm') {
      const c = scaled(palm(Math.floor(r() * 9)), 0.5);
      p.g.drawImage(c, Math.round(d.x - c.width / 2), Math.round(d.y - c.height));
    } else if (d.kind === 'umbrella') {
      const c = scaled(umbrella(r() < 0.5 ? C.red : C.blue), 0.7);
      p.g.drawImage(c, Math.round(d.x - c.width / 2), Math.round(d.y - c.height));
    } else if (d.kind === 'towel') {
      const t = towel(r() < 0.5 ? C.orange : C.purple);
      p.g.save();
      p.g.translate(d.x, d.y);
      p.g.rotate(Math.PI / 2);
      p.g.drawImage(t.canvas, -t.w / 2, -t.h / 2);
      p.g.restore();
    } else if (d.kind === 'shell') p.draw(shell(), d.x - 4, d.y - 4);
    else if (d.kind === 'boat') p.draw(boat(), d.x - 15, d.y - 7);
    else if (d.kind === 'crab') p.g.drawImage(scaled(crab(0), 0.6), d.x - 9, d.y - 7);
  }
  // Schatten, Holzbande, Rasen
  const sh = h.shape.map((q) => ({ x: q.x + 2, y: q.y + 3 }));
  fillPoly(p, sh, 'rgba(60,40,20,0.35)', 4);
  fillPoly(p, h.shape, C.woodDarker, 5);
  fillPoly(p, h.shape, C.wood, 4);
  fillPoly(p, h.shape.map((q) => ({ x: q.x, y: q.y - 1 })), C.woodLight, 3);
  fillPoly(p, h.shape, C.woodDark, 1);
  fillPoly(p, h.shape, '#4fa63c');
  // Kunstrasen-Streifen
  const xs = h.shape.map((q) => q.x);
  const ys = h.shape.map((q) => q.y);
  const bx0 = Math.min(...xs);
  const bx1 = Math.max(...xs);
  const by0 = Math.min(...ys);
  const by1 = Math.max(...ys);
  const turf = new Pix(W, H);
  fillPoly(turf, h.shape, '#4fa63c');
  turf.overlayOn(() => {
    for (let x = bx0; x < bx1; x += 16) turf.rect(x, by0, 8, by1 - by0, '#58b043');
    turf.speckle(bx0, by0, bx1 - bx0, by1 - by0, '#46963a', ((bx1 - bx0) * (by1 - by0)) / 18, r);
    turf.speckle(bx0, by0, bx1 - bx0, by1 - by0, '#67bd4f', ((bx1 - bx0) * (by1 - by0)) / 30, r);
  });
  p.draw(turf, 0, 0);
  // Hänge: hellere Fläche + Pfeile in Rollrichtung
  for (const s of h.slopes) {
    p.g.fillStyle = 'rgba(255,255,220,0.13)';
    p.g.fillRect(s.x, s.y, s.w, s.h);
    const len = Math.hypot(s.ax, s.ay) || 1;
    const ux = s.ax / len;
    const uy = s.ay / len;
    const strong = len > 150;
    for (let y = s.y + 8; y < s.y + s.h - 4; y += strong ? 10 : 16) {
      for (let x = s.x + 8; x < s.x + s.w - 4; x += strong ? 12 : 18) {
        const col = strong ? '#ffe7a0' : '#9ad65a';
        // kleiner Winkel-Pfeil („>“) in Rollrichtung
        for (let k = 0; k < 4; k++) {
          const bx = x + ux * k - uy * (3 - k) * 0.9;
          const by = y + uy * k + ux * (3 - k) * 0.9;
          const cx = x + ux * k + uy * (3 - k) * 0.9;
          const cy = y + uy * k - ux * (3 - k) * 0.9;
          p.px(Math.round(bx), Math.round(by), col).px(Math.round(cx), Math.round(cy), col);
        }
      }
    }
  }
  // Sandbunker
  for (const s of h.sand) {
    const poly = [
      { x: s.x + 3, y: s.y },
      { x: s.x + s.w - 3, y: s.y },
      { x: s.x + s.w, y: s.y + 3 },
      { x: s.x + s.w, y: s.y + s.h - 3 },
      { x: s.x + s.w - 3, y: s.y + s.h },
      { x: s.x + 3, y: s.y + s.h },
      { x: s.x, y: s.y + s.h - 3 },
      { x: s.x, y: s.y + 3 },
    ];
    fillPoly(p, poly, '#c9a560', 1);
    fillPoly(p, poly, C.sand);
    p.clip(s.x + 1, s.y + 1, s.w - 2, s.h - 2, () => {
      p.speckle(s.x, s.y, s.w, s.h, C.sandDark, (s.w * s.h) / 10, r);
      p.speckle(s.x, s.y, s.w, s.h, C.sandLight, (s.w * s.h) / 14, r);
      for (let y = s.y + 4; y < s.y + s.h; y += 5) for (let x = s.x + 2; x < s.x + s.w - 2; x++) if ((x + y) % 4 && r() < 0.5) p.px(x, y, '#e0c084');
    });
  }
  // Wasser
  for (const w of h.water) {
    p.rect(w.x - 1, w.y - 1, w.w + 2, w.h + 2, '#3d6a8a');
    paintWater(p, w.x, w.y, w.w, w.h, 710 + idx);
    p.hline(w.x, w.y, w.w, C.foam);
  }
  // Brücke
  for (const b of h.bridges) {
    for (let x = b.x; x < b.x + b.w; x += 4) {
      p.rect(x, b.y, 3, b.h, C.wood).vline(x + 3, b.y, b.h, C.woodDark);
      p.px(x + 1, b.y + 2, C.woodDarker).px(x + 1, b.y + b.h - 3, C.woodDarker);
    }
    p.hline(b.x, b.y, b.w, C.woodDarker).hline(b.x, b.y + b.h - 1, b.w, C.woodDarker);
  }
  // Mauerblöcke
  for (const blk of h.blocks) {
    fillPoly(p, blk.map((q) => ({ x: q.x + 1, y: q.y + 2 })), 'rgba(40,25,10,0.4)');
    fillPoly(p, blk, C.woodDarker, 1);
    fillPoly(p, blk, C.wood);
    const bxs = blk.map((q) => q.x);
    const bys = blk.map((q) => q.y);
    p.hline(Math.min(...bxs), Math.min(...bys), Math.max(...bxs) - Math.min(...bxs), C.woodLight);
  }
  // Looping: Röhre als bunter Bogen vom Eingang zum Ausgang
  for (const t of h.tubes) {
    const steps = 80;
    const mx = (t.x + t.out.x) / 2;
    const my = Math.min(t.y, t.out.y) - 46;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const x = (1 - u) * (1 - u) * t.x + 2 * u * (1 - u) * mx + u * u * t.out.x;
      const y = (1 - u) * (1 - u) * t.y + 2 * u * (1 - u) * my + u * u * t.out.y;
      p.disc(x + 1, y + 2, 4, 'rgba(40,25,10,0.25)');
    }
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const x = (1 - u) * (1 - u) * t.x + 2 * u * (1 - u) * mx + u * u * t.out.x;
      const y = (1 - u) * (1 - u) * t.y + 2 * u * (1 - u) * my + u * u * t.out.y;
      p.disc(x, y, 4, C.outline);
    }
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const x = (1 - u) * (1 - u) * t.x + 2 * u * (1 - u) * mx + u * u * t.out.x;
      const y = (1 - u) * (1 - u) * t.y + 2 * u * (1 - u) * my + u * u * t.out.y;
      p.disc(x, y, 3, i % 16 < 8 ? '#f0973a' : '#ffd25e');
      p.px(Math.round(x - 1), Math.round(y - 2), '#fff4d6');
    }
    p.draw(tubeMouthPix(t.r, false), t.x - t.r - 2, t.y - t.r - 2);
    p.draw(tubeMouthPix(5, true), t.out.x - 7, t.out.y - 7);
  }
  // Abschlagmatte
  p.rect(h.tee.x - 8, h.tee.y - 8, 16, 16, '#2f7d32');
  p.rect(h.tee.x - 7, h.tee.y - 7, 14, 14, '#3a8f3c');
  p.rect(h.tee.x - 1, h.tee.y - 1, 2, 2, '#fff4d6');
  // Loch
  p.disc(h.cup.x, h.cup.y, 7, '#3f8f34');
  p.disc(h.cup.x, h.cup.y, 5, '#1d1410');
  p.ellipse(h.cup.x, h.cup.y + 1.5, 4, 2.4, '#000000');
  p.hline(h.cup.x - 3, h.cup.y - 5, 6, '#7fc95a');
}
