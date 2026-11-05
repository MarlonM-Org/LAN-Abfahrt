/**
 * Soundeffekte für den TV – prozedural erzeugte Chiptune-Töne (keine Audiodateien).
 *
 * Alles läuft über den `fxBus` des Synths (`client/music/player.ts`), damit der Regler
 * „Effekte“ im Musikmenü, die Gesamtlautstärke und „Stumm“ greifen. Ohne freigeschaltetes
 * Audio (noch kein Klick/Tastendruck am TV) passiert einfach nichts.
 *
 *   sfx('hit', { x: 120 })          // Stereo nach x-Position (0–480 → links … rechts)
 *   sfx('coin', { pitch: 1.2 })     // höher; jede Wiedergabe variiert zusätzlich ±5 %
 *   sfx('boom', { vol: 0.6 })       // leiser
 */
import { audioCtx, audioFx } from './music';

export type SfxName =
  | 'hit' | 'hitHard' | 'boom' | 'splash' | 'coin' | 'jump' | 'powerup' | 'tick' | 'go' | 'ko'
  | 'win' | 'lose' | 'error' | 'whoosh' | 'throw' | 'catch' | 'select' | 'goal' | 'strike' | 'pop'
  | 'cheer' | 'countdown' | 'drumroll' | 'fanfare' | 'bonk' | 'shoot' | 'whistle' | 'crack';

export const SFX_NAMES: SfxName[] = [
  'hit', 'hitHard', 'boom', 'splash', 'coin', 'jump', 'powerup', 'tick', 'go', 'ko',
  'win', 'lose', 'error', 'whoosh', 'throw', 'catch', 'select', 'goal', 'strike', 'pop',
  'cheer', 'countdown', 'drumroll', 'fanfare', 'bonk', 'shoot', 'whistle', 'crack',
];

export interface SfxOpts {
  /** Stereo −1 (links) … 1 (rechts) */
  pan?: number;
  /** Alternativ: x-Position in der Welt (0–480), wird zu `pan` umgerechnet */
  x?: number;
  /** Tonhöhen-Faktor (1 = normal); dazu kommen immer ±5 % Zufall */
  pitch?: number;
  /** Lautstärke-Faktor (1 = normal) */
  vol?: number;
  /** Verzögerung in Sekunden */
  delay?: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Welt-x (0–480) → Stereo-Panorama −1 … 1 */
export const panX = (x: number) => clamp(x / 240 - 1, -1, 1);

type Env = 'pluck' | 'hold';

/** Baukasten für einen Effekt: alle Zeiten relativ zum Start, alle Frequenzen × Tonhöhe */
class Voice {
  constructor(
    readonly ctx: AudioContext,
    readonly out: AudioNode,
    readonly t0: number,
    readonly p: number,
  ) {}

  osc(type: OscillatorType, f0: number, f1: number | null, at: number, dur: number, vol: number, env: Env = 'pluck', vib?: [number, number]) {
    const { ctx } = this;
    const t = this.t0 + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0 * this.p, t);
    if (f1 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * this.p), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    if (env === 'pluck') {
      g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } else {
      const rel = Math.min(0.04, dur / 3);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      g.gain.setValueAtTime(vol, t + dur - rel);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    let lfo: OscillatorNode | null = null;
    if (vib) {
      // Vibrato: [Rate Hz, Tiefe Hz]
      lfo = ctx.createOscillator();
      lfo.frequency.value = vib[0];
      const lg = ctx.createGain();
      lg.gain.value = vib[1] * this.p;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Gefiltertes Rauschen; `f1` = Zielfrequenz des Filters (Sweep), `attack` für weiche Einsätze */
  noise(at: number, dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number | null = null, q = 1, attack = 0.003, tremolo?: number) {
    const { ctx } = this;
    const t = this.t0 + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0 * this.p, t);
    if (f1 !== null) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * this.p), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let last: AudioNode = g;
    if (tremolo) {
      // Schwankende Lautstärke (Jubel)
      const trem = ctx.createGain();
      trem.gain.value = 0.6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = tremolo;
      const lg = ctx.createGain();
      lg.gain.value = 0.4;
      lfo.connect(lg).connect(trem.gain);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
      g.connect(trem);
      last = trem;
    }
    src.connect(f).connect(g);
    last.connect(this.out);
    const buf = src.buffer!;
    const offset = Math.random() * Math.max(0, buf.duration - dur - 0.1);
    src.start(t, offset, dur + 0.05);
  }

  /** Mehrere Noten hintereinander (Hz, Dauer) */
  seq(type: OscillatorType, notes: [number, number][], at: number, vol: number, env: Env = 'hold', gap = 0) {
    let t = at;
    for (const [f, d] of notes) {
      if (f > 0) this.osc(type, f, null, t, d, vol, env);
      t += d + gap;
    }
    return t;
  }
}

const noiseBufs = new WeakMap<AudioContext, AudioBuffer>();
function noiseBuffer(ctx: AudioContext) {
  let b = noiseBufs.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2.5), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBufs.set(ctx, b);
  }
  return b;
}

// Noten (Hz)
const N = { G3: 196, C4: 262, E4: 330, F4: 349, G4: 392, A4: 440, B4: 494, C5: 523, D5: 587, E5: 659, G5: 784, A5: 880, B5: 988, C6: 1047, E6: 1319, G6: 1568 };

/** Rezepte: bauen den Effekt und geben seine Länge (s) zurück */
const RECIPES: Record<SfxName, (v: Voice) => number> = {
  hit: (v) => {
    v.osc('square', 420, 110, 0, 0.09, 0.14);
    v.noise(0, 0.05, 0.16, 'highpass', 2500);
    return 0.1;
  },
  hitHard: (v) => {
    v.osc('square', 260, 50, 0, 0.2, 0.17);
    v.osc('triangle', 170, 40, 0, 0.26, 0.4);
    v.noise(0, 0.2, 0.3, 'lowpass', 3500, 300);
    return 0.27;
  },
  boom: (v) => {
    v.noise(0, 0.95, 0.55, 'lowpass', 2200, 70, 0.8);
    v.osc('triangle', 120, 28, 0, 0.6, 0.5);
    v.osc('square', 80, 30, 0, 0.22, 0.1);
    return 0.95;
  },
  splash: (v) => {
    v.noise(0, 0.5, 0.32, 'bandpass', 800, 3600, 0.7, 0.01);
    v.noise(0.04, 0.38, 0.12, 'highpass', 5000);
    v.osc('sine', 500, 1300, 0.02, 0.09, 0.12);
    return 0.55;
  },
  coin: (v) => {
    v.osc('square', N.B5, null, 0, 0.07, 0.08, 'hold');
    v.osc('square', N.E6, null, 0.07, 0.36, 0.08);
    return 0.43;
  },
  jump: (v) => {
    v.osc('square', 280, 760, 0, 0.16, 0.09);
    return 0.17;
  },
  powerup: (v) => {
    const notes = [N.C5, N.E5, N.G5, N.C6, N.E6, N.G6];
    notes.forEach((f, i) => {
      v.osc('square', f, null, i * 0.05, 0.1, 0.07);
      v.osc('triangle', f / 2, null, i * 0.05, 0.1, 0.12);
    });
    return 0.42;
  },
  tick: (v) => {
    v.osc('square', 1800, null, 0, 0.03, 0.05);
    v.noise(0, 0.02, 0.05, 'highpass', 6000);
    return 0.04;
  },
  countdown: (v) => {
    v.osc('square', N.A5, null, 0, 0.16, 0.1, 'hold');
    v.osc('triangle', N.A4, null, 0, 0.16, 0.12, 'hold');
    return 0.18;
  },
  go: (v) => {
    v.osc('square', N.A5 * 1.5, null, 0, 0.5, 0.09, 'hold', [7, 6]);
    v.osc('square', N.A5, null, 0, 0.5, 0.06, 'hold');
    v.osc('triangle', N.A4, null, 0, 0.5, 0.16, 'hold');
    v.noise(0, 0.12, 0.08, 'highpass', 5000);
    return 0.52;
  },
  ko: (v) => {
    v.osc('square', 900, 70, 0, 0.6, 0.13);
    v.osc('triangle', 220, 40, 0, 0.5, 0.3);
    v.noise(0, 0.45, 0.25, 'lowpass', 4500, 200);
    return 0.62;
  },
  win: (v) => {
    const t = v.seq('square', [[N.C5, 0.09], [N.E5, 0.09], [N.G5, 0.09]], 0, 0.08);
    v.seq('triangle', [[N.C4, 0.09], [N.E4, 0.09], [N.G4, 0.09]], 0, 0.12);
    for (const f of [N.C6, N.G5, N.E5]) v.osc('square', f, null, t, 0.55, 0.06, 'hold', [6, 5]);
    v.osc('triangle', N.C4, null, t, 0.55, 0.16, 'hold');
    return t + 0.56;
  },
  lose: (v) => {
    const t = v.seq('triangle', [[N.G4, 0.26], [370, 0.26], [N.F4, 0.26]], 0, 0.18, 'hold', 0.03);
    v.seq('square', [[N.G3, 0.26], [185, 0.26], [175, 0.26]], 0, 0.04, 'hold', 0.03);
    v.osc('triangle', N.E4, null, t, 0.7, 0.18, 'hold', [5, 8]);
    v.osc('square', 165, null, t, 0.7, 0.04, 'hold', [5, 4]);
    return t + 0.72;
  },
  error: (v) => {
    v.osc('square', 150, null, 0, 0.1, 0.09, 'hold');
    v.osc('square', 140, null, 0.13, 0.17, 0.09, 'hold');
    return 0.31;
  },
  whoosh: (v) => {
    v.noise(0, 0.32, 0.22, 'bandpass', 450, 3800, 1.6, 0.12);
    return 0.33;
  },
  throw: (v) => {
    v.noise(0, 0.15, 0.16, 'bandpass', 1200, 3200, 1.2, 0.03);
    v.osc('triangle', 300, 720, 0, 0.1, 0.12);
    return 0.16;
  },
  shoot: (v) => {
    v.noise(0, 0.13, 0.32, 'lowpass', 7000, 700);
    v.osc('square', 320, 60, 0, 0.08, 0.12);
    return 0.14;
  },
  catch: (v) => {
    v.osc('triangle', N.E5, null, 0, 0.06, 0.2);
    v.osc('triangle', N.B5, null, 0.06, 0.13, 0.2);
    v.noise(0, 0.03, 0.08, 'highpass', 4000);
    return 0.2;
  },
  select: (v) => {
    v.osc('square', N.C6, null, 0, 0.05, 0.06);
    v.osc('square', N.G6, null, 0.05, 0.1, 0.06);
    return 0.16;
  },
  goal: (v) => {
    const t = v.seq('square', [[N.G4, 0.1], [N.C5, 0.1], [N.E5, 0.1]], 0, 0.08);
    v.osc('square', N.G5, null, t, 0.7, 0.08, 'hold', [6, 6]);
    v.osc('square', N.E5, null, t, 0.7, 0.05, 'hold');
    v.osc('triangle', N.C4, null, t, 0.7, 0.16, 'hold');
    RECIPES.cheer(v);
    return Math.max(t + 0.72, 1.5);
  },
  strike: (v) => {
    v.noise(0, 0.7, 0.3, 'highpass', 1200, 600);
    for (let i = 0; i < 7; i++) {
      const at = 0.02 + i * 0.035 + Math.random() * 0.06;
      v.osc('triangle', 900 + Math.random() * 700, 320, at, 0.06, 0.16);
    }
    v.osc('triangle', 110, 40, 0, 0.3, 0.35);
    return 0.72;
  },
  pop: (v) => {
    v.osc('sine', 300, 1400, 0, 0.06, 0.25);
    return 0.07;
  },
  cheer: (v) => {
    v.noise(0, 1.5, 0.16, 'bandpass', 900, 1300, 0.6, 0.25, 9);
    v.noise(0.05, 1.4, 0.1, 'bandpass', 2400, 2000, 0.8, 0.3, 13);
    // ein paar „Huuu!“-Pfiffe
    v.osc('sine', 1500, 2300, 0.2, 0.35, 0.03);
    v.osc('sine', 1800, 2600, 0.55, 0.3, 0.025);
    return 1.5;
  },
  drumroll: (v) => {
    const n = 30;
    for (let i = 0; i < n; i++) {
      const at = i * 0.05;
      v.noise(at, 0.06, 0.04 + (i / n) * 0.12, 'bandpass', 2600, null, 0.8);
    }
    const end = n * 0.05;
    v.noise(end, 0.9, 0.22, 'highpass', 4000, 2500);
    v.osc('triangle', 130, 45, end, 0.3, 0.4);
    return end + 0.9;
  },
  fanfare: (v) => {
    const notes: [number, number][] = [[N.G4, 0.11], [N.G4, 0.11], [N.G4, 0.11], [N.C5, 0.55]];
    const t = v.seq('square', notes, 0, 0.08, 'hold', 0.02);
    v.seq('square', [[N.E4, 0.11], [N.E4, 0.11], [N.E4, 0.11], [N.E5, 0.55]], 0, 0.04, 'hold', 0.02);
    v.seq('triangle', [[N.C4 / 2, 0.11], [N.C4 / 2, 0.11], [N.G3 / 2, 0.11], [N.C4 / 2, 0.55]], 0, 0.18, 'hold', 0.02);
    const t2 = v.seq('square', [[N.D5, 0.11], [N.E5, 0.11]], t + 0.04, 0.08, 'hold', 0.02);
    v.osc('square', N.G5, null, t2, 0.7, 0.08, 'hold', [6, 6]);
    v.osc('square', N.C5, null, t2, 0.7, 0.05, 'hold');
    v.osc('triangle', N.C4 / 2, null, t2, 0.7, 0.18, 'hold');
    return t2 + 0.72;
  },
  bonk: (v) => {
    v.osc('triangle', 760, 340, 0, 0.12, 0.28);
    v.osc('sine', 190, 150, 0, 0.1, 0.25);
    v.noise(0, 0.02, 0.1, 'highpass', 3000);
    return 0.13;
  },
  whistle: (v) => {
    // Trillerpfeife (früher eigener AudioContext in VersteckScene)
    const { ctx } = v;
    const t = v.t0;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1300 * v.p, t);
    o.frequency.exponentialRampToValueAtTime(2200 * v.p, t + 0.18);
    o.frequency.setValueAtTime(1500 * v.p, t + 0.26);
    o.frequency.exponentialRampToValueAtTime(2600 * v.p, t + 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.03);
    g.gain.setValueAtTime(0.18, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.02, t + 0.24);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(v.out);
    o.start(t);
    o.stop(t + 0.62);
    return 0.62;
  },
  crack: (v) => {
    v.noise(0, 0.07, 0.25, 'bandpass', 1800, 900, 3);
    v.osc('square', 150, 80, 0, 0.05, 0.08);
    v.noise(0.06, 0.05, 0.12, 'bandpass', 2400, null, 3);
    return 0.12;
  },
};

/** Mindestabstand (s) zwischen zwei gleichen Effekten – bei 12 Spielern sonst Matsch */
const GAP: Partial<Record<SfxName, number>> = { select: 0.08, tick: 0.025, hit: 0.035, splash: 0.08, boom: 0.06, cheer: 0.6, drumroll: 1, fanfare: 0.8, countdown: 0.3, go: 0.5, crack: 0.05 };
const MAX_VOICES = 28;
const lastAt = new Map<SfxName, number>();
let voices: number[] = [];

/** Spielt einen Effekt; `false`, wenn kein Audio bereit ist oder gedrosselt wurde */
export function sfx(name: SfxName, o: SfxOpts = {}): boolean {
  const ctx = audioCtx();
  const bus = audioFx();
  if (!ctx || !bus || ctx.state !== 'running') return false;
  const recipe = RECIPES[name];
  if (!recipe) return false;
  const now = ctx.currentTime;
  const start = now + Math.max(0, o.delay ?? 0) + 0.005;
  const prev = lastAt.get(name);
  if (prev !== undefined && Math.abs(start - prev) < (GAP[name] ?? 0.02)) return false;
  voices = voices.filter((t) => t > now);
  if (voices.length >= MAX_VOICES) return false;
  lastAt.set(name, start);

  const out = ctx.createGain();
  out.gain.value = clamp(o.vol ?? 1, 0, 2);
  const pan = clamp(o.pan ?? (o.x !== undefined ? panX(o.x) : 0), -1, 1);
  let tail: AudioNode = out;
  if (pan && typeof ctx.createStereoPanner === 'function') {
    const sp = ctx.createStereoPanner();
    sp.pan.value = pan;
    out.connect(sp);
    tail = sp;
  }
  tail.connect(bus);
  const pitch = clamp(o.pitch ?? 1, 0.25, 4) * (1 + (Math.random() - 0.5) * 0.1);
  let dur = 0.5;
  try {
    dur = recipe(new Voice(ctx, out, start, pitch));
  } catch (e) {
    console.warn('sfx', name, e);
  }
  voices.push(start + dur);
  // Knoten nach dem Ausklingen abhängen (die Oszillatoren stoppen von selbst)
  window.setTimeout(() => {
    out.disconnect();
    if (tail !== out) tail.disconnect();
  }, (start - now + dur + 0.4) * 1000);
  return true;
}

/** Fürs Testen in der Konsole: `__sfx('boom')`, `__sfxAll()` */
const W = window as unknown as { __sfx?: typeof sfx; __sfxAll?: () => void };
W.__sfx = sfx;
W.__sfxAll = () => SFX_NAMES.forEach((n, i) => window.setTimeout(() => sfx(n), i * 900));
