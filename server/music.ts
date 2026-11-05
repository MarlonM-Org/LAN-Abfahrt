/**
 * Musik-Bibliothek des Servers: eigene Songs (Song-Format v2) als JSON in `data/music/`,
 * Szenen-Zuordnung in `data/music/assign.json`. REST für TV-Menü und Musik-Werkstatt,
 * Änderungen gehen zusätzlich live per Socket.IO an alle Hosts (`music:songs`, `music:assign`).
 */
import express, { type Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'socket.io';
import { type Assignment, type Song, type SongInfo, SONG_ID_RE, songInfo, validateAssignment, validateSong } from '../shared/music';
import { BUILTIN_IDS, BUILTIN_INFOS } from '../shared/musicBuiltin';

const dir = path.dirname(fileURLToPath(import.meta.url));
/** Größte erlaubte Anfrage (ein Song mit 4096 Noten liegt weit darunter) */
export const MAX_BODY = 256 * 1024;
const MAX_SONGS = 200;

export class MusicStore {
  private songs = new Map<string, Song>();
  private assign: Assignment = {};
  readonly dir: string;

  constructor(dataDir = path.resolve(dir, '../data/music')) {
    this.dir = dataDir;
    this.load();
  }

  private load() {
    try {
      for (const f of fs.readdirSync(this.dir)) {
        if (!f.endsWith('.json') || f === 'assign.json') continue;
        try {
          const r = validateSong(JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')));
          if (r.ok && !BUILTIN_IDS.has(r.song.id) && `${r.song.id}.json` === f) this.songs.set(r.song.id, r.song);
          else console.warn(`Musik: ${f} übersprungen (${r.ok ? 'ID passt nicht zum Dateinamen' : r.error})`);
        } catch (e) {
          console.warn(`Musik: ${f} nicht lesbar:`, (e as Error).message);
        }
      }
    } catch {
      /* noch kein data/music */
    }
    try {
      const r = validateAssignment(JSON.parse(fs.readFileSync(path.join(this.dir, 'assign.json'), 'utf8')), (id) => this.exists(id));
      if (r.ok) this.assign = r.assign;
      else console.warn('Musik: assign.json ungültig:', r.error);
    } catch {
      this.assign = {};
    }
  }

  exists(id: string) {
    return BUILTIN_IDS.has(id) || this.songs.has(id);
  }

  list(): SongInfo[] {
    const own = [...this.songs.values()].map((s) => songInfo(s)).sort((a, b) => a.title.localeCompare(b.title, 'de'));
    return [...BUILTIN_INFOS, ...own];
  }

  get(id: string): Song | undefined {
    return this.songs.get(id);
  }

  get assignment(): Assignment {
    return { ...this.assign };
  }

  save(raw: unknown): { ok: true; song: Song } | { ok: false; error: string } {
    const r = validateSong(raw);
    if (!r.ok) return r;
    if (BUILTIN_IDS.has(r.song.id)) return { ok: false, error: 'Eingebaute Songs kann man nicht überschreiben – unter neuem Namen speichern' };
    if (!this.songs.has(r.song.id) && this.songs.size >= MAX_SONGS) return { ok: false, error: `Höchstens ${MAX_SONGS} eigene Songs` };
    r.song.updated = Date.now();
    this.songs.set(r.song.id, r.song);
    this.write(`${r.song.id}.json`, r.song);
    return { ok: true, song: r.song };
  }

  delete(id: string): boolean {
    if (!this.songs.delete(id)) return false;
    try {
      fs.unlinkSync(path.join(this.dir, `${id}.json`));
    } catch {
      /* schon weg */
    }
    // Zuordnungen auf den gelöschten Song entfernen
    let changed = false;
    for (const [k, v] of Object.entries(this.assign)) if (v === id) { delete this.assign[k]; changed = true; }
    if (changed) this.write('assign.json', this.assign);
    return true;
  }

  /** Einzelne Szenen umstellen (leerer String = Eintrag löschen); unbekannte Szenen/Songs → Fehler */
  patchAssignment(raw: unknown): { ok: true; assign: Assignment } | { ok: false; error: string } {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Zuordnung muss ein Objekt sein' };
    const r = validateAssignment(raw, (id) => this.exists(id));
    if (!r.ok) return r;
    const next = { ...this.assign, ...r.assign };
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (v === '' || v === null) delete next[k];
    this.assign = next;
    this.write('assign.json', this.assign);
    return { ok: true, assign: this.assignment };
  }

  private write(file: string, data: unknown) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, file), JSON.stringify(data, null, 2));
    } catch (e) {
      console.warn('Musik: konnte nicht speichern:', (e as Error).message);
    }
  }
}

/** Express-Router unter /api/music; `io` bekommt Live-Updates für die TVs */
export function musicRouter(store: MusicStore, io: Server): Router {
  const r = express.Router();
  r.use(express.json({ limit: MAX_BODY }));
  // JSON-Fehler (zu groß, kaputt) sauber als 400/413 statt HTML-Fehlerseite
  r.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.too.large') return res.status(413).json({ error: 'Song zu groß (max. 256 KB)' });
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Kein gültiges JSON' });
    next(err);
  });
  const pushSongs = () => io.to('hosts').emit('music:songs', store.list());
  const pushAssign = () => io.to('hosts').emit('music:assign', store.assignment);

  r.get('/songs', (_req, res) => res.json({ songs: store.list() }));
  r.get('/songs/:id', (req, res) => {
    const id = String(req.params.id);
    if (!SONG_ID_RE.test(id)) return res.status(400).json({ error: 'Ungültige ID' });
    const song = store.get(id);
    if (!song) return res.status(404).json({ error: 'Song nicht gefunden' });
    res.json({ song });
  });
  r.put('/songs/:id', (req, res) => {
    const id = String(req.params.id);
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object' || body.id !== id) return res.status(400).json({ error: 'ID in Adresse und Song müssen übereinstimmen' });
    const out = store.save(body);
    if (!out.ok) return res.status(400).json({ error: out.error });
    pushSongs();
    res.json({ song: out.song });
  });
  r.delete('/songs/:id', (req, res) => {
    const id = String(req.params.id);
    if (BUILTIN_IDS.has(id)) return res.status(400).json({ error: 'Eingebaute Songs kann man nicht löschen' });
    if (!store.delete(id)) return res.status(404).json({ error: 'Song nicht gefunden' });
    pushSongs();
    pushAssign();
    res.json({ ok: true });
  });
  r.get('/assign', (_req, res) => res.json({ assign: store.assignment }));
  r.patch('/assign', (req, res) => {
    const out = store.patchAssignment(req.body);
    if (!out.ok) return res.status(400).json({ error: out.error });
    pushAssign();
    res.json({ assign: out.assign });
  });
  // Alles andere unter /api/music → JSON-404 (statt Vite-HTML)
  r.use((_req, res) => res.status(404).json({ error: 'Unbekannte Adresse' }));
  return r;
}
