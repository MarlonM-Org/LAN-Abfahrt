/**
 * Ton fürs Gespräch (`rhythm`) am TV: Soundcheck-Klick und Song, beide über dieselbe Zeitumrechnung geplant.
 *
 * Bewusst OHNE `outputLatency`/`getOutputTimestamp`: Hinter dem Browser hängt oft eine Strecke, die er nicht kennt
 * (AirPlay-Spiegelung vom Mac zum Apple TV, HDMI-Tonverarbeitung des Fernsehers …) – oder er meldet sie falsch.
 * Stattdessen: der Ton verlässt den Browser zur Uhrzeit des Servers, und alles dahinter misst der Soundcheck
 * (Handys tippen zum gehörten Klick) als Ton-Versatz. Damit das stimmt, müssen Klick und Song exakt gleich geplant
 * werden – dafür `TonUhr`: laufendes Maximum von `currentTime − performance.now()` (der Hauptthread sieht
 * `currentTime` nur in Sprüngen pro Audio-Puffer; das Maximum liegt direkt nach dem Sprung und ist auf ~1 ms stabil).
 */
import { type Song } from '../../shared/music';
import { RH, rhBeatMs, rhStepMs } from '../../shared/rhythmus';
import { SongPlayer, type Synth, midiHz } from '../music/player';
import { toLocalPerf } from '../timesync';

export class TonUhr {
  private best = -Infinity;
  private at = 0;

  constructor(private ctx: AudioContext) {}

  /** Bei jedem Bild aufrufen – je öfter, desto genauer */
  sample() {
    const now = performance.now();
    const d = this.ctx.currentTime * 1000 - now;
    // Langsam vergessen (0,2 ms pro s), damit eine Drift der Soundkarte nachgezogen wird
    this.best = Math.max(d, this.best - Math.max(0, now - this.at) * 0.0002);
    this.at = now;
  }

  /** performance.now()-Zeit → AudioContext-Zeit (s) */
  perfToAudio(perf: number): number {
    this.sample();
    return (perf + this.best) / 1000;
  }
}

/** Kurzer, harter Klick (gut hörbar, klarer Einsatz) – Betonung auf jedem 4. Schlag */
function klick(synth: Synth, t: number, out: AudioNode, accent: boolean) {
  synth.tone(midiHz(accent ? 96 : 89), t, 0.05, 'square', accent ? 0.09 : 0.06, out);
  if (accent) synth.kick(t, out, 0.22);
}

/** Soundcheck: Klick im Raster `kalAt + k · beat` (Serverzeit), mit kleinem Vorlauf geplant */
export class Soundcheck {
  private timer: number | undefined;
  private next = -Infinity;

  constructor(
    private synth: Synth,
    private uhr: TonUhr,
    private out: AudioNode,
    private kalAt: number,
    private beat: number,
  ) {
    this.timer = window.setInterval(() => this.plan(), 50);
    this.plan();
  }

  /** Schlag k (Serverzeit) → lokale performance-Zeit */
  beatPerf(k: number) {
    return toLocalPerf(this.kalAt + k * this.beat);
  }

  private plan() {
    const ctx = this.synth.ctx;
    if (ctx.state !== 'running') return;
    const nowPerf = performance.now();
    // Erster Schlag, der noch nicht geplant ist und mindestens 20 ms in der Zukunft liegt
    let k = Math.max(this.next, Math.ceil((nowPerf - toLocalPerf(this.kalAt) + 20) / this.beat));
    while (this.beatPerf(k) < nowPerf + 400) {
      const t = this.uhr.perfToAudio(this.beatPerf(k));
      if (t > ctx.currentTime + 0.005) klick(this.synth, t, this.out, ((k % 4) + 4) % 4 === 0);
      k++;
    }
    this.next = k;
  }

  stop() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}

/**
 * Song ab Takt 1 zur Serverzeit `startAt` (davor 4 Klicks Einzähler). Ist der Song schon unterwegs (Ton erst jetzt
 * freigeschaltet), steigt er beim nächsten Schritt ein. Liefert den Player (zum Stoppen) oder null.
 */
export function spieleSong(synth: Synth, uhr: TonUhr, out: AudioNode, song: Song, startAt: number): SongPlayer | null {
  const ctx = synth.ctx;
  if (ctx.state !== 'running') return null;
  const start = uhr.perfToAudio(toLocalPerf(startAt));
  const beat = rhBeatMs(song) / 1000;
  const step = rhStepMs(song) / 1000;
  const parts = { lead: out, bass: out, harmony: out, kick: out, snare: out, hat: out };
  const player = new SongPlayer(synth);
  if (start > ctx.currentTime + 0.05) {
    for (let k = RH.COUNT_IN; k >= 1; k--) {
      const t = start - k * beat;
      if (t > ctx.currentTime) klick(synth, t, out, k === RH.COUNT_IN);
    }
    player.play(song, { loop: false, startAt: start, out: parts });
  } else {
    const from = Math.ceil((ctx.currentTime + 0.12 - start) / step);
    if (from >= song.bars * 16) return null;
    player.play(song, { loop: false, from, startAt: start + from * step, out: parts });
  }
  return player;
}
