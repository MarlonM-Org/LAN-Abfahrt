/**
 * Wii Balance Board: gemeinsame Typen und Helfer (Server, TV, Handy, Bots).
 *
 * Das Board hängt per Bluetooth am Laptop. Die TV-Seite liest es per WebHID aus (`client/host/balanceBoard.ts`)
 * und schickt rund 30-mal pro Sekunde einen `BalanceSample` an den Server (Event `bb:sample`, nur vom Laptop
 * angenommen). Ohne Board erzeugt die TV-Seite dieselben Werte aus den Pfeiltasten (Tastatur-Ersatz).
 * Bots schicken ihre Werte als Minispiel-Eingabe `bb` – nur, wenn sie selbst gerade dran sind.
 *
 * Board-Spiele laufen reihum: immer genau einer steht auf dem Board, die anderen schauen zu.
 */

/** Ein Messwert vom Board */
export interface BalanceSample {
  /** Gesamtgewicht in kg */
  w: number;
  /** Schwerpunkt links (−1) … rechts (+1) */
  x: number;
  /** Schwerpunkt hinten/Fersen (−1) … vorne/Zehen (+1) */
  y: number;
}

/** Live-Anzeige für TV/Handy (gerundet, damit der Zustand klein bleibt) */
export interface BalanceLive {
  x: number;
  y: number;
  /** Gewicht relativ zum eingemessenen Körpergewicht (1 = normal stehen); 0 = noch nicht eingemessen */
  r: number;
  /** Gewicht in kg */
  w: number;
}

export const BB = {
  /** Ohne neuen Messwert seit so vielen ms gilt das Board als getrennt */
  STALE_MS: 600,
  /** Ab so viel kg steht jemand drauf */
  MIN_KG: 15,
  /** So lange ruhig stehen = eingemessen (Körpergewicht = Basis für Sprung-Erkennung) */
  CALIB_MS: 1400,
  /** Spätestens nach so langem Draufstehen gilt man als eingemessen (auch wenn es wackelt) */
  CALIB_MAX_MS: 5000,
  /** Höchstens so lange warten, bis der Spieler auf dem Board steht – dann ist der Nächste dran */
  READY_MS: 30_000,
  /** Sendetakt der TV-Seite */
  SEND_MS: 33,
  /** Gewichtssprung (Abdrücken/Hochschnellen) relativ zum Körpergewicht */
  JUMP_HI: 1.2,
  JUMP_LO: 0.72,
};

/** Minispiele, die das Balance Board brauchen (nicht im Zufall, nicht auf dem Spielbrett, nicht im Turnier) */
export const BALANCE_KINDS = ['skisprung', 'teppich', 'kugel'] as const;
export type BalanceKind = (typeof BALANCE_KINDS)[number];
/** Bestleistung pro Spieler und Spiel: Schanzen-Springen = weiteste Sprungweite (höher), Teppich/Kugel = Bestzeit (niedriger) */
export const RECORD_DIR: Record<BalanceKind, 'high' | 'low'> = { skisprung: 'high', teppich: 'low', kugel: 'low' };

/** Ein Eintrag der ewigen Bestenliste */
export interface BoardRecord {
  name: string;
  value: number;
  detail?: string;
}

/** Ergebnis einer Rekord-Prüfung: neuer Gesamtrekord oder nur persönliche Bestleistung (sonst `null`) */
export type RecordResult = 'record' | 'pb';

export const isBalanceKind = (k: string | undefined | null): k is BalanceKind => !!k && (BALANCE_KINDS as readonly string[]).includes(k);

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Rohdaten vom Netz prüfen → Messwert oder null */
export function parseSample(raw: unknown): BalanceSample | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const w = Number(r.w);
  const x = Number(r.x);
  const y = Number(r.y);
  if (![w, x, y].every(Number.isFinite)) return null;
  return { w: clamp(w, 0, 250), x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
}

/** Für den Snapshot runden */
export const liveOf = (s: BalanceSample | null, base: number): BalanceLive | null =>
  s ? { x: Math.round(s.x * 100) / 100, y: Math.round(s.y * 100) / 100, r: base ? Math.round((s.w / base) * 100) / 100 : 0, w: Math.round(s.w) } : null;

/**
 * Vier Sensorwerte (kg) → Gewicht + Schwerpunkt. Die Sensoren sitzen in den Ecken des Boards, das Board liegt quer
 * vor dem TV (Power-Knopf zeigt zum Spieler). `flipY` tauscht vorne/hinten, falls das Board andersherum liegt.
 */
export function centerOfPressure(tl: number, tr: number, bl: number, br: number, flipY = false): BalanceSample {
  const w = Math.max(0, tl) + Math.max(0, tr) + Math.max(0, bl) + Math.max(0, br);
  if (w < 1) return { w, x: 0, y: 0 };
  const x = (tr + br - (tl + bl)) / w;
  let y = (tl + tr - (bl + br)) / w;
  if (flipY) y = -y;
  // Die Füße stehen nie ganz außen: ±0,6 reicht für den vollen Ausschlag
  return { w, x: clamp(x / 0.6, -1, 1), y: clamp(y / 0.6, -1, 1) };
}

/** Zufall mit festem Startwert (gleiche Strecke auf Server und TV) */
export function seeded(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gemeinsamer Teil beider Board-Spiele: wer ist dran, wie weit ist das Einmessen? */
export interface BalanceTurn {
  /** Ewige Bestenliste dieses Spiels (Top 5, alle Abende) */
  records: BoardRecord[];
  /** Reihenfolge der aktuellen Runde */
  order: string[];
  /** Wer gerade auf dem Board steht (bzw. stehen soll) */
  active: string | null;
  /** Kommt ein frischer Messwert an (Board verbunden bzw. Tastatur-Ersatz aktiv)? */
  board: boolean;
  /** Live-Werte des aktiven Spielers */
  bal: BalanceLive | null;
  /** Einmessen 0…1 (Phase `ready`) */
  calib: number;
  /** Restzeit der aktuellen Phase (ms, 0 = keine) */
  endsIn: number;
}
