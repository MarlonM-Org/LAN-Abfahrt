/**
 * Song-Format v2 für die 8-Bit-Musik (TV + Musik-Werkstatt) – reine Daten und Prüfung,
 * ohne DOM/Node, damit Server (Validierung), TV und Werkstatt dasselbe verwenden.
 *
 * Ein Song besteht aus Takten zu je 16 Schritten (Sechzehntel, 4/4). Melodiekanäle
 * (Lead, Bass, optional Begleitung) enthalten freie Töne als { step, midi, len },
 * das Schlagzeug Listen der Schritte, auf denen Kick/Snare/HiHat spielen.
 */
import { MINI_INFO } from './games';

export const STEPS_PER_BAR = 16;
export const MAX_BARS = 16;
export const MAX_NOTES = 4096;
export const MIDI_MIN = 21;
export const MIDI_MAX = 108;

export type Wave = 'pulse12' | 'pulse25' | 'pulse50' | 'triangle' | 'square' | 'saw';
export const WAVES: { id: Wave; name: string }[] = [
  { id: 'pulse12', name: 'Puls 12,5 %' },
  { id: 'pulse25', name: 'Puls 25 %' },
  { id: 'pulse50', name: 'Rechteck 50 %' },
  { id: 'triangle', name: 'Dreieck' },
  { id: 'saw', name: 'Sägezahn' },
];
export const isWave = (w: unknown): w is Wave => w === 'square' || WAVES.some((x) => x.id === w);
/** Hüllkurve: 'hold' = Ton steht bis zum Ende, 'pluck' = klingt exponentiell aus (wie die alten Loops) */
export type Env = 'hold' | 'pluck';

export interface SongNote {
  /** Startschritt ab Songbeginn (0 … bars·16−1) */
  step: number;
  midi: number;
  /** Länge in Schritten (Werkstatt: ganze Zahlen; eingebaute Loops auch Bruchteile) */
  len: number;
}

export interface MelodicChannel {
  wave: Wave;
  /** Lautstärke als Verstärkung (0 … 0,3) */
  volume: number;
  env: Env;
  notes: SongNote[];
}

export interface DrumChannel {
  /** Faktor für alle Trommeln (0 … 2) */
  volume: number;
  kick: number[];
  snare: number[];
  hat: number[];
}

export type ChannelId = 'lead' | 'bass' | 'harmony';
export const CHANNELS: { id: ChannelId; name: string }[] = [
  { id: 'lead', name: 'Melodie' },
  { id: 'bass', name: 'Bass' },
  { id: 'harmony', name: 'Begleitung' },
];

export type StyleId = 'party' | 'action' | 'chill' | 'romantisch' | 'grusel' | 'bar' | 'retro' | 'episch';
export const STYLES: { id: StyleId; name: string; color: string }[] = [
  { id: 'party', name: 'Party', color: '#e8613c' },
  { id: 'action', name: 'Action', color: '#d8a03c' },
  { id: 'chill', name: 'Chill/Strand', color: '#3fa7b5' },
  { id: 'romantisch', name: 'Romantisch', color: '#d66a9a' },
  { id: 'grusel', name: 'Grusel', color: '#7a5aa8' },
  { id: 'bar', name: 'Bar', color: '#a0703c' },
  { id: 'retro', name: 'Retro-Arcade', color: '#5fa437' },
  { id: 'episch', name: 'Episch', color: '#4a6fc8' },
];
export const styleName = (s: string) => STYLES.find((x) => x.id === s)?.name ?? s;

export interface Song {
  v: 2;
  id: string;
  title: string;
  author: string;
  style: StyleId;
  bpm: number;
  /** Verschiebung jedes zweiten Sechzehntels in Schritten (0 … 0,5) */
  swing: number;
  bars: number;
  stepsPerBar: 16;
  /** Tonart fürs Editieren (Skalen-Hervorhebung, Einsingen) */
  key: { root: number; minor: boolean };
  lead: MelodicChannel;
  bass: MelodicChannel;
  harmony: MelodicChannel;
  drums: DrumChannel;
  updated?: number;
}

/** Kurzinfo für Listen */
export interface SongInfo {
  id: string;
  title: string;
  author: string;
  style: StyleId;
  bpm: number;
  bars: number;
  builtin?: boolean;
  updated?: number;
}

export const songInfo = (s: Song, builtin = false): SongInfo => ({
  id: s.id, title: s.title, author: s.author, style: s.style, bpm: s.bpm, bars: s.bars, builtin: builtin || undefined, updated: s.updated,
});

export function emptySong(id = 'neuer-song', title = 'Neuer Song'): Song {
  return {
    v: 2, id, title, author: '', style: 'party', bpm: 120, swing: 0, bars: 4, stepsPerBar: 16,
    key: { root: 0, minor: false },
    lead: { wave: 'pulse25', volume: 0.07, env: 'hold', notes: [] },
    bass: { wave: 'triangle', volume: 0.16, env: 'hold', notes: [] },
    harmony: { wave: 'pulse12', volume: 0.03, env: 'pluck', notes: [] },
    drums: { volume: 1, kick: [], snare: [], hat: [] },
  };
}

// ------------------------------------------------------------------ Zuordnung

/** Szenen, denen man Musik zuordnen kann: Standard, Phasen und alle Minispiele */
export const ASSIGN_SCENES: { id: string; name: string }[] = [
  { id: 'standard', name: 'Standard (alles ohne eigene Zuordnung)' },
  { id: 'lobby', name: 'Lobby' },
  { id: 'board', name: 'Spielbrett' },
  { id: 'results', name: 'Ergebnisse' },
  { id: 'story', name: 'Date Night – Geschichte' },
  ...Object.entries(MINI_INFO).map(([id, info]) => ({ id, name: info.title })),
];

/**
 * Zuordnungswert: Song-ID (eigener oder eingebauter Song), `style:<stil>` (zufälliger Song
 * dieses Stils, wechselt bei jedem Szenenstart) oder `none` (Stille). Fehlt ein Eintrag,
 * gilt `standard`, sonst der eingebaute Loop der Szene.
 */
export type Assignment = Record<string, string>;

export const SONG_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/** Dateiname-taugliche ID aus einem Titel („Strand-Party!“ → „strand-party“) */
export function slugId(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return SONG_ID_RE.test(s) ? s : `song-${Date.now().toString(36)}`;
}

/** Eingebaute Zuordnung Szene → eingebauter Song, wenn nichts anderes eingestellt ist */
export function defaultSongForScene(scene: string): string {
  switch (scene) {
    case 'lobby': case 'board': case 'results': case 'volley':
      return 'party';
    case 'story': case 'stars': case 'rhythm': case 'boule':
      return 'romantic';
    case 'golf':
      return 'strandpromenade';
    case 'wrap': case 'descent':
      return 'action';
    case 'darts':
      return 'strandpromenade';
    case 'murder': case 'ttt': case 'verstecken': case 'geist': case 'fangen': case 'werwolf':
      return 'spooky';
    case 'stillepost': case 'wwe': case 'nhie': case 'hilo': case 'bomb': case 'tourist': case 'sprueche':
      return 'bar';
    case 'pixel':
      return 'strandpromenade';
    default:
      return 'action';
  }
}

/**
 * Welcher Song soll für eine Szene laufen? Reihenfolge: Zuordnung der Szene →
 * Zuordnung „standard“ → eingebauter Loop. Bei `style:…` wird reihum ein Song des Stils
 * gewählt (`pick` bekommt die Kandidaten und liefert einen davon). Ergebnis `null` = Stille.
 */
export function resolveSceneSong(scene: string, assign: Assignment, songs: SongInfo[], pick: (ids: string[]) => string): string | null {
  const raw = assign[scene] ?? assign.standard ?? defaultSongForScene(scene);
  if (raw === 'none') return null;
  if (raw.startsWith('style:')) {
    const style = raw.slice(6);
    const ids = songs.filter((s) => s.style === style).map((s) => s.id);
    return ids.length ? pick(ids) : defaultSongForScene(scene);
  }
  return songs.some((s) => s.id === raw) ? raw : defaultSongForScene(scene);
}

export function validateAssignment(raw: unknown, songExists: (id: string) => boolean): { ok: true; assign: Assignment } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Zuordnung muss ein Objekt sein' };
  const out: Assignment = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ASSIGN_SCENES.some((s) => s.id === k)) return { ok: false, error: `Unbekannte Szene: ${k}` };
    if (v === '' || v === null || v === undefined) continue;
    if (typeof v !== 'string') return { ok: false, error: `Ungültiger Wert für ${k}` };
    if (v === 'none') out[k] = v;
    else if (v.startsWith('style:')) {
      if (!STYLES.some((s) => `style:${s.id}` === v)) return { ok: false, error: `Unbekannter Stil: ${v}` };
      out[k] = v;
    } else if (SONG_ID_RE.test(v) && songExists(v)) out[k] = v;
    else return { ok: false, error: `Unbekannter Song: ${v}` };
  }
  return { ok: true, assign: out };
}

// ------------------------------------------------------------------ Prüfung

type Res = { ok: true; song: Song } | { ok: false; error: string };

const isNum = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;

function checkChannel(raw: unknown, name: string, totalSteps: number): MelodicChannel | string {
  if (!raw || typeof raw !== 'object') return `${name}: fehlt`;
  const c = raw as Record<string, unknown>;
  if (!isWave(c.wave)) return `${name}: unbekannte Wellenform`;
  if (!isNum(c.volume, 0, 0.3)) return `${name}: Lautstärke 0 … 0,3`;
  const env = c.env === 'pluck' ? 'pluck' : c.env === 'hold' || c.env === undefined ? 'hold' : null;
  if (!env) return `${name}: unbekannte Hüllkurve`;
  if (!Array.isArray(c.notes) || c.notes.length > MAX_NOTES) return `${name}: Notenliste fehlt oder zu lang`;
  const notes: SongNote[] = [];
  for (const n of c.notes as unknown[]) {
    const o = n as Record<string, unknown>;
    if (!o || !isNum(o.step, 0, totalSteps - 1) || !Number.isInteger(o.step)) return `${name}: ungültiger Schritt`;
    if (!isNum(o.midi, MIDI_MIN, MIDI_MAX) || !Number.isInteger(o.midi)) return `${name}: Ton außerhalb ${MIDI_MIN}–${MIDI_MAX}`;
    if (!isNum(o.len, 0.05, totalSteps)) return `${name}: ungültige Länge`;
    notes.push({ step: o.step, midi: o.midi, len: o.len });
  }
  notes.sort((a, b) => a.step - b.step || a.midi - b.midi);
  return { wave: c.wave as Wave, volume: c.volume as number, env, notes };
}

function checkSteps(raw: unknown, name: string, totalSteps: number): number[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > totalSteps) return `Schlagzeug ${name}: ungültig`;
  const s = new Set<number>();
  for (const x of raw) {
    if (!Number.isInteger(x) || x < 0 || x >= totalSteps) return `Schlagzeug ${name}: ungültiger Schritt`;
    s.add(x);
  }
  return [...s].sort((a, b) => a - b);
}

/** Prüft und normalisiert einen Song (z. B. aus dem Netz). Lehnt Ungültiges ab statt zu raten. */
export function validateSong(raw: unknown): Res {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Song muss ein Objekt sein' };
  const r = raw as Record<string, unknown>;
  if (r.v !== 2) return { ok: false, error: 'Nur Song-Format v2' };
  if (typeof r.id !== 'string' || !SONG_ID_RE.test(r.id)) return { ok: false, error: 'Ungültige ID (a–z, 0–9, - und _, max. 48 Zeichen)' };
  if (typeof r.title !== 'string' || !r.title.trim() || r.title.length > 60) return { ok: false, error: 'Titel fehlt oder ist zu lang' };
  const author = typeof r.author === 'string' ? r.author.slice(0, 40) : '';
  const style = STYLES.some((s) => s.id === r.style) ? (r.style as StyleId) : null;
  if (!style) return { ok: false, error: 'Unbekannter Stil' };
  if (!isNum(r.bpm, 40, 260)) return { ok: false, error: 'Tempo 40 … 260 BPM' };
  const swing = r.swing === undefined ? 0 : r.swing;
  if (!isNum(swing, 0, 0.5)) return { ok: false, error: 'Swing 0 … 0,5' };
  if (!isNum(r.bars, 1, MAX_BARS) || !Number.isInteger(r.bars)) return { ok: false, error: `Takte 1 … ${MAX_BARS}` };
  if (r.stepsPerBar !== undefined && r.stepsPerBar !== 16) return { ok: false, error: 'Nur 16 Schritte pro Takt' };
  const k = r.key as Record<string, unknown> | undefined;
  const key = k && isNum(k.root, 0, 11) && Number.isInteger(k.root) ? { root: k.root, minor: !!k.minor } : { root: 0, minor: false };
  const total = r.bars * STEPS_PER_BAR;
  const lead = checkChannel(r.lead, 'Melodie', total);
  if (typeof lead === 'string') return { ok: false, error: lead };
  const bass = checkChannel(r.bass, 'Bass', total);
  if (typeof bass === 'string') return { ok: false, error: bass };
  const harmony = r.harmony === undefined ? emptySong().harmony : checkChannel(r.harmony, 'Begleitung', total);
  if (typeof harmony === 'string') return { ok: false, error: harmony };
  const d = r.drums as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object') return { ok: false, error: 'Schlagzeug fehlt' };
  const dv = d.volume === undefined ? 1 : d.volume;
  if (!isNum(dv, 0, 2)) return { ok: false, error: 'Schlagzeug-Lautstärke 0 … 2' };
  const kick = checkSteps(d.kick, 'Kick', total);
  const snare = checkSteps(d.snare, 'Snare', total);
  const hat = checkSteps(d.hat, 'HiHat', total);
  for (const x of [kick, snare, hat]) if (typeof x === 'string') return { ok: false, error: x };
  return {
    ok: true,
    song: {
      v: 2, id: r.id, title: r.title.trim(), author, style, bpm: r.bpm, swing, bars: r.bars, stepsPerBar: 16, key,
      lead, bass, harmony, drums: { volume: dv, kick: kick as number[], snare: snare as number[], hat: hat as number[] },
      updated: typeof r.updated === 'number' ? r.updated : undefined,
    },
  };
}

// ------------------------------------------------------------------ Tonarten & Notennamen

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'H'];
export const noteName = (midi: number) => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
export function scaleSet(key: { root: number; minor: boolean }): Set<number> {
  return new Set((key.minor ? MINOR : MAJOR).map((s) => (key.root + s) % 12));
}
export const inScale = (midi: number, key: { root: number; minor: boolean }) => scaleSet(key).has(((midi % 12) + 12) % 12);
/** Nächster Skalenton (bei Gleichstand der tiefere) */
export function snapToScale(pitch: number, key: { root: number; minor: boolean }): number {
  const s = scaleSet(key);
  let best = Math.round(pitch), d = Infinity;
  for (let k = Math.floor(pitch) - 2; k <= Math.ceil(pitch) + 2; k++) {
    if (!s.has(((k % 12) + 12) % 12)) continue;
    const dd = Math.abs(k - pitch);
    if (dd < d - 1e-9) { d = dd; best = k; }
  }
  return best;
}
