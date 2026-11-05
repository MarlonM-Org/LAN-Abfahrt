import type { MiniKind, MiniSnapshot, PrivateState, SkipInfo } from '../shared/types';
import { possessive } from '../shared/players';

export interface MiniResult {
  /** Platzierungsgruppen: [[Sieger...], [Zweite...], ...] */
  groups: string[][];
  /** Text pro Spieler für den Ergebnis-Screen, z. B. "5 Punkte" */
  details: Record<string, string>;
  subtitle: string;
  /** Optional: Münzen pro Gruppe (sonst Standard-Staffel) */
  coins?: number[];
  /** Date Night: gemeinsam verdiente Herzen (0–10) */
  hearts?: number;
  /** Trinkspiel: Schlücke pro Spieler */
  sips?: Record<string, number>;
}

export interface MiniCtx {
  onChange(): void;
  finish(result: MiniResult): void;
  /** Verbunden – oder erst seit < 3 s weg (Gnadenfrist des Raums: kurze Wackler merkt das Spiel nicht) */
  isConnected(id: string): boolean;
  /** Seit wie vielen ms ohne Verbindung (0 = verbunden). Eingefrorene Figuren scheiden nach OFFLINE_OUT_MS aus. */
  offlineMs?(id: string): number;
  /** Vom VIP/Laptop entfernt (kommt in diesem Spiel nicht mehr zurück) */
  isGone?(id: string): boolean;
  nameOf(id: string): string;
  /** Testspieler? (z. B. für Hinweise, die Menschen per Zuruf bekommen) */
  isBot?(id: string): boolean;
  /** Aussehen eines Spielers (z. B. Shirt-Farbe als Spur) */
  lookOf?(id: string): import('../shared/types').Look | undefined;
  mode: import('../shared/types').GameMode;
}

export interface MiniGame {
  readonly kind: MiniKind;
  snapshot(): MiniSnapshot;
  privateFor?(playerId: string): PrivateState;
  input(playerId: string, action: string, payload: unknown): void;
  playerDisconnected(playerId: string): void;
  /** Nur der VIP: z. B. Diskussion überspringen */
  vipAction?(action: string): void;
  /**
   * Was VIP/Laptop gerade überspringen können (Zug eines Spielers, Schreib-/Abstimmungsphase, Info-Screen) –
   * null, wenn nichts. Echtzeit-Spiele implementieren das nicht.
   * Fehlende Eingaben zählen beim Überspringen als „passen“ bzw. werden automatisch ergänzt.
   */
  skippable?(): SkipInfo | null;
  /** Überspringen ausführen (der Raum ruft das nur auf, wenn skippable() etwas liefert) */
  skip?(): void;
  dispose(): void;
}

/** So lange bleibt eine Figur ohne Verbindung eingefroren + unverwundbar im Spiel, dann scheidet sie aus. */
export const OFFLINE_OUT_MS = 15_000;

/**
 * Optionaler Phasen-Timer: `ms === null` heißt „kein Zeitlimit“ (der VIP kann überspringen).
 * Liefert die Deadline (0 = keine → `endsIn: 0`, Handy/TV zeigen dann keinen Countdown).
 */
export function phaseTimer(timers: Timers, ms: number | null, fn: () => void): number {
  if (ms == null) return 0;
  timers.later(ms, fn);
  return Date.now() + ms;
}

/** Restzeit für den Snapshot (0 = kein Zeitlimit bzw. abgelaufen) */
export const endsIn = (deadline: number) => (deadline ? Math.max(0, deadline - Date.now()) : 0);

/**
 * Knopftext für „auf Eingaben warten“: fehlt genau einer → „Bens Antwort überspringen“, sonst der allgemeine Text.
 */
export function waitLabel(ctx: MiniCtx, missing: string[], what: string, general: string): string {
  return missing.length === 1 ? `${possessive(ctx.nameOf(missing[0]))} ${what} überspringen` : general;
}

/** Kleine Helferklasse, damit beim Beenden eines Spiels keine Timer weiterlaufen. */
export class Timers {
  private set = new Set<NodeJS.Timeout>();

  later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.set.delete(t);
      fn();
    }, ms);
    this.set.add(t);
  }

  private intervals = new Set<NodeJS.Timeout>();

  every(ms: number, fn: () => void) {
    const t = setInterval(fn, ms);
    this.intervals.add(t);
  }

  clear() {
    for (const t of this.set) clearTimeout(t);
    this.set.clear();
    for (const t of this.intervals) clearInterval(t);
    this.intervals.clear();
  }
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Gruppiert Spieler nach Punkten (absteigend) → Platzierungsgruppen. */
export function groupByScore(ids: string[], score: (id: string) => number): string[][] {
  const sorted = [...ids].sort((a, b) => score(b) - score(a));
  const groups: string[][] = [];
  let last: number | null = null;
  for (const id of sorted) {
    const s = score(id);
    if (last === s) groups[groups.length - 1].push(id);
    else groups.push([id]);
    last = s;
  }
  return groups;
}

export const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
