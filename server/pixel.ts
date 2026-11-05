import type { MiniSnapshot, PixelState, PrivateState, SkipInfo } from '../shared/types';
import { PIXEL, PIXEL_PROMPTS, cleanPic, filledCount } from '../shared/pixel';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, groupByScore, shuffle, waitLabel } from './minigame';

/**
 * Pixel-Galerie: Alle malen zum selben Thema ein 16 × 16-Pixelbild am Handy.
 * Danach zeigt der TV die Ausstellung (anonym), jeder stimmt für sein Lieblingsbild
 * (nicht das eigene), dann werden Künstler und Stimmen aufgedeckt. 3 Runden,
 * gewertet wird nach erhaltenen Stimmen.
 */
export class PixelGame implements MiniGame {
  readonly kind = 'pixel' as const;
  private state: PixelState;
  private prompts: string[];
  /** Bilder der aktuellen Runde (Entwurf bzw. fertig) */
  private pics = new Map<string, string>();
  /** Ausstellung: Künstler in Anzeige-Reihenfolge */
  private order: string[] = [];
  private votes = new Map<string, number>();
  private best: { by: string; prompt: string; votes: number } | null = null;
  private deadline = 0;
  /** Reguläres Ende der Malzeit (falls jemand nach "alle fertig" doch noch ändert) */
  private paintEnds = 0;
  private timers = new Timers();
  private pending: (() => void) | null = null;
  private seq = 0;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.prompts = shuffle(PIXEL_PROMPTS);
    const zero = () => Object.fromEntries(ids.map((id) => [id, 0]));
    this.state = {
      sub: 'intro',
      round: 0,
      rounds: PIXEL.ROUNDS,
      prompt: '',
      endsIn: 0,
      players: [...ids],
      filled: zero(),
      done: [],
      gallery: [],
      voters: [],
      voted: [],
      points: zero(),
      roundGain: zero(),
    };
    this.startRound(1);
  }

  // ---------------------------------------------------------------- Ablaufsteuerung (wie Sprüche-Duell)

  /** Nächsten Schritt nach `ms` ausführen – der VIP kann ihn mit "Weiter" vorziehen */
  private schedule(ms: number | null, fn: () => void) {
    this.timers.clear();
    this.deadline = ms === null ? 0 : Date.now() + ms;
    const token = ++this.seq;
    const run = () => {
      if (this.seq !== token) return;
      this.seq++;
      this.pending = null;
      this.timers.clear();
      fn();
    };
    this.pending = run;
    if (ms !== null) this.timers.later(ms, run);
  }

  /** Alle fertig → kurz durchatmen, dann weiter */
  private soon(ms = 900) {
    const run = this.pending;
    if (!run) return;
    this.timers.clear();
    this.deadline = Date.now() + ms;
    this.timers.later(ms, run);
  }

  private connected = (id: string) => this.ctx.isConnected(id);

  // ---------------------------------------------------------------- Runden

  private startRound(round: number) {
    const s = this.state;
    s.round = round;
    s.prompt = this.prompts[(round - 1) % this.prompts.length];
    s.sub = 'intro';
    s.gallery = [];
    s.voters = [];
    s.voted = [];
    s.done = [];
    this.pics.clear();
    this.order = [];
    this.votes.clear();
    for (const id of this.ids) {
      s.filled[id] = 0;
      s.roundGain[id] = 0;
    }
    this.schedule(PIXEL.INTRO_MS, () => this.startPaint());
    this.ctx.onChange();
  }

  private startPaint() {
    this.state.sub = 'paint';
    this.paintEnds = PIXEL.PAINT_MS === null ? 0 : Date.now() + PIXEL.PAINT_MS;
    this.schedule(PIXEL.PAINT_MS, () => this.startVote());
    this.ctx.onChange();
  }

  private startVote() {
    const s = this.state;
    // Ausstellung: alle Bilder mit mindestens einem Pixel, anonym gemischt
    this.order = shuffle(this.ids.filter((id) => filledCount(this.pics.get(id)) >= PIXEL.MIN_FILLED));
    s.gallery = this.order.map((id) => ({ pic: this.pics.get(id)!, by: null, votes: null }));
    s.done = [];
    if (!this.order.length) {
      // Niemand hat gemalt → gleich weiter
      s.sub = 'reveal';
      this.schedule(3000, () => this.showScores());
      return this.ctx.onChange();
    }
    s.voters = this.ids.filter((id) => this.connected(id) && this.order.some((by) => by !== id));
    s.voted = [];
    this.votes.clear();
    s.sub = 'vote';
    this.schedule(this.order.length > 8 ? PIXEL.VOTE_MS_MANY : PIXEL.VOTE_MS, () => this.reveal());
    if (!s.voters.length) this.soon(2500);
    this.ctx.onChange();
  }

  private reveal() {
    const s = this.state;
    const counts = this.order.map(() => 0);
    for (const idx of this.votes.values()) if (counts[idx] !== undefined) counts[idx]++;
    s.gallery = this.order.map((by, i) => {
      s.points[by] = (s.points[by] ?? 0) + counts[i];
      s.roundGain[by] = counts[i];
      if (counts[i] > 0 && (!this.best || counts[i] > this.best.votes)) this.best = { by, prompt: s.prompt, votes: counts[i] };
      return { pic: this.pics.get(by)!, by, votes: counts[i] };
    });
    s.sub = 'reveal';
    this.schedule(PIXEL.REVEAL_MS + Math.min(4000, this.order.length * 300), () => this.showScores());
    this.ctx.onChange();
  }

  private showScores() {
    const s = this.state;
    s.sub = 'scores';
    s.voters = [];
    s.voted = [];
    this.schedule(PIXEL.SCORES_MS, () => (s.round >= s.rounds ? this.finish() : this.startRound(s.round + 1)));
    this.ctx.onChange();
  }

  private finish() {
    const s = this.state;
    s.sub = 'over';
    this.deadline = 0;
    this.pending = null;
    this.ctx.onChange();
    const best = this.best;
    const subtitle = best
      ? `Publikumsliebling: ${this.ctx.nameOf(best.by)} mit „${best.prompt}“ (${best.votes} ${best.votes === 1 ? 'Stimme' : 'Stimmen'})`
      : 'Keine Stimmen – die Galerie bleibt geheimnisvoll.';
    this.timers.later(600, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => s.points[id] ?? 0),
        details: Object.fromEntries(this.ids.map((id) => [id, `${s.points[id] ?? 0} ${s.points[id] === 1 ? 'Stimme' : 'Stimmen'}`])),
        subtitle,
      }),
    );
  }

  private checkAllDone() {
    const s = this.state;
    if (!this.pending) return;
    if (s.sub === 'paint') {
      const active = this.ids.filter(this.connected);
      if (active.length && active.every((id) => s.done.includes(id))) this.soon(1200);
    } else if (s.sub === 'vote') {
      const active = s.voters.filter(this.connected);
      if (active.every((id) => this.votes.has(id))) this.soon(1200);
    }
  }

  // ---------------------------------------------------------------- Schnittstelle

  snapshot(): MiniSnapshot {
    const s = this.state;
    return { kind: 'pixel', state: { ...s, endsIn: endsIn(this.deadline) } };
  }

  privateFor(id: string): PrivateState {
    const s = this.state;
    if (!this.ids.includes(id)) return null;
    const i = this.order.indexOf(id);
    return {
      kind: 'pixel',
      state: {
        round: s.round,
        sub: s.sub,
        pic: s.sub === 'paint' ? (this.pics.get(id) ?? null) : null,
        done: s.done.includes(id),
        mine: (s.sub === 'vote' || s.sub === 'reveal') && i >= 0 ? i : null,
        canVote: s.sub === 'vote' && s.voters.includes(id),
        myVote: this.votes.get(id) ?? null,
      },
    };
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (!this.ids.includes(id)) return;
    const p = asRecord(payload);

    if (action === 'paint' && s.sub === 'paint') {
      if (Number(p.round) !== s.round) return;
      const pic = cleanPic(p.pic);
      if (!pic) return;
      const wasDone = s.done.includes(id);
      if (wasDone && !p.done) return; // fertig = gesperrt, bis "Doch noch ändern"
      this.pics.set(id, pic);
      const filled = filledCount(pic);
      const changed = filled !== s.filled[id];
      s.filled[id] = filled;
      if (p.done && !wasDone) {
        s.done = [...s.done, id];
        this.ctx.onChange();
        return this.checkAllDone();
      }
      if (changed) this.ctx.onChange();
      return;
    }
    if (action === 'undone' && s.sub === 'paint' && s.done.includes(id)) {
      s.done = s.done.filter((x) => x !== id);
      // Lief schon der "alle fertig"-Countdown → wieder bis zum regulären Ende (mind. 10 s) malen
      const left = this.paintEnds - Date.now();
      if (this.pending && !this.paintEnds) this.schedule(null, () => this.startVote());
      else if (this.pending && this.deadline < this.paintEnds) this.schedule(Math.max(10000, left), () => this.startVote());
      return this.ctx.onChange();
    }
    if (action === 'vote' && s.sub === 'vote' && s.voters.includes(id) && !this.votes.has(id)) {
      const idx = Number(p.idx);
      if (Number(p.round) !== s.round || !Number.isInteger(idx) || !this.order[idx] || this.order[idx] === id) return;
      this.votes.set(id, idx);
      s.voted = [...this.votes.keys()];
      this.ctx.onChange();
      return this.checkAllDone();
    }
  }

  vipAction(action: string) {
    if (action !== 'next' || !this.pending) return;
    const sub = this.state.sub;
    // Malphase nicht per Knopf abkürzen – da malen noch alle
    if (sub === 'intro' || sub === 'vote' || sub === 'reveal' || sub === 'scores') this.pending();
  }

  /** VIP/Laptop: jeden Schritt vorziehen – beim Malen zählt, was bisher auf der Leinwand ist */
  skippable(): SkipInfo | null {
    if (!this.pending) return null;
    const s = this.state;
    if (s.sub === 'intro') return { label: 'Los geht’s', info: true };
    if (s.sub === 'paint') {
      const missing = this.ids.filter((id) => this.connected(id) && !s.done.includes(id));
      return { label: waitLabel(this.ctx, missing, 'Bild', 'Malen beenden') };
    }
    if (s.sub === 'vote') {
      const missing = s.voters.filter((id) => this.connected(id) && !this.votes.has(id));
      return { label: waitLabel(this.ctx, missing, 'Stimme', 'Abstimmung beenden') };
    }
    if (s.sub === 'reveal' || s.sub === 'scores') return { label: 'Weiter', info: true };
    return null;
  }

  skip() {
    this.pending?.();
  }

  playerDisconnected() {
    this.checkAllDone();
  }

  dispose() {
    this.timers.clear();
    this.pending = null;
  }
}
