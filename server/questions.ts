import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const MAX = 200;

/**
 * Eigene "Wer würde eher …?"-Fragen der Gruppe.
 * Werden in data/questions.json gespeichert, damit sie den nächsten Abend überleben.
 */
export class QuestionStore {
  private list: string[] = [];
  private file: string;

  constructor(
    file = 'questions.json',
    private kind: 'wwe' | 'nhie' = 'wwe',
  ) {
    this.file = path.resolve(dir, '../data', file);
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(raw)) this.list = raw.filter((q) => typeof q === 'string').slice(0, MAX);
    } catch {
      this.list = [];
    }
  }

  get all() {
    return [...this.list];
  }

  add(question: string): string | null {
    let q = question.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (q.length < 4) return null;
    if (this.kind === 'wwe') {
      q = q.replace(/^wer würde eher\s*/i, '');
      if (!q.startsWith('...')) q = `... ${q}`;
      if (!q.endsWith('?')) q += '?';
    } else {
      q = q.replace(/^ich hab(e)? noch nie\s*/i, '');
      if (!q.startsWith('...')) q = `... ${q}`;
      if (!/[.!?]$/.test(q)) q += '.';
    }
    if (this.list.includes(q)) return q;
    this.list.push(q);
    if (this.list.length > MAX) this.list.shift();
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.list, null, 2));
    } catch (e) {
      console.warn('Konnte Fragen nicht speichern:', e);
    }
    return q;
  }
}
