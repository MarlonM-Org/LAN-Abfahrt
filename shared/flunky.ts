import type { Point, Team } from './types';

/** Spielfeld in "Pixel-Welt"-Koordinaten (wird auf dem TV hochskaliert). */
export const WORLD = { W: 480, H: 270 };

export const BOTTLE: Point = { x: 240, y: 190 };
export const THROW_SPOT: Record<Team, Point> = {
  A: { x: 92, y: 190 },
  B: { x: 388, y: 190 },
};

/** Wurfweite bei voller Kraft (power = 1) */
export const RANGE = 220;
/** Wie stark der Wurfwinkel seitlich ablenkt */
export const LAT_K = 110;
/** Maximaler Windeinfluss in Radiant */
export const WIND_K = 0.12;
export const HIT_DX = 14;
export const HIT_DY = 10;

export const FLIGHT_MS = 1300;
/**
 * Zielen ist kein Zeitfaktor: `null` = der Werfer hat alle Zeit (vorher 30 s, dann Fehlwurf).
 * Der VIP kann den Wurf im Menü überspringen; wer offline geht, wird sofort übersprungen.
 */
export const FLUNKY_AIM_IDLE_MS: number | null = null;
/** Taps, die der Läufer braucht (hin zur Flasche + zurück) */
export const RUN_TAPS = 24;
/** Wie viel Bier pro Trink-Tap verschwindet */
export const DRINK_PER_TAP = 2.5;

export const TEAM_INFO: Record<Team, { name: string; color: string; colorNum: number }> = {
  A: { name: 'Team Sonne', color: '#f4c542', colorNum: 0xf4c542 },
  B: { name: 'Team Meer', color: '#3fa7e0', colorNum: 0x3fa7e0 },
};

export const otherTeam = (t: Team): Team => (t === 'A' ? 'B' : 'A');

/**
 * Berechnet, wo der Ball landet.
 * @param angle Wischwinkel am Handy in Radiant (0 = gerade nach oben, positiv = nach rechts)
 * @param power 0 … 1 (Länge der Wischbewegung)
 */
export function computeLanding(team: Team, angle: number, power: number, wind: number) {
  const from = THROW_SPOT[team];
  const dir = team === 'A' ? 1 : -1;
  const to: Point = {
    x: from.x + dir * power * RANGE,
    y: clamp(from.y + (angle + wind * WIND_K) * LAT_K, 118, 262),
  };
  const hit = Math.abs(to.x - BOTTLE.x) <= HIT_DX && Math.abs(to.y - BOTTLE.y) <= HIT_DY;
  return { from, to, hit };
}

/** Kurzes Feedback für einen Fehlwurf. */
export function missHint(team: Team, to: Point): string {
  const dir = team === 'A' ? 1 : -1;
  const along = (to.x - BOTTLE.x) * dir;
  const side = to.y - BOTTLE.y;
  if (Math.abs(along) > HIT_DX) return along < 0 ? 'Zu kurz!' : 'Zu weit!';
  if (Math.abs(side) > HIT_DY) return side < 0 ? 'Zu weit links!' : 'Zu weit rechts!';
  return 'Knapp daneben!';
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
