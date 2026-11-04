/**
 * Smash-Arena: gemeinsame Konstanten, Bühnen-Geometrie und Angriffswerte.
 * Wird vom Server (Physik), vom TV (Darstellung) und vom Handy (Anzeige) benutzt.
 */

export const SMASH = {
  TICK_MS: 50,
  SUBSTEPS: 4,
  COUNTDOWN_MS: 3500,
  TIME_MS: 180_000,
  END_MS: 3200,

  GRAVITY: 1050,
  MAX_FALL: 390,
  FAST_FALL: 540,
  RUN: 135,
  AIR_SPEED: 120,
  GROUND_ACCEL: 1500,
  AIR_ACCEL: 750,
  JUMP_V: 410,
  AIR_JUMP_V: 360,
  AIR_JUMPS: 2,

  /** Hurtbox (Ursprung = Füße, Mitte) */
  W: 16,
  H: 36,
  /** Darstellungs-Skalierung der Pixel-Avatare (16 × 27 → 24 × 40) */
  SCALE: 1.5,

  /** Wer diese Grenzen überschreitet, verliert ein Leben */
  BLAST: { left: -70, right: 550, top: -80, bottom: 320 },

  /** Rückstoß: horizontales Abbremsen pro Sekunde (Faktor) und Schwerkraft-Faktor im Treffer-Taumel */
  KB_DECAY: 0.42,
  HITSTUN_GRAVITY: 0.45,
  HITSTUN_PER_KB: 1.05,

  RESPAWN_MS: 1700,
  INVINCIBLE_MS: 2200,

  SHIELD_MAX: 100,
  SHIELD_DRAIN: 24,
  SHIELD_REGEN: 15,
  SHIELD_BREAK_MS: 2200,

  ITEM_MIN_MS: 7000,
  ITEM_MAX_MS: 13000,
  ITEM_MAX: 2,
  ITEM_LIFE_MS: 16000,
  ANANAS_HEAL: 30,

  /** Ab so vielen Spielern nur 2 statt 3 Leben */
  FEW_STOCKS_FROM: 6,
};

// ------------------------------------------------------------------ Bühnen

export type PlatformKind = 'deck' | 'plank' | 'surf' | 'pooldeck' | 'board' | 'flamingo';

export interface SmashPlatform {
  x: number;
  y: number;
  w: number;
  /** Dicke (nur bei festen Plattformen relevant) */
  h: number;
  /** fest = man kann nicht durchfallen; sonst von unten durchspringbar + mit "runter" durchfallen */
  solid: boolean;
  kind: PlatformKind;
  /** Bewegung: x schwingt mit 2 × period, y mit period */
  move?: { ax: number; ay: number; period: number };
}

export interface SmashStage {
  id: 'beach' | 'pool';
  name: string;
  platforms: SmashPlatform[];
}

export const SMASH_STAGES: SmashStage[] = [
  {
    id: 'beach',
    name: 'Strandbar',
    platforms: [
      { x: 100, y: 196, w: 280, h: 30, solid: true, kind: 'deck' },
      { x: 118, y: 146, w: 72, h: 6, solid: false, kind: 'plank' },
      { x: 290, y: 146, w: 72, h: 6, solid: false, kind: 'plank' },
      { x: 208, y: 98, w: 64, h: 6, solid: false, kind: 'surf', move: { ax: 78, ay: 3, period: 3600 } },
    ],
  },
  {
    id: 'pool',
    name: 'Pool-Party',
    platforms: [
      { x: 92, y: 198, w: 296, h: 28, solid: true, kind: 'pooldeck' },
      { x: 62, y: 150, w: 66, h: 5, solid: false, kind: 'board' },
      { x: 352, y: 150, w: 66, h: 5, solid: false, kind: 'board' },
      { x: 206, y: 108, w: 68, h: 6, solid: false, kind: 'flamingo', move: { ax: 14, ay: 10, period: 2600 } },
    ],
  },
];

/** Aktuelle Position einer (evtl. beweglichen) Plattform zum Zeitpunkt t (ms seit Kampfbeginn) */
export function platformPos(p: SmashPlatform, t: number): { x: number; y: number } {
  if (!p.move) return { x: p.x, y: p.y };
  const a = (t / p.move.period) * Math.PI * 2;
  return { x: p.x + Math.sin(a / 2) * p.move.ax, y: p.y + Math.sin(a) * p.move.ay };
}

/** Die Hauptplattform (für Bots, Spawn, Items) */
export const mainPlatform = (st: SmashStage) => st.platforms.find((p) => p.solid)!;

// ------------------------------------------------------------------ Angriffe

export type AttackId = 'jab' | 'side' | 'up' | 'down' | 'nair' | 'dair';

export interface HitData {
  dmg: number;
  /** Grad, 0 = waagerecht nach vorn, 90 = nach oben, negativ = nach unten */
  angle: number;
  base: number;
  scale: number;
  /** Fester Rückstoß ohne %-Skalierung */
  fixed?: boolean;
  /** Betäubt statt wegzuschleudern (ms) */
  stun?: number;
}

export interface AttackDef extends HitData {
  startup: number;
  active: number;
  end: number;
  /** Hitbox relativ zu den Füßen, für Blick nach rechts */
  box: { x: number; y: number; w: number; h: number };
}

export const ATTACKS: Record<AttackId, AttackDef> = {
  jab: { startup: 50, active: 100, end: 110, dmg: 4, angle: 32, base: 95, scale: 1.3, box: { x: 6, y: -26, w: 20, h: 13 } },
  side: { startup: 110, active: 100, end: 230, dmg: 9, angle: 38, base: 160, scale: 3.1, box: { x: 6, y: -27, w: 26, h: 15 } },
  up: { startup: 80, active: 130, end: 200, dmg: 8, angle: 86, base: 150, scale: 2.9, box: { x: -14, y: -52, w: 28, h: 20 } },
  down: { startup: 80, active: 100, end: 210, dmg: 7, angle: 22, base: 125, scale: 2.1, box: { x: -24, y: -10, w: 48, h: 11 } },
  nair: { startup: 50, active: 160, end: 120, dmg: 7, angle: 45, base: 120, scale: 1.9, box: { x: -15, y: -34, w: 30, h: 30 } },
  dair: { startup: 100, active: 130, end: 200, dmg: 10, angle: -78, base: 115, scale: 1.8, box: { x: -11, y: -8, w: 22, h: 15 } },
};

// ------------------------------------------------------------------ Spezialmoves (Urlaubs-Items)

export type SpecialId = 'flipflop' | 'schirm' | 'cocktail' | 'matratze' | 'wasser';

export const SPECIALS: Record<SpecialId, { name: string; text: string; cooldown: number }> = {
  flipflop: { name: 'Flip-Flop-Wurf', text: 'Wirft einen Flip-Flop geradeaus.', cooldown: 1300 },
  schirm: { name: 'Sonnenschirm-Rückstoß', text: 'Schießt dich nach oben und du segelst langsam runter – perfekt zum Zurückkommen!', cooldown: 1600 },
  cocktail: { name: 'Cocktail-Spritzer', text: 'Kurzer Spritzer nach vorn – wer getroffen wird, ist kurz benommen.', cooldown: 2600 },
  matratze: { name: 'Luftmatratzen-Klatscher', text: 'Hüpfer hoch, dann Bauchklatscher – Druckwelle bei der Landung!', cooldown: 2800 },
  wasser: { name: 'Wasserpistole', text: 'Langer Wasserstrahl – schubst Gegner weg, ideal am Rand.', cooldown: 2000 },
};

export const SPECIAL_IDS = Object.keys(SPECIALS) as SpecialId[];

export const SPECIAL_HITS = {
  flipflop: { dmg: 7, angle: 35, base: 90, scale: 1.3 } as HitData,
  schirm: { dmg: 6, angle: 82, base: 120, scale: 1.4 } as HitData,
  cocktail: { dmg: 3, angle: 20, base: 60, scale: 0, fixed: true, stun: 1000 } as HitData,
  matratzeSlam: { dmg: 7, angle: -70, base: 100, scale: 1.2 } as HitData,
  matratzeWave: { dmg: 11, angle: 50, base: 160, scale: 2.3 } as HitData,
  wasser: { dmg: 2, angle: 12, base: 250, scale: 0.4 } as HitData,
};

// ------------------------------------------------------------------ Items

export type ItemKind = 'kokos' | 'bombe' | 'ananas';

export const ITEM_INFO: Record<ItemKind, { name: string; weight: number }> = {
  kokos: { name: 'Kokosnuss', weight: 4 },
  bombe: { name: 'Wasserbombe', weight: 3 },
  ananas: { name: 'Erste-Hilfe-Ananas', weight: 2 },
};

export const ITEM_HITS = {
  kokos: { dmg: 12, angle: 40, base: 150, scale: 2.0 } as HitData,
  bombe: { dmg: 12, angle: 55, base: 170, scale: 2.3 } as HitData,
};

export const BOMB_RADIUS = 34;

/** Rückstoß-Stärke nach dem Treffer (Prozent nach Schaden) */
export function knockback(h: HitData, pctAfter: number) {
  return h.fixed ? h.base : h.base + h.scale * pctAfter;
}

/** Farbe der Prozentanzeige: weiß → gelb → rot → dunkelrot */
export function pctColor(pct: number): string {
  if (pct < 35) return '#fff4d6';
  if (pct < 70) return '#ffd25e';
  if (pct < 110) return '#f0973a';
  if (pct < 150) return '#e04a3f';
  return '#b52a2a';
}
