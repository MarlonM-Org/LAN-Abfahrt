import type { MiniKind, MiniSnapshot, PrivateState } from '../shared/types';

export interface MiniResult {
  /** Platzierungsgruppen: [[Sieger...], [Zweite...], ...] */
  groups: string[][];
  /** Text pro Spieler für den Ergebnis-Screen, z. B. "5 Punkte" */
  details: Record<string, string>;
  subtitle: string;
  /** Optional: Münzen pro Gruppe (sonst Standard-Staffel) */
  coins?: number[];
}

export interface MiniCtx {
  onChange(): void;
  finish(result: MiniResult): void;
  isConnected(id: string): boolean;
  nameOf(id: string): string;
}

export interface MiniGame {
  readonly kind: MiniKind;
  snapshot(): MiniSnapshot;
  privateFor?(playerId: string): PrivateState;
  input(playerId: string, action: string, payload: unknown): void;
  playerDisconnected(playerId: string): void;
  /** Nur der VIP: z. B. Diskussion überspringen */
  vipAction?(action: string): void;
  dispose(): void;
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

  clear() {
    for (const t of this.set) clearTimeout(t);
    this.set.clear();
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
