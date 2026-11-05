/**
 * Kofferpacken: gemeinsame Konstanten, Gepäck-Formen, Geometrie und Typen (Server, TV, Handy, Bots).
 *
 * Seitenansicht (Querschnitt) eines Kombis mit offener Heckklappe. Physik-Koordinaten wie beim
 * Wackelturm: 1 Block = BLOCK Einheiten, x nach rechts (0 = Innenseite der Rückbank-Lehne),
 * Physik-y nach unten (0 = Kofferraumboden). Im Zustand (Snapshot) ist y nach OBEN positiv.
 */

export const KOFFER = {
  BLOCK: 16,
  /** Innenbreite des Kofferraums (Blöcke, von der Lehne bis zur Ladekante) */
  W: 14,
  /** Dachlinie: bis hier schließt die Heckklappe (Blöcke über dem Boden) */
  ROOF: 9,
  /** Höhe der Ladekante hinten (Blöcke) – darüber ist der Kofferraum offen, Sachen können rausfallen */
  LIP: 2,
  /** Dicke der Ladekante (Blöcke) */
  LIP_T: 0.5,
  /** So weit (Blöcke) darf man ein Teil hinten über die Ladekante hinaus schieben */
  OVERHANG: 3,
  /** Sichtbarer Bereich einer Bahn (Blöcke): links/rechts, oben/unten */
  VIEW_X0: -3,
  VIEW_X1: 18,
  VIEW_TOP: 15,
  VIEW_BOTTOM: 2.8,
  /** Fallgeschwindigkeit in Blöcken pro Sekunde (normal / mit ▼) */
  FALL: 2.5,
  FAST: 14,
  /** Seitliches Raster (Blöcke) – Zellkanten liegen immer auf diesem Raster */
  STEP: 0.5,
  LOCK_MS: 400,
  LOCK_FAST_MS: 100,
  LOCK_MAX_MS: 1500,
  /** Ausweichen beim Verschieben/Drehen, wenn es knapp klemmt (Blöcke) */
  KICK: 0.5,
  /** Neues Teil erscheint so weit über dem höchsten Gepäckstück (Blöcke), mindestens über der Dachlinie */
  SPAWN_GAP: 2.5,
  SPAWN_MIN: 11.5,
  /** Liter pro Zelle (Anzeige) */
  LITER: 10,
  /** Teile über der Dachlinie oder hinten raus zählen nur so viel */
  OUTSIDE: 0.5,
  TIME_MS: 150000,
  COUNTDOWN_MS: 3500,
  /** Nach Ablauf: so lange darf noch etwas rausfallen, dann klappt die Heckklappe zu */
  SETTLE_MS: 1500,
  /** Klappe-zu-Animation + Wertung, bevor der Ergebnis-Screen kommt */
  OVER_MS: 4500,
  /** Ab so vielen Spielern packen je zwei ein Auto */
  TEAM_FROM: 9,
  /** Auto-Farben (eine pro Bahn) */
  COLORS: [0xe0503f, 0x3f8fe0, 0x46b04a, 0xf2c33a, 0x9b5fc0, 0xf0973a, 0x2fb5a5, 0xf07aa8, 0x8d5629, 0x5f6bd6, 0xa8c43a, 0x7f7b73],
};

export interface KofferItem {
  name: string;
  /** Zellen als [Spalte, Zeile], Zeile nach unten */
  cells: [number, number][];
  /** Dichte relativ (1 = normal) – schwere Teile drücken leichte weg */
  density: number;
}

const rect = (w: number, h: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out.push([c, r]);
  return out;
};

/** Urlaubsgepäck – unregelmäßige Formen und Gewichte */
export const KOFFER_ITEMS: KofferItem[] = [
  { name: 'Koffer', cells: rect(3, 2), density: 1.6 },
  { name: 'Kühlbox', cells: rect(2, 2), density: 1.8 },
  { name: 'Surfbrett', cells: rect(5, 1), density: 0.5 },
  { name: 'Luftmatratze', cells: rect(4, 1), density: 0.25 },
  { name: 'Sonnenschirm', cells: [[0, 0], [0, 1], [1, 1], [2, 1], [3, 1]], density: 0.7 },
  { name: 'Gitarre', cells: [[0, 0], [1, 0], [2, 0], [3, 0], [2, 1], [3, 1]], density: 0.6 },
  { name: 'Katzenkorb', cells: [[1, 0], [0, 1], [1, 1], [2, 1]], density: 1 },
  { name: 'Rucksack', cells: [[0, 0], [0, 1], [1, 1], [0, 2], [1, 2]], density: 1.1 },
  { name: 'Schuhkarton', cells: rect(2, 1), density: 0.8 },
  { name: 'Bobbycar', cells: [[0, 0], [0, 1], [1, 1], [2, 1]], density: 0.9 },
];

/** Ein Beutel: jedes Teil einmal, Schuhkartons (Lückenfüller) doppelt */
export const KOFFER_BAG: number[] = [...KOFFER_ITEMS.map((_, i) => i), 8];

/** Schwerpunkt einer Form in Zellen */
export function kofferCom(item: number): { x: number; y: number; cols: number; rows: number } {
  const cells = KOFFER_ITEMS[item].cells;
  let x = 0;
  let y = 0;
  let cols = 0;
  let rows = 0;
  for (const [c, r] of cells) {
    x += c + 0.5;
    y += r + 0.5;
    cols = Math.max(cols, c + 1);
    rows = Math.max(rows, r + 1);
  }
  return { x: x / cells.length, y: y / cells.length, cols, rows };
}

/** Zellmitten relativ zum Schwerpunkt, gedreht um `angle` (Bildschirm-Koordinaten, y nach unten, im Uhrzeigersinn) */
export function kofferCellOffsets(item: number, angle: number): { x: number; y: number }[] {
  const com = kofferCom(item);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const B = KOFFER.BLOCK;
  return KOFFER_ITEMS[item].cells.map(([c, r]) => {
    const dx = (c + 0.5 - com.x) * B;
    const dy = (r + 0.5 - com.y) * B;
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  });
}

/** x (Schwerpunkt) so einrasten, dass die Zellkanten auf dem Halbblock-Raster liegen */
export function kofferSnapX(item: number, rot: number, x: number): number {
  const offs = kofferCellOffsets(item, (rot * Math.PI) / 2);
  const h = KOFFER.STEP * KOFFER.BLOCK;
  const left = x + Math.min(...offs.map((o) => o.x)) - KOFFER.BLOCK / 2;
  return Math.round((x + Math.round(left / h) * h - left) * 1000) / 1000;
}

/**
 * Wertung eines liegenden Teils (Schwerpunkt x/y mit y nach OBEN, wie im Snapshot):
 * Zellen im Kofferraum zählen voll, Zellen über der Dachlinie oder hinten raus nur halb.
 */
export function kofferCellsInside(item: number, x: number, yUp: number, angle: number): { inside: number; outside: number } {
  const B = KOFFER.BLOCK;
  let inside = 0;
  let outside = 0;
  for (const o of kofferCellOffsets(item, angle)) {
    const cx = x + o.x;
    const cy = yUp - o.y;
    if (cx > 0 && cx < KOFFER.W * B && cy > 0 && cy < KOFFER.ROOF * B) inside++;
    else outside++;
  }
  return { inside, outside };
}

/** Das gerade fallende (gesteuerte) Teil. x/y: Schwerpunkt, y = Höhe über dem Boden (nach oben). */
export interface KofferActive {
  id: number;
  item: number;
  /** Farbvariante 0–2 */
  v: number;
  x: number;
  y: number;
  rot: number;
  /** Landehöhe, wenn es jetzt fiele; null = fällt raus */
  gy: number | null;
  /** Aufgesetzt, aber noch steuerbar (Lock-Delay) */
  rest: boolean;
  /** Wer steuert dieses Teil (bei Teams wechselt das) */
  owner: string;
}

export interface KofferCar {
  id: string;
  /** Ein Spieler oder (ab 9 Spielern) ein Zweier-Team */
  owners: string[];
  next: [number, number];
  active: KofferActive | null;
  /** Liegende Teile, flach: [id, Teil, Variante, x, y, Winkel·100, …] (y nach oben, Winkel im Uhrzeigersinn) */
  pieces: number[];
  /** Aktuelle Wertung in Litern */
  liters: number;
  /** Füllstand des Kofferraums (0–100) */
  pct: number;
  /** Teile im Auto */
  count: number;
  /** Rausgefallene Teile */
  lost: number;
  /** Zählt hoch, wenn etwas rausfällt (Effekte) */
  lostSeq: number;
  /** Bis oben voll – es kommt nichts mehr */
  full: boolean;
}

export interface KofferState {
  sub: 'countdown' | 'play' | 'settle' | 'over';
  endsIn: number;
  cars: KofferCar[];
}

export const kofferLiters = (n: number) => `${Math.round(n)} L`;
