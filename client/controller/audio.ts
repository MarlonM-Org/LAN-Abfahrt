/** Kleiner WebAudio-Synth für das Rhythmusspiel (muss durch einen Tap entsperrt werden). */
let ctx: AudioContext | null = null;

export function unlockAudio(): AudioContext | null {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    // stummer Ton, damit iOS den Kontext wirklich freigibt
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.01);
  } catch {
    ctx = null;
  }
  return ctx;
}

export const audio = () => ctx;

function env(t: number, attack: number, decay: number, peak: number) {
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(ctx!.destination);
  return g;
}

export function kick(t: number) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(130, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
  o.connect(env(t, 0.005, 0.2, 0.5));
  o.start(t);
  o.stop(t + 0.25);
}

export function hat(t: number) {
  if (!ctx) return;
  const len = 0.05;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6000;
  src.connect(hp).connect(env(t, 0.002, 0.05, 0.12));
  src.start(t);
}

/** Weicher Bass/Akkordton */
export function pad(t: number, freq: number, dur: number) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = freq;
  o.connect(env(t, 0.03, dur, 0.12));
  o.start(t);
  o.stop(t + dur + 0.1);
}

/** Kurzer, heller Ton bei einem Treffer */
export function pluck(freq: number) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.value = freq;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2200;
  o.connect(lp).connect(env(t, 0.004, 0.18, 0.1));
  o.start(t);
  o.stop(t + 0.25);
}

export const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
const BASS = [130.81, 110, 87.31, 98]; // C – a – F – G

/** Plant die Begleitmusik für den ganzen Song */
export function scheduleSong(startAt: number, beatSec: number, beats: number) {
  if (!ctx) return;
  for (let b = 0; b < beats; b++) {
    const t = startAt + b * beatSec;
    if (b % 2 === 0) kick(t);
    hat(t + beatSec / 2);
    if (b % 4 === 0) pad(t, BASS[Math.floor(b / 4) % BASS.length], beatSec * 3.5);
  }
}
