import type { BotSkill } from './players';
import type { FlunkyState, Point, Team } from './types';

/** Spielfeld in "Pixel-Welt"-Koordinaten (wird auf dem TV hochskaliert). */
export const WORLD = { W: 480, H: 270 };

/** Grundposition der Flasche – nach jedem Treffer wird sie etwas versetzt wieder aufgestellt. */
export const BOTTLE: Point = { x: 240, y: 190 };
/** Mitte der Wurfzone je Team (der Werfer steht bei jedem Wurf woanders darin). */
export const THROW_SPOT: Record<Team, Point> = {
  A: { x: 92, y: 190 },
  B: { x: 388, y: 190 },
};

/**
 * Flunkyball-Regeln und -Geometrie (Server, TV, Handy, Bots, `npm run test:flunky`).
 *
 * Richtung: `aim` in Radiant, 0 = geradeaus aufs andere Team, positiv = Pfeil am TV nach UNTEN (+y) –
 * für beide Teams gleich, die ▲/▼-Knöpfe am Handy drehen den Pfeil genau so, wie man ihn am TV sieht.
 * Wind (−1 … 1) treibt den Ball ebenfalls am TV nach unten (positiv) bzw. oben (negativ).
 */
export const FLUNKY = {
  /** Runden (jedes Team wirft einmal pro Runde); danach gewinnt, wer mehr getrunken hat */
  ROUNDS: 10,
  /** Gleichstand nach allen Runden: so viele Verlängerungsrunden, dann Unentschieden */
  EXTRA_ROUNDS: 3,
  /** Wurfzone: seitlicher Versatz (TV-y) und vor/zurück (TV-x) um THROW_SPOT */
  SPOT_LAT: 44,
  SPOT_DEPTH: 16,
  /** neuer Wurfpunkt liegt seitlich mindestens so weit vom letzten des Teams weg */
  SPOT_MOVE: 22,
  /** Flasche: Versatz beim Wiederaufstellen um BOTTLE */
  BOTTLE_LAT: 16,
  BOTTLE_DEPTH: 10,
  /** Weite bei Kraft 0 bzw. 1 (px) */
  D_MIN: 40,
  D_MAX: 260,
  /** Zielpfeil höchstens so weit gedreht (rad, ≈ 34°) */
  AIM_MAX: 0.6,
  /** Wurf-Abweichung (schräg gewischt) höchstens ± (rad, ≈ 4°) */
  DEV_MAX: 0.07,
  /** seitliche Verwehung bei Windstärke 1 auf 150 px Flugweite */
  WIND_PX: 20,
  /** Wind ändert sich pro Wurf um höchstens so viel (dreht langsam statt zu springen) */
  WIND_STEP: 0.45,
  /** Trefferbereich um die Flasche in Werfersicht (px): davor, dahinter (Ball trifft im Fallen), seitlich */
  HIT_NEAR: 10,
  HIT_FAR: 15,
  HIT_LAT: 10,
  /** Anzeige-Maßstab */
  PX_PER_M: 16,
  /** Trinken: höchstens so viel Prozent pro Treffer und Spieler, so viel pro Tipp */
  SIP_MAX: 34,
  DRINK_PER_TAP: 1.7,
  /** Taps, die der Läufer braucht (hin zur Flasche + zurück) */
  RUN_TAPS: 20,
  /** Flugzeit des Balls; nach einem Fehlwurf noch so lange stehen lassen (Hinweis lesen) */
  FLIGHT_MS: 1300,
  MISS_PAUSE_MS: 600,
  /** „Flasche steht“ → nächster Werfer */
  RESET_MS: 900,
  OVER_MS: 3500,
};

/** Kurznamen (TV/Handy) */
export const FLIGHT_MS = FLUNKY.FLIGHT_MS;
export const RUN_TAPS = FLUNKY.RUN_TAPS;

/**
 * Zielen ist kein Zeitfaktor: `null` = der Werfer hat alle Zeit (vorher 30 s, dann Fehlwurf).
 * Der VIP kann den Wurf im Menü überspringen; wer offline geht, wird sofort übersprungen.
 */
export const FLUNKY_AIM_IDLE_MS: number | null = null;

export const TEAM_INFO: Record<Team, { name: string; color: string; colorNum: number }> = {
  A: { name: 'Team Sonne', color: '#f4c542', colorNum: 0xf4c542 },
  B: { name: 'Team Meer', color: '#3fa7e0', colorNum: 0x3fa7e0 },
};

export const otherTeam = (t: Team): Team => (t === 'A' ? 'B' : 'A');

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ------------------------------------------------------------------ Kraft-Kurve

/**
 * Kraft-Kurve für Schwung und Wischen: `level` = Schwungstärke relativ zu einem kräftigen Flunkyball-Wurf
 * (1 = Referenz, siehe client/controller/flunkyThrow.ts). Logarithmisch: 20 % mehr Schwung bringen überall
 * etwa 20 % mehr Weite. Ein kräftiger Wurf landet mitten im Zielbereich, ein leichter Schwung bleibt weit vor
 * der Flasche liegen, und selbst ein voller Hieb (Sensor-Anschlag) fliegt nicht bis ans Ende des Strands.
 */
export const FLUNKY_POWER = {
  /** Kraft bei level 1 (→ 150 px ≈ mittlerer Abstand) */
  REF: 0.5,
  /** Kraft pro ln(level) – 0,6 ≈ Weite proportional zur Schwungstärke */
  K: 0.6,
};

export const flunkyPowerFromLevel = (level: number) => clamp(FLUNKY_POWER.REF + FLUNKY_POWER.K * Math.log(Math.max(0.02, level)), 0, 1);
/** Umkehrung: welche Schwungstärke (relativ zum kräftigen Wurf) diese Kraft braucht */
export const flunkyLevelFor = (power: number) => Math.exp((power - FLUNKY_POWER.REF) / FLUNKY_POWER.K);

// ------------------------------------------------------------------ Geometrie

/** Wurfrichtung des Teams entlang TV-x */
export const fwd = (team: Team) => (team === 'A' ? 1 : -1);
/** Einheitsvektor der Wurfrichtung am TV */
export const aimDir = (team: Team, aim: number): Point => ({ x: fwd(team) * Math.cos(aim), y: Math.sin(aim) });
/** Weite (px) aus der Kraft 0 … 1 */
export const flunkyDistance = (power: number) => FLUNKY.D_MIN + clamp(power, 0, 1) * (FLUNKY.D_MAX - FLUNKY.D_MIN);
/** Kraft, mit der der Ball nach `dist` px aufkommt */
export const flunkyPowerFor = (dist: number) => clamp((dist - FLUNKY.D_MIN) / (FLUNKY.D_MAX - FLUNKY.D_MIN), 0, 1);
/** Seitliche Verwehung (px, + = TV unten) nach `dist` px Flug */
export const windDrift = (wind: number, dist: number) => (wind * FLUNKY.WIND_PX * dist) / 150;
/** px → „8,4 m“ (Anzeige) */
export const fmtM = (px: number) => `${(Math.abs(px) / FLUNKY.PX_PER_M).toFixed(1).replace('.', ',')} m`;
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Wo der Ball landet (ohne Zufall – Handy, TV und Server rechnen gleich).
 * @param aim  Zielrichtung inkl. Wurf-Abweichung (rad, + = TV unten)
 * @param power 0 … 1
 */
export function computeLanding(team: Team, from: Point, aim: number, power: number, wind: number, bottle: Point) {
  const d = aimDir(team, aim);
  const L = flunkyDistance(power);
  const to: Point = { x: from.x + d.x * L, y: clamp(from.y + d.y * L + windDrift(wind, L), 108, 266) };
  return { to, ...flunkyMiss(from, to, bottle) };
}

/**
 * Abweichung des Aufpralls von der Flasche in Werfersicht: `along` > 0 = dahinter, < 0 = davor;
 * `lat` > 0 = am TV unterhalb, < 0 = oberhalb. Treffer = innerhalb der (vorn kürzeren) Ellipse.
 */
export function flunkyMiss(from: Point, to: Point, bottle: Point) {
  const n = dist(from, bottle) || 1;
  const ux = (bottle.x - from.x) / n;
  const uy = (bottle.y - from.y) / n;
  const rx = to.x - bottle.x;
  const ry = to.y - bottle.y;
  const along = rx * ux + ry * uy;
  // Querachse so gedreht, dass + für beide Teams „am TV unten“ heißt
  const s = ux >= 0 ? 1 : -1;
  const lat = (rx * -uy + ry * ux) * s;
  const a = along / (along < 0 ? FLUNKY.HIT_NEAR : FLUNKY.HIT_FAR);
  const l = lat / FLUNKY.HIT_LAT;
  return { along, lat, hit: a * a + l * l <= 1 };
}

/** Kurzes Feedback für einen Fehlwurf (TV und Handy). */
export function missHint(along: number, lat: number): string {
  const a = along < -FLUNKY.HIT_NEAR * 0.6 ? 'Zu kurz' : along > FLUNKY.HIT_FAR * 0.6 ? 'Zu weit' : '';
  const l = lat < -FLUNKY.HIT_LAT * 0.6 ? 'oben vorbei' : lat > FLUNKY.HIT_LAT * 0.6 ? 'unten vorbei' : '';
  if (a && l) return `${a} & ${l}!`;
  if (a) return `${a}!`;
  if (l) return `${l[0].toUpperCase()}${l.slice(1)}!`;
  return 'Knapp daneben!';
}

/**
 * Perfekter Wurf: Richtung (gegen den Wind vorgehalten) und Kraft, mit der der Ball genau an der Flasche aufkommt.
 * `behind` = so viel px hinter die Flaschenmitte zielen (der Trefferbereich reicht hinten weiter).
 */
export function flunkyIdeal(team: Team, from: Point, bottle: Point, wind: number, behind = 0) {
  const n = dist(from, bottle) || 1;
  const tx = bottle.x - from.x + ((bottle.x - from.x) / n) * behind;
  const ty = bottle.y - from.y + ((bottle.y - from.y) / n) * behind;
  let L = Math.hypot(tx, ty);
  for (let i = 0; i < 5; i++) L = Math.hypot(tx, ty - windDrift(wind, L));
  const aim = Math.atan2(ty - windDrift(wind, L), fwd(team) * tx);
  return { aim, power: flunkyPowerFor(L), dist: L };
}

/** Kraftbereich, der bei perfekter Richtung trifft (fürs Feedback am Handy) */
export function flunkyPowerWindow(team: Team, from: Point, bottle: Point, wind: number) {
  const ideal = flunkyIdeal(team, from, bottle, wind);
  return { ideal: ideal.power, lo: flunkyPowerFor(ideal.dist - FLUNKY.HIT_NEAR), hi: flunkyPowerFor(ideal.dist + FLUNKY.HIT_FAR), aim: ideal.aim };
}

/**
 * Schräg gewischt (Grad, + = nach rechts aus Werfersicht) → Wurf-Abweichung am TV (rad, + = unten).
 * 5° Spielraum, darüber zieht der Ball mit 15 % der Schräge mit.
 */
export function flunkyDev(team: Team, slantDeg: number): number {
  const a = Math.abs(slantDeg);
  if (!Number.isFinite(a) || a <= 5) return 0;
  const dev = (Math.sign(slantDeg) * (a - 5) * 0.15 * Math.PI) / 180;
  // aus Werfersicht rechts = am TV unten (Team Sonne) bzw. oben (Team Meer)
  return clamp(dev * fwd(team), -FLUNKY.DEV_MAX, FLUNKY.DEV_MAX);
}

// ------------------------------------------------------------------ Zufall (Server)

/** Neuer Wurfpunkt in der Wurfzone – seitlich spürbar anders als der letzte des Teams */
export function nextSpot(team: Team, prev: Point | null, rnd: () => number = Math.random): Point {
  const base = THROW_SPOT[team];
  let lat = 0;
  for (let i = 0; i < 20; i++) {
    lat = (rnd() * 2 - 1) * FLUNKY.SPOT_LAT;
    if (!prev || Math.abs(base.y + lat - prev.y) >= FLUNKY.SPOT_MOVE) break;
  }
  const depth = (rnd() * 2 - 1) * FLUNKY.SPOT_DEPTH;
  return { x: Math.round(base.x - fwd(team) * depth), y: Math.round(base.y + lat) };
}

/** Wo die Flasche nach dem Treffer wieder aufgestellt wird */
export function nextBottle(rnd: () => number = Math.random): Point {
  return {
    x: Math.round(BOTTLE.x + (rnd() * 2 - 1) * FLUNKY.BOTTLE_DEPTH),
    y: Math.round(BOTTLE.y + (rnd() * 2 - 1) * FLUNKY.BOTTLE_LAT),
  };
}

/** Wind dreht langsam: neuer Wert nahe am alten, ab und zu Flaute */
export function nextWind(prev: number, rnd: () => number = Math.random): number {
  const w = clamp(prev + (rnd() * 2 - 1) * FLUNKY.WIND_STEP, -1, 1);
  return Math.round((Math.abs(w) < 0.08 ? 0 : w) * 100) / 100;
}

/** Windstärke in Stufen 0 … 3 (Anzeige) */
export const windLevel = (w: number) => (Math.abs(w) < 0.12 ? 0 : Math.abs(w) < 0.45 ? 1 : Math.abs(w) < 0.75 ? 2 : 3);
export const WIND_WORD = ['windstill', 'schwach', 'mittel', 'stark'];

// ------------------------------------------------------------------ Stand

/** Durchschnittliches Restbier eines Teams (0 … 100) */
export function teamBeer(f: Pick<FlunkyState, 'teams' | 'beer'>, team: Team): number {
  const ids = f.teams[team];
  return ids.length ? ids.reduce((s, id) => s + (f.beer[id] ?? 0), 0) / ids.length : 100;
}

// ------------------------------------------------------------------ Bots & Simulation

/**
 * Wie genau ein Werfer ist (Bots und `npm run test:flunky`):
 * `aimDeg` = Streuung beim Ausrichten des Pfeils, `windErr` = Schätzfehler beim Vorhalten (Anteil der Verwehung),
 * `swing` = Streuung der Schwungstärke (σ von ln), `bias` = systematisch zu kräftig (ln), `slantDeg` = Schräge beim Wischen.
 */
export interface FlunkyThrower {
  aimDeg: number;
  windErr: number;
  swing: number;
  bias: number;
  slantDeg: number;
}

export const FLUNKY_THROWERS: Record<BotSkill, FlunkyThrower> = {
  /** Anfänger: Pfeil grob, Wind halb vergessen, Schwung schwankt stark und ist eher zu kräftig */
  leicht: { aimDeg: 3, windErr: 0.6, swing: 0.3, bias: 0.08, slantDeg: 9 },
  normal: { aimDeg: 1.8, windErr: 0.35, swing: 0.21, bias: 0.03, slantDeg: 6 },
  /** Geübt: Pfeil sitzt, Wind gut geschätzt, gleichmäßiger Schwung */
  profi: { aimDeg: 1, windErr: 0.2, swing: 0.14, bias: 0, slantDeg: 4 },
};

/** Normalverteilte Zufallszahl (Box-Muller) */
export function gauss(rnd: () => number = Math.random): number {
  const u = Math.max(1e-9, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/**
 * Wurf eines simulierten Werfers: `aim` = wohin er den Pfeil stellt, dann `dev`/`power` aus dem Wurf selbst.
 * Gleiche Eingaben wie vom Handy (`throw`: aim, dev, power).
 */
export function flunkyBotThrow(f: Pick<FlunkyState, 'spot' | 'bottle' | 'wind' | 'turnTeam'>, t: FlunkyThrower, rnd: () => number = Math.random) {
  const team = f.turnTeam;
  // Wind geschätzt (mit Fehler), leicht hinter die Flaschenmitte gezielt
  const windGuess = f.wind * (1 + gauss(rnd) * t.windErr);
  const ideal = flunkyIdeal(team, f.spot, f.bottle, windGuess, 2);
  const aim = clamp(ideal.aim + (gauss(rnd) * t.aimDeg * Math.PI) / 180, -FLUNKY.AIM_MAX, FLUNKY.AIM_MAX);
  const level = flunkyLevelFor(ideal.power) * Math.exp(gauss(rnd) * t.swing + t.bias);
  const dev = flunkyDev(team, gauss(rnd) * t.slantDeg);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { aim: r3(aim), dev: r3(dev), power: r3(flunkyPowerFromLevel(level)) };
}
