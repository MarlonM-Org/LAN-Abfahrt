/**
 * 8-Bit-Synth + Sequencer für Song-Format v2 (WebAudio, keine Audiodateien).
 * Wird vom TV (`client/host/music.ts`) und von der Musik-Werkstatt benutzt.
 *
 * Aufbau: Oszillatoren/Rauschen → Kanal-Gain → `musicBus` (Songs) bzw. `fxBus` (Effekte,
 * Rhythmus-Song, Metronom) → `master` (Gesamtlautstärke + stumm) → Lautsprecher.
 */
import { STEPS_PER_BAR, type Env, type MelodicChannel, type Song, type Wave } from '../../shared/music';

export const midiHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Synth {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly musicBus: GainNode;
  readonly fxBus: GainNode;
  private waves: Partial<Record<Wave, PeriodicWave>> = {};
  private noiseBuf: AudioBuffer | null = null;
  private masterVol = 1;
  private muted = false;

  constructor(ctx = new AudioContext()) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.fxBus = ctx.createGain();
    this.fxBus.connect(this.master);
    for (const duty of [0.125, 0.25, 0.5]) {
      const n = 32;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      this.waves[`pulse${duty === 0.125 ? 12 : duty * 100}` as Wave] = ctx.createPeriodicWave(real, imag);
    }
  }

  get now() {
    return this.ctx.currentTime;
  }

  resume() {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  /** Gesamtlautstärke 0 … 1 (wird mit dem alten Standard 0,9 multipliziert) */
  setMasterVolume(v: number) {
    this.masterVol = Math.max(0, Math.min(1, v));
    this.applyMaster();
  }
  setMuted(m: boolean) {
    this.muted = m;
    this.applyMaster();
  }
  get isMuted() {
    return this.muted;
  }
  private applyMaster() {
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9 * this.masterVol, this.ctx.currentTime, 0.02);
  }
  setMusicVolume(v: number) {
    this.musicBus.gain.setTargetAtTime(Math.max(0, Math.min(1.5, v)), this.ctx.currentTime, 0.05);
  }
  setFxVolume(v: number) {
    this.fxBus.gain.setTargetAtTime(Math.max(0, Math.min(1.5, v)), this.ctx.currentTime, 0.05);
  }

  /**
   * Ein Ton. `env` 'pluck': klingt über `dur` exponentiell aus (alter Loop-Klang);
   * 'hold': steht bis kurz vor Ende und wird dann in 30 ms abgeblendet.
   */
  tone(freq: number, time: number, dur: number, wave: Wave, vol: number, out: AudioNode = this.musicBus, env: Env = 'pluck') {
    if (vol <= 0 || dur <= 0) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    if (wave === 'triangle' || wave === 'square') o.type = wave;
    else if (wave === 'saw') o.type = 'sawtooth';
    else {
      const pw = this.waves[wave];
      if (pw) o.setPeriodicWave(pw);
      else o.type = 'square';
    }
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    if (env === 'pluck') {
      g.gain.exponentialRampToValueAtTime(vol, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    } else {
      const rel = Math.min(0.03, dur / 3);
      g.gain.exponentialRampToValueAtTime(vol, time + 0.005);
      g.gain.setValueAtTime(vol, time + dur - rel);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    }
    o.connect(g).connect(out);
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  kick(time: number, out: AudioNode = this.musicBus, vol = 0.35) {
    if (vol <= 0) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, time);
    o.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    o.connect(g).connect(out);
    o.start(time);
    o.stop(time + 0.2);
  }

  noise(time: number, dur: number, hp: number, vol: number, out: AudioNode = this.musicBus) {
    if (vol <= 0) return;
    const ctx = this.ctx;
    if (!this.noiseBuf) {
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(f).connect(g).connect(out);
    src.start(time);
    src.stop(time + dur + 0.02);
  }

  snare(time: number, out: AudioNode = this.musicBus, vol = 0.12) {
    this.noise(time, 0.12, 2500, vol, out);
  }
  hat(time: number, out: AudioNode = this.musicBus, vol = 0.05) {
    this.noise(time, 0.03, 8000, vol, out);
  }

  /** Metronom-Klick (Effekt-Bus) */
  click(time: number, accent = false) {
    this.tone(accent ? 1760 : 1320, time, 0.05, 'square', accent ? 0.08 : 0.05, this.fxBus);
  }

  /** Einzelne Note sofort anspielen (Vorhören im Editor) */
  preview(midi: number, ch: MelodicChannel, dur = 0.25) {
    this.tone(midiHz(midi), this.ctx.currentTime, dur, ch.wave, Math.min(0.2, ch.volume * 1.2), this.musicBus, 'pluck');
  }
}

export interface PlayOptions {
  loop?: boolean;
  /** Startschritt */
  from?: number;
  /** AudioContext-Zeit, zu der der erste Schritt erklingen soll (sonst sofort) */
  startAt?: number;
  /** Kanäle stumm (z. B. beim Einsingen die Melodie aus) */
  mute?: Partial<Record<'lead' | 'bass' | 'harmony' | 'drums', boolean>>;
  /** Metronom-Klick auf jeden Schlag */
  click?: boolean;
  /** Wird für jeden geplanten Schritt aufgerufen (Schritt, AudioContext-Zeit) */
  onStep?: (step: number, time: number) => void;
  onEnd?: () => void;
}

/**
 * Spielt einen Song (Loop oder einmal). Hot-Swap per `setSong()` (Takt bleibt),
 * `currentStep()` liefert den gerade hörbaren Schritt für den Abspielkopf.
 */
export class SongPlayer {
  private song: Song | null = null;
  private opts: PlayOptions = {};
  private step = 0;
  private nextTime = 0;
  private timer: number | undefined;
  private scheduled: { step: number; time: number }[] = [];
  private ended = false;

  constructor(readonly synth: Synth) {}

  get playing() {
    return this.timer !== undefined;
  }
  get current() {
    return this.song;
  }

  play(song: Song, opts: PlayOptions = {}) {
    this.stop();
    this.song = song;
    this.opts = { loop: true, ...opts };
    this.step = Math.max(0, Math.min((opts.from ?? 0) | 0, song.bars * STEPS_PER_BAR - 1));
    this.nextTime = opts.startAt ?? this.synth.now + 0.08;
    this.scheduled = [];
    this.ended = false;
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.scheduled = [];
  }

  /** Song austauschen, ohne den Takt zu verlieren (Editor, Live-Änderung am TV) */
  setSong(song: Song) {
    this.song = song;
    this.step %= song.bars * STEPS_PER_BAR;
  }

  /** Schritt, der gerade zu hören ist (−1 = nichts) */
  currentStep(): number {
    const now = this.synth.now;
    let s = -1;
    for (const e of this.scheduled) if (e.time <= now) s = e.step;
    else break;
    return s;
  }

  private schedule() {
    const song = this.song;
    if (!song || this.timer === undefined) return;
    const synth = this.synth;
    const stepDur = 60 / song.bpm / 4;
    const total = song.bars * STEPS_PER_BAR;
    while (this.nextTime < synth.now + 0.15) {
      if (this.ended) break;
      const s = this.step;
      const t = this.nextTime + (s % 2 === 1 ? song.swing * stepDur : 0);
      this.playStep(song, s, t, stepDur);
      this.scheduled.push({ step: s, time: t });
      if (this.scheduled.length > 64) this.scheduled.splice(0, this.scheduled.length - 64);
      this.opts.onStep?.(s, t);
      this.nextTime += stepDur;
      this.step = s + 1;
      if (this.step >= total) {
        if (this.opts.loop) this.step = 0;
        else {
          this.ended = true;
          const wait = Math.max(0, (this.nextTime - synth.now) * 1000) + 50;
          window.setTimeout(() => {
            if (this.ended) {
              this.stop();
              this.opts.onEnd?.();
            }
          }, wait);
        }
      }
    }
  }

  private channel(ch: MelodicChannel, step: number, time: number, stepDur: number) {
    for (const n of ch.notes) {
      if (n.step !== step) continue;
      this.synth.tone(midiHz(n.midi), time, n.len * stepDur, ch.wave, ch.volume, this.synth.musicBus, ch.env);
    }
  }

  private playStep(song: Song, s: number, time: number, stepDur: number) {
    const m = this.opts.mute ?? {};
    if (!m.bass) this.channel(song.bass, s, time, stepDur);
    if (!m.harmony) this.channel(song.harmony, s, time, stepDur);
    if (!m.lead) this.channel(song.lead, s, time, stepDur);
    if (!m.drums) {
      const d = song.drums;
      if (d.kick.includes(s)) this.synth.kick(time, this.synth.musicBus, 0.35 * d.volume);
      if (d.snare.includes(s)) this.synth.snare(time, this.synth.musicBus, 0.12 * d.volume);
      if (d.hat.includes(s)) this.synth.hat(time, this.synth.musicBus, 0.05 * d.volume);
    }
    if (this.opts.click && s % 4 === 0) this.synth.click(time, s % STEPS_PER_BAR === 0);
  }
}
