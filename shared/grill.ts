/**
 * Grill-Chaos (à la Overcooked): Konstanten, Küchen-Layouts, Rezepte, Kombinier-Regeln und Zustandstypen.
 * Wird von Server (Spiellogik), TV (Zeichnen), Handy (Anzeige "Du trägst") und Bots (Wegfindung) benutzt.
 */
import type { Team } from './types';

export const GRILL = {
  TIME_MS: 180000,
  COUNTDOWN_MS: 4000,
  /** Kachelgröße der Küche in Welt-Pixeln */
  TILE: 18,
  /** Oberkante der Küche (darüber: HUD + Bestellzettel) */
  KY: 98,
  PLAYER_R: 5,
  SPEED: 76,
  /** Wie weit man von der Figur aus an eine Station herankommt */
  REACH: 15,
  CHOP_MS: 1500,
  COOK_MS: 5000,
  /** So lange nach dem Garwerden, bis es anbrennt (und Feuer fängt) */
  BURN_MS: 8000,
  /** Feuerlöscher halten, bis das Feuer aus ist */
  EXT_MS: 1000,
  /** AKTION gilt als losgelassen, wenn das Handy so lange nichts schickt */
  ACT_LATCH_MS: 900,
  TIP_MAX: 12,
  EXPIRE_PENALTY: 10,
  /** Neue Bestellung (Abstand in ms) – wird mit der Spielerzahl schneller */
  ORDER_EVERY_MS: 17000,
  /** Am Anfang nur einfache Rezepte */
  EASY_MS: 30000,
};

// ------------------------------------------------------------------ Zutaten & Rezepte

export type GrillIng = 'paprika' | 'zucchini' | 'mais' | 'tofu' | 'broetchen' | 'zitrone' | 'minze' | 'eis';
export type GrillStep = 'raw' | 'chop' | 'grill' | 'burnt';
export type GrillBase = 'plate' | 'glass';

export const GRILL_INGS: Record<GrillIng, { name: string; path: GrillStep[] }> = {
  paprika: { name: 'Paprika', path: ['raw', 'chop', 'grill'] },
  zucchini: { name: 'Zucchini', path: ['raw', 'chop', 'grill'] },
  mais: { name: 'Maiskolben', path: ['raw', 'grill'] },
  tofu: { name: 'Tofu-Wurst', path: ['raw', 'grill'] },
  broetchen: { name: 'Brötchen', path: ['raw'] },
  zitrone: { name: 'Zitrone', path: ['raw', 'chop'] },
  minze: { name: 'Minze', path: ['raw', 'chop'] },
  eis: { name: 'Eiswürfel', path: ['raw'] },
};

/** Buchstabe im Layout → Vorratskiste */
export const GRILL_CRATES: Record<string, GrillIng> = {
  p: 'paprika',
  z: 'zucchini',
  m: 'mais',
  t: 'tofu',
  b: 'broetchen',
  l: 'zitrone',
  n: 'minze',
  e: 'eis',
};

export type GrillRecipeId = 'mais' | 'limo' | 'hotdog' | 'spiess' | 'mojito';

export const GRILL_RECIPES: Record<GrillRecipeId, { name: string; base: GrillBase; parts: GrillIng[]; points: number; ms: number; easy: boolean }> = {
  mais: { name: 'Maiskolben', base: 'plate', parts: ['mais'], points: 20, ms: 55000, easy: true },
  limo: { name: 'Zitronen-Limo', base: 'glass', parts: ['zitrone', 'eis'], points: 20, ms: 55000, easy: true },
  hotdog: { name: 'Tofu-Hotdog', base: 'plate', parts: ['broetchen', 'tofu'], points: 30, ms: 70000, easy: false },
  spiess: { name: 'Gemüsespieß', base: 'plate', parts: ['paprika', 'zucchini'], points: 40, ms: 85000, easy: false },
  mojito: { name: 'Virgin Mojito', base: 'glass', parts: ['minze', 'zitrone', 'eis'], points: 35, ms: 75000, easy: false },
};
export const GRILL_RECIPE_IDS = Object.keys(GRILL_RECIPES) as GrillRecipeId[];

// ------------------------------------------------------------------ Gegenstände

export interface GrillPart {
  t: GrillIng;
  s: GrillStep;
}

/** Ein Gegenstand: Zutat(en), Teller/Glas mit Inhalt oder der Feuerlöscher */
export interface GrillItem {
  /** Teller/Glas (null = lose Zutat bzw. Spieß) */
  b: GrillBase | null;
  p: GrillPart[];
  /** Fortschritt zum nächsten Schritt (Schneiden bzw. Grillen), 0–1 */
  g: number;
  /** Anbrenn-Fortschritt auf dem Grill, 0–1 */
  u: number;
  /** Feuerlöscher */
  x?: 1;
}

export const newIng = (t: GrillIng): GrillItem => ({ b: null, p: [{ t, s: 'raw' }], g: 0, u: 0 });
export const newBase = (b: GrillBase): GrillItem => ({ b, p: [], g: 0, u: 0 });
export const newExt = (): GrillItem => ({ b: null, p: [], g: 0, u: 0, x: 1 });

export function nextStep(part: GrillPart): GrillStep | null {
  if (part.s === 'burnt') return null;
  const path = GRILL_INGS[part.t].path;
  const i = path.indexOf(part.s);
  return i >= 0 && i < path.length - 1 ? path[i + 1] : null;
}

export const isDone = (part: GrillPart) => part.s !== 'burnt' && nextStep(part) === null;

/** Ist `small` (als Multimenge) in `big` enthalten? */
function subBag(small: GrillIng[], big: GrillIng[]) {
  const left = [...big];
  for (const t of small) {
    const i = left.indexOf(t);
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

/** Kann diese Kombination noch zu einem Rezept werden? */
export function validCombo(base: GrillBase | null, parts: GrillPart[]): boolean {
  if (!parts.length) return true;
  if (parts.some((p) => p.s === 'burnt')) return parts.length === 1 && !base;
  const types = parts.map((p) => p.t);
  if (base) {
    if (!parts.every(isDone)) return false;
    return GRILL_RECIPE_IDS.some((r) => GRILL_RECIPES[r].base === base && subBag(types, GRILL_RECIPES[r].parts));
  }
  if (parts.length === 1) return true;
  // Lose Mehrfach-Zutat = Spieß: alles im selben Zustand und als Nächstes auf den Grill
  const s = parts[0].s;
  if (!parts.every((p) => p.s === s && nextStep(p) === 'grill')) return false;
  return GRILL_RECIPE_IDS.some((r) => subBag(types, GRILL_RECIPES[r].parts));
}

/** Zwei Gegenstände kombinieren (null = passt nicht zusammen) */
export function mergeItems(a: GrillItem, b: GrillItem): GrillItem | null {
  if (a.x || b.x) return null;
  if (a.b && b.b) return null;
  const base = a.b ?? b.b;
  const parts = [...a.p, ...b.p];
  if (!parts.length) return null;
  if (!validCombo(base, parts)) return null;
  parts.sort((x, y) => x.t.localeCompare(y.t));
  return { b: base, p: parts, g: 0, u: 0 };
}

/** Fertiges Gericht → Rezept */
export function matchRecipe(item: GrillItem | null): GrillRecipeId | null {
  if (!item || !item.b || item.x || !item.p.length || !item.p.every(isDone)) return null;
  const types = item.p.map((p) => p.t);
  return (
    GRILL_RECIPE_IDS.find((r) => {
      const R = GRILL_RECIPES[r];
      return R.base === item.b && R.parts.length === types.length && subBag(types, R.parts);
    }) ?? null
  );
}

export const canChop = (i: GrillItem) => !i.x && !i.b && i.p.length === 1 && nextStep(i.p[0]) === 'chop';
/** Darf auf den Grill: lose Zutat(en), die gegrillt werden (oder schon gegrillt sind) */
export const canGrill = (i: GrillItem) => !i.x && !i.b && i.p.length > 0 && (i.p.every((p) => nextStep(p) === 'grill') || i.p.every((p) => p.s === 'grill'));
export const isBurnt = (i: GrillItem | null) => !!i?.p.some((p) => p.s === 'burnt');

/** Kurzer Tipp fürs Handy: was mache ich mit dem, was ich trage? */
export function grillHint(i: GrillItem | null): string {
  if (!i) return 'Hol Zutaten aus den Kisten – oder Teller/Gläser vom Stapel!';
  if (i.x) return 'Feuerlöscher: an den brennenden Grill und AKTION halten!';
  if (isBurnt(i)) return 'Verbrannt! Ab in den Mülleimer.';
  if (i.b) {
    const r = matchRecipe(i);
    if (r) return `${GRILL_RECIPES[r].name} fertig – ab zur Ausgabe!`;
    return i.p.length ? 'Noch was drauf? Fertige Zutaten auf den Teller/ins Glas.' : `Leeres ${i.b === 'plate' ? 'Teller' : 'Glas'} – fertige Zutaten draufpacken.`;
  }
  const n = nextStep(i.p[0]);
  if (n === 'chop') return 'Zum Schneidebrett – ablegen und AKTION halten!';
  if (n === 'grill') return i.p.length > 1 ? 'Spieß fertig – ab auf den Grill!' : 'Ab auf den Grill! (Paprika + Zucchini = Spieß)';
  return 'Fertig! Auf einen Teller oder ins Glas damit.';
}

export function itemLabel(i: GrillItem | null): string {
  if (!i) return 'nichts';
  if (i.x) return 'Feuerlöscher';
  const step = (p: GrillPart) => (p.s === 'burnt' ? 'verbrannt' : p.s === 'chop' ? 'geschnitten' : p.s === 'grill' ? 'gegrillt' : '');
  const parts = i.p.map((p) => `${GRILL_INGS[p.t].name}${step(p) ? ` (${step(p)})` : ''}`).join(' + ');
  if (i.b) {
    const r = matchRecipe(i);
    if (r) return GRILL_RECIPES[r].name;
    return `${i.b === 'plate' ? 'Teller' : 'Glas'}${parts ? `: ${parts}` : ' (leer)'}`;
  }
  return i.p.length > 1 ? `Spieß: ${parts}` : parts;
}

// ------------------------------------------------------------------ Küchen

/**
 * Layouts (Draufsicht, eine Zeile = eine Kachelreihe):
 * . Boden · # Ablage · F Ablage mit Feuerlöscher · K Schneidebrett · G Grill · P Teller · W Gläser · S Ausgabe · X Mülleimer
 * Kleinbuchstaben = Vorratskisten (siehe GRILL_CRATES)
 */
export const GRILL_LAYOUTS = {
  small: [
    '#pzmtblne#GG#',
    'K...........F',
    'K...........#',
    '#...........#',
    '#....###....#',
    '#...........#',
    '#...........#',
    '#...........#',
    '#PW##SS##X###',
  ],
  wide: [
    '#pzmtbl#GG##F###GG#blnez##',
    'K........................K',
    'K........................K',
    '#........................#',
    '#.......####....####.....#',
    '#........................#',
    '#........................#',
    '#........................#',
    '#PP#####X##SSSS##X#####WW#',
  ],
};
export type GrillLayoutId = keyof typeof GRILL_LAYOUTS;

for (const [id, rows] of Object.entries(GRILL_LAYOUTS)) {
  if (rows.some((r) => r.length !== rows[0].length)) throw new Error(`Grill-Layout ${id}: ungleich lange Zeilen`);
}

export function grillGrid(layout: GrillLayoutId, mirror: boolean): string[] {
  const rows = GRILL_LAYOUTS[layout];
  return mirror ? rows.map((r) => [...r].reverse().join('')) : rows;
}

export interface GrillGeo {
  x0: number;
  y0: number;
  grid: string[];
}

export const geoCols = (k: GrillGeo) => k.grid[0].length;
export const geoRows = (k: GrillGeo) => k.grid.length;
export const tileCh = (k: GrillGeo, c: number, r: number) => k.grid[r]?.[c] ?? '#';
export const isFloorCh = (ch: string) => ch === '.';
export const tileOfPos = (k: { x0: number; y0: number }, x: number, y: number) => ({ c: Math.floor((x - k.x0) / GRILL.TILE), r: Math.floor((y - k.y0) / GRILL.TILE) });
export const tileCenter = (k: { x0: number; y0: number }, c: number, r: number) => ({ x: k.x0 + (c + 0.5) * GRILL.TILE, y: k.y0 + (r + 0.5) * GRILL.TILE });

export type GrillStation = 'counter' | 'board' | 'grill' | 'plates' | 'glasses' | 'serve' | 'trash' | 'crate';
export function stationOf(ch: string): GrillStation | null {
  if (ch === '.') return null;
  if (ch === '#' || ch === 'F') return 'counter';
  if (ch === 'K') return 'board';
  if (ch === 'G') return 'grill';
  if (ch === 'P') return 'plates';
  if (ch === 'W') return 'glasses';
  if (ch === 'S') return 'serve';
  if (ch === 'X') return 'trash';
  if (GRILL_CRATES[ch]) return 'crate';
  return 'counter';
}

/** Kürzester Weg über den Boden (Breitensuche); liefert die nächste Kachel oder null */
export function grillNextTile(k: GrillGeo, from: { c: number; r: number }, goals: { c: number; r: number }[], blocked?: Set<string>): { c: number; r: number } | null {
  const cols = geoCols(k);
  const rows = geoRows(k);
  const key = (c: number, r: number) => r * cols + c;
  const goalSet = new Set(goals.map((g) => key(g.c, g.r)));
  if (goalSet.has(key(from.c, from.r))) return from;
  const prev = new Map<number, number>();
  const start = key(from.c, from.r);
  prev.set(start, -1);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    const c = cur % cols;
    const r = Math.floor(cur / cols);
    if (goalSet.has(cur)) {
      let n = cur;
      while (prev.get(n) !== start && prev.get(n) !== -1) n = prev.get(n)!;
      return { c: n % cols, r: Math.floor(n / cols) };
    }
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const nk = key(nc, nr);
      if (prev.has(nk) || !isFloorCh(tileCh(k, nc, nr))) continue;
      if (blocked?.has(`${nc},${nr}`) && !goalSet.has(nk)) continue;
      prev.set(nk, cur);
      queue.push(nk);
    }
  }
  return null;
}

/** Sterne-Grenzen im gemeinsamen Modus (hängt von der Spielerzahl ab) */
export function grillStarGoals(players: number): [number, number, number] {
  const f = Math.min(1.6, 0.55 + 0.18 * players);
  return [Math.round((90 * f) / 10) * 10, Math.round((220 * f) / 10) * 10, Math.round((380 * f) / 10) * 10];
}

// ------------------------------------------------------------------ Zustand (kompakt)

export interface GrillOrder {
  id: number;
  r: GrillRecipeId;
  /** Restzeit / Gesamtzeit in ms */
  left: number;
  dur: number;
}

export interface GrillSlot {
  c: number;
  r: number;
  i: GrillItem | null;
  /** brennt */
  f?: 1;
  /** Lösch-Fortschritt 0–1 */
  e?: number;
}

export interface GrillKitchen {
  team: Team | null;
  layout: GrillLayoutId;
  mirror: boolean;
  x0: number;
  y0: number;
  orders: GrillOrder[];
  score: number;
  served: number;
  expired: number;
  /** nur belegte bzw. brennende Stationen */
  slots: GrillSlot[];
}

export interface GrillPlayer {
  x: number;
  y: number;
  /** Küche (Index) */
  k: number;
  /** Blickrichtung */
  fx: number;
  fy: number;
  m: boolean;
  /** Trägt */
  h: GrillItem | null;
  /** arbeitet gerade (schneidet/löscht) */
  w: boolean;
  /** Ziel-Station (Spalte/Zeile, −1 = keine) */
  tc: number;
  tr: number;
  c: number;
  /** Zähler: "geht nicht" (für ein rotes X über dem Kopf) */
  no: number;
  sv: number;
  ch: number;
  gr: number;
  rs: number;
}

export interface GrillEvent {
  seq: number;
  k: number;
  kind: 'serve' | 'expire' | 'fire' | 'out' | 'trash';
  x: number;
  y: number;
  pts?: number;
  tip?: number;
  r?: GrillRecipeId;
}

export interface GrillState {
  sub: 'countdown' | 'play' | 'over';
  endsIn: number;
  teams: boolean;
  kitchens: GrillKitchen[];
  players: Record<string, GrillPlayer>;
  /** Sterne-Grenzen (gemeinsamer Modus) */
  goals: [number, number, number];
  /** Ergebnis (nur bei "over") */
  stars: number;
  winner: Team | null;
  events: GrillEvent[];
}
