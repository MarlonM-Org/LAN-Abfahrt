/**
 * Waschbär-Bande (MiniKind `igel`): eigene 8-Bit-Icons für Waffen, Werkzeuge, Themenkarten und HUD –
 * statt Emojis. 16 × 16 Pixel, kräftige Kontur; TV nutzt sie als Textur, das Handy als Bild-URL (`iconUrl`).
 */
import type { IgelThemeId, IgelWeapon } from '../../shared/types';
import { Pix } from './pix';

const OUT = '#2d1b12';

/** Farben der Pixel-Karten (ein Zeichen = eine Farbe, '.' = durchsichtig) */
const PAL: Record<string, string> = {
  k: '#2d1b12', // Kontur / ganz dunkel
  x: '#1e1a17', // fast schwarz (Loch, Maske)
  w: '#fdf7ea',
  W: '#ffffff',
  r: '#e04a3f',
  R: '#a8342a',
  p: '#f08a7d',
  y: '#ffd25e',
  t: '#3a332d', // Waschbär-Schwanz dunkel
  a: '#8f877c', // Waschbär-Fell
  T: '#c4baac', // Waschbär-Schwanz hell
  Y: '#d99a2b',
  o: '#f0973a',
  s: '#cfd2d6',
  S: '#8a8f96',
  l: '#eef0f2',
  d: '#5e5e66',
  D: '#3d3d45',
  g: '#46b04a',
  G: '#2f7d32',
  h: '#86cc55',
  b: '#3f8fe0',
  B: '#2b6ba6',
  c: '#93d3f3',
  C: '#d4f1ff',
  n: '#b8783f',
  N: '#8d5629',
  m: '#d39a5c',
  M: '#5e3518',
  e: '#9aa1b2', // Taube hell
  E: '#6b7286', // Taube dunkel
  u: '#8a63b8', // lila Schimmer
  v: '#3e4c43', // Müllsack
  V: '#6f8a76',
  q: '#c79b54', // Korbgeflecht
  Q: '#946a2c',
};

/** Icon aus einer 16 × 16-Pixelkarte; `post` zeichnet nach der Kontur (z. B. Funken ohne Rand) */
function icon(rows: string[], post?: (p: Pix) => void): Pix {
  const p = new Pix(16, 16);
  p.map(0, 0, rows, PAL);
  p.outline(OUT);
  post?.(p);
  return p;
}

// ------------------------------------------------------------------ Waffen und Werkzeuge

const ROCKET = [
  '................',
  '.............y..',
  '............yY..',
  '...........yyY..',
  '..........rrrR..',
  '.........rrrR...',
  '........wwwR....',
  '.......rrrR.....',
  '......rrrR......',
  '.....rrRR.......',
  '....n.o.........',
  '...n.oyo........',
  '..n...o.........',
  '.n..............',
  '................',
  '................',
];

const CAN = [
  '................',
  '...........o.o..',
  '............y...',
  '...........o.o..',
  '..........n.....',
  '....llllln.l....',
  '...slllllllS....',
  '...slssssssS....',
  '...rrrrrrrrR....',
  '...rwwwwwwrR....',
  '...rrrrrrrrR....',
  '...slssssssS....',
  '...slssssssS....',
  '....SSSSSSS.....',
  '................',
  '................',
];

const BAG = [
  '................',
  '......v..v......',
  '.......yy.......',
  '......vVv.......',
  '.....vvvvv......',
  '....vvVvvvv.....',
  '...vvVvvvvvv..r.',
  '...vVvvvvvvv.rR.',
  '..vvVvvvvvvvv...',
  '..vvvvvvvvvvv.y.',
  '..vvvvvvvvvvvyy.',
  '..vvvvvvvvvvv...',
  '...vvvvvvvvv....',
  '....vvvvvvv.....',
  '................',
  '................',
];

const HOLY = [
  '................',
  '................',
  '................',
  '................',
  '......YYYY......',
  '..YyyyyyyyyyyY..',
  '..YYYYYYYYYYYY..',
  '...yWyyYyyYyY...',
  '...yWyyYyyYyY...',
  '...yWyyYyyYyY...',
  '...yWyyYyyYyY...',
  '....WyyYyyYY....',
  '....yyyYyyYY....',
  '....yyyyyyyY....',
  '.....YYYYYY.....',
  '................',
];

const HOSE = [
  '................',
  '................',
  '................',
  '..........cc.ccc',
  '..ggggggyy......',
  '..gGGGGGyy......',
  '...gg.d....cc.cc',
  '...gg.d.........',
  '...gg...........',
  '..ggG...........',
  '..g.............',
  '.g..............',
  '.g..............',
  '..gg............',
  '................',
  '................',
];

const PIGEON = [
  '................',
  '....ee..........',
  '....eEe.........',
  '.....eEe....uh..',
  '..eeeeeeeeeeuhko',
  '.eeeeeeeeeeeee..',
  '...eEEeeeeee....',
  '................',
  '.......l........',
  '.......l........',
  '...........l....',
  '...........l....',
  '....l...........',
  '....l...........',
  '................',
  '................',
];

const BOELLER = [
  '................',
  '...........o....',
  '..........oyo...',
  '.........n.o....',
  '........n.......',
  '.......n........',
  '.....rrrrR......',
  '.....rwwwR......',
  '.....rrrrR......',
  '.....rrrrR......',
  '.....rwwwR......',
  '.....rrrrR......',
  '.....rrrrR......',
  '.....RRRRR......',
  '................',
  '................',
];

const TRAP = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '...........yy...',
  '..........yYyy..',
  '.........yyyyYy.',
  '..mmmmmmmmmmmmm.',
  '.nnnnnnnnnnnnnn.',
  '.NNNNNNNNNNNNNN.',
  '................',
  '................',
  '................',
];

const PAN = [
  '................',
  '........DDDD....',
  '......DDddddDD..',
  '.....DddddddddD.',
  '.....DdSddddddD.',
  '.....DdSddddddD.',
  '.....DddddddddD.',
  '......DDddddDD..',
  '....nN..DDDD....',
  '...nN...........',
  '..nN............',
  '.nN.............',
  'nN..............',
  '................',
  '................',
  '................',
];

const PAW = [
  '................',
  '.....dd..dd.....',
  '....ddd..ddd....',
  '....ddd..ddd....',
  '.dd..........dd.',
  'ddd..........ddd',
  'ddd...dddd...ddd',
  '.....dddddd.....',
  '....dddddddd....',
  '...dddddddddd...',
  '...dddddddddd...',
  '...dddddddddd...',
  '....dddd.dddd...',
  '................',
  '................',
  '................',
];

const GULLY = [
  '................',
  '.....yyyy.......',
  '....y....y......',
  '...y......y.....',
  '...y.....yyy....',
  '...y......y.....',
  '..tT............',
  '..Tt......a..a..',
  '..tT......aaaa..',
  '.SSSSS....xWxW..',
  'SxxxxxS..SawwaS.',
  'SxxxxxS..SxxxxS.',
  '.SSSSS....SSSS..',
  '................',
  '................',
  '................',
];

const PIPE = [
  '................',
  '..y........y....',
  '..y........y....',
  'yyyyy......y....',
  '.yyy.....yyyyy..',
  '..y.......yyy...',
  'SSSSS......y....',
  'sxxxs...SSSSS...',
  '.sss.....sxxxs..',
  '.sss......sss...',
  '.sss......sss...',
  '.sssssssssssss..',
  '.sSSSSSSSSSSss..',
  '..SSSSSSSSSSS...',
  '................',
  '................',
];

const PLANK = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.mmmmmmmmmmmmmm.',
  '.nnNnnnnnnnNnnn.',
  '.NSNNNNNNNNNNSN.',
  'hh............hh',
  'nn............nn',
  'nn............nn',
  'Nn............nN',
  'nn............nn',
  '................',
  '................',
  '................',
];

const LINE = [
  '................',
  '................',
  'k..............k',
  'k..............k',
  'kl............lk',
  'k.ll........ll.k',
  'k...lNllllNl...k',
  'k...rrr..bbbbb.k',
  'k...rrr..bbbbb.k',
  'k...rrr...bbb..k',
  'k...rrrr..bbb..k',
  'k....rrr.......k',
  'k..............k',
  'k..............k',
  'k..............k',
  '................',
];

const UMBRELLA = [
  '................',
  '.......k........',
  '.....bbbbb......',
  '...bbcbbbcbb....',
  '..bbcbbbbbcbb...',
  '.bbcbbbbbbbcbb..',
  '.bB.bB.k.bB.bB..',
  '.......k........',
  '.......k........',
  '.......k........',
  '.......k........',
  '.......k........',
  '.......k..k.....',
  '........kk......',
  '................',
  '................',
];

const SHOVEL = [
  '................',
  '...........nnn..',
  '...........n.n..',
  '...........nnn..',
  '..........n.....',
  '.........n......',
  '........n.......',
  '.......n........',
  '......sS........',
  '.....ssS........',
  '....sssS........',
  '...sssSS........',
  '..ssssS.........',
  '..sssS......nn..',
  '...S.......nNnn.',
  '................',
];

const WEAPON_MAPS: Record<IgelWeapon, string[]> = {
  bazooka: ROCKET,
  grenade: CAN,
  cluster: BAG,
  holy: HOLY,
  shotgun: HOSE,
  airstrike: PIGEON,
  dynamite: BOELLER,
  mine: TRAP,
  paddle: PAN,
  punch: PAW,
  teleport: GULLY,
  bridge: PLANK,
  rope: LINE,
  parasol: UMBRELLA,
  shovel: SHOVEL,
};

/** Heiligenschein und Glitzer über der goldenen Tonne (nach der Kontur, ohne Rand) */
function halo(p: Pix) {
  p.hline(5, 0, 6, PAL.Y).px(4, 1, PAL.Y).px(11, 1, PAL.Y).hline(5, 2, 6, PAL.Y);
  p.px(6, 0, PAL.y).px(7, 0, PAL.y).px(9, 2, PAL.y);
  p.px(1, 4, PAL.Y).px(0, 5, PAL.Y).px(2, 5, PAL.Y).px(1, 6, PAL.Y);
  p.px(14, 8, PAL.Y).px(13, 9, PAL.Y).px(15, 9, PAL.Y).px(14, 10, PAL.Y);
}

/** Mausefalle: gespannter Bügel und Feder (dünn, nach der Kontur) */
function trapBow(p: Pix) {
  p.hline(2, 9, 8, '#5e5e66').vline(2, 5, 4, '#5e5e66').hline(2, 5, 6, '#5e5e66').vline(7, 5, 4, '#5e5e66');
  p.hline(3, 6, 4, '#cfd2d6').px(8, 8, '#8a8f96').px(9, 8, '#8a8f96');
}

export const pipeIcon = () => icon(PIPE);

export function weaponIcon(w: IgelWeapon): Pix {
  return icon(WEAPON_MAPS[w], w === 'holy' ? halo : w === 'mine' ? trapBow : undefined);
}

// ------------------------------------------------------------------ Themenkarten

const THEME_MAPS: Record<IgelThemeId, string[]> = {
  sturm: [], // aus dem Wind-Icon gebaut (themeIcon)
  mond: [
    '................',
    '.....yyyyy......',
    '...yyyyyyyyy....',
    '..yyYyyyyyyyy...',
    '..yYYyyyyyYyy...',
    '.yyyyyyyyyYyyy..',
    '.yyyyyyyyyyyyy..',
    '.yyyyyYyyyyyyy..',
    '.yyyyYYyyyyyyy..',
    '.yyyyyyyyyyyyy..',
    '..yyyyyyyyyYy...',
    '..yyyyyyyyyyy...',
    '...yyyyyyyyy....',
    '.....yyyyy......',
    '................',
    '................',
  ],
  kisten: [
    '................',
    '..rr......bb....',
    '.rpRr....bcbB...',
    '.rrRr....bbbB...',
    '..rR......bB....',
    '...k......k.....',
    '....k....k......',
    '.....k..k.......',
    '...qqqqqqqq.....',
    '..qQqQqQqQqq....',
    '..rwrwrwrwrw....',
    '..qQqQqQqQqq....',
    '..qqQqQqQqqq....',
    '...QQQQQQQQ.....',
    '................',
    '................',
  ],
  spreng: [
    '................',
    '.......y........',
    '...r...y...r....',
    '....r..y..r.....',
    '.....r...r......',
    '................',
    '.yyy...W...yyy..',
    '................',
    '.....b...b......',
    '....b..g..b.....',
    '...b...g...b....',
    '.......g........',
    '................',
    '................',
    '................',
    '................',
  ],
  vampir: [
    '................',
    '................',
    '................',
    '......d..d......',
    '.dd...dddd...dd.',
    '.ddd..drdr..ddd.',
    '.dddddddddddddd.',
    '..ddddddddddddd.',
    '..dd.dddddd.dd..',
    '..d...dWWd...d..',
    '.......dd.......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  flut: [
    '................',
    '................',
    '................',
    '....cc......cc..',
    '...cbbc....cbbc.',
    '..bbbbbb..bbbbbb',
    'bbbbbbbbbbbbbbbb',
    'BbbBbbBbbBbbBbbB',
    '................',
    '....cc......cc..',
    '...cbbc....cbbc.',
    '..bbbbbb..bbbbbb',
    'bbbbbbbbbbbbbbbb',
    'BBBBBBBBBBBBBBBB',
    '................',
    '................',
  ],
};

export function themeIcon(t: IgelThemeId): Pix {
  if (t !== 'sturm') return icon(THEME_MAPS[t]);
  // Sturmnacht: Windlinien + ein davonwirbelndes Blatt
  const p = uiIcon('wind');
  p.map(12, 9, ['.kk.', 'khgk', 'kggk', '.kk.'], PAL).px(14, 13, PAL.k);
  return p;
}

// ------------------------------------------------------------------ HUD

export type IgelUiIcon = 'wind' | 'flood';

const UI_MAPS: Record<IgelUiIcon, string[]> = {
  // drei Windlinien mit Schnörkeln (dünn, ohne Kontur – siehe uiIcon)
  wind: [
    '................',
    '.........BBB....',
    '........B...B...',
    '............B...',
    'BBBBBBBBBBBB....',
    '................',
    '................',
    '.BBBBBBBBBBBBBB.',
    '................',
    '................',
    'BBBBBBBBBBB.....',
    '...........B....',
    '........B..B....',
    '.........BB.....',
    '................',
    '................',
  ],
  // Hochwasser: Welle mit Pfeil nach oben
  flood: [
    '................',
    '...r............',
    '..rrr...........',
    '.rrrrr..........',
    '..rrr...........',
    '..rrr.....cc....',
    '..rrr....cbbc...',
    '........bbbbbb..',
    '..cc...bbbbbbbb.',
    '.cbbc.bbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'BbbBbbBbbBbbBbbB',
    'BBBBBBBBBBBBBBBB',
    '................',
    '................',
    '................',
  ],
};

export function uiIcon(k: IgelUiIcon): Pix {
  if (k !== 'wind') return icon(UI_MAPS[k]);
  // Wind: feine Linien lesen sich besser ohne Kontur (doppelt gezeichnet = 2 px dick)
  // oben hell, darunter dunkel versetzt: lesbar auf Papier (Handy, HUD) und auf der dunklen Themenkarte
  const p = new Pix(16, 16);
  p.map(0, 1, UI_MAPS.wind, { B: '#2b5a96' });
  p.map(0, 0, UI_MAPS.wind, { B: '#5b9be0' });
  return p;
}

// ------------------------------------------------------------------ Handy: Bild-URLs

const urls = new Map<string, string>();

/** Data-URL eines Icons (einmal gerendert, dann gemerkt) – fürs Handy (`<img>` mit `image-rendering: pixelated`) */
function cached(key: string, make: () => Pix): string {
  let u = urls.get(key);
  if (!u) {
    u = make().canvas.toDataURL();
    urls.set(key, u);
  }
  return u;
}

export const weaponIconUrl = (w: IgelWeapon) => cached(`w_${w}`, () => weaponIcon(w));
export const themeIconUrl = (t: IgelThemeId) => cached(`t_${t}`, () => themeIcon(t));
export const uiIconUrl = (k: IgelUiIcon) => cached(`u_${k}`, () => uiIcon(k));
