/**
 * Versteckspiel mit Möbeln – gemeinsame Geometrie und Regeln (Server, TV, Handy, Bots).
 * Das Ferienhaus passt komplett auf einen Bildschirm (480 × 270).
 */

export const VS = {
  TICK_MS: 50,
  INTRO_MS: 6000,
  HIDE_MS: 25000,
  /** Suchzeit bei 2 bzw. 3 Runden (damit alles in ~5–6 Minuten passt) */
  SEEK_MS_2: 110000,
  SEEK_MS_3: 90000,
  REVEAL_MS: 7000,
  OVER_MS: 3500,
  SEEKER_SPEED: 72,
  HIDER_SPEED: 78,
  /** Verkleidet läuft man langsamer */
  PROP_SPEED: 44,
  /** Radius, in dem man Möbel kopieren kann */
  MORPH_R: 36,
  /** Reichweite von PRÜFEN (Abstand Blickpunkt → Möbel-Rechteck) */
  REACH: 12,
  CHECK_CD_MS: 450,
  /** Falsch geprüft: schwindelig – jedes weitere Mal in Folge länger */
  STUN_MS: 2000,
  STUN_STEP_MS: 700,
  STUN_MAX_MS: 5500,
  WHISTLE_CD_MS: 18000,
  /** In der letzten Minute: Zwangspfiff bei diesen Restzeiten */
  FORCED_AT_MS: [60000, 30000],
  /** Abstand, ab dem gleiche Möbel "nebeneinander" stehen */
  PAIR_R: 24,
  POINTS: { FIND: 5, SURVIVE: 3, PER_10S: 1, WHISTLE: 2 },
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Zone extends Rect {
  name: string;
  /** "im Wohnzimmer", "in der Küche" … */
  inName: string;
}

export const ZONES: Zone[] = [
  { name: 'Wohnzimmer', inName: 'im Wohnzimmer', x: 4, y: 22, w: 172, h: 120 },
  { name: 'Küche', inName: 'in der Küche', x: 4, y: 142, w: 172, h: 124 },
  { name: 'Schlafzimmer', inName: 'im Schlafzimmer', x: 176, y: 22, w: 128, h: 120 },
  { name: 'Terrasse', inName: 'auf der Terrasse', x: 176, y: 142, w: 128, h: 124 },
  { name: 'Garten', inName: 'im Garten', x: 304, y: 22, w: 172, h: 244 },
];

export const HOUSE: Rect = { x: 4, y: 22, w: 472, h: 244 };

/** Wände (mit Türlücken) */
export const WALLS: Rect[] = [
  // Rückwand drinnen + Hecke im Garten
  { x: 4, y: 22, w: 300, h: 12 },
  { x: 304, y: 22, w: 172, h: 8 },
  // Wohnzimmer | Küche (Tür 72–108)
  { x: 4, y: 139, w: 68, h: 6 },
  { x: 108, y: 139, w: 68, h: 6 },
  // Wohnzimmer | Schlafzimmer (Tür 70–104)
  { x: 173, y: 22, w: 6, h: 48 },
  { x: 173, y: 104, w: 6, h: 41 },
  // Schlafzimmer | Terrasse (Glastür 222–258)
  { x: 176, y: 139, w: 46, h: 6 },
  { x: 258, y: 139, w: 46, h: 6 },
  // Küche | Terrasse (Tür 186–220)
  { x: 173, y: 145, w: 6, h: 41 },
  { x: 173, y: 220, w: 6, h: 46 },
  // Schlafzimmer | Garten (Außenwand ohne Tür)
  { x: 301, y: 22, w: 6, h: 123 },
];

export const POOL: Rect = { x: 338, y: 152, w: 100, h: 58 };

export const BLOCKERS: Rect[] = [...WALLS, POOL];

/** Türen für die Bot-Navigation */
export const DOORS: { a: number; b: number; x: number; y: number }[] = [
  { a: 0, b: 1, x: 90, y: 142 },
  { a: 0, b: 2, x: 176, y: 87 },
  { a: 2, b: 3, x: 240, y: 142 },
  { a: 1, b: 3, x: 176, y: 203 },
  { a: 3, b: 4, x: 304, y: 200 },
];

/** Ecke, in der die Sucher während des Versteckens "Augen zu" machen */
export const SEEKER_CORNER: Rect = { x: 418, y: 34, w: 54, h: 50 };

// ------------------------------------------------------------------ Möbel

export type PropType =
  | 'plant' | 'crate' | 'lamp' | 'suitcase' | 'cooler' | 'pineapple'
  | 'deckchair' | 'umbrella' | 'flamingo' | 'gnome' | 'beachball';

export interface PropInfo {
  name: string;
  plural: string;
  /** Sprite-Größe in Welt-Pixeln (Ursprung unten mittig) */
  w: number;
  h: number;
  /** Räume, in denen das Ding normal aussieht */
  zones: number[];
  variants: number;
  /** Zwei davon direkt nebeneinander wirken verdächtig */
  single: boolean;
}

export const PROPS: Record<PropType, PropInfo> = {
  plant: { name: 'Topfpflanze', plural: 'Topfpflanzen', w: 12, h: 18, zones: [0, 1, 2, 3, 4], variants: 1, single: false },
  crate: { name: 'Kiste', plural: 'Kisten', w: 16, h: 16, zones: [0, 1, 2, 3, 4], variants: 1, single: false },
  lamp: { name: 'Stehlampe', plural: 'Stehlampen', w: 10, h: 26, zones: [0, 2], variants: 2, single: true },
  suitcase: { name: 'Koffer', plural: 'Koffer', w: 14, h: 16, zones: [0, 2], variants: 2, single: false },
  cooler: { name: 'Kühlbox', plural: 'Kühlboxen', w: 18, h: 14, zones: [1, 3, 4], variants: 2, single: true },
  pineapple: { name: 'Ananas', plural: 'Ananas', w: 10, h: 17, zones: [1, 3], variants: 1, single: true },
  deckchair: { name: 'Liegestuhl', plural: 'Liegestühle', w: 26, h: 20, zones: [3, 4], variants: 3, single: false },
  umbrella: { name: 'Sonnenschirm', plural: 'Sonnenschirme', w: 34, h: 40, zones: [3, 4], variants: 2, single: true },
  flamingo: { name: 'Flamingo-Ring', plural: 'Flamingo-Ringe', w: 22, h: 18, zones: [3, 4], variants: 1, single: true },
  gnome: { name: 'Gartenzwerg', plural: 'Gartenzwerge', w: 10, h: 16, zones: [4], variants: 2, single: true },
  beachball: { name: 'Wasserball', plural: 'Wasserbälle', w: 11, h: 11, zones: [0, 3, 4], variants: 1, single: true },
};

export const PROP_TYPES = Object.keys(PROPS) as PropType[];

/** Mögliche Stellplätze echter Möbel: [Typ, x, y (Füße), Variante, gespiegelt] */
export const PROP_SPOTS: [PropType, number, number, number, boolean][] = [
  // Wohnzimmer (Sofa bei 64/72, Teppich 96/112)
  ['plant', 14, 52, 0, false],
  ['lamp', 34, 68, 0, false],
  ['lamp', 158, 56, 1, true],
  ['plant', 112, 50, 0, true],
  ['suitcase', 140, 74, 0, false],
  ['crate', 20, 128, 0, false],
  ['beachball', 132, 124, 0, false],
  ['suitcase', 160, 126, 1, true],
  ['plant', 52, 130, 0, false],
  // Küche (Theke oben, Tisch Mitte)
  ['cooler', 24, 186, 0, false],
  ['pineapple', 30, 160, 0, false],
  ['plant', 160, 166, 0, true],
  ['crate', 150, 256, 0, false],
  ['cooler', 112, 254, 1, true],
  ['pineapple', 96, 212, 0, true],
  ['plant', 16, 256, 0, false],
  ['crate', 132, 182, 0, true],
  // Schlafzimmer (Betten oben links)
  ['lamp', 254, 54, 0, false],
  ['suitcase', 290, 70, 1, false],
  ['suitcase', 274, 70, 0, true],
  ['plant', 292, 128, 0, false],
  ['crate', 190, 128, 0, false],
  ['lamp', 194, 82, 1, false],
  // Terrasse
  ['deckchair', 202, 172, 1, false],
  ['umbrella', 236, 190, 0, false],
  ['cooler', 270, 170, 0, true],
  ['flamingo', 200, 256, 0, false],
  ['pineapple', 286, 256, 0, false],
  ['plant', 290, 206, 0, true],
  ['deckchair', 248, 240, 2, true],
  ['beachball', 222, 214, 0, false],
  // Garten (Pool 338–438 / 152–210, Baum oben links, Grill)
  ['gnome', 316, 56, 0, false],
  ['gnome', 404, 120, 1, true],
  ['deckchair', 352, 140, 0, false],
  ['deckchair', 380, 140, 2, false],
  ['umbrella', 416, 138, 1, false],
  ['flamingo', 456, 176, 0, true],
  ['cooler', 326, 230, 1, false],
  ['beachball', 448, 214, 0, false],
  ['gnome', 462, 258, 0, true],
  ['deckchair', 390, 252, 1, true],
  ['umbrella', 356, 256, 0, false],
  ['plant', 464, 100, 0, false],
  ['crate', 322, 104, 0, true],
  ['flamingo', 330, 188, 0, false],
];

// ------------------------------------------------------------------ Geometrie

export interface VsThing {
  t: PropType;
  x: number;
  y: number;
}

export const inRect = (x: number, y: number, r: Rect) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

export function zoneAt(x: number, y: number): number {
  const i = ZONES.findIndex((z) => inRect(x, y, z));
  return i < 0 ? 4 : i;
}

/** Kann eine Figur (Füße, Radius 3) hier stehen? */
export function canStand(x: number, y: number): boolean {
  const r = 3;
  if (x - r < HOUSE.x || x + r > HOUSE.x + HOUSE.w || y - r < HOUSE.y || y > HOUSE.y + HOUSE.h - 1) return false;
  return !BLOCKERS.some((b) => x + r > b.x && x - r < b.x + b.w && y + 1 > b.y && y - 2 < b.y + b.h);
}

/** Sprite-Rechteck eines Möbels */
export function propRect(o: VsThing): Rect {
  const p = PROPS[o.t];
  return { x: o.x - p.w / 2, y: o.y - p.h, w: p.w, h: p.h };
}

/** Standfläche (unterer Teil) – für "steht in etwas drin" */
export function baseRect(o: VsThing): Rect {
  const p = PROPS[o.t];
  const h = Math.min(p.h, 8);
  const w = o.t === 'umbrella' ? 8 : p.w;
  return { x: o.x - w / 2, y: o.y - h, w, h };
}

export function rectDist(px: number, py: number, r: Rect) {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

export const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Welches Möbel hat ein Sucher (Füße x/y, Blickrichtung dir) gerade vor sich? */
export function pickTarget<T extends VsThing>(objs: T[], x: number, y: number, dir: number): T | null {
  const fx = x + dir * 8;
  const fy = y - 5;
  let best: T | null = null;
  let bd: number = VS.REACH;
  for (const o of objs) {
    const d = rectDist(fx, fy, propRect(o)) + Math.abs(o.y - y) * 0.05;
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

export interface HideHint {
  text: string;
  level: 'ok' | 'warn' | 'bad';
}

/** Wie verdächtig sieht ein verkleideter Spieler gerade aus? */
export function judgeSpot(me: VsThing, others: VsThing[], moving: boolean, locked: boolean): HideHint {
  const info = PROPS[me.t];
  if (moving) return { text: 'Laufende Möbel? Sehr verdächtig!', level: 'bad' };
  const myBase = baseRect(me);
  for (const o of others) {
    if (overlap(myBase, baseRect(o)) > 6) return { text: `Du stehst halb in ${article(o.t)}!`, level: 'bad' };
  }
  if (info.single) {
    const twin = others.find((o) => o.t === me.t && Math.hypot(o.x - me.x, o.y - me.y) < VS.PAIR_R);
    if (twin) return { text: `Zwei ${info.plural} nebeneinander ist verdächtig!`, level: 'bad' };
  }
  const z = zoneAt(me.x, me.y);
  if (!info.zones.includes(z)) return { text: `${info.name} ${ZONES[z].inName}? Eher ungewöhnlich ...`, level: 'bad' };
  if (!locked) return { text: 'Gut! Jetzt EINRASTEN – sonst wackelst du.', level: 'warn' };
  return { text: 'Perfekt getarnt! Nicht bewegen.', level: 'ok' };
}

const ARTICLE: Record<PropType, string> = {
  plant: 'einer Topfpflanze', crate: 'einer Kiste', lamp: 'einer Lampe', suitcase: 'einem Koffer', cooler: 'einer Kühlbox',
  pineapple: 'einer Ananas', deckchair: 'einem Liegestuhl', umbrella: 'einem Sonnenschirm', flamingo: 'einem Flamingo',
  gnome: 'einem Gartenzwerg', beachball: 'einem Wasserball',
};
const article = (t: PropType) => ARTICLE[t];

const NOMINATIVE: Record<PropType, string> = {
  plant: 'eine Topfpflanze', crate: 'eine Kiste', lamp: 'eine Stehlampe', suitcase: 'ein Koffer', cooler: 'eine Kühlbox',
  pineapple: 'eine Ananas', deckchair: 'ein Liegestuhl', umbrella: 'ein Sonnenschirm', flamingo: 'ein Flamingo-Ring',
  gnome: 'ein Gartenzwerg', beachball: 'ein Wasserball',
};
/** "eine Kühlbox", "ein Koffer" … */
export const aProp = (t: PropType) => NOMINATIVE[t];

/** Nächster Wegpunkt auf dem Weg von a nach b (über die Türen) – für Bots */
export function nextWaypoint(x: number, y: number, tx: number, ty: number): { x: number; y: number } {
  const za = zoneAt(x, y);
  const zb = zoneAt(tx, ty);
  if (za === zb) return { x: tx, y: ty };
  // Breitensuche über die Räume
  const prev = new Map<number, number>([[za, -1]]);
  const queue = [za];
  while (queue.length) {
    const z = queue.shift()!;
    if (z === zb) break;
    for (const d of DOORS) {
      const n = d.a === z ? d.b : d.b === z ? d.a : -1;
      if (n >= 0 && !prev.has(n)) {
        prev.set(n, z);
        queue.push(n);
      }
    }
  }
  let step = zb;
  while (prev.get(step) !== za && prev.get(step) !== undefined && prev.get(step) !== -1) step = prev.get(step)!;
  const door = DOORS.find((d) => (d.a === za && d.b === step) || (d.b === za && d.a === step));
  if (!door) return { x: tx, y: ty };
  // Kurz vor der Tür ausrichten, dann durch
  const vertical = WALLS.some((w) => w.w === 6 && Math.abs(w.x + 3 - door.x) < 2);
  const near = Math.hypot(x - door.x, y - door.y) < 12;
  if (near) {
    const other = ZONES[step];
    return vertical ? { x: door.x + (other.x > door.x - 1 ? 14 : -14), y: door.y } : { x: door.x, y: door.y + (other.y >= door.y ? 14 : -14) };
  }
  const aligned = vertical ? Math.abs(y - door.y) < 8 : Math.abs(x - door.x) < 8;
  if (!aligned) {
    const here = ZONES[za];
    return vertical ? { x: door.x + (here.x < door.x - 1 ? -12 : 12), y: door.y } : { x: door.x, y: door.y + (here.y < door.y - 1 ? -12 : 12) };
  }
  return { x: door.x, y: door.y };
}
