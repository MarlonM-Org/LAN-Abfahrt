/**
 * Darts (301 Single Out): gemeinsame Geometrie, Wertung, Atmen des Fadenkreuzes, Checkout-Wege und Zustandstypen.
 * Wird von Server (Spiellogik), TV, Handy, Bots und dem Test-Skript benutzt.
 *
 * Koordinaten = Millimeter auf der Scheibe, Mitte (0, 0), x nach rechts, y nach UNTEN
 * (wie auf dem Bildschirm). Echte Turnier-Maße: Doppelring außen bei 170 mm.
 */
import type { Point } from './types';

export const DARTS = {
  /** Radien (mm) */
  BULL_IN: 6.35,
  BULL_OUT: 15.9,
  TRIPLE_IN: 99,
  TRIPLE_OUT: 107,
  DOUBLE_IN: 162,
  DOUBLE_OUT: 170,
  /** Ziel- und Landepunkte werden auf ± WALL begrenzt (Wand um die Scheibe) */
  WALL: 230,

  /** 301 Single Out: jeder startet hier und muss genau auf 0 kommen (jedes Feld darf beenden) */
  START: 301,
  DARTS_PER_ROUND: 3,
  /** Rundenlimit (eine Runde = eine Aufnahme à 3 Darts für alle) – danach gewinnt der niedrigste Rest */
  MAX_ROUNDS: 10,
  /** Ab diesem Rest zeigen TV und Handy einen Checkout-Weg */
  HINT_FROM: 60,

  /** Atmen des Fadenkreuzes (Amplitude in mm): Start, Minimum (ganz ruhig), Maximum */
  AMP_START: 30,
  AMP_MIN: 11,
  AMP_MAX: 42,
  /** nach jedem Wurf zittert die Hand nach: Amplitude mindestens so viel */
  AMP_AFTER: 24,
  /** Zeitkonstante (ms), mit der sich das Fadenkreuz beruhigt */
  CALM_TAU_MS: 1300,
  /** Zielen (Finger/Handy bewegen) macht unruhiger: mm Amplitude pro mm Weg (ab BUMP_DEAD mm pro Messung) */
  BUMP_PER_MM: 0.25,
  BUMP_DEAD: 0.5,

  /** Erklär-Screen (VIP kann überspringen) */
  INTRO_MS: 8000,
  /*
   * Eine Runde hat KEIN Zeitlimit: Sie endet, wenn alle ihre Darts geworfen haben (oder überworfen/ausgecheckt sind).
   * Für Handys, die weg sind, wirft der Server; der VIP kann die Runde beenden (fehlende Darts verfallen).
   */
  /** nach dem letzten Dart einer Runde (Flug + Anzeige) */
  LAST_MS: 1800,
  /** Zwischenstand nach jeder Runde (VIP kann überspringen) */
  TALLY_MS: 7000,
  OVER_MS: 4500,
  /** Abwesende Spieler werfen automatisch (Abstand zwischen zwei Darts) */
  AUTO_MS: 1400,
  /** Handy schickt die Zielposition höchstens so oft (ms) */
  AIM_SEND_MS: 70,
};

/** Segmentzahlen im Uhrzeigersinn, beginnend oben */
export const DART_SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

export type DartRing = 'bull' | 'outerbull' | 'single' | 'double' | 'triple' | 'miss';

export interface DartHit {
  ring: DartRing;
  /** Segmentzahl (bei Bull 25, bei Daneben 0) */
  seg: number;
  points: number;
  /** z. B. "TRIPLE 20", "BULLSEYE", "7" */
  label: string;
  /** kurz für die Anzeige am Dart, z. B. "T20", "D5", "BULL" */
  short: string;
}

/** Segment-Index (0 = 20 oben) für einen Punkt */
export function dartSegmentIndex(p: Point): number {
  const deg = (Math.atan2(p.x, -p.y) * 180) / Math.PI; // 0 = oben, im Uhrzeigersinn
  return Math.floor((((deg + 9) % 360) + 360) % 360 / 18) % 20;
}

/** Wertung eines Treffers */
export function dartsScore(p: Point): DartHit {
  const r = Math.hypot(p.x, p.y);
  if (r <= DARTS.BULL_IN) return { ring: 'bull', seg: 25, points: 50, label: 'BULLSEYE', short: 'BULL' };
  if (r <= DARTS.BULL_OUT) return { ring: 'outerbull', seg: 25, points: 25, label: 'BULL 25', short: '25' };
  if (r > DARTS.DOUBLE_OUT) return { ring: 'miss', seg: 0, points: 0, label: 'DANEBEN', short: '0' };
  const seg = DART_SEGMENTS[dartSegmentIndex(p)];
  if (r >= DARTS.TRIPLE_IN && r <= DARTS.TRIPLE_OUT) return { ring: 'triple', seg, points: seg * 3, label: `TRIPLE ${seg}`, short: `T${seg}` };
  if (r >= DARTS.DOUBLE_IN) return { ring: 'double', seg, points: seg * 2, label: `DOPPEL ${seg}`, short: `D${seg}` };
  return { ring: 'single', seg, points: seg, label: String(seg), short: String(seg) };
}

export type DartAimRing = 'triple' | 'double' | 'single' | 'outerbull' | 'bull';

/** Mitte eines Feldes (für Bots, Schnellwahl am Handy und Checkout-Hinweise). Single = äußeres Single-Feld (das größere). */
export function dartsTarget(seg: number, ring: DartAimRing): Point {
  if (ring === 'bull') return { x: 0, y: 0 };
  if (ring === 'outerbull') return { x: 0, y: -Math.round(((DARTS.BULL_IN + DARTS.BULL_OUT) / 2) * 10) / 10 };
  const idx = DART_SEGMENTS.indexOf(seg);
  const a = (idx * 18 * Math.PI) / 180;
  const r = ring === 'triple' ? (DARTS.TRIPLE_IN + DARTS.TRIPLE_OUT) / 2 : ring === 'double' ? (DARTS.DOUBLE_IN + DARTS.DOUBLE_OUT) / 2 : 135;
  return { x: Math.round(Math.sin(a) * r * 10) / 10, y: Math.round(-Math.cos(a) * r * 10) / 10 };
}

// ------------------------------------------------------------------ Atmen (Lissajous)

/** Fester Phasenversatz pro Spieler und Runde – Handy, TV und Server rechnen dasselbe */
export function dartsPhase(playerId: string, round: number): number {
  let h = 2166136261;
  for (const ch of `${playerId}|${round}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

/**
 * Versatz des Fadenkreuzes zum Zielpunkt bei Amplitude `amp` (mm) – eine Lissajous-Schleife („Atmen“).
 * `t` = ms seit Rundenbeginn in Serverzeit (`DartsState.t0`), damit Handy, TV und Server dieselbe Stelle sehen.
 */
export function dartsWobble(t: number, amp: number, phase: number): Point {
  const x = Math.sin(t * 0.0021 + phase) * 0.72 + Math.sin(t * 0.0057 + phase * 2) * 0.28;
  const y = Math.sin(t * 0.0029 + phase * 1.7) * 0.72 + Math.sin(t * 0.0043 + phase * 3) * 0.28;
  return { x: x * amp, y: y * amp };
}

/** Wie sich das Fadenkreuz in `dtMs` beruhigt */
export function dartsCalm(amp: number, dtMs: number): number {
  return DARTS.AMP_MIN + (Math.max(DARTS.AMP_MIN, amp) - DARTS.AMP_MIN) * Math.exp(-Math.max(0, dtMs) / DARTS.CALM_TAU_MS);
}

/** Amplitude nach `mm` Zielbewegung in einer Messung (kleines Zittern unter BUMP_DEAD zählt nicht) */
export function dartsBump(amp: number, mm: number): number {
  return Math.min(DARTS.AMP_MAX, amp + Math.max(0, mm - DARTS.BUMP_DEAD) * DARTS.BUMP_PER_MM);
}

/** Fadenkreuz = Zielpunkt + Atmen, begrenzt auf die Wand, auf 0,1 mm gerundet (genau dort landet der Dart) */
export function dartsCross(aim: Point, t: number, amp: number, phase: number): Point {
  const W = DARTS.WALL;
  const a = Math.max(DARTS.AMP_MIN, Math.min(DARTS.AMP_MAX, amp));
  const w = dartsWobble(t, a, phase);
  const r1 = (v: number) => Math.round(Math.max(-W, Math.min(W, v)) * 10) / 10;
  return { x: r1(aim.x + w.x), y: r1(aim.y + w.y) };
}

// ------------------------------------------------------------------ 301 Single Out

/** Ein Feld der Scheibe (für Checkout-Wege) */
export interface DartsField {
  ring: Exclude<DartRing, 'miss'>;
  seg: number;
  points: number;
  short: string;
}

/** Wie schwer ein Feld zu treffen ist (für die Wahl des Checkout-Wegs): Singles sind am größten */
const FIELD_COST: Record<DartsField['ring'], number> = { single: 1, double: 2.5, triple: 3, outerbull: 3.5, bull: 6 };

export const DARTS_FIELDS: DartsField[] = [
  ...Array.from({ length: 20 }, (_, i) => i + 1).flatMap((seg): DartsField[] => [
    { ring: 'single', seg, points: seg, short: String(seg) },
    { ring: 'double', seg, points: seg * 2, short: `D${seg}` },
    { ring: 'triple', seg, points: seg * 3, short: `T${seg}` },
  ]),
  { ring: 'outerbull', seg: 25, points: 25, short: '25' },
  { ring: 'bull', seg: 25, points: 50, short: 'BULL' },
];

type Way = { cost: number; fields: DartsField[] } | null;
/** best[k][r] = leichtester Weg, genau r Punkte mit höchstens k Darts zu werfen (einmal vorberechnet) */
const MAX_PTS = 180;
const best: Way[][] = [Array.from({ length: MAX_PTS + 1 }, (_, r): Way => (r === 0 ? { cost: 0, fields: [] } : null))];
for (let k = 1; k <= DARTS.DARTS_PER_ROUND; k++) {
  const row = [...best[k - 1]];
  for (let r = 1; r <= MAX_PTS; r++) {
    for (const f of DARTS_FIELDS) {
      const prev = r - f.points >= 0 ? best[k - 1][r - f.points] : null;
      if (!prev) continue;
      const cost = prev.cost + FIELD_COST[f.ring];
      const fields = [f, ...prev.fields];
      const cur = row[r];
      // leichter gewinnt; bei Gleichstand weniger Darts, dann der höhere erste Dart (die 20 kennt jeder)
      const better =
        !cur ||
        cost < cur.cost - 1e-9 ||
        (Math.abs(cost - cur.cost) < 1e-9 && (fields.length < cur.fields.length || (fields.length === cur.fields.length && f.points > cur.fields[0].points)));
      if (better) row[r] = { cost, fields };
    }
  }
  best.push(row);
}

/**
 * Leichtester Weg, mit höchstens `darts` Darts genau `rest` zu werfen (Single Out: jedes Feld darf beenden) –
 * null, wenn es so nicht geht. Beispiel: 40 → [20, 20], mit einem Dart → [D20]; 57 mit einem Dart → [T19].
 */
export function dartsCheckout(rest: number, darts: number = DARTS.DARTS_PER_ROUND): DartsField[] | null {
  const k = Math.max(0, Math.min(DARTS.DARTS_PER_ROUND, Math.floor(darts)));
  if (!Number.isInteger(rest) || rest <= 0 || rest > MAX_PTS || k === 0) return null;
  return best[k][rest]?.fields ?? null;
}

/** Checkout-Weg als Text, z. B. "20 · 17" oder "T19" (null = kein Hinweis: Rest über HINT_FROM oder so nicht machbar) */
export function dartsCheckoutText(rest: number, darts: number = DARTS.DARTS_PER_ROUND): string | null {
  if (rest > DARTS.HINT_FROM) return null;
  const way = dartsCheckout(rest, darts);
  return way ? way.map((f) => f.short).join(' · ') : null;
}

/**
 * Wohin zielen (Bots, automatische Würfe)? Der leichteste Checkout-Weg mit den übrigen Darts, sonst Triple 20 –
 * oder bei Rest ≤ 60 die große Single 20, damit die Triple nicht überwirft.
 */
export function dartsAimFor(rest: number, left: number): Point {
  const way = dartsCheckout(rest, left);
  if (way) return dartsTarget(way[0].seg, way[0].ring);
  return rest > 60 ? dartsTarget(20, 'triple') : dartsTarget(20, 'single');
}

/** Klartext eines Feldes für Sätze: „der 17“, „Doppel 20“, „Bullseye“ */
export function dartsSay(h: { ring: DartRing; seg: number }): string {
  if (h.ring === 'bull') return 'Bullseye';
  if (h.ring === 'outerbull') return 'Bull 25';
  if (h.ring === 'double') return `Doppel ${h.seg}`;
  if (h.ring === 'triple') return `Triple ${h.seg}`;
  return `der ${h.seg}`;
}

/** Ergebnis eines Darts im 301: neuer Rest, überworfen (unter 0 → Aufnahme zählt nicht) oder ausgecheckt (genau 0) */
export function dartsApply(rest: number, points: number): { rest: number; bust: boolean; out: boolean } {
  const left = rest - points;
  if (left < 0) return { rest, bust: true, out: false };
  return { rest: left, bust: false, out: left === 0 };
}

/** Deterministischer Zufall (mulberry32) */
export function dartsRng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Zwei normalverteilte Zahlen (Box-Muller) aus einem Seed – begrenzt auf ±2.5 σ */
export function dartsNoise(seed: number): [number, number] {
  const rnd = dartsRng(seed);
  const u = Math.max(1e-9, rnd());
  const v = rnd();
  const m = Math.sqrt(-2 * Math.log(u));
  const c = (z: number) => Math.max(-2.5, Math.min(2.5, z));
  return [c(m * Math.cos(2 * Math.PI * v)), c(m * Math.sin(2 * Math.PI * v))];
}

// ------------------------------------------------------------------ Zustand

export interface DartsDart {
  seq: number;
  owner: string;
  round: number;
  /** 0 … 2 */
  n: number;
  /** Landepunkt (mm) */
  x: number;
  y: number;
  ring: DartRing;
  seg: number;
  label: string;
  short: string;
  points: number;
  /** Rest nach diesem Dart (bei Bust: wieder der Stand vor der Aufnahme) */
  rest: number;
  /** dieser Dart hat überworfen – die ganze Aufnahme zählt nicht */
  bust?: boolean;
  /** dieser Dart hat genau auf 0 gebracht */
  out?: boolean;
  /** automatisch geworfen (Spieler weg) */
  auto?: boolean;
}

/** Live-Zielposition eines Spielers (vom Handy, ohne Atmen – das rechnet jeder selbst aus `t0`) */
export interface DartsAim {
  x: number;
  y: number;
  /** Atem-Amplitude (mm) beim Senden – beruhigt sich danach wie `dartsCalm` */
  amp: number;
  /** Finger liegt auf (Touch) bzw. Sensor-Modus aktiv */
  on: boolean;
}

export interface DartsPlayer {
  id: string;
  /** Pfeilfarbe als Hex-Zahl */
  color: number;
  /** Reststand */
  rest: number;
  /** Stand vor dieser Aufnahme (bei Bust geht es dahin zurück) */
  start: number;
  /** Punkte dieser Aufnahme (0 nach Bust) */
  scored: number;
  /** Darts dieser Aufnahme schon geworfen */
  thrown: number;
  /** in dieser Aufnahme überworfen (restliche Darts verfallen) */
  bust: boolean;
  /** ausgecheckt: Darts bis zur 0, jede frühere Runde zählt 3 (0 = noch nicht) */
  out: number;
  /** VIP hat die Runde beendet, bevor alle Darts geworfen waren (Rest verfällt) */
  skipped: boolean;
  /** Punkte pro Aufnahme, null = überworfen */
  history: (number | null)[];
  aim: DartsAim | null;
}

/** Hat der Spieler in dieser Runde nichts mehr zu werfen? */
export const dartsDone = (p: DartsPlayer) => p.thrown >= DARTS.DARTS_PER_ROUND || p.bust || p.out > 0 || p.skipped;

/** Wie viele Darts hat der Spieler in dieser Runde noch? */
export const dartsLeft = (p: DartsPlayer) => (dartsDone(p) ? 0 : DARTS.DARTS_PER_ROUND - p.thrown);

/** Reihenfolge der Wertung: Ausgecheckte zuerst (weniger Darts besser), dann niedrigster Rest */
export function dartsRank(a: DartsPlayer, b: DartsPlayer): number {
  if (!!a.out !== !!b.out) return a.out ? -1 : 1;
  if (a.out && b.out) return a.out - b.out;
  return a.rest - b.rest;
}

export interface DartsTally {
  /** vorn liegen (niedrigster Rest bzw. ausgecheckt) */
  lead: string[];
  rest: number;
  /** in dieser Runde überworfen / ausgecheckt */
  busts: string[];
  outs: string[];
  /** beste Aufnahme der Runde */
  best: string[];
  points: number;
}

export interface DartsState {
  sub: 'intro' | 'throw' | 'tally' | 'over';
  endsIn: number;
  round: number;
  rounds: number;
  /** Startwert (301) */
  start: number;
  /** Serverzeit (ms) des Rundenbeginns – Zeitbasis fürs Atmen */
  t0: number;
  players: DartsPlayer[];
  /** Darts der aktuellen Runde (werden nach jeder Runde aus der Scheibe gezogen) */
  darts: DartsDart[];
  /** Auswertung der Runde (sub = 'tally'/'over') */
  tally: DartsTally | null;
  /** Sieger (sub = 'over'): wer ausgecheckt hat bzw. nach dem Rundenlimit den niedrigsten Rest */
  winners: string[];
}
