/**
 * Wackel-Prügelei: gemeinsame Konstanten, Bühnen und Typen (Server, TV, Handy, Bots).
 *
 * Seitenansicht in Welt-Pixeln (480 × 270, y nach unten). Die Figuren sind labbrige
 * Physik-Puppen (matter-js auf dem Server): Rumpf, Kopf, zwei Arme, zwei Beine.
 * Ziel: die anderen vom Steg bzw. Kutter ins Meer befördern – wer zuletzt steht, gewinnt die Runde.
 */

export const WACKEL = {
  TICK_MS: 40,
  /** Physik-Schrittweite (ms) – pro Tick mehrere Schritte */
  STEP_MS: 1000 / 60,
  COUNTDOWN_MS: 3500,
  /** Normale Rundenlänge, danach steigt das Wasser (Sudden Death) */
  ROUND_MS: 50000,
  /** Harte Obergrenze pro Runde (ab hier Unentschieden unter den Überlebenden) */
  ROUND_CAP_MS: 78000,
  /** Steigendes Wasser (px/s) im Sudden Death */
  RISE_PX_S: 7,
  END_DELAY_MS: 900,
  ROUND_OVER_MS: 3800,
  WIN_ROUNDS: 3,
  MAX_ROUNDS: 5,
  /** Meeresspiegel zu Beginn */
  SEA_Y: 236,
  /** Körpermaße (Welt-Pixel) */
  TORSO_W: 8,
  TORSO_H: 12,
  HEAD_R: 5.5,
  ARM_W: 3,
  ARM_L: 9,
  LEG_W: 3,
  LEG_L: 10,
  /** Rumpfmitte steht so hoch über dem Boden */
  STAND_H: 16,
  /** Laufen (px pro Physik-Schritt) */
  WALK: 1.45,
  JUMP: 5.6,
  PUNCH_MS: 230,
  PUNCH_CD_MS: 520,
  /** Treffer-Radius Faust ↔ Körperteil */
  PUNCH_R: 7.5,
  /** Betäubung nach normalem Treffer / Kopftreffer */
  STUN_MS: 700,
  STUN_HEAD_MS: 1300,
  /** Wucht eines Treffers (px pro Schritt) */
  KNOCK: 2.7,
  KNOCK_UP: 1.3,
  /** Greifen: Reichweite Hand ↔ Körperteil / Kante */
  GRAB_R: 8,
  /** Festhalten an Spielern höchstens so lange, danach kurz Pause */
  HOLD_MAX_MS: 4000,
  GRAB_CD_MS: 500,
  /** Wurf beim Loslassen (px pro Schritt) */
  THROW: 4.6,
  THROW_UP: 2.2,
  /** Treffer/Griff zählt als „rausgeworfen“, wenn der Sturz so kurz danach passiert */
  CREDIT_MS: 3000,
  /** Welle: Abstand, Breite, Schub */
  WAVE_MIN_MS: 9000,
  WAVE_MAX_MS: 14000,
  WAVE_SPEED: 2.2,
  WAVE_HALF: 26,
  WAVE_PUSH: 0.55,
  /** Kutter: Schaukeln (rad) und Periode (ms) */
  TILT_RAD: 0.13,
  TILT_MS: 5200,
  /** Haken: Seil-Länge, Antrieb */
  HOOK_LEN: 104,
  HOOK_R: 6,
  /** Ab dieser Hakengeschwindigkeit (px/Schritt) gibt es Betäubung */
  HOOK_STUN_V: 2.6,
  MAX_PLAYERS: 8,
};

export type WackelStageId = 'steg' | 'kutter';

export interface WackelPlatform {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Zeichenstil */
  kind: 'deck' | 'low' | 'high' | 'boat' | 'crate';
  /** Schaukelt (nur Kutter-Deck) */
  rock?: boolean;
}

export interface WackelStage {
  id: WackelStageId;
  name: string;
  platforms: WackelPlatform[];
  /** Startplätze (x) auf dem Hauptdeck */
  spawnX: [number, number];
  spawnY: number;
  /** Welle (Steg) oder Kranhaken (Kutter) */
  hazard: 'wave' | 'hook';
  /** Welle: Schub trifft nur, wer tiefer steht als diese Höhe */
  waveDeckY?: number;
  /** Kran: Aufhängung */
  hookPivot?: { x: number; y: number };
}

export const WACKEL_STAGES: WackelStage[] = [
  {
    id: 'steg',
    name: 'Holzsteg',
    platforms: [
      { x: 118, y: 178, w: 244, h: 12, kind: 'deck' },
      { x: 10, y: 214, w: 92, h: 10, kind: 'low' },
      { x: 378, y: 214, w: 92, h: 10, kind: 'low' },
      { x: 206, y: 128, w: 68, h: 8, kind: 'high' },
    ],
    spawnX: [140, 340],
    spawnY: 178,
    hazard: 'wave',
    waveDeckY: 196,
  },
  {
    id: 'kutter',
    name: 'Fischkutter',
    platforms: [
      { x: 110, y: 184, w: 260, h: 14, kind: 'boat', rock: true },
      { x: 30, y: 206, w: 46, h: 10, kind: 'crate' },
      { x: 404, y: 206, w: 46, h: 10, kind: 'crate' },
      { x: 318, y: 146, w: 52, h: 8, kind: 'crate' },
    ],
    spawnX: [134, 346],
    spawnY: 184,
    hazard: 'hook',
    hookPivot: { x: 240, y: 46 },
  },
];

export const wackelStage = (id: WackelStageId) => WACKEL_STAGES.find((s) => s.id === id) ?? WACKEL_STAGES[0];

/** Neigung des Kutter-Decks zu einem Zeitpunkt (rad, positiv = rechts tiefer) */
export const wackelTilt = (t: number) => Math.sin((t / WACKEL.TILT_MS) * Math.PI * 2) * WACKEL.TILT_RAD;

/** Oberkante einer (ggf. geneigten) Plattform an Stelle x – oder null, wenn x nicht darüber liegt */
export function wackelSurfaceY(p: WackelPlatform, x: number, tilt = 0): number | null {
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  const a = p.rock ? tilt : 0;
  const lx = (x - cx) * Math.cos(a);
  if (Math.abs(lx) > p.w / 2 + 1) return null;
  return cy - (p.h / 2) * Math.cos(a) + lx * Math.sin(a);
}

/** Plattform direkt unter einem Punkt (bis `reach` px darunter) */
export function wackelPlatformUnder(stage: WackelStage, x: number, y: number, tilt = 0, reach = 40): WackelPlatform | null {
  let best: WackelPlatform | null = null;
  let bestD = Infinity;
  for (const p of stage.platforms) {
    const sy = wackelSurfaceY(p, x, tilt);
    if (sy === null) continue;
    const d = sy - y;
    if (d < -4 || d > reach) continue;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Körperteile im Snapshot: je [x, y, Winkel in Grad] */
export const WACKEL_PARTS = ['torso', 'head', 'armL', 'armR', 'legL', 'legR'] as const;
export type WackelPartName = (typeof WACKEL_PARTS)[number];

export interface WackelPlayer {
  /** 6 × [x, y, Winkel°] – leer, wenn nicht (mehr) auf der Bühne */
  parts: number[];
  /** Rumpfposition (auch nach dem Platsch) */
  x: number;
  y: number;
  f: 1 | -1;
  alive: boolean;
  stun: boolean;
  /** Wird gerade festgehalten */
  held: boolean;
  /** 0 = frei, 1 = hält einen Spieler, 2 = hängt an einer Kante/einem Objekt */
  grab: 0 | 1 | 2;
  /** Zählt bei jedem Schlag hoch (Animation) */
  punch: number;
  /** Arm, der zuletzt geschlagen hat (0 = links, 1 = rechts) */
  arm: 0 | 1;
  /** Schlag-Abklingzeit (ms) */
  cd: number;
  hits: number;
  wins: number;
  outs: number;
}

export interface WackelFx {
  seq: number;
  type: 'hit' | 'head' | 'platsch' | 'grab' | 'throw' | 'hook';
  x: number;
  y: number;
  id?: string;
}

export interface WackelState {
  sub: 'countdown' | 'play' | 'roundOver' | 'over';
  endsIn: number;
  round: number;
  winRounds: number;
  stage: WackelStageId;
  /** Aktueller Meeresspiegel (steigt im Sudden Death) */
  sea: number;
  sudden: boolean;
  /** Kutter: Neigung (Grad × 10) */
  tilt: number;
  /** Kutter: Hakenposition */
  hook: [number, number] | null;
  /** Steg: Welle (x) und Richtung, sonst null */
  wave: [number, number] | null;
  players: Record<string, WackelPlayer>;
  roundWinner: string | null;
  fx: WackelFx[];
}
