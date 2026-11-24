import { IGEL, type Mask } from '../../shared/igel';
import { C } from './palette';
import { type BgLayer, Pix, bgLayers, rng, shade } from './pix';
import { paintSky } from './ground';

/**
 * Waschbär-Bande (MiniKind `igel`): Figuren, Geschosse, Gegenstände und Kulisse –
 * Waschbären-Banden auf einer Campinginsel im See, abends. Icons fürs Waffenraster: `igelIcons.ts`.
 */

const OUT = C.outline;

// ------------------------------------------------------------------ Figuren

/** Aussehen eines Waschbären: Halstuch in Spielerfarbe, Kopfbedeckung (Team-Mütze oder nach dem Avatar) */
export interface RaccoonLook {
  scarf: string;
  hat: 'none' | 'beanie' | 'cap' | 'tuft';
  hatColor: string;
}

/** Haltungen: stehen/laufen (2 Laufbilder), springen/fliegen, hängen (Wäscheleine, Schirm), getroffen, zielen */
export type RaccoonPose = 'stand' | 'walk' | 'jump' | 'hang' | 'hurt' | 'aim';
export const RACCOON_POSES: RaccoonPose[] = ['stand', 'walk', 'jump', 'hang', 'hurt', 'aim'];

const FUR: Record<string, string> = {
  g: '#8f877c', // Fell
  G: '#4a423b', // Ohr innen, Pfoten
  l: '#bcb3a6', // Bauch
  w: '#f4efe6', // weiße Gesichtszeichnung
  W: '#ffffff', // Augenglanz
  x: '#26201c', // Maske
  n: '#120e0c', // Nase
  t: '#3a332d', // Schwanz dunkel
  T: '#c4baac', // Schwanz hell
  f: '#4a423b', // Pfoten/Füße
  R: '#c0443a', // offener Mund
};

/** Waschbär (schaut nach rechts), 18 × 17, Fußpunkt = Mitte der vorletzten Zeile */
const RACCOON: Record<RaccoonPose, string[]> = {
  stand: [
    '..................',
    '........g.....g...',
    '.......gGg...gGg..',
    '.......ggggggggg..',
    '..tt...gwwgggwwg..',
    '.tttt..xxWxgxWxx..',
    '.TTTT..gxxxwxxxg..',
    '.tttt...gwwwnwg...',
    '..TTTT...gwwwg....',
    '..tttt..ssssssS...',
    '...TTTgglllgg.....',
    '....ttgglllggf....',
    '....TTgglllgg.....',
    '.....tggglllg.....',
    '......ggggggg.....',
    '.......ff..ff.....',
    '..................',
  ],
  walk: [
    '..................',
    '........g.....g...',
    '.......gGg...gGg..',
    '.......ggggggggg..',
    '...tt..gwwgggwwg..',
    '..tttt.xxWxgxWxx..',
    '..TTTT.gxxxwxxxg..',
    '..tttt..gwwwnwg...',
    '...TTTT..gwwwg....',
    '...tttt.ssssssS...',
    '....TTgglllgg.....',
    '....ttgglllgg.....',
    '....TTgglllggf....',
    '.....tggglllg.....',
    '......ggggggg.....',
    '......ff....ff....',
    '..................',
  ],
  jump: [
    '..................',
    '........g.....g...',
    '.tt....gGg...gGg..',
    'tttt...ggggggggg..',
    'TTTT...gwwgggwwg..',
    'tttt...xxWxgxWxx..',
    '.TTTT..gxxxwxxxg..',
    '.tttt...gwwwnwg...',
    '..TTT....gwwwg....',
    '..ttt...ssssssSf..',
    '...TTTgglllggg....',
    '....ttgglllgg.....',
    '.....Tgglllgg.....',
    '......gglllgg.....',
    '.....fgggggggf....',
    '..................',
    '..................',
  ],
  hang: [
    '......f.......f...',
    '......g.g...g.g...',
    '......ggGg..gGgg..',
    '......gggggggggg..',
    '......ggwwgggwwg..',
    '......gxxWxgxWxx..',
    '......ggxxxwxxxg..',
    '.........gwwnwg...',
    '..tt......gwwg....',
    '.tttt...ssssssS...',
    '.TTTT..glllgg.....',
    '.tttt..glllgg.....',
    '..TTTT.glllgg.....',
    '...tttgglllg......',
    '.......ggggg......',
    '........f..f......',
    '..................',
  ],
  hurt: [
    '..................',
    '........g.....g...',
    '.t.t...gGg...gGg..',
    '..tt...ggggggggg..',
    '.tttt..gwwgggwwg..',
    'tTTTTt.xxxxgxxxx..',
    '.TTTT..gxxxwxxxg..',
    'ttttt...gwwnwwg...',
    '.TTTTT...gwRwg....',
    '..tttt..ssssssS...',
    '...TTTgglllgg.....',
    '....ttgglllggf....',
    '....TTgglllgg.....',
    '.....tggglllg.....',
    '......ggggggg.....',
    '.......ff..ff.....',
    '..................',
  ],
  aim: [
    '..................',
    '........g.....g...',
    '.......gGg...gGg..',
    '.......ggggggggg..',
    '..tt...gwwgggwwg..',
    '.tttt..xxWxgxWxx..',
    '.TTTT..gxxxwxxxg..',
    '.tttt...gwwwnwg...',
    '..TTTT...gwwwg....',
    '..tttt..ssssssS...',
    '...TTTgglllggggf..',
    '....ttgglllgg.....',
    '....TTgglllgg.....',
    '.....tggglllg.....',
    '......ggggggg.....',
    '.......ff..ff.....',
    '..................',
  ],
};

/** Kopf-Oberkante (Zeile) und Mitte (Spalte) je Haltung – für Mütze und Haare */
const HEAD: Record<RaccoonPose, { x: number; y: number }> = {
  stand: { x: 11, y: 3 },
  walk: { x: 11, y: 3 },
  jump: { x: 11, y: 3 },
  hang: { x: 11, y: 3 },
  hurt: { x: 11, y: 3 },
  aim: { x: 11, y: 3 },
};

export function raccoon(look: RaccoonLook, pose: RaccoonPose = 'stand'): Pix {
  const p = new Pix(18, 17);
  const pal = { ...FUR, s: look.scarf, S: shade(look.scarf, 0.7) };
  p.map(0, 0, RACCOON[pose], pal);
  // Halstuch-Zipfel vorne (größere Fläche in Spielerfarbe)
  p.px(11, 10, look.scarf).px(12, 10, look.scarf).px(12, 11, pal.S);
  const h = HEAD[pose];
  const c = look.hatColor;
  if (look.hat === 'beanie') {
    // Bommelmütze zwischen den Ohren
    p.rect(h.x - 3, h.y - 2, 7, 2, c).hline(h.x - 3, h.y, 7, shade(c, 0.75)).px(h.x - 2, h.y - 2, shade(c, 1.3));
    p.px(h.x, h.y - 3, C.white).px(h.x - 1, h.y - 3, shade(C.white, 0.85));
  } else if (look.hat === 'cap') {
    p.rect(h.x - 3, h.y - 2, 6, 2, c).px(h.x - 2, h.y - 2, shade(c, 1.3)).hline(h.x + 1, h.y, 4, shade(c, 0.7));
  } else if (look.hat === 'tuft') {
    p.px(h.x, h.y - 1, c).px(h.x - 1, h.y - 2, c).px(h.x + 1, h.y - 2, shade(c, 0.8)).px(h.x, h.y - 3, c);
  }
  p.outline(OUT);
  return p;
}

/** Grabstein mit Pfotenabdruck – K.o.-Waschbär */
export function gravestone(): Pix {
  const p = new Pix(13, 14);
  p.rect(2, 4, 9, 9, C.stone).ellipse(6.5, 4.5, 4.5, 3.5, C.stone);
  p.overlayOn(() => {
    p.vline(3, 3, 10, C.stoneLight);
    // Pfote eingraviert
    p.rect(5, 7, 3, 2, C.stoneDark).px(4, 5, C.stoneDark).px(6, 4, C.stoneDark).px(8, 5, C.stoneDark);
  });
  p.rect(0, 12, 13, 2, C.grass).px(1, 11, C.grassLight).px(11, 11, C.grassLight);
  p.outline(OUT);
  return p;
}

/** Schwimmring – K.o. im See: der Waschbär treibt davon */
export function swimRing(look: RaccoonLook): Pix {
  const p = new Pix(18, 13);
  p.map(5, 0, ['.g...g.', 'ggggggg', 'xxWgWxx', 'gxwwwxg', '.gwnwg.'], FUR);
  p.ellipse(8.5, 9.5, 8.5, 3, C.red);
  p.overlayOn(() => {
    p.rect(3, 7, 2, 6, C.white).rect(12, 7, 2, 6, C.white);
  });
  p.rect(7, 6, 4, 1, look.scarf);
  p.outline(OUT);
  return p;
}

// ------------------------------------------------------------------ Geschosse

/** Silvesterrakete (zeigt nach rechts – die Szene dreht sie in Flugrichtung) */
export function rocket(): Pix {
  const p = new Pix(12, 7);
  p.map(0, 0, [
    '............',
    '.N.....r....',
    'NNNNrrwrrrY.',
    '.NNNrrwrrrYy',
    '...NRRwRRRY.',
    '.......R....',
    '............',
  ], { N: '#b8783f', r: C.red, R: '#a8342a', w: C.white, Y: '#d99a2b', y: C.gold });
  p.outline(OUT);
  return p;
}

/** Dosenbombe: Konservendose mit Zündschnur */
export function tinCan(): Pix {
  const p = new Pix(9, 10);
  p.map(0, 0, [
    '......o..',
    '.....n...',
    '.lllln...',
    '.sllllS..',
    '.rrrrrR..',
    '.rwwwrR..',
    '.rrrrrR..',
    '.slsssS..',
    '..SSSS...',
    '.........',
  ], { o: C.gold, n: '#5e3518', l: '#eef0f2', s: '#cfd2d6', S: '#8a8f96', r: C.red, R: '#a8342a', w: C.white });
  p.outline(OUT);
  return p;
}

/** Platzender Müllsack (Splitterbombe) */
export function trashBag(): Pix {
  const p = new Pix(9, 11);
  p.map(0, 0, [
    '..v..v...',
    '...yy....',
    '...vv....',
    '..vVvv...',
    '.vVvvvv..',
    '.vVvvvvv.',
    '.vvvvvvv.',
    '.vvvvvvv.',
    '..vvvvv..',
    '.........',
    '.........',
  ], { v: '#3e4c43', V: '#6f8a76', y: C.gold });
  p.outline(OUT);
  return p;
}

/** Müllbrocken aus dem Sack: Dose, Bananenschale, Apfelrest */
export function junk(kind: number): Pix {
  const p = new Pix(6, 6);
  const k = ((kind % 3) + 3) % 3;
  if (k === 0) p.map(1, 1, ['ss', 'rr', 'ss'], { s: '#cfd2d6', r: C.red });
  else if (k === 1) p.map(0, 1, ['y...', '.yy.', '..yY'], { y: C.gold, Y: '#8d5629' });
  else p.map(1, 1, ['.N', 'rr', 'mm', 'rr'], { N: '#5e3518', r: C.red, m: '#fbe7bd' });
  p.outline(OUT);
  return p;
}

/** Heilige Mülltonne: goldene Tonne mit Heiligenschein */
export function holyBin(): Pix {
  const p = new Pix(11, 13);
  p.map(0, 3, [
    '....YY.....',
    '.YyyyyyyY..',
    '.YYYYYYYY..',
    '..yWyYyY...',
    '..yWyYyY...',
    '..yWyYyY...',
    '..yyyYyY...',
    '...YYYY....',
  ], { y: C.gold, Y: '#d99a2b', W: '#fffbe8' });
  p.outline(OUT);
  p.hline(3, 0, 4, '#d99a2b').px(2, 1, '#d99a2b').px(7, 1, '#d99a2b').hline(3, 2, 4, '#d99a2b').px(4, 0, C.gold);
  return p;
}

/** Was die Tauben fallen lassen */
export function pigeonDrop(): Pix {
  const p = new Pix(6, 7);
  p.map(1, 1, ['.w.', 'www', 'wlw', '.w.'], { w: '#f4f1ea', l: '#c9c3b6' });
  p.outline(OUT);
  return p;
}

/** Riesenböller mit Zündschnur */
export function boeller(): Pix {
  const p = new Pix(7, 12);
  p.rect(1, 3, 5, 8, '#d8473c').rect(1, 5, 5, 1, '#fff4d6').rect(1, 8, 5, 1, '#fff4d6').vline(5, 3, 8, '#a8342a');
  p.vline(3, 1, 2, '#5e4e40').px(4, 0, '#ffd25e');
  p.outline(OUT);
  return p;
}

// ------------------------------------------------------------------ Gegenstände

/** Camping-Gaskartusche (explodiert bei Treffer) */
export function gasCan(): Pix {
  const p = new Pix(9, 12);
  p.rect(1, 4, 7, 7, '#2f6fc0').ellipse(4.5, 4, 3.5, 1.5, '#2f6fc0');
  p.overlayOn(() => {
    p.vline(2, 3, 8, '#6aa5ea');
    p.rect(1, 6, 7, 3, '#fdf7ea');
    p.px(3, 7, '#e04a3f').px(4, 7, '#e04a3f').px(5, 7, '#e04a3f');
  });
  p.rect(3, 0, 3, 3, '#cfd2d6').px(5, 1, '#8a8f96');
  p.outline(OUT);
  return p;
}

/** Picknickkorb (Kiste: zufällige Waffe oder Snack mit +HP) */
export function picnicBasket(): Pix {
  const p = new Pix(13, 12);
  p.map(0, 0, [
    '....NNNNN....',
    '...N.....N...',
    '..N.......N..',
    '.qqqqqqqqqqq.',
    '.qQqQqQqQqQq.',
    '.rwrwrwrwrwr.',
    '.wrwrwrwrwrw.',
    '.qQqQqQqQqQq.',
    '.qqQqQqQqQqq.',
    '..QQQQQQQQQ..',
    '.............',
    '.............',
  ], { N: '#8d5629', q: '#c79b54', Q: '#946a2c', r: C.red, w: C.white });
  p.outline(OUT);
  return p;
}

/** Luftballons, an denen der Picknickkorb herabschwebt */
export function balloons(): Pix {
  const p = new Pix(19, 17);
  const cols = ['#e04a3f', '#3f8fe0', '#f2c33a'];
  const spots: [number, number][] = [[4.5, 4], [14.5, 4], [9.5, 2.5]];
  spots.forEach(([x, y], i) => {
    p.ellipse(x, y, 3.2, 3.6, cols[i]);
    p.px(x - 1.5, y - 2, shade(cols[i], 1.5));
  });
  p.outline(OUT);
  // Schnüre zum Korb
  for (let i = 0; i <= 8; i++) {
    p.px(4.5 + i * 0.55, 8 + i, '#5e4e40');
    p.px(14.5 - i * 0.55, 8 + i, '#5e4e40');
  }
  p.vline(9, 7, 10, '#5e4e40');
  return p;
}

/** Mausefalle: `armed` = Bügel gespannt (flach) mit Käse, sonst Bügel noch oben */
export function mouseTrap(armed: boolean): Pix {
  const p = new Pix(13, 9);
  p.rect(0, 6, 13, 2, '#d39a5c').hline(0, 7, 13, '#8d5629');
  p.rect(8, 3, 3, 3, C.gold).px(9, 4, '#d99a2b');
  if (armed) {
    p.hline(1, 5, 7, '#8a8f96').vline(1, 4, 2, '#8a8f96').px(7, 5, C.red);
  } else {
    p.vline(2, 1, 5, '#8a8f96').vline(6, 1, 5, '#8a8f96').hline(2, 1, 5, '#8a8f96');
  }
  p.outline(OUT);
  return p;
}

/** Taube (fliegt nach rechts), 2 Flügelschläge */
export function pigeon(frame: number): Pix {
  const p = new Pix(16, 9);
  const wing = frame === 0
    ? ['....ee..........', '....eEe.........', '.....eEe........']
    : ['................', '................', '................'];
  const body = [
    '............uh..',
    '..eeeeeeeeeeuhko',
    '.eeeeeeeeeeeee..',
    '...EEeeeeeee....',
  ];
  const down = frame === 1 ? ['.....eEe........', '....eEe.........'] : [];
  p.map(0, 0, [...wing, ...body, ...down], { e: '#9aa1b2', E: '#6b7286', u: '#8a63b8', h: '#5fae6e', k: '#1e1a17', o: C.orange });
  p.outline(OUT);
  return p;
}

/** Fledermaus (Kulisse am Abendhimmel), 2 Flügelschläge */
export function bat(frame: number): Pix {
  const p = new Pix(11, 6);
  const rows = frame === 0 ? ['x.........x', 'xx..x.x..xx', '.xxxxxxxxx.', '...xxxxx...', '....x.x....'] : ['...........', '....x.x....', '.xxxxxxxxx.', 'xx.xxxxx.xx', 'x...x.x...x'];
  p.map(0, 0, rows, { x: '#2a2440' });
  return p;
}

/** Gullydeckel-Loch (Teleport: rein und woanders wieder raus) */
export function manhole(): Pix {
  const p = new Pix(15, 6);
  p.ellipse(7.5, 3, 7, 2.6, '#8a8f96');
  p.ellipse(7.5, 3, 5.4, 1.6, '#1e1a17');
  p.outline(OUT);
  return p;
}

/** Gullydeckel (fliegt beim Teleport hoch) */
export function manholeLid(): Pix {
  const p = new Pix(11, 4);
  p.ellipse(5.5, 2, 5, 1.6, '#6b6f76');
  p.overlayOn(() => p.hline(2, 1, 7, '#8a8f96').px(3, 2, '#4a4d52').px(5, 2, '#4a4d52').px(7, 2, '#4a4d52'));
  p.outline(OUT);
  return p;
}

/** Regenschirm-Gleiter: lila Schirm mit Griff (Griff unten = Pfoten des Waschbären) */
export function umbrellaPix(): Pix {
  const p = new Pix(17, 15);
  p.ellipse(8.5, 5, 8, 4.5, '#6b4fb8');
  p.overlayOn(() => {
    for (const x of [4, 8, 12]) p.vline(x, 0, 6, '#8f75d6');
  });
  p.outline(OUT);
  p.g.clearRect(0, 6, 17, 9);
  for (let x = 1; x < 16; x += 4) p.px(x, 5, OUT).px(x + 1, 6, OUT).px(x + 2, 6, OUT).px(x + 3, 5, OUT);
  p.px(8, 0, OUT);
  p.vline(8, 6, 7, '#3a332d').px(7, 13, '#3a332d').px(6, 12, '#3a332d');
  return p;
}

// ------------------------------------------------------------------ Deko (wird ins Terrain gemalt)

/** Tanne */
export function pine(seed = 1): Pix {
  const r = rng(seed);
  const h = 30 + Math.floor(r() * 10);
  const p = new Pix(22, h + 2);
  p.rect(10, h - 6, 3, 7, C.trunk);
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const top = 1 + i * ((h - 10) / tiers);
    const bot = top + (h - 8) / tiers + 4;
    for (let y = Math.floor(top); y <= bot; y++) {
      const half = ((y - top) / (bot - top)) * (4 + i * 2);
      p.hline(11 - half, y, half * 2 + 1, C.leafDark);
    }
  }
  p.overlayOn(() => {
    p.speckle(0, 0, 11, h - 6, C.leafLight, 10, r);
    p.speckle(11, 0, 11, h - 6, C.leafDarker, 14, r);
  });
  p.outline(OUT);
  return p;
}

/** Zelt mit offener Tür */
export function tent(col: string): Pix {
  const p = new Pix(28, 17);
  for (let y = 1; y <= 15; y++) {
    const half = (y / 15) * 13;
    p.hline(14 - half, y, half * 2, col);
  }
  p.overlayOn(() => {
    p.rect(0, 0, 14, 17, shade(col, 0.8));
    for (let y = 6; y <= 15; y++) p.hline(14 - (y - 6) * 0.45, y, (y - 6) * 0.9 + 1, '#2a2030');
  });
  p.vline(14, 0, 2, '#5e4e40');
  p.outline(OUT);
  return p;
}

/** Mülltonne (Lieblingsplatz der Bande) */
export function trashCan(): Pix {
  const p = new Pix(12, 16);
  p.rect(1, 3, 10, 2, '#7d8896').rect(4, 1, 4, 2, '#5e6670');
  p.rect(2, 5, 8, 10, '#8f9aa8');
  p.overlayOn(() => {
    for (const x of [3, 5, 7]) p.vline(x, 5, 10, '#6c7682');
    p.vline(8, 5, 10, '#b5bfcb');
  });
  // Bananenschale lugt heraus
  p.px(9, 2, C.gold).px(10, 1, C.gold);
  p.outline(OUT);
  return p;
}

// ------------------------------------------------------------------ Hintergrund

/** Abendhimmel über dem See – `layer`: far (Himmel, Sterne, Abendsonne, Wolken), mid (Waldufer, See am Horizont) oder alles */
export function paintIslandSky(p: Pix, seed: number, layer: BgLayer = 'all') {
  const { W, H } = IGEL;
  const r = rng(seed);
  const L = bgLayers(layer);
  if (L.far) {
    paintSky(p, 0, 0, W, H, ['#25285a', '#3f3a78', '#7a4f8f', '#c86a7e', '#f29a6a', '#ffc98a']);
    // erste Sterne oben
    for (let i = 0; i < 40; i++) p.px(Math.floor(r() * W), Math.floor(r() * 70), i % 4 ? '#c9c6ea' : '#fff4d6');
    // Abendsonne knapp über dem Ufer
    p.disc(390, 196, 18, '#ffb36b').disc(390, 196, 14, '#ffd28f').disc(390, 196, 9, '#ffe7b8');
    // rosa Wolkenbänder
    for (let i = 0; i < 6; i++) {
      const cx = r() * W;
      const cy = 60 + r() * 90;
      const len = 30 + r() * 50;
      p.ellipse(cx, cy, len / 2, 2.5, i % 2 ? '#d98a9a' : '#e7a2a0');
      p.hline(cx - len / 3, cy + 2, len / 1.5, '#b56a86');
    }
  }
  if (!L.mid) return;
  // Waldufer am Horizont – nahtlos kachelbar (was über den Rand ragt, wird drüben noch einmal gemalt)
  for (const dx of [-W, 0, W]) p.rect(dx, 204, W, 10, '#3a335e');
  for (let i = 0; i < 70; i++) {
    const cx = r() * W;
    const h = 8 + r() * 14;
    for (const dx of [-W, 0, W]) {
      for (let y = 0; y < h; y++) p.hline(cx + dx - (y / h) * 4, 206 - h + y, (y / h) * 8 + 1, i % 3 ? '#3a335e' : '#2f2a50');
    }
  }
  // See weit hinten mit Abendglitzern
  p.rect(0, 212, W, H - 212, '#4f6fa8');
  for (let i = 0; i < 80; i++) p.hline(r() * W, 214 + r() * 50, 2 + r() * 4, '#7d96c8');
  for (let i = 0; i < 24; i++) p.hline(380 + (r() - 0.5) * 40, 214 + r() * 40, 2 + r() * 6, '#f6b27a');
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

/** Malt die Inselmaske in ein ImageData gleicher Breite (Gras oben, Sand am Strand, Erde mit Steinen innen). */
export function paintTerrain(img: ImageData, m: Mask) {
  const W = m.w;
  const { H } = IGEL;
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
  const W = m.w;
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
