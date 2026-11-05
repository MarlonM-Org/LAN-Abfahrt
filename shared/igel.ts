/**
 * Igel-Krieg: gemeinsame Konstanten, Insel-Generator und Physik-Helfer.
 * Server (autoritativ), TV (eigene Terrain-Kopie) und Bots (Zielsimulation)
 * benutzen denselben Code – das Terrain wird nur als Seed + Kraterliste übertragen.
 */
import type { IgelWeapon } from './types';

export const IGEL = {
  W: 480,
  H: 270,
  /** Anfangs-Wasserspiegel (y) */
  WATER_Y: 248,
  /** Zugzeit bis 4 Spieler – darüber siehe `igelTurnMs()` */
  TURN_MS: 45000, // großzügiger (vorher 30 s), VIP kann im Menü überspringen
  /** Zugzeit, wenn der Spieler gerade offline ist (kurze Trennung, App gewechselt) */
  OFFLINE_TURN_MS: 5000,
  RETREAT_MS: 3000,
  COUNTDOWN_MS: 3500,
  SETTLE_MIN_MS: 700,
  /** Danach: Sudden Death (Wasser steigt nach jeder vollen Runde) – ab 7 Spielern `SUDDEN_MS_BIG` */
  SUDDEN_MS: 6 * 60_000,
  SUDDEN_MS_BIG: 3 * 60_000,
  /** Absolute Obergrenze, falls sich niemand trifft */
  HARD_CAP_MS: 10 * 60_000,
  WATER_RISE: 20,
  GRAVITY: 260,
  /** Windbeschleunigung bei wind = ±1 (px/s²) */
  WIND_ACC: 75,
  SPEED_MIN: 70,
  SPEED_MAX: 330,
  WALK: 30,
  JUMP_VX: 60,
  JUMP_VY: -125,
  HP: 100,
  /** Ab 8 Spielern weniger Lebenspunkte, damit überhaupt jemand ausscheidet */
  HP_BIG: 60,
  /** Wind ändert sich pro Zug höchstens um ±WIND_DRIFT/2 (driftet statt neu gewürfelt) */
  WIND_DRIFT: 0.4,
  /** Settle-Phase: HP-Anzeige zählt mit mind. so vielen Punkten pro Sekunde herunter */
  HP_TICK_PER_S: 40,
  /** … und braucht dafür höchstens so lange */
  HP_TICK_MAX_MS: 1600,
  /** Zuschauer-Sprüche: Abklingzeit pro Spieler und Anzeigedauer am TV */
  TAUNT_COOLDOWN_MS: 8000,
  TAUNT_SHOW_MS: 2600,  /** Ab dieser Aufprallgeschwindigkeit gibt es Fallschaden */
  FALL_SAFE: 200,
  FALL_DMG: 0.12,
  TELE_RANGE: 230,
  /** Physik-Teilschritt (s) */
  DT: 0.005,
};

export const WEAPONS: Record<IgelWeapon, { name: string; short: string; ammo: number; hint: string }> = {
  bazooka: { name: 'Kokosnuss-Bazooka', short: 'Bazooka', ammo: -1, hint: 'Fliegt mit dem Wind – explodiert beim Aufprall' },
  grenade: { name: 'Wasserbomben-Granate', short: 'Wasserbombe', ammo: 3, hint: 'Hüpft – platzt nach 3 Sekunden (kein Wind)' },
  teleport: { name: 'Muschel-Teleport', short: 'Teleport', ammo: 2, hint: 'Richtung + Weite wischen – du landest dort' },
  punch: { name: 'Igel-Schlag', short: 'Schlag', ammo: -1, hint: 'Richtung wischen – haut Nachbarn weg' },
};
export const WEAPON_ORDER: IgelWeapon[] = ['bazooka', 'grenade', 'teleport', 'punch'];

/** Zugzeit nach Spielerzahl: 30 s bis 4, 20 s bis 8, 15 s darüber */
export const igelTurnMs = (n: number) => (n <= 4 ? IGEL.TURN_MS : n <= 8 ? 20000 : 15000);
export const igelMaxHp = (n: number) => (n >= 8 ? IGEL.HP_BIG : IGEL.HP);
export const igelSuddenMs = (n: number) => (n >= 7 ? IGEL.SUDDEN_MS_BIG : IGEL.SUDDEN_MS);

/** Zuschauer-Sprüche (Action `taunt` mit `{ i }` = Index in diese Liste) */
export const IGEL_TAUNTS = ['Rache!', 'Feigling!', 'Ups.', 'Für die Strandbar!'];

export const BAZOOKA = { R: 21, DMG: 45, ARM_MS: 140 };
export const GRENADE = { R: 19, DMG: 40, FUSE_MS: 3000, SPEED: 0.8 };
export const PUNCH = { REACH: 15, DMG: 22, VX: 170, VY: -170 };

/** Teamfarben für bis zu 12 Teams (gut unterscheidbar) */
export const IGEL_COLORS = [
  '#e0503f', '#3f8fe0', '#46b04a', '#f2c33a', '#9b5fc0', '#f0973a',
  '#2fb5a5', '#f07aa8', '#8a5a2b', '#5a6ad6', '#b6d33a', '#fdf7ea',
];

// ------------------------------------------------------------------ Terrain

export type Mask = Uint8Array;

/** Deterministischer Zufall (mulberry32) */
export function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function isSolid(m: Mask, x: number, y: number): boolean {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || xi >= IGEL.W || yi < 0) return false;
  if (yi >= IGEL.H) return true;
  return m[yi * IGEL.W + xi] === 1;
}

/** Sprengt einen Kreis aus dem Terrain */
export function carve(m: Mask, cx: number, cy: number, r: number) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(IGEL.W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(IGEL.H - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) m[y * IGEL.W + x] = 0;
    }
  }
}

/**
 * Urlaubsinsel aus Höhenprofil + Höhlen. Manchmal zwei Inseln mit einer Bucht dazwischen.
 * Unterhalb des Wassers bleibt alles fest (sieht man eh nicht).
 */
export function genTerrain(seed: number): Mask {
  const { W, H, WATER_Y } = IGEL;
  const r = seeded(seed);
  const m = new Uint8Array(W * H);
  const left = 18 + r() * 30;
  const right = W - 18 - r() * 30;
  const twoIslands = r() < 0.45;
  const gapX = left + (right - left) * (0.4 + r() * 0.2);
  const gapW = 22 + r() * 18;
  const waves = Array.from({ length: 4 }, (_, i) => ({ a: (28 - i * 6) * (0.6 + r() * 0.6), f: (i + 1) * (0.012 + r() * 0.01), p: r() * Math.PI * 2 }));
  const base = 150 + r() * 25;
  const heights: number[] = [];
  for (let x = 0; x < W; x++) {
    let h = base;
    for (const w of waves) h += Math.sin(x * w.f + w.p) * w.a;
    // Ränder fallen ins Meer ab
    const edge = Math.min(x - left, right - x);
    if (edge < 50) h += ((50 - edge) / 50) ** 1.6 * 140;
    if (twoIslands) {
      const d = Math.abs(x - gapX);
      if (d < gapW) h += ((gapW - d) / gapW) ** 0.8 * 130;
    }
    heights.push(Math.max(70, Math.min(H + 5, h)));
  }
  for (let x = 0; x < W; x++) for (let y = Math.floor(heights[x]); y < H; y++) if (y >= 0) m[y * W + x] = 1;
  // Höhlen und Tunnel
  const caves = 2 + Math.floor(r() * 4);
  for (let i = 0; i < caves; i++) {
    const cx = left + 40 + r() * (right - left - 80);
    const top = heights[Math.max(0, Math.min(W - 1, Math.floor(cx)))];
    if (top > WATER_Y - 40) continue;
    const cy = top + 22 + r() * Math.max(4, WATER_Y - top - 40);
    const len = 2 + Math.floor(r() * 4);
    let x = cx;
    let y = cy;
    for (let k = 0; k < len; k++) {
      carve(m, x, y, 7 + r() * 6);
      x += (r() - 0.5) * 26;
      y += (r() - 0.5) * 10;
    }
  }
  // Ein paar schwebende Felsbrocken / Überhänge
  if (r() < 0.6) {
    const cx = left + 60 + r() * (right - left - 120);
    const cy = 60 + r() * 40;
    const rx = 14 + r() * 14;
    for (let y = Math.floor(cy - 6); y <= cy + 6; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / 6;
        if (dx * dx + dy * dy <= 1 && x >= 0 && x < W) m[y * W + x] = 1;
      }
    }
  }
  return m;
}

/** Terrain = Seed + alle Krater (Reihenfolge wichtig!) */
export function buildTerrain(seed: number, craters: [number, number, number][]): Mask {
  const m = genTerrain(seed);
  for (const [x, y, r] of craters) carve(m, x, y, r);
  return m;
}

/** Oberste feste Zeile in Spalte x (oder H) */
export function surfaceY(m: Mask, x: number): number {
  for (let y = 0; y < IGEL.H; y++) if (isSolid(m, x, y)) return y;
  return IGEL.H;
}

// ------------------------------------------------------------------ Igel-Körper

/** Igel-Position = Fußpunkt (unterste Körperzeile). Kollision über ein paar Messpunkte. */
export function bodyHits(m: Mask, x: number, y: number): boolean {
  return isSolid(m, x, y) || isSolid(m, x, y - 7) || isSolid(m, x - 3, y - 3) || isSolid(m, x + 3, y - 3) || isSolid(m, x - 2, y - 6) || isSolid(m, x + 2, y - 6);
}

export const grounded = (m: Mask, x: number, y: number) => isSolid(m, x, y + 1) || isSolid(m, x - 2, y + 1) || isSolid(m, x + 2, y + 1);

/** Steht auf etwas – oder klemmt so fest, dass er nicht weiter fallen kann (z. B. in einer engen Spalte) */
export const supported = (m: Mask, x: number, y: number) => grounded(m, x, y) || bodyHits(m, x, y + 1);

// ------------------------------------------------------------------ Geschosse

export interface Ballistic {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function launch(x: number, y: number, angle: number, power: number, scale = 1): Ballistic {
  const v = (IGEL.SPEED_MIN + Math.max(0, Math.min(1, power)) * (IGEL.SPEED_MAX - IGEL.SPEED_MIN)) * scale;
  return { x: x + Math.cos(angle) * 7, y: y + Math.sin(angle) * 7, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v };
}

export function stepBallistic(p: Ballistic, dt: number, wind: number) {
  p.vx += wind * IGEL.WIND_ACC * dt;
  p.vy += IGEL.GRAVITY * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}

/**
 * Simuliert eine Bazooka-Kugel bis zum Einschlag (für Bots).
 * Gibt den Einschlagpunkt zurück oder null, wenn sie im Meer / außerhalb landet.
 */
export function simulateBazooka(
  m: Mask,
  from: { x: number; y: number },
  angle: number,
  power: number,
  wind: number,
  water: number,
  hogs: { x: number; y: number; self?: boolean }[],
): { x: number; y: number } | null {
  const p = launch(from.x, from.y, angle, power);
  for (let t = 0; t < 8; t += IGEL.DT) {
    stepBallistic(p, IGEL.DT, wind);
    if (p.x < -60 || p.x > IGEL.W + 60 || p.y > water) return null;
    if (isSolid(m, p.x, p.y)) return { x: p.x, y: p.y };
    for (const h of hogs) {
      if (h.self && t * 1000 < BAZOOKA.ARM_MS) continue;
      if (Math.hypot(h.x - p.x, h.y - 4 - p.y) < 5) return { x: p.x, y: p.y };
    }
  }
  return null;
}

/** Gibt die Wind-Stärke als Pfeiltext zurück, z. B. ">>" */
export function windArrows(w: number): string {
  const n = Math.round(Math.abs(w) * 3);
  return n === 0 ? '–' : (w < 0 ? '<' : '>').repeat(n);
}
