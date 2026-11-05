/**
 * Zauber-Arena (à la Spellsworn, stark vereinfacht): gemeinsame Konstanten und Geometrie
 * (Server, TV, Handy, Bots). Koordinaten in Welt-Pixeln (480 × 270), Draufsicht.
 *
 * Die Steinplattform ist ein Raster aus Kacheln über einem Lavasee. Welche Kacheln es gibt
 * und in welcher Reihenfolge sie zerbröckeln, folgt deterministisch aus `seed` und der
 * Spielerzahl – der Server schickt deshalb nur zwei Zähler: `cracked` (so viele Kacheln der
 * Reihenfolge haben Risse/blinken) und `fallen` (so viele sind schon in der Lava versunken).
 */

export const ZAUBER = {
  COLS: 38,
  ROWS: 19,
  TILE: 12,
  OX: 12,
  OY: 38,
  TICK_MS: 50,

  COUNTDOWN_MS: 3000,
  /** Kurz warten, bevor die Runde ausgewertet wird (gleichzeitiges Verpuffen = Unentschieden) */
  END_DELAY_MS: 800,
  ROUND_OVER_MS: 3800,
  /** Erst danach fängt der Rand an zu bröckeln */
  GRACE_MS: 6000,
  /** In dieser Zeit bröckelt die Plattform bis auf die letzte Insel */
  SHRINK_MS: 36000,
  /** Danach zerfällt auch die letzte Insel (Einsturz) */
  ROUND_MS: 50000,
  /** Abstand, in dem die letzten Kacheln beim Einsturz nacheinander reißen */
  SUDDEN_STEP_MS: 380,
  /** Sicherheitsnetz: so lange dauert eine Runde höchstens (ab LOS) */
  HARD_CAP_MS: 75000,
  /** Kacheln der letzten Insel */
  CORE_TILES: 7,
  /** So lange blinkt eine Kachel mit Rissen, bevor sie in der Lava versinkt */
  CRACK_MS: 1600,

  HP: 100,
  /** Lava-Schaden pro Sekunde */
  LAVA_DPS: 28,

  RADIUS: 6,
  ACCEL: 520,
  /** Reibung (1/s) – Endgeschwindigkeit ≈ ACCEL / FRICTION */
  FRICTION: 6.5,
  /** Reibung, während man weggeschleudert wird (rutscht weit) */
  FRICTION_HIT: 2.6,
  /** Kurze Kontrollsperre nach einem Treffer */
  STUN_MS: 340,

  // --- Zauber 1: Zielsuch-Feuerball (ANGRIFF)
  BOLT_CD_MS: 1200,
  BOLT_SPEED: 150,
  BOLT_LIFE_MS: 3000,
  /** Erst danach fängt der Feuerball an zu suchen (die grobe Richtung zählt) */
  BOLT_HOMING_DELAY_MS: 120,
  /** Maximale Drehrate (rad/s) – so kann man ausweichen */
  BOLT_TURN: 2.1,
  /** Sucht nur Ziele in diesem Umkreis … */
  BOLT_RANGE: 140,
  /** … und innerhalb dieses Kegels (cos des halben Öffnungswinkels, ±75°) */
  BOLT_CONE_COS: 0.26,
  BOLT_R: 3.5,
  BOLT_DMG: 13,
  /** Rückstoß beim Treffer (px/s) … */
  KNOCK: 165,
  /** … wird stärker, je weniger Leben man hat (bei 0 LP × (1 + KNOCK_LOW_HP)) */
  KNOCK_LOW_HP: 0.8,
  /** Zwei Feuerbälle verschiedener Zauberer löschen sich gegenseitig aus */
  CLASH_R: 7,

  // --- Zauber 2: Eilzauber (EILE)
  SPRINT_CD_MS: 4000,
  SPRINT_MS: 1500,
  /** Beschleunigung × Faktor während des Sprints */
  SPRINT_MULT: 1.9,
  /** Kurzer Schub am Anfang (px/s) */
  SPRINT_BURST: 190,

  /** Ein Sturz in die Lava zählt für den, der zuletzt getroffen hat (so kurz danach) */
  CREDIT_MS: 3000,
  WIN_ROUNDS: 3,
  MAX_ROUNDS: 5,
};

/** '#' Stein, '!' Risse (trägt noch), '.' Lava */
export type ZauberTile = '#' | '!' | '.';

export const zauberIdx = (c: number, r: number) => r * ZAUBER.COLS + c;
export const zauberTileX = (c: number) => ZAUBER.OX + c * ZAUBER.TILE;
export const zauberTileY = (r: number) => ZAUBER.OY + r * ZAUBER.TILE;
export const ZAUBER_CX = ZAUBER.OX + (ZAUBER.COLS * ZAUBER.TILE) / 2;
export const ZAUBER_CY = ZAUBER.OY + (ZAUBER.ROWS * ZAUBER.TILE) / 2;

/** Kachel unter einem Weltpunkt (oder null außerhalb des Rasters) */
export function zauberCellAt(x: number, y: number): [number, number] | null {
  const c = Math.floor((x - ZAUBER.OX) / ZAUBER.TILE);
  const r = Math.floor((y - ZAUBER.OY) / ZAUBER.TILE);
  if (c < 0 || r < 0 || c >= ZAUBER.COLS || r >= ZAUBER.ROWS) return null;
  return [c, r];
}

/** Halbachsen (in Kacheln) der Plattform je nach Spielerzahl */
export function zauberRadii(n: number): [number, number] {
  const k = Math.max(0, Math.min(10, n - 2)) / 10;
  return [11 + k * 5.5, 6.6 + k * 2.6];
}

function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ZauberArena {
  /** Kachel gehört zur Startplattform */
  shape: Uint8Array;
  /** Bröckel-Reihenfolge (Kachel-Indizes): außen zuerst, die letzte Insel ganz hinten */
  order: number[];
  /** Platz einer Kachel in `order` (−1 = von Anfang an Lava) */
  rank: Int16Array;
}

const arenaCache = new Map<string, ZauberArena>();

/** Startplattform + Bröckel-Reihenfolge – deterministisch aus Seed und Spielerzahl */
export function zauberArena(seed: number, n: number): ZauberArena {
  const key = `${seed}:${n}`;
  const hit = arenaCache.get(key);
  if (hit) return hit;
  const r = seeded(seed);
  const [rx, ry] = zauberRadii(n);
  const mc = (ZAUBER.COLS - 1) / 2;
  const mr = (ZAUBER.ROWS - 1) / 2;
  // Unregelmäßiger Rand: Radius schwankt mit dem Winkel (ein paar Sinus-Wellen)
  const p1 = r() * 6.28;
  const p2 = r() * 6.28;
  const wob = (a: number) => 1 + Math.sin(a * 3 + p1) * 0.06 + Math.sin(a * 5 + p2) * 0.04;
  const shape = new Uint8Array(ZAUBER.COLS * ZAUBER.ROWS);
  const solid: { i: number; d: number }[] = [];
  for (let row = 0; row < ZAUBER.ROWS; row++) {
    for (let c = 0; c < ZAUBER.COLS; c++) {
      const dx = (c - mc) / rx;
      const dy = (row - mr) / ry;
      const d = Math.hypot(dx, dy) / wob(Math.atan2(dy, dx));
      if (d <= 1) {
        const i = zauberIdx(c, row);
        shape[i] = 1;
        solid.push({ i, d });
      }
    }
  }
  solid.sort((a, b) => a.d - b.d || a.i - b.i);
  const core = solid.slice(0, ZAUBER.CORE_TILES);
  // Außen zuerst, mit Zufall (so entstehen Buchten und Inseln)
  const rest = solid.slice(ZAUBER.CORE_TILES).map((s) => ({ i: s.i, k: s.d + r() * 0.32 }));
  rest.sort((a, b) => b.k - a.k);
  const order = [...rest.map((s) => s.i), ...core.reverse().map((s) => s.i)];
  const rank = new Int16Array(ZAUBER.COLS * ZAUBER.ROWS).fill(-1);
  order.forEach((i, k) => (rank[i] = k));
  const arena = { shape, order, rank };
  if (arenaCache.size > 32) arenaCache.clear();
  arenaCache.set(key, arena);
  return arena;
}

/** Zustand einer Kachel aus den beiden Zählern */
export function zauberTile(arena: ZauberArena, i: number, cracked: number, fallen: number): ZauberTile {
  const k = arena.rank[i];
  if (k < 0 || k < fallen) return '.';
  return k < cracked ? '!' : '#';
}

/** Steht man an diesem Punkt auf Stein? (Kacheln mit Rissen tragen noch) */
export function zauberSolidAt(arena: ZauberArena, fallen: number, x: number, y: number) {
  const cell = zauberCellAt(x, y);
  if (!cell) return false;
  const k = arena.rank[zauberIdx(cell[0], cell[1])];
  return k >= fallen;
}

/** Mittelpunkt der noch heilen Kacheln (für Bots) */
export function zauberSafeCenter(arena: ZauberArena, cracked: number): { x: number; y: number; n: number } {
  let x = 0;
  let y = 0;
  let n = 0;
  for (let k = Math.max(0, cracked); k < arena.order.length; k++) {
    const i = arena.order[k];
    x += zauberTileX(i % ZAUBER.COLS) + ZAUBER.TILE / 2;
    y += zauberTileY(Math.floor(i / ZAUBER.COLS)) + ZAUBER.TILE / 2;
    n++;
  }
  if (!n) return { x: ZAUBER_CX, y: ZAUBER_CY, n: 0 };
  return { x: x / n, y: y / n, n };
}

/** Startplätze: Kreis um die Mitte */
export function zauberSpawns(n: number): { x: number; y: number }[] {
  const [rx, ry] = zauberRadii(n);
  const ax = rx * ZAUBER.TILE * 0.62;
  const ay = ry * ZAUBER.TILE * 0.62;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: ZAUBER_CX + Math.cos(a) * ax, y: ZAUBER_CY + Math.sin(a) * ay };
  });
}
