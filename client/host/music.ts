/**
 * 8-Bit-Musik für den TV/Laptop – komplett mit WebAudio erzeugt (keine Audiodateien).
 *
 * Der Synth/Sequencer liegt in `client/music/player.ts` (gleicher Klang wie in der
 * Musik-Werkstatt). Hier: Audio freischalten, Lautstärke/Stumm (localStorage), Bibliothek
 * und Szenen-Zuordnung vom Server (REST beim Start + live per Socket.IO), Szene → Song.
 */
import type { Socket } from 'socket.io-client';
import { type Assignment, type Song, type SongInfo, resolveSceneSong } from '../../shared/music';
import { BUILTIN_INFOS, builtinSong } from '../../shared/musicBuiltin';
import { getAssignment, getSong, listSongs } from '../music/api';
import { SongPlayer, Synth, midiHz } from '../music/player';

const LS_VOL = 'lan-abfahrt.musik.volume';
const LS_MUTE = 'lan-abfahrt.musik.mute';
const LS_MUSIC = 'lan-abfahrt.musik.music';
const LS_FX = 'lan-abfahrt.musik.fx';

let synth: Synth | null = null;
let player: SongPlayer | null = null;
let wantedScene = '';
let currentSongId: string | null = null;
/** Vorhören aus dem Musik-Menü läuft (dann keine Szenenmusik umschalten) */
let previewing = false;

let songs: SongInfo[] = BUILTIN_INFOS;
let assign: Assignment = {};
const cache = new Map<string, Song>();
/** Stil-Zuordnung: reihum durch die Songs des Stils (pro Stil ein Zähler) */
const rotation = new Map<string, number>();
export type MusicChange = 'volume' | 'library';
const listeners = new Set<(kind: MusicChange) => void>();

const read = (k: string, d: number) => {
  const v = Number(localStorage.getItem(k));
  return Number.isFinite(v) && localStorage.getItem(k) !== null ? v : d;
};
let volume = Math.max(0, Math.min(1, read(LS_VOL, 1)));
let muted = localStorage.getItem(LS_MUTE) === '1';
let musicVol = Math.max(0, Math.min(1, read(LS_MUSIC, 1)));
let fxVol = Math.max(0, Math.min(1, read(LS_FX, 1)));
let ducked = false;

/** Muss durch eine Nutzeraktion (Klick/Taste) aufgerufen werden */
export function unlockMusic() {
  if (synth) {
    synth.resume();
    return;
  }
  synth = new Synth();
  synth.setMasterVolume(volume);
  synth.setMuted(muted);
  synth.setMusicVolume(musicVol);
  synth.setFxVolume(fxVol);
  player = new SongPlayer(synth);
  if (wantedScene) void playScene(wantedScene);
}

export const audioReady = () => !!synth && synth.ctx.state === 'running';
export const audioCtx = () => synth?.ctx ?? null;
export const audioOut = () => synth?.master ?? null;
/** Musik-Bus (Regler „Musik“) – z. B. für einen Equalizer, der die Musik mithört */
export const audioMusic = () => synth?.musicBus ?? null;
/** Effekt-Bus (Regler „Effekte“) – Soundeffekte in `sfx.ts` hängen hier dran */
export const audioFx = () => synth?.fxBus ?? null;

// ------------------------------------------------------------------ Lautstärke

export const getVolume = () => volume;
export const isMuted = () => muted;

export const getMusicVolume = () => musicVol;
export const getFxVolume = () => fxVol;

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  localStorage.setItem(LS_VOL, String(volume));
  synth?.setMasterVolume(volume);
  notify('volume');
}

export function setMusicVolume(v: number) {
  musicVol = Math.max(0, Math.min(1, v));
  localStorage.setItem(LS_MUSIC, String(musicVol));
  if (!ducked) synth?.setMusicVolume(musicVol);
  notify('volume');
}

export function setFxVolume(v: number) {
  fxVol = Math.max(0, Math.min(1, v));
  localStorage.setItem(LS_FX, String(fxVol));
  synth?.setFxVolume(fxVol);
  notify('volume');
}

export function setMuted(m: boolean) {
  muted = m;
  localStorage.setItem(LS_MUTE, m ? '1' : '0');
  synth?.setMuted(m);
  notify('volume');
  return muted;
}

export const toggleMute = () => setMuted(!muted);

/** Musik leiser drehen (z. B. während der Rhythmus-Song läuft) */
export function duckMusic(on: boolean) {
  ducked = on;
  synth?.setMusicVolume(on ? 0 : musicVol);
}

// ------------------------------------------------------------------ Bibliothek & Zuordnung

export const getSongs = () => songs;
export const getAssign = () => assign;
export const getCurrentSongId = () => currentSongId;
export const getScene = () => wantedScene;

/** Benachrichtigung für das Musik-Menü (Lautstärke, Bibliothek, Zuordnung, laufender Song) */
export function onMusicChange(fn: (kind: MusicChange) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = (kind: MusicChange = 'library') => listeners.forEach((fn) => fn(kind));

/** Bibliothek + Zuordnung laden und Live-Updates vom Server abonnieren */
export function connectMusic(socket: Socket) {
  void Promise.all([listSongs(), getAssignment()]).then(([s, a]) => {
    songs = s;
    assign = a;
    notify();
    if (wantedScene) void playScene(wantedScene);
  });
  socket.on('music:songs', (s: SongInfo[]) => {
    songs = s;
    // Geänderte eigene Songs neu laden (eingebaute sind unveränderlich)
    for (const info of s) {
      const c = cache.get(info.id);
      if (c && !info.builtin && c.updated !== info.updated) cache.delete(info.id);
    }
    for (const id of [...cache.keys()]) if (!s.some((x) => x.id === id)) cache.delete(id);
    notify();
    if (wantedScene && !previewing) void playScene(wantedScene, true);
  });
  socket.on('music:assign', (a: Assignment) => {
    assign = a;
    notify();
    if (wantedScene && !previewing) void playScene(wantedScene);
  });
}

async function loadSong(id: string): Promise<Song | null> {
  const c = cache.get(id) ?? builtinSong(id);
  if (c) return c;
  try {
    const s = await getSong(id);
    cache.set(id, s);
    return s;
  } catch {
    return null;
  }
}

function pickRotating(style: string, ids: string[]): string {
  const n = rotation.get(style) ?? -1;
  const next = (n + 1) % ids.length;
  rotation.set(style, next);
  return ids[next];
}

/** Welcher Song gehört zur Szene (ohne ihn zu starten; bei Stil-Zuordnung der nächste der Rotation)? */
export function trackForScene(scene: string): string | null {
  const raw = assign[scene] ?? assign.standard ?? '';
  return resolveSceneSong(scene, assign, songs, (ids) => ids[((rotation.get(raw) ?? -1) + 1) % ids.length]);
}

let playToken = 0;
/** Song zur Szene (neu) starten. `refresh`: gleicher Song erneut laden (nach Änderung in der Werkstatt) */
async function playScene(scene: string, refresh = false) {
  if (!synth || !player) return;
  const raw = assign[scene] ?? assign.standard ?? '';
  const id = resolveSceneSong(scene, assign, songs, (ids) => pickRotating(raw, ids));
  if (id === currentSongId && !refresh && player.playing) return;
  const token = ++playToken;
  if (!id) {
    player.stop();
    currentSongId = null;
    notify();
    return;
  }
  const song = await loadSong(id);
  if (token !== playToken || !player) return;
  if (!song) {
    player.stop();
    currentSongId = null;
    notify();
    return;
  }
  if (refresh && id === currentSongId && player.playing) player.setSong(song);
  else player.play(song, { loop: true });
  currentSongId = id;
  notify();
}

/** Szene wechseln → passende Musik (Zuordnung → Standard → eingebauter Loop) */
export function setScene(scene: string) {
  wantedScene = scene;
  if (previewing) return;
  void playScene(scene);
}

/** Alte API: Loop direkt nach Namen – entspricht jetzt der Szene */
export const setTrack = (name: string) => setScene(name);

// ------------------------------------------------------------------ Vorhören (Musik-Menü)

/** Einen Song aus der Bibliothek anspielen (ersetzt die Szenenmusik, bis `stopPreview`) */
export async function previewSong(id: string) {
  unlockMusic();
  if (!player) return;
  previewing = true;
  const token = ++playToken;
  const song = await loadSong(id);
  if (token !== playToken || !player || !previewing) return;
  if (song) {
    player.play(song, { loop: true });
    currentSongId = id;
  }
  notify();
}

export function stopPreview() {
  if (!previewing) return;
  previewing = false;
  currentSongId = null;
  if (wantedScene) void playScene(wantedScene);
  else player?.stop();
  notify();
}

export const isPreviewing = () => previewing;

// ------------------------------------------------------------------ Rhythmus-Song (geteiltes Gerät)

const C = [60, 64, 67];
const G = [55, 59, 62];
const Am = [57, 60, 64];
const F = [53, 57, 60];

/**
 * Spielt den Gesprächs-Song auf dem TV. `startPerf` ist der lokale performance.now()-Zeitpunkt
 * von Beat 0 (nach dem Vorlauf) – aus der synchronisierten Serverzeit berechnet.
 */
export function playRhythmSong(startPerf: number, bpm: number, beats: number, leadIn: number) {
  if (!synth) return;
  const s = synth;
  const ctx = s.ctx;
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(s.fxBus);
  // performance.now() → AudioContext-Zeit
  const base = ctx.currentTime + (startPerf - performance.now()) / 1000;
  const beat = 60 / bpm;
  const chords = [C, Am, F, G];
  // Einzähler im Vorlauf
  for (let i = 0; i < 4; i++) {
    const t = base + leadIn / 1000 - (4 - i) * beat;
    if (t > ctx.currentTime) s.tone(midiHz(84), t, 0.08, 'square', 0.05, out);
  }
  for (let b = 0; b < beats; b++) {
    const t = base + leadIn / 1000 + b * beat;
    if (t < ctx.currentTime) continue;
    const chord = chords[Math.floor(b / 4) % 4];
    if (b % 2 === 0) s.kick(t, out);
    s.noise(t + beat / 2, 0.03, 8000, 0.05, out);
    if (b % 4 === 2) s.noise(t, 0.1, 2500, 0.1, out);
    s.tone(midiHz(chord[0] - 12), t, beat * 0.9, 'triangle', 0.18, out);
    s.tone(midiHz(chord[b % 3] + 12), t, beat * 0.45, 'pulse25', 0.04, out);
    s.tone(midiHz(chord[(b + 1) % 3] + 12), t + beat / 2, beat * 0.45, 'pulse25', 0.03, out);
  }
  return () => out.disconnect();
}
