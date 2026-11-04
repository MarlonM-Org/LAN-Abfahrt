import { C } from './palette';
import { Pix, rng, shade } from './pix';

/** Pixel-Art für die Bomben-Arena (Kacheln 18 × 18) */

/** Kleine Palme als feste Säule (Ursprung unten mittig) */
export function arenaPalm(seed = 1): Pix {
  const p = new Pix(24, 32);
  const r = rng(seed);
  for (let i = 0; i < 9; i++) {
    const x = 11 + Math.sin(i / 3) * 1.5;
    const y = 28 - i * 2;
    p.rect(x - 2, y, 4, 2, i % 2 ? '#a9773f' : '#8f6031');
    p.px(x + 1, y, '#6e4521');
  }
  const top = { x: 12, y: 10 };
  const fronds: [number, number][] = [[-1, -0.1], [-0.8, 0.5], [1, -0.1], [0.85, 0.5], [-0.3, -0.9], [0.35, -0.9]];
  for (const [dx, dy] of fronds) {
    for (let s = 0; s <= 10; s++) {
      const t = s / 10;
      p.disc(top.x + dx * t * 10, top.y + dy * t * 7 + t * t * 5, 2 * (1 - t) + 0.7, C.leafDark);
    }
  }
  p.overlayOn(() => {
    for (const [dx, dy] of fronds) for (let s = 0; s <= 10; s++) p.px(top.x + dx * (s / 10) * 10, top.y + dy * (s / 10) * 7 + (s / 10) ** 2 * 5 - 1, C.leafLight);
    p.speckle(0, 0, 24, 18, C.leafDarker, 8, r);
  });
  p.disc(11, 12, 1.6, '#6b4522').disc(14, 12, 1.6, '#5a3a1c');
  p.outline(C.outline);
  const out = new Pix(24, 34);
  out.ellipse(12, 30, 8, 2.5, 'rgba(0,0,0,0.22)');
  out.draw(p, 0, 0);
  return out;
}

/** Felsen als feste Säule */
export function arenaRock(seed = 2): Pix {
  const p = new Pix(20, 22);
  const r = rng(seed);
  p.ellipse(10, 13, 9, 8, C.stoneDark);
  p.overlayOn(() => {
    p.ellipse(8, 10, 6, 5, C.stone);
    p.ellipse(7, 8, 3, 2, C.stoneLight);
    p.rect(0, 18, 20, 4, '#5e5a54');
    p.speckle(0, 0, 20, 22, '#6e6a62', 10, r);
    p.px(13, 6, C.leafLight).px(14, 6, C.leaf).px(13, 5, C.leaf);
  });
  p.outline(C.outline);
  return p;
}

/** Sandburg (zerstörbar) */
export function sandcastle(): Pix {
  const p = new Pix(18, 20);
  p.rect(2, 9, 14, 9, C.sandDark);
  p.rect(5, 4, 8, 6, C.sandDark);
  for (const x of [2, 6, 10, 14]) p.rect(x, 7, 2, 2, C.sandDark);
  p.rect(7, 2, 4, 3, C.sandDark);
  p.overlayOn(() => {
    p.rect(3, 9, 12, 2, C.sand).rect(6, 4, 6, 2, C.sand).px(8, 2, C.sandLight).px(4, 13, '#c99a5e').px(12, 12, '#c99a5e');
    p.rect(8, 13, 3, 5, '#a97a43');
  });
  p.vline(9, 0, 3, C.woodDark).rect(10, 0, 3, 2, C.red);
  p.outline(C.outline);
  return p;
}

/** Liegestuhl von schräg oben (zerstörbar) */
export function lounger(fabric: string): Pix {
  const p = new Pix(18, 20);
  p.rect(2, 3, 14, 15, C.woodDark);
  p.rect(3, 4, 12, 13, fabric);
  p.overlayOn(() => {
    for (let y = 4; y < 17; y += 4) p.rect(3, y, 12, 2, C.white);
    p.rect(3, 4, 12, 4, shade(fabric, 1.15));
  });
  p.rect(3, 4, 12, 1, shade(fabric, 1.3));
  p.rect(1, 17, 2, 2, C.woodDarker).rect(15, 17, 2, 2, C.woodDarker);
  p.outline(C.outline);
  return p;
}

/** Kühlbox (zerstörbar) */
export function cooler(color: string): Pix {
  const p = new Pix(18, 18);
  p.rect(2, 5, 14, 11, color);
  p.rect(1, 3, 16, 4, C.white);
  p.overlayOn(() => {
    p.rect(2, 13, 14, 3, shade(color, 0.75));
    p.rect(3, 8, 3, 2, shade(color, 1.3));
  });
  p.rect(6, 1, 6, 2, '#cfcbc1');
  p.outline(C.outline);
  return p;
}

/** Hecken-Block für den Rand (Garten am Ferienhaus) */
export function hedge(seed: number): Pix {
  const p = new Pix(18, 18);
  const r = rng(seed);
  p.rect(0, 2, 18, 16, C.leafDark);
  p.overlayOn(() => {
    for (let i = 0; i < 9; i++) p.disc(r() * 18, 2 + r() * 10, 2 + r() * 2, C.leaf);
    p.speckle(0, 0, 18, 18, C.leafLight, 14, r);
    p.speckle(0, 0, 18, 18, C.leafDarker, 10, r);
    p.rect(0, 15, 18, 3, C.leafDarker);
    if (r() < 0.4) p.px(4 + r() * 10, 5 + r() * 6, '#f6a7c9');
  });
  return p;
}

/** Kokosnuss mit Zündschnur */
export function coconut(): Pix {
  const p = new Pix(16, 16);
  p.disc(8, 9, 6, '#6b4522');
  p.overlayOn(() => {
    p.disc(6, 7, 3, '#8a5a2b');
    p.px(5, 6, '#b47a42');
    p.speckle(0, 0, 16, 16, '#4a2e14', 10, rng(9));
    p.px(7, 11, '#3a2410').px(9, 11, '#3a2410').px(8, 13, '#3a2410');
  });
  p.vline(10, 1, 3, '#d8d2c4').px(11, 1, '#d8d2c4');
  p.outline(C.outline);
  p.px(12, 0, C.gold).px(11, 0, C.orange);
  return p;
}

/** Wasserbombe (Luftballon) */
export function waterBalloon(color: string): Pix {
  const p = new Pix(16, 16);
  p.ellipse(8, 9, 6, 5.5, color);
  p.overlayOn(() => {
    p.ellipse(6, 7, 2.5, 2, shade(color, 1.4));
    p.rect(0, 12, 16, 4, shade(color, 0.8));
  });
  p.rect(7, 2, 3, 2, shade(color, 0.7));
  p.outline(C.outline);
  p.px(8, 0, C.white);
  return p;
}

/** Wasser-Explosion: c = Mitte, h = waagerecht, v = senkrecht */
export function splash(k: 'c' | 'h' | 'v'): Pix {
  const p = new Pix(18, 18);
  const r = rng(k === 'c' ? 3 : k === 'h' ? 5 : 7);
  if (k === 'c') {
    p.disc(9, 9, 8.5, C.waterDark);
    p.disc(9, 9, 6.5, C.water);
    p.disc(9, 9, 4, C.waterLight);
    p.disc(8, 8, 2, C.foam);
  } else {
    const band = (o: number, w: number, c: string) => (k === 'h' ? p.rect(0, 9 - w / 2 + o, 18, w, c) : p.rect(9 - w / 2 + o, 0, w, 18, c));
    band(0, 14, C.waterDark);
    band(0, 10, C.water);
    band(0, 5, C.waterLight);
    band(-1, 2, C.foam);
  }
  for (let i = 0; i < 6; i++) p.px(r() * 18, r() * 18, C.foam);
  return p;
}

/** Geflutete Kachel */
export function floodTile(seed: number): Pix {
  const p = new Pix(18, 18);
  const r = rng(seed);
  p.rect(0, 0, 18, 18, C.waterDark);
  for (let i = 0; i < 5; i++) p.hline(r() * 14, r() * 18, 2 + r() * 3, C.waterLight);
  p.hline(0, 0, 18, C.foam);
  return p;
}

/** Power-up in einer Seifenblase */
export function itemIcon(t: 'bomb' | 'range' | 'speed'): Pix {
  const p = new Pix(16, 16);
  p.disc(8, 8, 7.5, 'rgba(234,248,255,0.55)');
  p.disc(8, 8, 6, t === 'bomb' ? '#f2c33a' : t === 'range' ? '#3f8fe0' : '#46b04a');
  if (t === 'bomb') {
    p.disc(8, 9, 3.5, '#6b4522').px(7, 8, '#b47a42').vline(9, 4, 2, C.white).px(10, 4, C.orange);
  } else if (t === 'range') {
    // Wassertropfen
    p.disc(8, 10, 3, C.foam).rect(7, 5, 2, 3, C.foam).px(8, 4, C.foam).px(7, 9, C.waterLight);
  } else {
    // Flip-Flop
    p.ellipse(8, 9, 3, 4.5, '#f07aa8').px(8, 6, C.white).px(7, 7, C.white).px(9, 7, C.white);
  }
  p.px(4, 4, C.white).px(5, 3, C.white);
  p.outline(C.outline);
  return p;
}
