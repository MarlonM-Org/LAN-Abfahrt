import type { MiniSnapshot, RhythmNote, RhythmState } from '../shared/types';
import { RHYTHM, RHYTHM_TOPICS } from '../shared/dategames';
import { type MiniCtx, type MiniGame, Timers, asRecord, shuffle } from './minigame';

/**
 * Das erste Gespräch: Ein Rhythmusspiel. Abwechselnd "redet" einer (viele Noten),
 * der andere hört zu (wenige Noten, nicken). Bewertet wird direkt am Handy,
 * damit Netzwerk-Verzögerungen keine Rolle spielen.
 */
export class RhythmGame implements MiniGame {
  readonly kind = 'rhythm' as const;
  private state: RhythmState;
  private judged = new Map<string, Set<number>>();
  private timers = new Timers();
  private seq = 0;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const beat = 60000 / RHYTHM.BPM;
    const phraseBeats = 8;
    const topics = shuffle(RHYTHM_TOPICS);
    const phrases: RhythmState['phrases'] = [];
    const charts: Record<string, RhythmNote[]> = Object.fromEntries(ids.map((id) => [id, []]));

    for (let p = 0; p < RHYTHM.BEATS / phraseBeats; p++) {
      const speaker = ids[p % ids.length];
      const from = RHYTHM.LEAD_IN + p * phraseBeats * beat;
      phrases.push({ from, to: from + phraseBeats * beat, speaker, topic: topics[p % topics.length] });
      for (const id of ids) {
        const talking = id === speaker || ids.length === 1;
        for (let b = 0; b < phraseBeats; b++) {
          const t = from + b * beat;
          if (talking) {
            if (b === 7) continue; // Atempause
            if (Math.random() < 0.8) charts[id].push({ t, lane: Math.random() < 0.5 ? 0 : 1 });
            if (p > 0 && Math.random() < 0.22) charts[id].push({ t: t + beat / 2, lane: Math.random() < 0.5 ? 0 : 1 });
          } else if (b % 4 === 0) {
            charts[id].push({ t, lane: b === 0 ? 0 : 1 }); // Nicken
          }
        }
      }
    }
    for (const id of ids) charts[id].sort((a, b) => a.t - b.t);

    this.state = {
      sub: 'ready',
      ready: [],
      playSeq: 0,
      bpm: RHYTHM.BPM,
      leadIn: RHYTHM.LEAD_IN,
      duration: RHYTHM.LEAD_IN + RHYTHM.BEATS * beat + 800,
      charts,
      phrases,
      score: Object.fromEntries(ids.map((id) => [id, 0])),
      combo: Object.fromEntries(ids.map((id) => [id, 0])),
      lastHit: {},
      sympathy: 50,
    };
    for (const id of ids) this.judged.set(id, new Set());
    // Falls jemand nicht "bereit" drückt, geht es trotzdem los
    this.timers.later(25000, () => this.play());
  }

  snapshot(): MiniSnapshot {
    return { kind: 'rhythm', state: this.state };
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (!this.ids.includes(id)) return;
    if (action === 'ready' && s.sub === 'ready') {
      if (!s.ready.includes(id)) s.ready.push(id);
      if (this.ids.filter((p) => this.ctx.isConnected(p)).every((p) => s.ready.includes(p))) this.play();
      else this.ctx.onChange();
    } else if (action === 'hit' && s.sub === 'play') {
      const p = asRecord(payload);
      const i = Number(p.i);
      const q = Math.max(0, Math.min(2, Math.round(Number(p.q)))) as 0 | 1 | 2;
      const judged = this.judged.get(id)!;
      if (!Number.isInteger(i) || i < 0 || i >= s.charts[id].length || judged.has(i)) return;
      judged.add(i);
      s.score[id] += q;
      s.combo[id] = q > 0 ? s.combo[id] + 1 : 0;
      s.lastHit[id] = { q, seq: ++this.seq };
      s.sympathy = this.sympathyNow();
      this.ctx.onChange();
    }
  }

  private sympathyNow() {
    let got = 0;
    let max = 0;
    for (const id of this.ids) {
      got += this.state.score[id];
      max += this.judged.get(id)!.size * 2;
    }
    return max ? Math.round((got / max) * 100) : 50;
  }

  private play() {
    const s = this.state;
    if (s.sub !== 'ready') return;
    this.timers.clear();
    s.sub = 'play';
    s.playSeq += 1;
    this.ctx.onChange();
    this.timers.later(s.duration + 1500, () => this.end());
  }

  private end() {
    const s = this.state;
    s.sub = 'over';
    this.ctx.onChange();
    let got = 0;
    let max = 0;
    for (const id of this.ids) {
      got += s.score[id];
      max += s.charts[id].length * 2;
    }
    const ratio = max ? got / max : 0;
    const hearts = Math.max(0, Math.min(10, Math.round(ratio * 10 + 0.5)));
    this.timers.later(2500, () =>
      this.ctx.finish({
        groups: [this.ids],
        details: Object.fromEntries(this.ids.map((id) => [id, `${Math.round((s.score[id] / Math.max(1, s.charts[id].length * 2)) * 100)}% im Takt`])),
        subtitle: ratio > 0.75 ? 'Ihr redet, als würdet ihr euch ewig kennen.' : ratio > 0.45 ? 'Ein paar Pausen – aber das Lachen war echt.' : 'Ähm ... schönes Wetter heute, oder?',
        hearts: this.ctx.mode === 'date' ? hearts : undefined,
      }),
    );
  }

  playerDisconnected() {}

  dispose() {
    this.timers.clear();
  }
}
