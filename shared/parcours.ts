/**
 * Fallen-Parcours: gemeinsame Geometrie, Teile-Definitionen und Kollisions-Helfer.
 * Wird vom Server (Physik), von den Bots und vom TV (Zeichnen) benutzt.
 */

export type PartType = 'platform' | 'plank' | 'spring' | 'urchin' | 'cannon' | 'fan' | 'ice' | 'bomb' | 'mover';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ParcoursPart {
  id: number;
  type: PartType;
  /** Mittelpunkt (gerastert) */
  x: number;
  y: number;
  /** 0–3 in 90°-Schritten (0 = rechts bzw. waagerecht) */
  rot: number;
  owner: string;
}

export const PARCOURS = {
  ROUNDS: 6,
  TARGET: 15,
  INTRO_MS: 4000,
  COUNTDOWN_MS: 2500,
  SCORE_MS: 5500,
  /** Bauen und Laufen haben KEIN Zeitlimit. Nur wer so lange gar nichts eingibt (AFK), wird übersprungen
   *  bzw. scheidet aus – ab AFK_WARN_MS Restzeit sieht er am Handy (und am TV) einen Hinweis. */
  AFK_MS: 60000,
  AFK_WARN_MS: 20000,
  /** Testspieler können sich festlaufen – damit eine reine Bot-Runde nicht ewig hängt */
  BOT_BUILD_MS: 20000,
  BOT_RUN_MS: 30000,
  /** Punkte */
  GOAL_PTS: 4,
  FIRST_PTS: 2,
  TRAP_PTS: 1,
  TRAP_MAX: 2,
  /** Physik (Pixel, Sekunden) */
  GRAVITY: 780,
  RUN: 100,
  GROUND_ACC: 900,
  AIR_ACC: 520,
  ICE_ACC: 120,
  JUMP_V: 300,
  JUMP_CUT: 0.45,
  SPRING_V: 410,
  MAX_FALL: 330,
  WALL_SLIDE: 55,
  WIND_ACC: 1150,
  COYOTE_MS: 100,
  BUFFER_MS: 130,
  /** Spieler-Hitbox (Ursprung = Füße, Mitte) */
  PW: 8,
  PH: 13,
  /** Kokosnüsse */
  NUT_SPEED: 120,
  NUT_R: 3,
  NUT_EVERY_MS: 2400,
  /** Schwebeplattform */
  MOVER_RANGE: 30,
  MOVER_PERIOD_MS: 3200,
  /** Platzieren */
  GHOST_SPEED: 150,
  GRID: 4,
  BOMB_R: 24,
  /** Spielerfarben (bis 12) */
  COLORS: [0xe0503f, 0x3f8fe0, 0x46b04a, 0xf2c33a, 0x9b5fc0, 0xf0973a, 0x2fb5a5, 0xf07aa8, 0x8d5629, 0xfdf7ea, 0x5a6f8a, 0xb7d94a],
  MAX_RUNNERS: 12,
};

/** Spielfläche (unterhalb der HUD-Leiste) */
export const COURSE = { x: 0, y: 26, w: 480, h: 244 };
/** Ab hier ist Wasser (tödlich) */
export const WATER_Y = 250;

/** Feste Grundstrecke: Strand (Start) → Felsen → Steg mit Cocktailbar (Ziel) */
export const BASE_SOLIDS: Rect[] = [
  { x: 0, y: 200, w: 76, h: 70 }, // Strand mit Handtuch
  { x: 116, y: 214, w: 40, h: 56 }, // Felsen 1
  { x: 200, y: 198, w: 32, h: 72 }, // Felsen 2
  { x: 290, y: 210, w: 32, h: 60 }, // Felsen 3
  { x: 380, y: 196, w: 100, h: 74 }, // Steg / Bar
];

/** Zielbereich (Flagge an der Cocktailbar) */
export const GOAL: Rect = { x: 440, y: 120, w: 40, h: 76 };
/** Hier darf nichts hingebaut werden */
export const NO_BUILD: Rect[] = [
  { x: 0, y: 150, w: 80, h: 50 },
  { x: 384, y: 110, w: 96, h: 86 },
];

/** Startplätze auf dem Strand (x 0–76): bis 12 Läufer nebeneinander, 5 px Abstand */
export const spawnX = (i: number) => 10 + (i % 12) * 5;
export const SPAWN_Y = 200;

export interface PartDef {
  name: string;
  desc: string;
  w: number;
  h: number;
  /** Anzahl Drehstufen (1 = nicht drehbar) */
  rots: 1 | 2 | 4;
  kind: 'solid' | 'oneway' | 'hazard' | 'bomb';
}

export const PART_DEFS: Record<PartType, PartDef> = {
  platform: { name: 'Plattform', desc: 'Fester Holzblock', w: 32, h: 8, rots: 2, kind: 'solid' },
  plank: { name: 'Planke', desc: 'Von unten durchspringbar', w: 48, h: 4, rots: 1, kind: 'oneway' },
  spring: { name: 'Trampolin', desc: 'Schleudert hoch hinaus', w: 16, h: 8, rots: 1, kind: 'solid' },
  urchin: { name: 'Seeigel', desc: 'Stachelig – Berührung = raus', w: 12, h: 10, rots: 1, kind: 'hazard' },
  cannon: { name: 'Kokosnuss-Kanone', desc: 'Schießt regelmäßig Kokosnüsse', w: 16, h: 12, rots: 4, kind: 'solid' },
  fan: { name: 'Ventilator', desc: 'Pustet alle weg', w: 14, h: 14, rots: 4, kind: 'solid' },
  ice: { name: 'Eisfläche', desc: 'Rutschig wie ein Eis am Stiel', w: 40, h: 8, rots: 1, kind: 'solid' },
  bomb: { name: 'Bombe', desc: 'Sprengt ein Teil weg', w: 16, h: 16, rots: 1, kind: 'bomb' },
  mover: { name: 'Schwebeplattform', desc: 'Fährt hin und her', w: 32, h: 6, rots: 2, kind: 'solid' },
};

export const PART_TYPES = Object.keys(PART_DEFS) as PartType[];

/** Richtungsvektor für Drehstufe (0 = rechts, 1 = unten, 2 = links, 3 = oben) */
export const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

export function partSize(type: PartType, rot: number): { w: number; h: number } {
  const d = PART_DEFS[type];
  // Plattform: Drehung 1 = senkrechte Wand. Schwebeplattform bleibt waagerecht (Drehung = Fahrtrichtung).
  if ((type === 'platform' || type === 'cannon' || type === 'fan') && rot % 2 === 1) return { w: d.h, h: d.w };
  return { w: d.w, h: d.h };
}

/** Versatz der Schwebeplattform zum Zeitpunkt t (ms seit Laufbeginn) */
export function moverOffset(p: Pick<ParcoursPart, 'rot' | 'id'>, t: number): { dx: number; dy: number } {
  const ph = (t / PARCOURS.MOVER_PERIOD_MS + p.id * 0.17) * Math.PI * 2;
  const o = Math.sin(ph) * PARCOURS.MOVER_RANGE;
  return p.rot % 2 === 0 ? { dx: o, dy: 0 } : { dx: 0, dy: o };
}

/** Kollisionsbox eines Teils (t = Laufzeit für Schwebeplattformen) */
export function partRect(p: ParcoursPart, t = 0): Rect {
  const { w, h } = partSize(p.type, p.rot);
  let x = p.x - w / 2;
  let y = p.y - h / 2;
  if (p.type === 'mover') {
    const o = moverOffset(p, t);
    x += o.dx;
    y += o.dy;
  }
  return { x, y, w, h };
}

/** Bereich, den eine Schwebeplattform insgesamt überstreicht (fürs Platzieren) */
export function partFootprint(p: ParcoursPart): Rect {
  const r = partRect(p, 0);
  if (p.type !== 'mover') return r;
  const R = PARCOURS.MOVER_RANGE;
  return p.rot % 2 === 0 ? { x: r.x - R, y: r.y, w: r.w + 2 * R, h: r.h } : { x: r.x, y: r.y - R, w: r.w, h: r.h + 2 * R };
}

/** Windzone eines Ventilators */
export function fanZone(p: ParcoursPart): Rect {
  const r = partRect(p);
  const L = 70;
  switch (p.rot % 4) {
    case 0:
      return { x: r.x + r.w, y: r.y - 3, w: L, h: r.h + 6 };
    case 1:
      return { x: r.x - 3, y: r.y + r.h, w: r.w + 6, h: L };
    case 2:
      return { x: r.x - L, y: r.y - 3, w: L, h: r.h + 6 };
    default:
      return { x: r.x - 3, y: r.y - L, w: r.w + 6, h: L };
  }
}

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const runnerRect = (x: number, y: number): Rect => ({ x: x - PARCOURS.PW / 2, y: y - PARCOURS.PH, w: PARCOURS.PW, h: PARCOURS.PH });

/** Darf hier gebaut werden? */
export function canPlace(type: PartType, x: number, y: number, rot: number, parts: ParcoursPart[]): boolean {
  if (type === 'bomb') return y > COURSE.y && y < WATER_Y && x > 0 && x < COURSE.w;
  const probe: ParcoursPart = { id: 0, type, x, y, rot, owner: '' };
  const r = partFootprint(probe);
  if (r.x < 0 || r.x + r.w > COURSE.w || r.y < COURSE.y + 4 || r.y + r.h > WATER_Y) return false;
  if (BASE_SOLIDS.some((b) => overlaps(r, b))) return false;
  if (NO_BUILD.some((b) => overlaps(r, b))) return false;
  return !parts.some((p) => overlaps(r, partFootprint(p)));
}

/** Startposition der Bau-Geister */
export function ghostStart(i: number): { x: number; y: number } {
  return { x: 120 + (i % 4) * 72, y: 70 + Math.floor(i / 4) * 40 };
}

export const snap = (v: number) => Math.round(v / PARCOURS.GRID) * PARCOURS.GRID;
