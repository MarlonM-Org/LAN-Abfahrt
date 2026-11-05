/**
 * Einsingen: Mikrofon aufnehmen (gleicher AudioContext wie der Synth, damit Klick, Begleitung
 * und Spur dieselbe Uhr haben), Einzähler + Metronom, Tonhöhe im Worker, live als Linie in der
 * Piano-Roll; am Ende Segmentierung → Sechzehntel → Vorschlag im Zielkanal.
 *
 * Ablauf nach dem Vorbild von CheatSheet (`mikrofonspur.ts`), nur dass die Fenster nicht per
 * Timer aus einem Analyser gelesen werden, sondern ein AudioWorklet sie alle 1024 Samples mit
 * exakter Audio-Uhrzeit liefert (keine verlorenen Rahmen, wenn der Haupt-Thread hakt).
 */
import { type ChannelId, STEPS_PER_BAR } from '../../shared/music';
import { type PitchFrame, quantize, segment } from '../music/pitch';
import type { SongPlayer, Synth } from '../music/player';
import type { PitchResponse } from './pitchWorker';
import type { Store } from './store';

export interface SingOptions {
  channel: ChannelId;
  fromBar: number;
  bars: number;
  countIn: boolean;
  click: boolean;
  /** Song (ohne Zielkanal) mitlaufen lassen */
  backing: boolean;
  snapScale: boolean;
}

export type SingPhase = 'idle' | 'countin' | 'recording' | 'done';

/** Worklet-Prozessor als Text (Blob-URL), damit er in Dev-Server und Build gleich lädt */
const WORKLET_SRC = `
class LanCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.fill = 0; this.since = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const n = ch.length;
    this.buf.copyWithin(0, n);
    this.buf.set(ch, 2048 - n);
    this.fill = Math.min(2048, this.fill + n);
    this.since += n;
    if (this.fill >= 2048 && this.since >= 1024) {
      this.since = 0;
      const copy = this.buf.slice();
      // Zeit der Fenstermitte: Blockende minus halbes Fenster
      this.port.postMessage({ t: currentTime + n / sampleRate - 1024 / sampleRate, buf: copy }, [copy.buffer]);
    }
    return true;
  }
}
registerProcessor('lan-capture', LanCapture);
`;
let workletUrl: string | null = null;
const readyContexts = new WeakSet<AudioContext>();
async function ensureWorklet(ctx: AudioContext) {
  if (readyContexts.has(ctx)) return;
  workletUrl ??= URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(workletUrl);
  readyContexts.add(ctx);
}

export class Singer {
  phase: SingPhase = 'idle';
  private stream: MediaStream | null = null;
  private capture: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worker: Worker | null = null;
  private timer: number | undefined;
  private frames: PitchFrame[] = [];
  private t0 = 0;
  private opts: SingOptions | null = null;
  private pending = 0;
  onPhase: (p: SingPhase, info?: string) => void = () => undefined;

  constructor(
    private store: Store,
    private synth: Synth,
    private player: SongPlayer,
  ) {}

  get active() {
    return this.phase === 'countin' || this.phase === 'recording';
  }

  async start(o: SingOptions) {
    if (this.active) return;
    this.opts = o;
    const ctx = this.synth.ctx;
    this.synth.resume();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
    } catch (e) {
      const name = (e as Error).name;
      this.onPhase('idle', name === 'NotAllowedError' ? 'Mikrofon nicht erlaubt – bitte im Browser für diese Seite freigeben.' : `Mikrofon nicht verfügbar (${name}).`);
      return;
    }
    try {
      await ensureWorklet(ctx);
    } catch (e) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.onPhase('idle', `AudioWorklet nicht verfügbar (${(e as Error).message}).`);
      return;
    }
    this.worker = new Worker(new URL('./pitchWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<PitchResponse>) => {
      this.pending--;
      const r = e.data;
      // Reihenfolge ist durch den Worker garantiert (eine Nachricht nach der anderen)
      this.frames.push({ t: r.t, midi: r.midi, rms: r.rms });
      this.store.setLive({ from: o.fromBar * STEPS_PER_BAR, bpm: this.store.song.bpm, frames: this.frames });
    };
    this.capture = new AudioWorkletNode(ctx, 'lan-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
    this.source = ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.capture);

    const song = this.store.song;
    const stepDur = 60 / song.bpm / 4;
    const barDur = stepDur * STEPS_PER_BAR;
    const begin = ctx.currentTime + 0.15;
    this.t0 = begin + (o.countIn ? barDur : 0);
    const endTime = this.t0 + o.bars * barDur + 0.25;
    this.frames = [];
    this.store.setProposal(null);
    this.store.setLive({ from: o.fromBar * STEPS_PER_BAR, bpm: song.bpm, frames: this.frames });

    // Einzähler
    if (o.countIn) for (let i = 0; i < 4; i++) this.synth.click(begin + i * stepDur * 4, i === 0);
    // Begleitung/Metronom über den Player ab Schritt des Starttakts
    const from = o.fromBar * STEPS_PER_BAR;
    if (o.backing || o.click) {
      this.player.play(song, {
        loop: false,
        from,
        startAt: this.t0,
        click: o.click,
        mute: o.backing ? { [o.channel]: true } : { lead: true, bass: true, harmony: true, drums: true },
      });
    }
    this.phase = 'countin';
    this.onPhase('countin');
    const sampleRate = ctx.sampleRate;
    this.capture.port.onmessage = (e: MessageEvent<{ t: number; buf: Float32Array }>) => {
      if (!this.worker || !this.active) return;
      const t = e.data.t - this.t0;
      if (t < -0.05 || t > endTime - this.t0) return;
      this.pending++;
      this.worker.postMessage({ t, sampleRate, buf: e.data.buf }, [e.data.buf.buffer]);
    };
    this.timer = window.setInterval(() => {
      const now = ctx.currentTime;
      if (now >= this.t0 && this.phase === 'countin') {
        this.phase = 'recording';
        this.onPhase('recording');
      }
      if (now >= endTime) void this.finish();
    }, 30);
  }

  /** Aufnahme beenden (vorzeitig oder am Ende) und Vorschlag berechnen */
  async finish() {
    if (!this.active) return;
    const o = this.opts!;
    clearInterval(this.timer);
    this.player.stop();
    this.source?.disconnect();
    this.capture?.disconnect();
    if (this.capture) this.capture.port.onmessage = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    // Letzte Worker-Antworten abwarten
    for (let i = 0; i < 40 && this.pending > 0; i++) await new Promise((r) => setTimeout(r, 15));
    this.worker?.terminate();
    this.worker = null;
    this.stream = null;
    this.phase = 'done';
    const song = this.store.song;
    const fromStep = o.fromBar * STEPS_PER_BAR;
    const toStep = Math.min(song.bars * STEPS_PER_BAR, fromStep + o.bars * STEPS_PER_BAR);
    const segs = segment(this.frames);
    const notes = quantize(segs, { bpm: song.bpm, key: o.snapScale ? song.key : null, startStep: fromStep, maxStep: toStep });
    this.store.setProposal({ channel: o.channel, fromStep, toStep, notes });
    this.onPhase('done', notes.length ? `${notes.length} Noten erkannt – übernehmen?` : 'Nichts erkannt – näher ans Mikro, lauter singen?');
  }

  cancel() {
    if (!this.active) return;
    clearInterval(this.timer);
    this.player.stop();
    this.source?.disconnect();
    this.capture?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.worker?.terminate();
    this.worker = null;
    this.stream = null;
    this.phase = 'idle';
    this.store.setLive(null);
    this.onPhase('idle');
  }
}
