/** Pixel-Art für „Spion unter Gästen“: Gartenparty am Ferienhaus + der eine Party-Gast in drei Hemd-Farben */
import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintGrass } from './ground';
import * as O from './objects';
import { BUFFET, GRILL, HAMMOCK, HOUSE, POOL, SPEAKER, SPION, STATIONS, TABLES, TREES } from '../../shared/spion';

/** Hemd-Varianten der Gäste (Hawaii-Hemd) */
export const GUEST_SHIRTS = ['#e0503f', '#2fb5a5', '#f2c33a'];
export const GUEST_W = 9;
export const GUEST_H = 18;
/** Bild-Indizes: 0 stehen, 1/2 gehen, 3 benutzen, 4 plaudern, 5 nass */
export const GF = { STAND: 0, WALK_A: 1, WALK_B: 2, USE: 3, CHAT: 4, WET: 5 } as const;

/**
 * Der Party-Gast: Strohhut, Sonnenbrille, Hawaii-Hemd, Shorts, Sandalen. Alle sehen (fast) gleich aus –
 * das ist das Spiel. Ursprung beim Zeichnen: unten mittig (Fußpunkt).
 */
export function guestPix(v: number, frame: number): Pix {
  const p = new Pix(GUEST_W, GUEST_H);
  const shirt = GUEST_SHIRTS[v % GUEST_SHIRTS.length];
  const skin = '#efbf98';
  const hat = '#e8c66a';
  const pal: Record<string, string> = {
    H: hat, h: shade(hat, 0.78), S: skin, s: shade(skin, 0.85), K: '#2b2b38', k: '#5a6a8a',
    T: shirt, t: shade(shirt, 0.8), F: C.white, P: '#d8c49a', p: '#b8a273', D: '#7a4a26',
  };
  const wet = frame === GF.WET;
  const head = [
    '..HHH..',
    '.HHHHH.',
    'hhhhhhh',
    '.SSSSS.',
    '.KKkKK.',
    '.SSSSS.',
    '..sss..',
  ];
  let body = [
    '.TTTTT.',
    'TTFTTFT',
    'STtTFtS',
    'S.TTT.S',
    '.PPPPP.',
    '.PP.PP.',
  ];
  let legs = ['.SS.SS.', '.DD.DD.'];
  if (frame === GF.WALK_A) legs = ['.SS..S.', 'DD...DD'];
  if (frame === GF.WALK_B) legs = ['..S.SS.', '..DDDD.'];
  if (frame === GF.USE) body = ['.TTTTTS', 'TTFTTFS', 'STtTFt.', 'S.TTT..', '.PPPPP.', '.PP.PP.'];
  if (frame === GF.CHAT) body = ['.TTTTTS', 'TTFTTFS', 'STtTFt.', 'S.TTT..', '.PPPPP.', '.PP.PP.'].map((r, i) => (i === 0 ? '.TTTTT.' : r));
  if (frame === GF.CHAT) head[5] = '.SSKSS.';
  p.map(1, 1, [...head, ...body, ...legs], pal);
  if (wet) {
    p.overlayOn(() => {
      p.rect(0, 0, GUEST_W, GUEST_H, 'rgba(90, 160, 232, 0.45)');
    });
  }
  p.outline(C.outline);
  if (wet) p.px(0, 4, C.waterLight).px(8, 7, C.waterLight).px(0, 11, C.waterLight);
  return p;
}

/** Pfütze eines enttarnten Spions */
export function puddle(): Pix {
  const p = new Pix(18, 7);
  p.ellipse(9, 3.5, 8, 3, C.water);
  p.overlayOn(() => p.ellipse(7, 2.5, 4, 1.4, C.waterLight));
  p.hline(5, 4, 3, C.foam);
  p.outline(C.waterDeep);
  return p;
}

export function partyBalloon(): Pix {
  const p = new Pix(9, 10);
  p.ellipse(4.5, 4, 3.6, 3.8, C.pink);
  p.overlayOn(() => p.ellipse(3.5, 3, 1.6, 1.4, shade(C.pink, 1.45)));
  p.px(3, 2, C.white).px(4, 8, shade(C.pink, 0.6)).px(5, 8, shade(C.pink, 0.6)).px(4, 9, shade(C.pink, 0.6));
  p.outline(C.outline);
  return p;
}

/** Buffet-Tisch mit Tischdecke, Melone, Schüsseln */
export function buffetTable(): Pix {
  const w = BUFFET.w + 4;
  const p = new Pix(w, 26);
  p.rect(2, 8, w - 4, 10, C.white).hline(2, 17, w - 4, '#d9d1bf');
  for (let x = 2; x < w - 2; x += 8) p.rect(x, 8, 4, 10, '#f2b5c4');
  p.rect(4, 18, 2, 7, C.woodDark).rect(w - 6, 18, 2, 7, C.woodDark);
  // Essen
  p.ellipse(12, 7, 6, 3, '#3f8a32').ellipse(12, 6, 5, 2, '#e0503f').px(10, 6, C.outline).px(13, 5, C.outline);
  p.ellipse(28, 7, 5, 2.5, '#d8d2c4').ellipse(28, 6, 4, 1.5, '#f0973a');
  p.ellipse(44, 7, 5, 2.5, '#d8d2c4').ellipse(44, 6, 4, 1.5, '#7cc04a');
  p.rect(56, 2, 3, 6, '#9fd8f5').rect(61, 3, 3, 5, '#ffd25e').rect(66, 2, 3, 6, '#f07aa8');
  p.ellipse(76, 7, 5, 2.5, '#d8d2c4').disc(75, 5, 1.5, '#a9773f').disc(78, 6, 1.5, '#a9773f');
  p.outline(C.outline);
  return p;
}

export function bigGrill(): Pix {
  const p = new Pix(GRILL.w + 6, 26);
  const w = GRILL.w + 6;
  p.rect(2, 8, w - 4, 7, '#4d4a47').rect(3, 8, w - 6, 1, '#7a7671');
  for (let x = 4; x < w - 3; x += 3) p.vline(x, 8, 6, '#2c2a28');
  p.rect(5, 9, 5, 2, '#c0442e').rect(12, 10, 5, 2, '#c0442e');
  p.rect(5, 15, 2, 10, '#4d4a47').rect(w - 7, 15, 2, 10, '#4d4a47');
  p.outline(C.outline);
  p.px(8, 4, '#d0d0d0').px(11, 2, '#d0d0d0').px(15, 5, '#d0d0d0').px(12, 0, '#e8e8e8');
  return p;
}

/** Hängematte zwischen zwei Palmen (nur das Netz – die Palmen kommen extra) */
export function hammock(): Pix {
  const w = HAMMOCK.w;
  const p = new Pix(w, 16);
  for (let x = 0; x < w; x++) {
    const t = x / (w - 1);
    const y = 3 + Math.sin(t * Math.PI) * 8;
    p.rect(x, y, 1, 3, Math.floor(x / 4) % 2 ? '#f2c33a' : '#e0503f');
  }
  p.outline(C.outline);
  return p;
}

export function speaker(): Pix {
  const p = new Pix(SPEAKER.w + 2, 24);
  p.rect(1, 1, SPEAKER.w, 22, '#3b3b4f').rect(2, 2, SPEAKER.w - 2, 1, '#5a5a70');
  p.disc(SPEAKER.w / 2 + 1, 8, 4, '#2a2a36').disc(SPEAKER.w / 2 + 1, 8, 1.5, '#8a8aa0');
  p.disc(SPEAKER.w / 2 + 1, 17, 3, '#2a2a36').disc(SPEAKER.w / 2 + 1, 17, 1, '#8a8aa0');
  p.outline(C.outline);
  return p;
}

/** Stehtisch mit Sonnenschirm */
export function partyTable(i: number): Pix {
  const p = new Pix(34, 44);
  p.draw(O.umbrella(i % 2 ? C.blue : C.orange, C.white), 0, 0);
  p.rect(10, 36, 14, 4, C.woodLight).hline(10, 39, 14, C.woodDark).rect(16, 40, 2, 4, C.woodDark);
  p.disc(13, 35, 1.5, '#9fd8f5').disc(21, 35, 1.5, '#f07aa8');
  return p;
}

/** Gemalter Hintergrund (Haus, Terrasse, Rasen, Pool, Wege, Lichterkette) */
export function paintParty(p: Pix) {
  const { W, H } = SPION;
  paintGrass(p, 0, 0, W, H, 91);
  const r = rng(92);
  // Terrasse
  const ty = HOUSE.y + HOUSE.h;
  for (let x = 0; x < W; x += 6) {
    p.rect(x, ty, 6, 24, (x / 6) % 2 ? '#d9a466' : '#cf9a5c');
    p.vline(x + 5, ty, 24, '#a87440');
  }
  p.hline(0, ty + 24, W, '#a87440');
  // Hauswand mit Fenstern, Tür und Dach
  p.rect(HOUSE.x, HOUSE.y, HOUSE.w, HOUSE.h, '#efe2c4');
  for (let x = 0; x < W; x += 6) p.vline(x, HOUSE.y + 4, HOUSE.h - 4, '#e2d2ae');
  p.rect(0, HOUSE.y, W, 4, C.roof).hline(0, HOUSE.y + 3, W, C.roofDark);
  for (const wx of [40, 120, 330, 410]) {
    p.rect(wx, HOUSE.y + 8, 24, 14, C.woodDarker).rect(wx + 1, HOUSE.y + 9, 22, 12, '#ffe08a').vline(wx + 12, HOUSE.y + 9, 12, C.woodDarker);
  }
  p.rect(222, HOUSE.y + 6, 36, HOUSE.h - 6, C.woodDarker).rect(223, HOUSE.y + 7, 34, HOUSE.h - 7, '#9fd8f5').vline(240, HOUSE.y + 7, HOUSE.h - 7, C.woodDarker);
  p.hline(0, HOUSE.y + HOUSE.h - 1, W, C.woodDark);
  // Lichterkette
  for (let x = 0; x < W; x += 2) {
    const y = HOUSE.y + 5 + Math.abs(Math.sin((x / 60) * Math.PI)) * 6;
    p.px(x, y, '#3b3b4f');
    if (x % 12 === 0) p.disc(x, y + 2, 1.2, ['#ffd25e', '#f07aa8', '#93d3f3', '#86cc55'][(x / 12) % 4]);
  }
  // Trittsteine
  for (let i = 0; i < 9; i++) p.ellipse(240 + Math.sin(i) * 3, 82 + i * 4, 4, 1.6, C.stoneLight);
  for (let i = 0; i < 8; i++) p.ellipse(60 + i * 14, 150 + Math.sin(i) * 4, 4, 1.6, C.stoneLight);
  for (let i = 0; i < 8; i++) p.ellipse(320 + i * 12, 160 + Math.cos(i) * 4, 4, 1.6, C.stoneLight);
  // Pool mit Rand, Leiter (Auftragsort) und Flamingo-Ring
  p.rect(POOL.x - 5, POOL.y - 5, POOL.w + 10, POOL.h + 10, C.stoneLight);
  for (let x = POOL.x - 5; x < POOL.x + POOL.w + 5; x += 7) p.vline(x, POOL.y - 5, 5, '#b9b5ab').vline(x, POOL.y + POOL.h, 5, '#b9b5ab');
  p.rect(POOL.x, POOL.y, POOL.w, POOL.h, C.water);
  for (let i = 0; i < 40; i++) p.hline(POOL.x + r() * (POOL.w - 6), POOL.y + 3 + r() * (POOL.h - 6), 2 + r() * 4, r() < 0.5 ? C.waterLight : C.waterDark);
  p.hline(POOL.x, POOL.y, POOL.w, C.waterDeep).hline(POOL.x, POOL.y + 1, POOL.w, C.waterDark);
  p.ellipse(212, 136, 7, 4, '#f07aa8').ellipse(212, 136, 3, 1.6, C.water);
  p.ellipse(270, 150, 6, 3.5, C.gold).ellipse(270, 150, 2.6, 1.4, C.water);
  const st = STATIONS[2];
  p.rect(st.x - 5, POOL.y + POOL.h - 6, 2, 10, '#d8d2c4').rect(st.x + 3, POOL.y + POOL.h - 6, 2, 10, '#d8d2c4');
  p.hline(st.x - 3, POOL.y + POOL.h - 3, 6, '#d8d2c4').hline(st.x - 3, POOL.y + POOL.h, 6, '#d8d2c4');
  // Blumenbeete
  for (let i = 0; i < 26; i++) p.px(6 + r() * 30, 70 + r() * 30, r() < 0.5 ? C.pink : C.white);
  for (let i = 0; i < 26; i++) p.px(440 + r() * 34, 120 + r() * 40, r() < 0.5 ? C.gold : C.white);
}

/** Feste Deko-/Auftrags-Objekte: [Schlüssel, Bild, x (Mitte), y (unten)] – auf dem TV tiefensortiert */
export function partyObjects(): [string, () => Pix, number, number][] {
  return [
    ['sp_buffet', buffetTable, BUFFET.x + BUFFET.w / 2, BUFFET.y + BUFFET.h + 2],
    ['sp_grill', bigGrill, GRILL.x + GRILL.w / 2, GRILL.y + GRILL.h + 2],
    ['sp_speaker', speaker, SPEAKER.x + SPEAKER.w / 2, SPEAKER.y + SPEAKER.h + 1],
    ['sp_hammock', hammock, HAMMOCK.x + HAMMOCK.w / 2, HAMMOCK.y + 4],
    ['sp_palmL', () => O.palm(61), HAMMOCK.x, HAMMOCK.y + HAMMOCK.h],
    ['sp_palmR', () => O.palm(62), HAMMOCK.x + HAMMOCK.w, HAMMOCK.y + HAMMOCK.h],
    ...TABLES.map((t, i) => [`sp_table${i}`, () => partyTable(i), t.x, t.y + 1] as [string, () => Pix, number, number]),
    ...TREES.map((t, i) => [`sp_tree${i}`, () => (i === 1 ? O.tree(70) : O.palm(70 + i)), t.x, t.y + 2] as [string, () => Pix, number, number]),
  ];
}

/** Alles flach in einem Bild (Handy-Karte) */
export function paintPartyFlat(): Pix {
  const p = new Pix(SPION.W, SPION.H);
  paintParty(p);
  const objs = partyObjects().map(([, make, x, y]) => ({ pix: make(), x, y }));
  objs.sort((a, b) => a.y - b.y);
  for (const o of objs) p.draw(o.pix, Math.round(o.x - o.pix.w / 2), Math.round(o.y - o.pix.h));
  return p;
}
