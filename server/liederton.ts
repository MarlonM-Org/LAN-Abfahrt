/**
 * Guess the Song: Wo kommt der Ton her?
 *
 * 1. **Eingebaute 8-Bit-Songs** (Genre „LAN-Abfahrt-Soundtrack“) + eigene Songs aus der Musik-Werkstatt –
 *    der TV spielt sie mit dem eigenen Synth. Geht immer, ganz ohne Lizenzfragen.
 * 2. **Eigene Dateien** unter `data/lieder/<Genre>/<Interpret> - <Titel>.mp3` (Ordner = Genre; passt der Ordnername
 *    zu einem eingebauten Genre wie „80er“ oder „Rock“, landet das Lied dort, sonst gibt es ein eigenes Genre).
 *    Gedacht für selbst gekaufte, DRM-freie Dateien – nur im Heimnetz abrufbar, nie über den Online-Tunnel.
 * 3. **Hörproben (30 s) von Deezer** für den Katalog (`server/liederkatalog.ts`) – nur, wenn in `.env`
 *    `LIEDER_VORSCHAU=deezer` steht (nicht-kommerziell, Deezer muss sichtbar genannt werden). Gespeichert wird
 *    nur die Deezer-Track-ID (`data/lieder/.deezer.json`), die Vorschau-Adresse wird jedes Mal frisch geholt
 *    und der TV lädt sie direkt bei Deezer.
 *
 * Der TV bekommt pro Runde nur einen zufälligen Token (`/api/lieder/ton/<token>`), der den Titel nicht verrät.
 */
import express, { type Router } from 'express';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIEDER, LIEDER_GENRES, SOUNDTRACK_GENRE, type LiederGenre, liederGenreId, liederNorm } from '../shared/lieder';
import { BUILTIN_SONGS } from '../shared/musicBuiltin';
import type { LiederQuelle } from '../shared/types';
import { KATALOG, type KatalogLied } from './liederkatalog';
import type { MusicStore } from './music';
import { viaProxy } from './net';

const dir = path.dirname(fileURLToPath(import.meta.url));

export interface Lied {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  genre: string;
  quelle: LiederQuelle;
  /** Eigene Datei (absoluter Pfad) */
  file?: string;
  /** Eingebauter/Werkstatt-Song (ID im Musik-Format) */
  synth?: string;
}

/** Fertiger Ton für eine Runde */
export interface LiedTon {
  token: string;
  /** Startsekunde (nur bei eigenen Dateien ≠ 0) */
  start: number;
  kind: LiederQuelle;
  /** Quellenhinweis für den TV */
  credit: string | null;
}

export interface LiederLibrary {
  songs: Lied[];
  genres: LiederGenre[];
}

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;
const EIGENE: LiederGenre = { id: 'eigene', name: 'Eigene Lieder', icon: '📁' };
/** Zuletzt gespielte Lieder (über Spiele hinweg) – die kommen erst wieder, wenn alles andere durch ist */
const RECENT_MAX = 200;
/** Gefundene Deezer-Tracks gelten so lange; „nicht gefunden“ wird nach 3 Tagen neu versucht */
const DZ_MISS_MS = 3 * 24 * 3600_000;
const compact = (s: string) => liederNorm(s).replace(/ /g, '');
/** Erster Interpret („Beyoncé feat. Jay-Z“ → „Beyoncé“) */
const mainArtist = (a: string) => a.split(/\s+(?:feat\.?|ft\.?|featuring|&|und|x|vs\.?)\s+|,\s*/i)[0].trim();

export class LiederTon {
  readonly dir: string;
  /** Hörproben-Quelle (aus LIEDER_VORSCHAU), null = aus */
  readonly vorschau: 'deezer' | null;
  private music: MusicStore | null = null;
  private tokens = new Map<string, { lied: Lied; url?: string }>();
  private recent: string[] = [];
  private dz: Record<string, { id: number | null; at: number }> = {};
  private dzSaveTimer: NodeJS.Timeout | null = null;
  /** Dateien, die der TV nicht abspielen konnte – bleiben bis zum Neustart draußen */
  private badFiles = new Set<string>();

  constructor(dataDir = path.resolve(dir, '../data/lieder'), vorschau = process.env.LIEDER_VORSCHAU) {
    this.dir = dataDir;
    this.vorschau = String(vorschau ?? '').toLowerCase() === 'deezer' ? 'deezer' : null;
    try {
      this.dz = JSON.parse(fs.readFileSync(path.join(this.dir, '.deezer.json'), 'utf8'));
    } catch {
      this.dz = {};
    }
  }

  /** Eigene Songs der Musik-Werkstatt gehören mit zum Soundtrack-Genre */
  attachMusic(m: MusicStore) {
    this.music = m;
  }

  // ---------------------------------------------------------------- Bibliothek

  /** Alle Lieder mit Ton-Quelle und ihre Genres (wird bei jedem Spielstart neu eingelesen) */
  library(): LiederLibrary {
    const songs: Lied[] = [];
    const genres = new Map<string, LiederGenre>();
    // 1. Soundtrack
    for (const s of BUILTIN_SONGS) songs.push({ id: `synth:${s.id}`, title: s.title, artist: 'LAN-Abfahrt', year: null, genre: SOUNDTRACK_GENRE.id, quelle: 'synth', synth: s.id });
    for (const info of this.music?.list() ?? []) {
      if (info.builtin) continue;
      songs.push({ id: `synth:${info.id}`, title: info.title, artist: 'Musik-Werkstatt', year: null, genre: SOUNDTRACK_GENRE.id, quelle: 'synth', synth: info.id });
    }
    // 2. Eigene Dateien
    const covered = new Set<string>();
    for (const f of this.scan()) {
      if (this.badFiles.has(f)) continue;
      const rel = path.relative(this.dir, f);
      const parts = rel.split(path.sep);
      const folder = parts.length > 1 ? parts[0] : '';
      const { title, artist } = parseName(path.basename(f).replace(AUDIO_EXT, ''));
      if (!title) continue;
      const kat = findKatalog(title, artist);
      let genre = folder ? this.folderGenre(folder) : null;
      if (!genre) genre = kat ? (LIEDER_GENRES.find((g) => g.id === kat.genre) ?? EIGENE) : EIGENE;
      genres.set(genre.id, genre);
      if (kat) covered.add(katalogId(kat));
      songs.push({ id: `datei:${rel}`, title: kat && !artist ? kat.title : title, artist: artist || kat?.artist || '', year: kat?.year ?? null, genre: genre.id, quelle: 'datei', file: f });
    }
    // 3. Katalog per Hörprobe (ohne die Lieder, die schon als Datei da sind)
    if (this.vorschau) {
      for (const k of KATALOG) {
        const id = katalogId(k);
        if (!covered.has(id)) songs.push({ id, title: k.title, artist: k.artist, year: k.year, genre: k.genre, quelle: 'vorschau' });
      }
    }
    const used = new Set(songs.map((s) => s.genre));
    const list = [...LIEDER_GENRES.filter((g) => used.has(g.id)), ...[...genres.values()].filter((g) => !LIEDER_GENRES.some((x) => x.id === g.id))];
    return { songs, genres: list };
  }

  /** Titel für falsche Antworten: erst dasselbe Genre (Bibliothek + Katalog), dann alles */
  titlePool(genre: string, songs: Lied[]): { same: string[]; all: string[] } {
    const same = [...songs.filter((s) => s.genre === genre).map((s) => s.title), ...KATALOG.filter((k) => k.genre === genre).map((k) => k.title)];
    const all = [...songs.map((s) => s.title), ...KATALOG.map((k) => k.title)];
    return { same: [...new Set(same)], all: [...new Set(all)] };
  }

  /** Ordnername → eingebautes Genre („80er“, „Rock“, „Hip-Hop“, „60er & 70er“) oder ein eigenes */
  private folderGenre(folder: string): LiederGenre {
    const c = compact(folder);
    const known = LIEDER_GENRES.find((g) => compact(g.id) === c || compact(g.name) === c);
    if (known) return known;
    return { id: `ordner-${liederGenreId(folder)}`, name: folder.slice(0, 24), icon: '📁' };
  }

  /** Audiodateien unter data/lieder (bis 3 Ebenen tief, ohne versteckte Dateien) */
  private scan(): string[] {
    const out: string[] = [];
    const walk = (d: string, depth: number) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory() && depth < 3) walk(p, depth + 1);
        else if (e.isFile() && AUDIO_EXT.test(e.name)) out.push(p);
        if (out.length >= 5000) return;
      }
    };
    walk(this.dir, 0);
    return out;
  }

  // ---------------------------------------------------------------- Auswahl

  /** Zufälliges Lied aus den Kandidaten – lange nicht gespielte zuerst */
  choose(candidates: Lied[]): Lied | null {
    if (!candidates.length) return null;
    const fresh = candidates.filter((l) => !this.recent.includes(l.id));
    if (fresh.length) return fresh[Math.floor(Math.random() * fresh.length)];
    // Alles schon mal gelaufen → das, was am längsten her ist
    return [...candidates].sort((a, b) => this.recent.indexOf(a.id) - this.recent.indexOf(b.id))[0];
  }

  /** Lied ist gelaufen (für die Rotation über Spiele hinweg) */
  played(id: string) {
    this.recent = [...this.recent.filter((x) => x !== id), id].slice(-RECENT_MAX);
  }

  // ---------------------------------------------------------------- Ton für eine Runde

  /** Ton besorgen – null, wenn es für dieses Lied gerade keinen gibt (Datei weg, keine Hörprobe gefunden) */
  async resolve(lied: Lied): Promise<LiedTon | null> {
    if (lied.quelle === 'synth') return lied.synth ? this.issue(lied, 0, null) : null;
    if (lied.quelle === 'datei') {
      if (!lied.file || !fs.existsSync(lied.file)) return null;
      const [a, b] = LIEDER.FILE_START_S;
      return this.issue(lied, Math.round(a + Math.random() * (b - a)), null);
    }
    const url = await this.deezerPreview(lied);
    return url ? this.issue(lied, 0, 'Hörprobe: Deezer', url) : null;
  }

  /** Der TV meldet: Ton lässt sich nicht abspielen → beim nächsten Mal neu suchen */
  markBad(token: string) {
    const t = this.tokens.get(token);
    if (t?.lied.quelle === 'vorschau') {
      delete this.dz[t.lied.id];
      this.saveDz();
    }
    if (t?.lied.file) {
      this.badFiles.add(t.lied.file);
      console.warn(`Guess the Song: ${path.relative(this.dir, t.lied.file)} lässt sich nicht abspielen – übersprungen`);
    }
    this.tokens.delete(token);
  }

  private issue(lied: Lied, start: number, credit: string | null, url?: string): LiedTon {
    const token = randomBytes(9).toString('base64url');
    this.tokens.set(token, { lied, url });
    // Nur die letzten paar Runden aufheben
    while (this.tokens.size > 48) this.tokens.delete(this.tokens.keys().next().value!);
    return { token, start, kind: lied.quelle, credit };
  }

  // ---------------------------------------------------------------- Deezer

  private async deezerPreview(lied: Lied): Promise<string | null> {
    const cached = this.dz[lied.id];
    if (cached && cached.id === null && Date.now() - cached.at < DZ_MISS_MS) return null;
    if (cached?.id) {
      const t = await getJson(`https://api.deezer.com/track/${cached.id}`);
      const url = typeof t?.preview === 'string' ? t.preview : '';
      if (url) return url;
    }
    const title = lied.title.replace(/^\(.*?\)\s*/, '').replace(/[’‘]/g, "'").replace(/…/g, '');
    const artist = mainArtist(lied.artist);
    let best = pickDeezer(await getJson(`https://api.deezer.com/search?${new URLSearchParams({ q: `artist:"${artist}" track:"${title}"`, limit: '15' })}`), lied);
    if (!best) best = pickDeezer(await getJson(`https://api.deezer.com/search?${new URLSearchParams({ q: `${artist} ${title}`, limit: '15' })}`), lied);
    this.dz[lied.id] = { id: best?.id ?? null, at: Date.now() };
    this.saveDz();
    return best?.preview ?? null;
  }

  private saveDz() {
    if (this.dzSaveTimer) return;
    this.dzSaveTimer = setTimeout(() => {
      this.dzSaveTimer = null;
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(path.join(this.dir, '.deezer.json'), JSON.stringify(this.dz));
      } catch (e) {
        console.warn('Guess the Song: .deezer.json nicht schreibbar:', (e as Error).message);
      }
    }, 2000);
    this.dzSaveTimer.unref();
  }

  // ---------------------------------------------------------------- REST

  /**
   * `GET /api/lieder/ton/:token` – Datei (mit Range-Unterstützung), Weiterleitung zur Hörprobe oder `{ synth }`.
   * `GET /api/lieder/status` – was ist da (Genres, Anzahl, Quellen).
   * Beides nur im Heimnetz, nie über den Online-Tunnel (die Dateien sind nur für den privaten Abend gedacht).
   */
  router(): Router {
    const r = express.Router();
    r.use((req, res, next) => {
      if (viaProxy(req.headers)) return void res.status(403).json({ error: 'Nur im Heimnetz' });
      next();
    });
    r.get('/ton/:token', (req, res) => {
      const t = this.tokens.get(String(req.params.token));
      res.setHeader('Cache-Control', 'no-store');
      if (!t) return void res.status(404).json({ error: 'Unbekannt' });
      if (t.lied.quelle === 'synth') return void res.json({ synth: t.lied.synth });
      if (t.lied.quelle === 'datei' && t.lied.file) return void res.sendFile(t.lied.file, { dotfiles: 'allow' }, (err) => err && !res.headersSent && res.status(404).end());
      if (t.url) return void res.redirect(302, t.url);
      res.status(404).end();
    });
    r.get('/status', (_req, res) => {
      const lib = this.library();
      res.json({
        ordner: this.dir,
        vorschau: this.vorschau,
        genres: lib.genres.map((g) => ({ ...g, lieder: lib.songs.filter((s) => s.genre === g.id).length })),
        quellen: { synth: lib.songs.filter((s) => s.quelle === 'synth').length, datei: lib.songs.filter((s) => s.quelle === 'datei').length, vorschau: lib.songs.filter((s) => s.quelle === 'vorschau').length },
      });
    });
    return r;
  }
}

// ------------------------------------------------------------------ Hilfen

const katalogId = (k: KatalogLied) => `katalog:${liederNorm(k.artist)}|${liederNorm(k.title)}`;

/** „01 - a-ha - Take On Me (Remastered)“ → Interpret „a-ha“, Titel „Take On Me (Remastered)“ */
export function parseName(base: string): { title: string; artist: string } {
  const clean = base.replace(/_/g, ' ').replace(/^\d{1,3}\s*[-.)]?\s+/, '').trim();
  const i = clean.indexOf(' - ');
  if (i < 0) return { title: clean, artist: '' };
  return { artist: clean.slice(0, i).trim(), title: clean.slice(i + 3).trim() };
}

/** Passendes Lied im Katalog (gleicher Titel, Interpret passt oder fehlt) */
function findKatalog(title: string, artist: string): KatalogLied | null {
  const t = liederNorm(title);
  const a = liederNorm(mainArtist(artist));
  return KATALOG.find((k) => liederNorm(k.title) === t && (!a || liederNorm(k.artist).includes(a) || a.includes(liederNorm(mainArtist(k.artist))))) ?? null;
}

export interface DzTrack {
  id: number;
  title: string;
  title_short?: string;
  preview?: string;
  artist?: { name?: string };
}

/** Bester Treffer: Titel und Interpret müssen passen, keine Karaoke-/Cover-Versionen */
export function pickDeezer(res: Record<string, unknown> | null, lied: Lied): DzTrack | null {
  const data = Array.isArray(res?.data) ? (res.data as DzTrack[]) : [];
  const t = liederNorm(lied.title);
  const a = liederNorm(mainArtist(lied.artist));
  let best: DzTrack | null = null;
  let bestScore = 0;
  for (const d of data) {
    if (!d?.preview || typeof d.id !== 'number') continue;
    const full = `${d.title} ${d.artist?.name ?? ''}`.toLowerCase();
    if (/karaoke|instrumental|tribute|cover version|made famous|originally performed|in the style of/.test(full)) continue;
    const tn = liederNorm(d.title_short || d.title);
    const an = liederNorm(d.artist?.name ?? '');
    const ts = tn === t ? 3 : tn.startsWith(t) || t.startsWith(tn) ? 2 : tn.includes(t) ? 1 : 0;
    const as = an === a ? 3 : an.includes(a) || a.includes(an) ? 2 : 0;
    if (!ts || !as) continue;
    const extra = /\b(live|remix|mix|edit|version|acoustic)\b/.test(d.title.toLowerCase()) && !/\b(live|remix|mix|edit|version|acoustic)\b/.test(lied.title.toLowerCase()) ? -1 : 0;
    const score = ts + as + extra;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const j = (await r.json()) as Record<string, unknown>;
    return j && typeof j === 'object' && !('error' in j) ? j : null;
  } catch {
    return null;
  }
}

/** Eine Bibliothek für den ganzen Server (Raum + REST) */
export const liederTon = new LiederTon();
