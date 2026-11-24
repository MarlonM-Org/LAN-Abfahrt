/**
 * Kopfball-Duell (`kopfball`, à la Head Soccer) und Kopf-Korb (`kopfkorb`, à la Head Basketball):
 * eine gemeinsame Engine – Konstanten, Feld-Geometrie und Ball-Physik für Server, TV und Bots.
 * Seitenansicht in Weltpixeln (480 × 270), y nach unten. Spieler-Positionen sind die Füße.
 *
 * Figuren: großer Kopf (Kreis `HEAD_R` um `HEAD_Y` über den Füßen) auf einem kleinen Körper (Kreis `BODY_R`).
 * Team Sonne (A) verteidigt links und spielt nach rechts, Team Meer (B) umgekehrt.
 * Das Feld wächst mit der Teamgröße (1 gegen 1: 300 px, 4 gegen 4: 420 px) – der TV zoomt passend darauf,
 * damit die Köpfe immer groß sind (`kbField().zoom`).
 */
import type { Team } from './types';

export type KbMode = 'fuss' | 'korb';
export type KbKind = 'kopfball' | 'kopfkorb';
export const kbMode = (kind: KbKind): KbMode => (kind === 'kopfkorb' ? 'korb' : 'fuss');

export const KB = {
  TICK_MS: 33,
  /** Physik-Unterschritte pro Tick (≈ 120 Hz) */
  SUBSTEPS: 4,
  /** Erster Anstoß: 3-2-1 (Countdown-Piep kommt automatisch aus ui.ts) */
  COUNTDOWN_MS: 4200,
  /** Nach einem Tor: alle stehen kurz still an ihren Plätzen, dann geht es mit dem schwebenden Ball los */
  KICKOFF_MS: 1100,
  /** So lange schwebt der Ball beim Anstoß, bis ihn jemand berührt (die Gegner bleiben so lange in ihrer Hälfte) */
  HOLD_MS: 2200,
  GOAL_MS: 2400,
  END_MS: 3200,
  MATCH_MS: 120_000,
  /** Golden Goal / Golden Basket bei Gleichstand, danach Unentschieden */
  OVERTIME_MS: 60_000,
  /** Wer das zuerst erreicht, gewinnt sofort */
  TARGET: { fuss: 5, korb: 15 } as Record<KbMode, number>,

  GROUND: 236,
  /** Mindestbreite des Felds (Bande zu Bande) – pro weiterem Spieler im größeren Team +40 */
  FIELD_W: 300,
  FIELD_STEP: 40,
  MAX_SIZE: 4,

  // Figur
  HEAD_R: 15,
  /** Kopfmitte über den Füßen */
  HEAD_Y: 27,
  BODY_R: 8,
  BODY_Y: 8,
  RUN: 138,
  /** Beschleunigung am Boden / in der Luft (px/s²) */
  ACC: 2400,
  AIR_ACC: 1500,
  JUMP_V: 338,
  P_G: 980,
  /** Sprung kurz vor der Landung wird gemerkt */
  JUMP_BUFFER_MS: 140,
  /** Stick so weit nach oben = springen (Alternative zum SPRUNG-Knopf) */
  STICK_JUMP: 0.6,
  /** Kleineres Team: etwas schneller, springt und schießt kräftiger */
  UNDERDOG: { run: 1.12, jump: 1.04, kick: 1.08 },

  // Ball
  BALL_R: 7,
  BALL_G: 560,
  BALL_MAX: 560,
  /** Abprall am Boden (Basketball springt mehr) */
  GROUND_E: { fuss: 0.62, korb: 0.78 } as Record<KbMode, number>,
  WALL_E: 0.8,
  CEIL_E: 0.55,
  SOLID_E: 0.6,
  RIM_E: 0.45,
  /** Rollreibung am Boden (1/s) */
  ROLL: 1.1,
  /** Kopf/Körper: Rückprall, wie viel vom Tempo der Figur mitgeht, Mindesttempo vom Kopf weg */
  HEAD_E: 0.72,
  BODY_E: 0.35,
  CARRY: 0.85,
  HEAD_MIN: 115,
  BODY_MIN: 45,
  /** Kopfball: kleiner Schubs Richtung gegnerisches Tor */
  HEADER_PUSH: 55,

  // Schuss (Fuß) bzw. Wurf
  KICK_MS: 200,
  /** In diesem Fenster nach dem Drücken trifft der Fuß */
  KICK_HIT_MS: 150,
  KICK_CD_MS: 320,
  KICK_V: 410,
  /** Trefferzone vor der Figur: vorwärts / Höhe über den Füßen */
  KICK_FWD: [-6, 30] as [number, number],
  KICK_UP: [-4, 34] as [number, number],
  /** Wurf (Korb): Ball so nah an der Figur (Mitte Oberkörper) */
  THROW_REACH: 36,
  THROW_ANGLE: 56,

  // Fußballtor
  GOAL_D: 30,
  GOAL_H: 72,
  BAR_T: 5,
  // Korb: Brett an der Bande, Ring davor
  BOARD_TOP: 126,
  BOARD_BOTTOM: 88,
  BOARD_X: 2,
  BOARD_T: 5,
  RIM_H: 96,
  RIM_W: 34,
  RIM_R: 2.5,
  /** Hintere Ringkante so weit vor dem Brett */
  RIM_BACK: 3,

  /** Ballkontakt zählt erst wieder nach dieser Pause */
  TOUCH_GAP_MS: 250,
  /** Torschütze: eigener Kontakt in dieser Zeit vor einem fremden zählt noch (sonst Eigentor) */
  SCORER_MS: 1800,
};

export interface KbRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface KbHoop {
  /** Ring von der Brett-Seite (xb) bis zur Vorderkante (xf), Höhe y */
  xb: number;
  xf: number;
  y: number;
}

export interface KbField {
  mode: KbMode;
  size: number;
  w: number;
  x0: number;
  x1: number;
  mid: number;
  /** TV: Kamera-Zoom und Bildmitte (y), damit das Feld den Bildschirm füllt */
  zoom: number;
  camY: number;
  /** Unsichtbare Decke für den Ball (knapp unter der Anzeigetafel) */
  ceil: number;
  /** Latten bzw. Bretter – Ball und Spieler prallen ab */
  solids: KbRect[];
  /** Ringkanten vorn und hinten (nur Korb) – nur der Ball prallt ab */
  rims: { x: number; y: number }[];
  /** Fußball: Torlinie des eigenen Tors (x) */
  goalLine: Record<Team, number>;
  /** Korb: der eigene Korb */
  hoops: Record<Team, KbHoop>;
}

/** Spielrichtung: Team Sonne (A) spielt nach rechts, Team Meer (B) nach links */
export const kbDir = (t: Team) => (t === 'A' ? 1 : -1);

/** Feld für den Modus und die Teamgröße (Spieler im größeren Team) */
export function kbField(mode: KbMode, size: number): KbField {
  const K = KB;
  const n = Math.max(1, Math.min(K.MAX_SIZE, Math.round(size)));
  const w = K.FIELD_W + K.FIELD_STEP * (n - 1);
  const x0 = 240 - w / 2;
  const x1 = 240 + w / 2;
  const zoom = Math.round((480 / (w + 20)) * 1000) / 1000;
  const G = K.GROUND;
  // Boden 14 Bildschirm-Pixel über dem unteren Rand, Decke knapp unter der 30 px hohen Tafel
  const camY = G - 121 / zoom;
  const ceil = Math.round(G - 226 / zoom + 2);
  const solids: KbRect[] = [];
  const rims: { x: number; y: number }[] = [];
  const hy = G - K.RIM_H;
  const hoops: Record<Team, KbHoop> = {
    A: { xb: x0 + K.BOARD_X + K.BOARD_T, xf: x0 + K.BOARD_X + K.BOARD_T + K.RIM_W, y: hy },
    B: { xb: x1 - K.BOARD_X - K.BOARD_T, xf: x1 - K.BOARD_X - K.BOARD_T - K.RIM_W, y: hy },
  };
  if (mode === 'fuss') {
    const by = G - K.GOAL_H - K.BAR_T;
    solids.push({ x: x0, y: by, w: K.GOAL_D + 2, h: K.BAR_T }, { x: x1 - K.GOAL_D - 2, y: by, w: K.GOAL_D + 2, h: K.BAR_T });
  } else {
    const h = K.BOARD_TOP - K.BOARD_BOTTOM;
    solids.push({ x: x0 + K.BOARD_X, y: G - K.BOARD_TOP, w: K.BOARD_T, h }, { x: x1 - K.BOARD_X - K.BOARD_T, y: G - K.BOARD_TOP, w: K.BOARD_T, h });
    // Vordere Ringkante und hintere (knapp vor dem Brett) – zu lange Würfe prallen hinten ab statt übers Brett reinzufallen
    rims.push({ x: hoops.A.xf, y: hy }, { x: hoops.B.xf, y: hy }, { x: hoops.A.xb + K.RIM_BACK, y: hy }, { x: hoops.B.xb - K.RIM_BACK, y: hy });
  }
  return { mode, size: n, w, x0, x1, mid: 240, zoom, camY, ceil, solids, rims, goalLine: { A: x0 + K.GOAL_D, B: x1 - K.GOAL_D }, hoops };
}

/** Spielbereich der Füße (Kopf berührt gerade die Bande) */
export const kbXRange = (f: KbField): [number, number] => [f.x0 + KB.HEAD_R, f.x1 - KB.HEAD_R];

/**
 * Aufstellung beim Anstoß: Wer Anstoß hat, steht mit Platz 0 hinter dem schwebenden Ball in der eigenen Hälfte,
 * die anderen dahinter; das andere Team steht verteidigend vor dem eigenen Tor bzw. Korb (sonst wäre jeder
 * Anstoß-Schuss über den Kopf des Gegners ein sicheres Tor).
 */
export function kbSpot(f: KbField, team: Team, slot: number, kicking: boolean): number {
  const d = kbDir(team);
  const off = kicking ? 80 + 38 * slot : Math.min(f.w * 0.3 + 30 * slot, f.w / 2 - 20);
  const [lo, hi] = kbXRange(f);
  return Math.max(lo, Math.min(hi, f.mid - d * off));
}

/** Wo der Ball beim Anstoß schwebt (in der Hälfte des Teams mit Anstoß, auf Brusthöhe) */
export function kbHoldSpot(f: KbField, team: Team): { x: number; y: number } {
  return { x: f.mid - kbDir(team) * 45, y: KB.GROUND - (f.mode === 'korb' ? 34 : 30) };
}

export interface KbBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Kreis gegen Rechteck: rausschieben, abprallen lassen (Restitution `e`). Liefert die Normale (vom Rechteck weg)
 * oder null ohne Kontakt. `vel` = false: nur Position korrigieren (die Geschwindigkeit regelt der Aufrufer).
 */
export function kbCircleRect(c: KbBall, r: number, rect: KbRect, e: number, vel = true): { nx: number; ny: number } | null {
  const cx = clamp(c.x, rect.x, rect.x + rect.w);
  const cy = clamp(c.y, rect.y, rect.y + rect.h);
  const dx = c.x - cx;
  const dy = c.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  let nx: number;
  let ny: number;
  if (d2 < 1e-8) {
    // Mitte im Rechteck: auf der kürzesten Seite raus
    const l = c.x - rect.x;
    const rr = rect.x + rect.w - c.x;
    const t = c.y - rect.y;
    const b = rect.y + rect.h - c.y;
    const m = Math.min(l, rr, t, b);
    if (m === t) [nx, ny, c.y] = [0, -1, rect.y - r];
    else if (m === b) [nx, ny, c.y] = [0, 1, rect.y + rect.h + r];
    else if (m === l) [nx, ny, c.x] = [-1, 0, rect.x - r];
    else [nx, ny, c.x] = [1, 0, rect.x + rect.w + r];
  } else {
    const d = Math.sqrt(d2);
    nx = dx / d;
    ny = dy / d;
    c.x = cx + nx * r;
    c.y = cy + ny * r;
  }
  if (vel) {
    const vn = c.vx * nx + c.vy * ny;
    if (vn < 0) {
      c.vx -= (1 + e) * vn * nx;
      c.vy -= (1 + e) * vn * ny;
    }
  }
  return { nx, ny };
}

/** Ergebnis eines Ball-Schritts: Aufprall an Latte/Brett/Ring (für Effekte), Bodenkontakt */
export interface KbStepInfo {
  clank: { x: number; y: number; speed: number } | null;
  ground: boolean;
}

/**
 * Ein Physikschritt für den Ball: Schwerkraft, Banden, Decke, Boden, Latten/Bretter und Ringkanten.
 * Spieler-Kontakte und Tore gehören nicht dazu (macht der Server); die Bots rechnen damit voraus.
 */
export function kbStepBall(b: KbBall, f: KbField, dt: number): KbStepInfo {
  const K = KB;
  const r = K.BALL_R;
  const info: KbStepInfo = { clank: null, ground: false };
  b.vy += K.BALL_G * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.x < f.x0 + r) {
    b.x = f.x0 + r;
    b.vx = Math.abs(b.vx) * K.WALL_E;
  } else if (b.x > f.x1 - r) {
    b.x = f.x1 - r;
    b.vx = -Math.abs(b.vx) * K.WALL_E;
  }
  if (b.y < f.ceil + r) {
    b.y = f.ceil + r;
    b.vy = Math.abs(b.vy) * K.CEIL_E;
  }
  const G = K.GROUND;
  if (b.y > G - r) {
    b.y = G - r;
    b.vy = Math.abs(b.vy) < 30 ? 0 : -Math.abs(b.vy) * K.GROUND_E[f.mode];
    info.ground = true;
  }
  if (b.y >= G - r - 0.01) b.vx *= Math.exp(-K.ROLL * dt);
  for (const s of f.solids) {
    const speed = Math.hypot(b.vx, b.vy);
    const n = kbCircleRect(b, r, s, K.SOLID_E);
    if (!n) continue;
    if (speed > 60) info.clank = { x: b.x - n.nx * r, y: b.y - n.ny * r, speed };
    // Oben auf der Latte bzw. dem Brett liegen bleiben gibt es nicht: rollt ins Feld zurück
    if (n.ny < -0.8 && Math.abs(b.vx) < 40) b.vx += (s.x + s.w / 2 < f.mid ? 1 : -1) * 220 * dt;
  }
  for (const p of f.rims) {
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    const min = r + K.RIM_R;
    const d = Math.hypot(dx, dy);
    if (d >= min) continue;
    const nx = d > 1e-4 ? dx / d : 0;
    const ny = d > 1e-4 ? dy / d : -1;
    b.x = p.x + nx * min;
    b.y = p.y + ny * min;
    const vn = b.vx * nx + b.vy * ny;
    const speed = Math.hypot(b.vx, b.vy);
    if (vn < 0) {
      b.vx -= (1 + K.RIM_E) * vn * nx;
      b.vy -= (1 + K.RIM_E) * vn * ny;
    }
    // Genau auf der Ringkante balancieren gibt es nicht
    if (ny < -0.9 && Math.abs(b.vx) < 20) b.vx += (dx >= 0 ? 1 : -1) * 30;
    if (speed > 50) info.clank = { x: p.x, y: p.y, speed };
  }
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > K.BALL_MAX) {
    b.vx *= K.BALL_MAX / sp;
    b.vy *= K.BALL_MAX / sp;
  }
  return info;
}

/** Ball ein Stück vorausrechnen (Bots): Position nach `s` Sekunden ohne Spielerkontakte */
export function kbPredict(ball: KbBall, f: KbField, s: number): KbBall {
  const b = { ...ball };
  const dt = 1 / 60;
  for (let t = 0; t < s; t += dt) kbStepBall(b, f, dt);
  return b;
}

/**
 * Wurf zum Korb (Kopf-Korb): Anfangsgeschwindigkeit für einen Bogen mit `angleDeg` durch die Ringmitte des Korbs `h`.
 * Zu nah (unter dem Korb) wird der Bogen steiler. Liefert die Geschwindigkeit ohne Streuung.
 */
export function kbThrowVelocity(bx: number, by: number, h: KbHoop, angleDeg: number = KB.THROW_ANGLE): { vx: number; vy: number } {
  const g = KB.BALL_G;
  // Ziel etwas hinter der Ringmitte (Richtung Brett): lieber ans Brett als an die vordere Kante
  const tx = (h.xb + h.xf) / 2 + Math.sign(h.xb - h.xf) * 3;
  const ty = h.y - 2;
  const dx = tx - bx;
  const dist = Math.max(4, Math.abs(dx));
  const up = by - ty;
  const s = Math.sign(dx) || 1;
  // An der vorderen Ringkante muss der Ball mit Abstand vorbei (Radius + Ring + 2 px) – auch im Steigen
  const clear = KB.BALL_R + KB.RIM_R + 2;
  const misses = (tan: number, k: number) => {
    for (let x = 0; x <= dist; x += 1) {
      const px = bx + s * x;
      const py = by - (x * tan - k * x * x);
      if (Math.hypot(px - h.xf, py - h.y) < clear) return false;
    }
    return true;
  };
  for (let a = angleDeg; a <= 86; a += 2) {
    const th = (a * Math.PI) / 180;
    const tan = Math.tan(th);
    const k = (dist * tan - up) / (dist * dist);
    if (k <= 1e-6) continue;
    // Höhe über dem Abwurf bei x: x·tanθ − k·x²; am Ziel muss er schon fallen
    if (tan - 2 * k * dist > -0.3) continue;
    if (!misses(tan, k)) continue;
    const cos = Math.cos(th);
    const v = Math.sqrt(g / (2 * cos * cos * k));
    if (v > KB.BALL_MAX) continue;
    return { vx: s * v * cos, vy: -v * Math.sin(th) };
  }
  // Notlösung (direkt unter dem Korb): steil nach oben Richtung Korb
  return { vx: s * Math.min(140, dist * 2), vy: -Math.min(KB.BALL_MAX * 0.9, Math.sqrt(2 * g * Math.max(20, up + 40))) };
}

export interface KbPlayer {
  t: Team;
  /** Füße (Weltpixel) */
  x: number;
  y: number;
  vx: number;
  vy: number;
  air: boolean;
  /** Schuss-Zähler – der TV spielt bei jeder Erhöhung den Fuß bzw. den Wurf ab */
  ks: number;
  /** Restliche Abklingzeit des Schusses (ms) */
  cd: number;
  /** Ohne Verbindung (eingefroren) */
  off?: boolean;
  /** Zu lange weg: steht nicht mehr im Feld */
  out?: boolean;
  /** Tore (Fußball) bzw. Punkte (Korb) */
  g: number;
  /** Ballkontakte */
  h: number;
}

export interface KbGoal {
  seq: number;
  /** Team, das punktet */
  team: Team;
  scorer: string | null;
  own: boolean;
  /** Fußball 1, Korb 2 oder 3 */
  pts: number;
  dunk: boolean;
  x: number;
  y: number;
}

export interface KbTouch {
  seq: number;
  id: string;
  /** kopf = Kopfball, schuss = Fuß/Wurf, koerper = angeprallt */
  how: 'kopf' | 'schuss' | 'koerper';
  power: number;
  x: number;
  y: number;
}

export interface KbState {
  mode: KbMode;
  /** countdown (erster Anstoß) → play ⇄ goal → kickoff → play … → over */
  sub: 'countdown' | 'kickoff' | 'play' | 'goal' | 'over';
  /** Serverzeit (Date.now()) dieses Standes – Wiedergabe-Uhr am TV */
  t: number;
  /** play: Spielzeit (ms, Aufwärmrunde 0); sonst Rest der Phase */
  endsIn: number;
  clock: number;
  overtime: boolean;
  /** Aufwärmrunde: nichts zählt, keine Uhr */
  practice?: boolean;
  /** Teamgröße fürs Feld (`kbField(mode, size)`) */
  size: number;
  score: Record<Team, number>;
  target: number;
  /** Team mit Anstoß bzw. Einwurf (nach einem Tor: wer kassiert hat; am Anfang per Los) */
  kick: Team;
  /** Noch der erste Anstoß (per Los) */
  first: boolean;
  /** Ball schwebt beim Anstoß, bis ihn jemand berührt */
  hold: boolean;
  /** Zählt bei jedem neuen Anstoß hoch */
  round: number;
  ball: KbBall;
  players: Record<string, KbPlayer>;
  lastGoal: KbGoal | null;
  touch: KbTouch | null;
  /** Ball an Latte/Brett/Ring (für den Klang) */
  clank: { seq: number; x: number; y: number } | null;
  winner: Team | null;
}

/** „Tor“/„Korb“ und Einheit für Texte */
export const KB_WORDS: Record<KbMode, { goal: string; kick: string; unit1: string; unitN: string; target: string }> = {
  fuss: { goal: 'TOR', kick: 'Anstoß', unit1: 'Tor', unitN: 'Tore', target: 'Tore' },
  korb: { goal: 'KORB', kick: 'Einwurf', unit1: 'Punkt', unitN: 'Punkte', target: 'Punkte' },
};
