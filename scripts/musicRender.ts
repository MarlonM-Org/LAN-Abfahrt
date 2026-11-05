/**
 * Offline-Renderer für Song-Format v2 (Node, ohne WebAudio) – bildet den Synth aus
 * `client/music/player.ts` nach: gleiche Wellenformen (Puls per Fourier-Reihe mit 31
 * Obertönen, normalisiert wie `createPeriodicWave`), gleiche Hüllkurven (pluck/hold mit
 * exponentiellen Rampen), Kick (Sinus 140 → 45 Hz), Snare/HiHat (Rauschen + Hochpass),
 * Swing und Master-Verstärkung 0,9. Für Prüfungen (Übersteuerung, Pegel, stumme Kanäle)
 * und zum Anhören als WAV (`npm run render:music -- <ordner>`).
 */
import { STEPS_PER_BAR, type Env, type MelodicChannel, type Song, type Wave } from '../shared/music';

const midiHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const TABLE = 2048;

const tables = new Map<Wave, Float32Array>();
function table(wave: Wave): Float32Array {
  const c = tables.get(wave);
  if (c) return c;
  const t = new Float32Array(TABLE);
  for (let i = 0; i < TABLE; i++) {
    const ph = i / TABLE;
    if (wave === 'triangle') t[i] = ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4;
    else if (wave === 'saw') t[i] = ph < 0.5 ? 2 * ph : 2 * ph - 2;
    else {
      const duty = wave === 'pulse12' ? 0.125 : wave === 'pulse25' ? 0.25 : 0.5;
      let v = 0;
      for (let k = 1; k < 32; k++) v += (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty) * Math.sin(2 * Math.PI * k * ph);
      t[i] = v;
    }
  }
  let peak = 0;
  for (const v of t) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < TABLE; i++) t[i] /= peak;
  tables.set(wave, t);
  return t;
}

/** Hüllkurve wie WebAudio: Liste von (Zeit, Wert, Rampe) → Wert zur Zeit t */
type Ev = { t: number; v: number; exp: boolean };
function envAt(evs: Ev[], t: number): number {
  let prev = evs[0];
  if (t <= prev.t) return prev.v;
  for (let i = 1; i < evs.length; i++) {
    const e = evs[i];
    if (t < e.t) {
      if (!e.exp) return prev.v;
      const f = (t - prev.t) / (e.t - prev.t);
      return prev.v * Math.pow(e.v / prev.v, f);
    }
    prev = e;
  }
  return prev.v;
}

function tone(out: Float32Array, sr: number, freq: number, time: number, dur: number, wave: Wave, vol: number, env: Env) {
  if (vol <= 0 || dur <= 0) return;
  const evs: Ev[] = [{ t: time, v: 0.0001, exp: false }];
  if (env === 'pluck') {
    evs.push({ t: time + 0.01, v: vol, exp: true }, { t: time + dur, v: 0.0001, exp: true });
  } else {
    const rel = Math.min(0.03, dur / 3);
    evs.push({ t: time + 0.005, v: vol, exp: true }, { t: time + dur - rel, v: vol, exp: false }, { t: time + dur, v: 0.0001, exp: true });
  }
  const tab = table(wave);
  const i0 = Math.max(0, Math.floor(time * sr)), i1 = Math.min(out.length, Math.ceil((time + dur + 0.05) * sr));
  const inc = (freq * TABLE) / sr;
  let ph = 0;
  for (let i = i0; i < i1; i++) {
    out[i] += tab[Math.floor(ph) & (TABLE - 1)] * envAt(evs, i / sr);
    ph += inc;
  }
}

function kick(out: Float32Array, sr: number, time: number, vol: number) {
  if (vol <= 0) return;
  const i0 = Math.floor(time * sr), i1 = Math.min(out.length, Math.ceil((time + 0.2) * sr));
  let ph = 0;
  for (let i = i0; i < i1; i++) {
    const t = i / sr - time;
    const f = t < 0.12 ? 140 * Math.pow(45 / 140, t / 0.12) : 45;
    const g = t < 0.18 ? vol * Math.pow(0.0001 / vol, t / 0.18) : 0.0001;
    out[i] += Math.sin(ph) * g;
    ph += (2 * Math.PI * f) / sr;
  }
}

let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
function noise(out: Float32Array, sr: number, time: number, dur: number, hp: number, vol: number) {
  if (vol <= 0) return;
  // Biquad-Hochpass (RBJ), Q = 1 dB wie die WebAudio-Voreinstellung
  const q = Math.pow(10, 1 / 20);
  const w0 = (2 * Math.PI * Math.min(hp, sr * 0.45)) / sr, alpha = Math.sin(w0) / (2 * q), cos = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0, b1 = -(1 + cos) / a0, b2 = b0, a1 = (-2 * cos) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const i0 = Math.floor(time * sr), i1 = Math.min(out.length, Math.ceil((time + dur + 0.02) * sr));
  for (let i = i0; i < i1; i++) {
    const x = rnd();
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const t = i / sr - time;
    const g = t < dur ? vol * Math.pow(0.0001 / vol, t / dur) : 0.0001;
    out[i] += y * g;
  }
}

export interface Render {
  sr: number;
  /** Länge eines Durchlaufs in Sekunden */
  seconds: number;
  mix: Float32Array;
  channels: Record<'lead' | 'bass' | 'harmony' | 'drums', Float32Array>;
}

/**
 * Rendert `loops` Durchläufe (Master 0,9 eingerechnet). Was über das Ende hinausklingt,
 * wird wie beim Loopen auf den Anfang gelegt.
 */
export function renderSong(song: Song, sr = 22050, loops = 1): Render {
  const stepDur = 60 / song.bpm / 4;
  const total = song.bars * STEPS_PER_BAR;
  const seconds = total * stepDur;
  const len = Math.ceil(seconds * loops * sr);
  const pad = Math.ceil(1.5 * sr);
  const ch = { lead: new Float32Array(len + pad), bass: new Float32Array(len + pad), harmony: new Float32Array(len + pad), drums: new Float32Array(len + pad) };
  const at = (loop: number, s: number) => (loop * total + s) * stepDur + (s % 2 === 1 ? song.swing * stepDur : 0);
  const mel = (c: MelodicChannel, out: Float32Array) => {
    for (let l = 0; l < loops; l++) for (const n of c.notes) tone(out, sr, midiHz(n.midi), at(l, n.step), n.len * stepDur, c.wave, c.volume, c.env);
  };
  mel(song.bass, ch.bass);
  mel(song.harmony, ch.harmony);
  mel(song.lead, ch.lead);
  const d = song.drums;
  for (let l = 0; l < loops; l++) {
    for (const s of d.kick) kick(ch.drums, sr, at(l, s), 0.35 * d.volume);
    for (const s of d.snare) noise(ch.drums, sr, at(l, s), 0.12, 2500, 0.12 * d.volume);
    for (const s of d.hat) noise(ch.drums, sr, at(l, s), 0.03, 8000, 0.05 * d.volume);
  }
  const fold = (a: Float32Array) => {
    const o = new Float32Array(len);
    o.set(a.subarray(0, len));
    for (let i = len; i < a.length; i++) o[i - len] += a[i];
    return o;
  };
  const channels = { lead: fold(ch.lead), bass: fold(ch.bass), harmony: fold(ch.harmony), drums: fold(ch.drums) };
  const mix = new Float32Array(len);
  for (let i = 0; i < len; i++) mix[i] = 0.9 * (channels.lead[i] + channels.bass[i] + channels.harmony[i] + channels.drums[i]);
  for (const k of Object.keys(channels) as (keyof typeof channels)[]) for (let i = 0; i < len; i++) channels[k][i] *= 0.9;
  return { sr, seconds, mix, channels };
}

export const peakOf = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
export function rmsOf(a: Float32Array) {
  let s = 0;
  for (const v of a) s += v * v;
  return Math.sqrt(s / Math.max(1, a.length));
}
export const db = (x: number) => 20 * Math.log10(Math.max(1e-9, x));

/** Längste Strecke (Sekunden), in der der Mix praktisch still ist (RMS in 50-ms-Fenstern < −60 dB) */
export function longestSilence(a: Float32Array, sr: number) {
  const win = Math.round(sr * 0.05);
  let run = 0, best = 0;
  for (let i = 0; i + win <= a.length; i += win) {
    if (rmsOf(a.subarray(i, i + win)) < 0.001) run += win;
    else run = 0;
    best = Math.max(best, run);
  }
  return best / sr;
}

/** 16-Bit-Mono-WAV */
export function wav(a: Float32Array, sr: number): Uint8Array {
  const buf = new ArrayBuffer(44 + a.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + a.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, a.length * 2, true);
  for (let i = 0; i < a.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, a[i])) * 32767, true);
  return new Uint8Array(buf);
}
