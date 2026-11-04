import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LeaderEntry, MiniKind } from '../shared/types';

const dir = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(dir, '../data/arcade.json');

/**
 * Arcade-Leaderboard: Punkte pro Spielername über alle Abende hinweg.
 * Gespeichert in data/arcade.json. Bots werden nicht gezählt.
 */
export class Leaderboard {
  private entries = new Map<string, LeaderEntry>();

  constructor() {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as LeaderEntry[];
      for (const e of raw) if (e?.name) this.entries.set(e.name, { ...e, perGame: e.perGame ?? {} });
    } catch {
      /* noch keine Daten */
    }
  }

  add(name: string, kind: MiniKind, points: number, won: boolean) {
    if (/^Bot /.test(name)) return;
    const e = this.entries.get(name) ?? { name, points: 0, games: 0, wins: 0, perGame: {} };
    e.points += points;
    e.games += 1;
    if (won) e.wins += 1;
    const g = e.perGame[kind] ?? { points: 0, plays: 0, wins: 0 };
    g.points += points;
    g.plays += 1;
    if (won) g.wins += 1;
    e.perGame[kind] = g;
    this.entries.set(name, e);
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify([...this.entries.values()], null, 2));
    } catch (e) {
      console.warn('Konnte Leaderboard nicht speichern:', e);
    }
  }

  reset() {
    this.entries.clear();
    this.save();
  }

  get list(): LeaderEntry[] {
    return [...this.entries.values()].sort((a, b) => b.points - a.points || b.wins - a.wins);
  }
}
