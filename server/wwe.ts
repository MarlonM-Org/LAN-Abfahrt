import type { MiniSnapshot, WweState } from '../shared/types';
import { WWE } from '../shared/games';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

/**
 * Wer würde eher …? – alle stimmen geheim ab, wer gemeint ist.
 * Punkte bekommt, wer mit der Mehrheit gestimmt hat.
 */
export class WweGame implements MiniGame {
  readonly kind = 'wwe' as const;
  private state: WweState;
  private questions: string[];
  private votes = new Map<string, string>();
  private deadline = 0;
  private timers = new Timers();
  private totalSips: Record<string, number> = {};

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
    customQuestions: string[],
    defaults: string[],
  ) {
    // Eigene Fragen haben Vorrang, Rest mit Standardfragen auffüllen
    const custom = shuffle(customQuestions);
    const fill = shuffle(defaults.filter((q) => !custom.includes(q)));
    this.questions = [...custom, ...fill].slice(0, WWE.ROUNDS);
    const points: Record<string, number> = {};
    for (const id of ids) points[id] = 0;
    this.state = {
      round: 0,
      rounds: this.questions.length,
      question: '',
      sub: 'question',
      endsIn: 0,
      voted: [],
      votes: null,
      tally: null,
      points,
      drinking: ctx.mode === 'drink',
      sips: null,
    };
    this.totalSips = Object.fromEntries(ids.map((id) => [id, 0]));
    this.nextRound();
  }

  snapshot(): MiniSnapshot {
    return { kind: 'wwe', state: { ...this.state, endsIn: Math.max(0, this.deadline - Date.now()) } };
  }

  input(playerId: string, action: string, payload: unknown) {
    if (action !== 'vote' || this.state.sub !== 'question') return;
    const target = String(asRecord(payload).target ?? '');
    if (!this.ids.includes(playerId) || !this.ids.includes(target)) return;
    this.votes.set(playerId, target);
    this.state.voted = [...this.votes.keys()];
    if (!this.checkAllVoted()) this.ctx.onChange();
  }

  /** Alle (noch verbundenen) haben abgestimmt → sofort auflösen. */
  private checkAllVoted() {
    if (this.state.sub !== 'question' || !this.votes.size) return false;
    if (!this.ids.filter((id) => this.ctx.isConnected(id)).every((id) => this.votes.has(id))) return false;
    this.timers.clear();
    this.reveal();
    return true;
  }

  playerDisconnected() {
    // Wer weg ist, wird nicht mehr abgewartet (sonst läuft die Abstimmung bis zum Timer)
    this.checkAllVoted();
  }

  dispose() {
    this.timers.clear();
  }

  private nextRound() {
    const s = this.state;
    if (s.round >= this.questions.length) return this.finish();
    s.question = this.questions[s.round];
    s.round += 1;
    s.sub = 'question';
    s.voted = [];
    s.votes = null;
    s.tally = null;
    s.sips = null;
    this.votes.clear();
    this.deadline = Date.now() + WWE.QUESTION_MS;
    this.timers.later(WWE.QUESTION_MS, () => this.reveal());
    this.ctx.onChange();
  }

  private reveal() {
    const s = this.state;
    const tally: Record<string, number> = {};
    for (const t of this.votes.values()) tally[t] = (tally[t] ?? 0) + 1;
    const max = Math.max(0, ...Object.values(tally));
    if (max > 0) {
      for (const [voter, target] of this.votes) if (tally[target] === max) s.points[voter] += 1;
    }
    // Trinkspiel: Meistgewählte trinken so viele Schlücke wie sie Stimmen haben
    s.sips = {};
    if (s.drinking && max > 0) {
      for (const [id, n] of Object.entries(tally)) if (n === max) s.sips[id] = n;
      for (const [id, n] of Object.entries(s.sips)) this.totalSips[id] = (this.totalSips[id] ?? 0) + n;
    }
    s.sub = 'reveal';
    s.votes = Object.fromEntries(this.votes);
    s.tally = tally;
    this.deadline = Date.now() + WWE.REVEAL_MS;
    this.timers.later(WWE.REVEAL_MS, () => this.nextRound());
    this.ctx.onChange();
  }

  private finish() {
    const s = this.state;
    s.sub = 'over';
    this.ctx.onChange();
    this.timers.later(500, () =>
      this.ctx.finish(
        s.drinking
          ? {
              groups: groupByScore(this.ids, (id) => this.totalSips[id]),
              details: Object.fromEntries(this.ids.map((id) => [id, `${this.totalSips[id]} Schlücke`])),
              subtitle: 'Wer am häufigsten gewählt wurde, hat getrunken.',
              sips: this.totalSips,
            }
          : {
              groups: groupByScore(this.ids, (id) => s.points[id]),
              details: Object.fromEntries(this.ids.map((id) => [id, `${s.points[id]} Punkte`])),
              subtitle: 'Punkte gab’s fürs Stimmen mit der Mehrheit.',
            },
      ),
    );
  }
}
