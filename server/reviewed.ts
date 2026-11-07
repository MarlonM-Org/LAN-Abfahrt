import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MINI_INFO } from '../shared/games';
import type { MiniKind } from '../shared/types';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/status.json');
/** So oft schaut der Server höchstens nach, ob sich die Datei geändert hat */
const CHECK_MS = 5000;

let cache: MiniKind[] = [];
let mtime = -1;
let checkedAt = 0;

/**
 * Spiele, die Marlon schon getestet hat = Spiele mit Feedback-Eintrag in `docs/status.json` (Quelle der Wahrheit der
 * Status-Seite, egal ob positiv, offen, in Arbeit oder umgesetzt). Für die Arcade-Sortierung „Getestet zuerst“.
 * Änderungen an der Datei kommen ohne Neustart an (höchstens alle 5 s geprüft); fehlt sie, ist die Liste leer.
 */
export function reviewedKinds(now = Date.now()): MiniKind[] {
  if (now - checkedAt < CHECK_MS) return cache;
  checkedAt = now;
  try {
    const m = fs.statSync(FILE).mtimeMs;
    if (m === mtime) return cache;
    mtime = m;
    const feedback = (JSON.parse(fs.readFileSync(FILE, 'utf8')) as { feedback?: Record<string, unknown> }).feedback ?? {};
    cache = Object.keys(feedback).filter((k): k is MiniKind => k in MINI_INFO);
  } catch {
    cache = [];
  }
  return cache;
}
