/**
 * 8-Bit-Musik für den TV/Laptop – komplett mit WebAudio erzeugt (keine Audiodateien).
 * Ein kleiner Sequencer spielt je nach Szene einen passenden Loop:
 * Pulse-Lead, Dreieck-Bass und Rauschen als Schlagzeug.
 */

type TrackName = 'party' | 'action' | 'romantic' | 'spooky' | 'bar' | 'none';

interface Track {
  bpm: number;
  /** Akkordfolge als MIDI-Grundtöne, je ein Takt */
  chords: number[][];
  lead: 'pulse25' | 'pulse50' | 'triangle';
  drums: 'four' | 'rock' | 'soft' | 'none';
  /** Melodie: pro Takt 16 Schritte, Zahl = Index in Akkord (+7 = Oktave), -1 = Pause */
  melody: number[][];
  swing?: number;
  leadVol: number;
}

const m = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

const C = [60, 64, 67];
const G = [55, 59, 62];
const Am = [57, 60, 64];
const F = [53, 57, 60];
const Dm = [50, 53, 57];
const Bb = [46, 50, 53];
const Gm = [55, 58, 62];
const A = [57, 61, 64];
const Em = [52, 55, 59];
const D = [50, 54, 57];

const R = -1;
const TRACKS: Record<Exclude<TrackName, 'none'>, Track> = {
  party: {
    bpm: 124,
    chords: [C, G, Am, F],
    lead: 'pulse25',
    drums: 'four',
    leadVol: 0.07,
    melody: [
      [2, R, 1, R, 0, R, 1, 2, R, 2, R, 3, 2, R, 1, R],
      [1, R, 2, R, 1, R, 0, R, 1, 2, 1, R, 0, R, R, R],
      [0, R, 1, R, 2, R, 3, R, 2, R, 1, R, 2, R, 0, R],
      [1, R, 0, R, 1, 2, R, 3, R, 4, R, 3, 2, R, R, R],
    ],
  },
  action: {
    bpm: 150,
    chords: [Am, F, C, G],
    lead: 'pulse50',
    drums: 'rock',
    leadVol: 0.06,
    melody: [
      [0, 0, 2, 0, 3, 0, 2, 1, 0, 0, 2, 0, 4, 3, 2, 1],
      [0, 0, 2, 0, 3, 0, 2, 1, 0, 1, 2, 3, 4, R, 3, R],
      [2, 2, 3, 2, 1, 0, 1, 2, 3, R, 2, R, 1, R, 0, R],
      [1, 1, 2, 1, 0, R, 1, 2, 4, 3, 2, 1, 2, R, R, R],
    ],
  },
  romantic: {
    bpm: 84,
    chords: [F, Dm, Bb, C],
    lead: 'triangle',
    drums: 'soft',
    leadVol: 0.12,
    swing: 0.12,
    melody: [
      [2, R, R, 1, 2, R, 3, R, 2, R, R, R, 1, R, R, R],
      [0, R, R, 1, 2, R, 1, R, 0, R, R, R, R, R, R, R],
      [1, R, R, 2, 3, R, 2, R, 1, R, 0, R, 1, R, R, R],
      [2, R, R, R, 1, R, R, R, 0, R, R, R, R, R, R, R],
    ],
  },
  spooky: {
    bpm: 92,
    chords: [Dm, Bb, Gm, A],
    lead: 'triangle',
    drums: 'soft',
    leadVol: 0.1,
    melody: [
      [0, R, R, 7, R, R, 2, R, 1, R, R, R, 0, R, R, R],
      [R, R, 2, R, R, 1, R, R, 0, R, R, R, R, R, R, R],
      [0, R, R, 7, R, R, 2, R, 3, R, R, 2, R, 1, R, R],
      [1, R, R, R, 0, R, R, R, R, R, R, R, R, R, R, R],
    ],
  },
  bar: {
    bpm: 108,
    chords: [G, Em, C, D],
    lead: 'pulse25',
    drums: 'four',
    leadVol: 0.06,
    swing: 0.18,
    melody: [
      [2, R, 2, 1, 2, R, 3, R, 2, R, 1, R, 0, R, R, R],
      [1, R, 1, 0, 1, R, 2, R, 1, R, 0, R, R, R, R, R],
      [0, R, 1, R, 2, R, 3, 4, 3, R, 2, R, 1, R, R, R],
      [2, R, 1, R, 0, R, 1, R, 2, R, R, R, R, R, R, R],
    ],
  },
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let pulseWaves: Record<string, PeriodicWave> = {};
let current: TrackName = 'none';
let wanted: TrackName = 'none';
let step = 0;
let nextTime = 0;
let timer: number | undefined;
let muted = false;

/** Muss durch eine Nutzeraktion (Klick/Taste) aufgerufen werden */
export function unlockMusic() {
  if (ctx) {
    void ctx.resume();
    return;
  }
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ctx.destination);
  musicBus = ctx.createGain();
  musicBus.gain.value = 1;
  musicBus.connect(master);
  for (const duty of [0.25, 0.5]) {
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    pulseWaves[`pulse${duty * 100}`] = ctx.createPeriodicWave(real, imag);
  }
  setTrack(wanted);
}

export const audioReady = () => !!ctx && ctx.state === 'running';
export const audioCtx = () => ctx;
export const audioOut = () => master;

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.9;
  return muted;
}

export function setTrack(name: TrackName) {
  wanted = name;
  if (!ctx || name === current) return;
  current = name;
  clearInterval(timer);
  if (name === 'none') return;
  step = 0;
  nextTime = ctx.currentTime + 0.1;
  timer = window.setInterval(schedule, 25);
}

/** Musik leiser drehen (z. B. während der Rhythmus-Song läuft) */
export function duckMusic(on: boolean) {
  if (musicBus && ctx) musicBus.gain.setTargetAtTime(on ? 0 : 1, ctx.currentTime, 0.3);
}

function schedule() {
  if (!ctx || current === 'none') return;
  const t = TRACKS[current];
  const stepDur = 60 / t.bpm / 4;
  while (nextTime < ctx.currentTime + 0.15) {
    playStep(t, step, nextTime + (step % 2 === 1 ? (t.swing ?? 0) * stepDur : 0), stepDur);
    nextTime += stepDur;
    step = (step + 1) % (16 * t.chords.length);
  }
}

function playStep(t: Track, s: number, time: number, stepDur: number) {
  const bar = Math.floor(s / 16);
  const i = s % 16;
  const chord = t.chords[bar % t.chords.length];
  // Bass
  if (i % 4 === 0 || (t.drums === 'rock' && i % 2 === 0)) tone(m(chord[0] - 12), time, stepDur * 1.8, 'triangle', 0.16);
  // Arpeggio (leise)
  if (t.lead !== 'triangle' && i % 2 === 0) tone(m(chord[(i / 2) % 3] + 12), time, stepDur * 0.8, 'pulse25', 0.025);
  if (t.lead === 'triangle' && i % 4 === 2) tone(m(chord[Math.floor(i / 4) % 3] + 12), time, stepDur * 3, 'triangle', 0.04);
  // Melodie
  const note = t.melody[bar % t.melody.length][i];
  if (note >= 0) {
    const pitch = note >= 7 ? chord[(note - 7) % 3] + 24 : chord[note % 3] + 12 + (note >= 3 ? 12 : 0);
    tone(m(pitch), time, stepDur * (t.lead === 'triangle' ? 3 : 1.6), t.lead, t.leadVol);
  }
  // Schlagzeug
  if (t.drums === 'four' && i % 4 === 0) kick(time);
  if (t.drums === 'rock' && (i === 0 || i === 8 || i === 10)) kick(time);
  if ((t.drums === 'four' || t.drums === 'rock') && i % 8 === 4) noise(time, 0.12, 2500, 0.12);
  if (t.drums !== 'none' && i % 2 === 1) noise(time, 0.03, 8000, t.drums === 'soft' ? 0.025 : 0.05);
}

export function tone(freq: number, time: number, dur: number, wave: 'pulse25' | 'pulse50' | 'triangle' | 'square', vol: number, out?: AudioNode) {
  if (!ctx || !musicBus) return;
  const o = ctx.createOscillator();
  if (wave === 'triangle' || wave === 'square') o.type = wave;
  else o.setPeriodicWave(pulseWaves[wave]);
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(vol, time + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  o.connect(g).connect(out ?? musicBus);
  o.start(time);
  o.stop(time + dur + 0.05);
}

export function kick(time: number, out?: AudioNode) {
  if (!ctx || !musicBus) return;
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(140, time);
  o.frequency.exponentialRampToValueAtTime(45, time + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.35, time);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
  o.connect(g).connect(out ?? musicBus);
  o.start(time);
  o.stop(time + 0.2);
}

let noiseBuf: AudioBuffer | null = null;
export function noise(time: number, dur: number, hp: number, vol: number, out?: AudioNode) {
  if (!ctx || !musicBus) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, time);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  src.connect(f).connect(g).connect(out ?? musicBus);
  src.start(time);
  src.stop(time + dur + 0.02);
}

/** Welcher Loop passt zu welcher Szene? */
export function trackForScene(scene: string): TrackName {
  switch (scene) {
    case 'lobby':
    case 'board':
    case 'results':
      return 'party';
    case 'story':
    case 'stars':
    case 'wrap':
    case 'descent':
      return scene === 'descent' || scene === 'wrap' ? 'action' : 'romantic';
    case 'murder':
      return 'spooky';
    case 'wwe':
    case 'nhie':
    case 'hilo':
    case 'bomb':
      return 'bar';
    case 'rhythm':
      return 'romantic';
    default:
      return 'action';
  }
}

// ------------------------------------------------------------------ Rhythmus-Song (geteiltes Gerät)

/**
 * Spielt den Gesprächs-Song auf dem TV. `startPerf` ist der lokale performance.now()-Zeitpunkt
 * von Beat 0 (nach dem Vorlauf) – aus der synchronisierten Serverzeit berechnet.
 */
export function playRhythmSong(startPerf: number, bpm: number, beats: number, leadIn: number) {
  if (!ctx || !master) return;
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(master);
  // performance.now() → AudioContext-Zeit
  const base = ctx.currentTime + (startPerf - performance.now()) / 1000;
  const beat = 60 / bpm;
  const chords = [C, Am, F, G];
  // Einzähler im Vorlauf
  for (let i = 0; i < 4; i++) {
    const t = base + leadIn / 1000 - (4 - i) * beat;
    if (t > ctx.currentTime) tone(m(84), t, 0.08, 'square', 0.05, out);
  }
  for (let b = 0; b < beats; b++) {
    const t = base + leadIn / 1000 + b * beat;
    if (t < ctx.currentTime) continue;
    const chord = chords[Math.floor(b / 4) % 4];
    if (b % 2 === 0) kick(t, out);
    noise(t + beat / 2, 0.03, 8000, 0.05, out);
    if (b % 4 === 2) noise(t, 0.1, 2500, 0.1, out);
    tone(m(chord[0] - 12), t, beat * 0.9, 'triangle', 0.18, out);
    tone(m(chord[b % 3] + 12), t, beat * 0.45, 'pulse25', 0.04, out);
    tone(m(chord[(b + 1) % 3] + 12), t + beat / 2, beat * 0.45, 'pulse25', 0.03, out);
  }
  return () => out.disconnect();
}
