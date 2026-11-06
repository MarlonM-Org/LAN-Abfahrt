import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BalanceKind, type BoardRecord, RECORD_DIR, type RecordResult } from '../shared/balance';

const dir = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.RECORDS_FILE ?? path.resolve(dir, '../data/records.json');

interface Entry {
  value: number;
  detail?: string;
  at: number;
}

/**
 * Ewige Bestleistungen pro Spieler (Name) und Board-Spiel: Sprungweite, Bestzeiten. Gespeichert in data/records.json,
 * Bots zählen nicht (das entscheidet der Raum). Wird – anders als die Punkte-Tabelle – nicht mit „Leaderboard zurücksetzen“ gelöscht.
 */
export class Records {
  private data: Record<string, Record<string, Entry>> = {};

  constructor(private file = FILE) {
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) ?? {};
    } catch {
      /* noch keine Daten */
    }
  }

  private better(kind: BalanceKind, a: number, b: number) {
    return RECORD_DIR[kind] === 'high' ? a > b : a < b;
  }

  /** Neue Leistung melden: `record` = bester Wert aller Spieler, `pb` = eigene Bestleistung, sonst `null` */
  submit(kind: BalanceKind, name: string, value: number, detail?: string): RecordResult | null {
    if (!Number.isFinite(value)) return null;
    const book = (this.data[kind] ??= {});
    const prev = book[name];
    if (prev && !this.better(kind, value, prev.value)) return null;
    const top = this.top(kind, 1)[0];
    const record = !top || this.better(kind, value, top.value);
    book[name] = { value, ...(detail ? { detail } : {}), at: Date.now() };
    this.save();
    return record ? 'record' : 'pb';
  }

  top(kind: BalanceKind, n = 5): BoardRecord[] {
    const dirHigh = RECORD_DIR[kind] === 'high';
    return Object.entries(this.data[kind] ?? {})
      .map(([name, e]) => ({ name, value: e.value, ...(e.detail ? { detail: e.detail } : {}) }))
      .sort((a, b) => (dirHigh ? b.value - a.value : a.value - b.value))
      .slice(0, n);
  }

  private save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.warn('Konnte Rekorde nicht speichern:', e);
    }
  }
}
