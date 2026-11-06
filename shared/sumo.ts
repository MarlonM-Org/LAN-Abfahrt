/**
 * Sumo-Steg: gemeinsame Konstanten und Geometrie (Server, TV, Handy, Bots).
 * Koordinaten in Welt-Pixeln (480 × 270). Der Steg ist ein Raster aus Planken,
 * Planke (c, r) liegt bei OX + c·TILE … OX + (c+1)·TILE.
 */

export const SUMO = {
  COLS: 26,
  ROWS: 13,
  TILE: 16,
  OX: 32,
  OY: 44,
  TICK_MS: 33,
  COUNTDOWN_MS: 3000,
  /** Kurz warten, bevor die Runde ausgewertet wird (gleichzeitiges Platschen = Unentschieden) */
  END_DELAY_MS: 800,
  ROUND_OVER_MS: 3800,
  /** Erst danach fangen Planken an abzubrechen */
  GRACE_MS: 5000,
  /** So lange brechen die Planken bis auf die letzte Insel weg */
  SHRINK_MS: 24000,
  /** Danach bricht auch die letzte Insel (Sudden Death) */
  ROUND_MS: 45000,
  /** Mindestgröße der letzten Insel (Planken) */
  CORE_TILES: 6,
  /** So lange knackt eine Planke, bevor sie wegbricht */
  CRACK_MS: 1300,
  /** Fallen ins Wasser: so lange sieht man das Eintauchen */
  FALL_MS: 600,
  RADIUS: 6.5,
  ACCEL: 560,
  /** Reibung (1/s) – Endgeschwindigkeit ≈ ACCEL / FRICTION */
  FRICTION: 6,
  /** Reibung, während man weggeschubst wurde (rutscht weiter) */
  FRICTION_HIT: 3.4,
  DASH_SPEED: 210,
  /** Reibung (1/s) während des Sprints */
  DASH_FRICTION: 1.2,
  /** Sprintdauer – mit DASH_BRAKE trägt ein Rempler aus dem Stand ≈ 49 px (3 Planken) weit, getroffen wird bis ≈ 49 px Mitte–Mitte */
  DASH_MS: 200,
  /** Abbremsen am Ende eines Sprints ohne Treffer (Faktor auf die Geschwindigkeit) – weniger Überschießen */
  DASH_BRAKE: 0.5,
  DASH_COOLDOWN_MS: 1300,
  /** Stoß, den ein Rempler beim Gegner auslöst (Getroffene fliegen ≈ 53 px, also weiter als der Sprint selbst) */
  KNOCK: 220,
  /** Faktor, wenn der Getroffene selbst gerade rempelt (Frontalzusammenstoß) */
  KNOCK_DASHING: 1.5,
  /** Was dem Rempler nach einem Treffer an Tempo bleibt (der Schwung geht in den Getroffenen) */
  KNOCK_RECOIL: 0.2,
  /** Kurze Kontrollsperre nach einem Treffer */
  STUN_MS: 380,
  /** Normales Anrempeln ohne Dash: kleiner Abpraller */
  BUMP: 40,
  /** Schubser zählt als „ins Wasser geschubst“, wenn der Sturz so kurz danach passiert */
  CREDIT_MS: 3500,
  WIN_ROUNDS: 2,
  MAX_ROUNDS: 3,
};

/** '#' Planke, '!' knackt gleich, '.' Wasser */
export type SumoTile = '#' | '!' | '.';

export const sumoIdx = (c: number, r: number) => r * SUMO.COLS + c;
export const sumoTileX = (c: number) => SUMO.OX + c * SUMO.TILE;
export const sumoTileY = (r: number) => SUMO.OY + r * SUMO.TILE;

/** Planke unter einem Weltpunkt (oder null außerhalb des Rasters) */
export function sumoCellAt(x: number, y: number): [number, number] | null {
  const c = Math.floor((x - SUMO.OX) / SUMO.TILE);
  const r = Math.floor((y - SUMO.OY) / SUMO.TILE);
  if (c < 0 || r < 0 || c >= SUMO.COLS || r >= SUMO.ROWS) return null;
  return [c, r];
}

/** Steht man an diesem Punkt auf Holz? (knackende Planken tragen noch) */
export function sumoSolidAt(tiles: string, x: number, y: number) {
  const cell = sumoCellAt(x, y);
  if (!cell) return false;
  return tiles[sumoIdx(cell[0], cell[1])] !== '.';
}

/** Mitte des Rasters in Weltkoordinaten */
export const SUMO_CX = SUMO.OX + (SUMO.COLS * SUMO.TILE) / 2;
export const SUMO_CY = SUMO.OY + (SUMO.ROWS * SUMO.TILE) / 2;

/** Halbachsen (in Planken) des ovalen Stegs je nach Spielerzahl */
export function sumoRadii(n: number): [number, number] {
  const k = Math.max(0, Math.min(10, n - 2)) / 10;
  return [7.5 + k * 5, 4.2 + k * 2.3];
}

/** Startform: ovale Plattform, Ränder leicht ausgefranst, plus kleine Stege nach links/rechts */
export function sumoShape(n: number): string {
  const [rx, ry] = sumoRadii(n);
  const mc = (SUMO.COLS - 1) / 2;
  const mr = (SUMO.ROWS - 1) / 2;
  let out = '';
  for (let r = 0; r < SUMO.ROWS; r++) {
    for (let c = 0; c < SUMO.COLS; c++) {
      const dx = (c - mc) / rx;
      const dy = (r - mr) / ry;
      // Ecken etwas eckiger als ein reines Oval (sieht mehr nach Steg aus)
      const d = Math.pow(Math.pow(Math.abs(dx), 3) + Math.pow(Math.abs(dy), 3), 1 / 3);
      const pier = Math.abs(r - mr) <= 0.5 && Math.abs(dx) <= 1 + 2.2 / rx;
      out += d <= 1 || pier ? '#' : '.';
    }
  }
  return out;
}

/** Startplätze: Kreis um die Mitte */
export function sumoSpawns(n: number): { x: number; y: number }[] {
  const [rx, ry] = sumoRadii(n);
  const ax = rx * SUMO.TILE * 0.6;
  const ay = ry * SUMO.TILE * 0.6;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: SUMO_CX + Math.cos(a) * ax, y: SUMO_CY + Math.sin(a) * ay };
  });
}
