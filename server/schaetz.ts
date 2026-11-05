import type { MiniSnapshot, PrivateState, SchaetzCard, SchaetzState, SkipInfo } from '../shared/types';
import { SCHAETZ, SCHAETZ_FACTS, SCHAETZ_GROUP, fmtNum, groupQuestion, schaetzOdds } from '../shared/schaetz';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, groupByScore, shuffle, waitLabel } from './minigame';

/** Eine Runde: Wissensfrage mit fester Antwort oder Gruppenfrage über einen Spieler */
type RoundPlan = { question: string; unit: string; answer: number; subject: null } | { question: string; unit: string; answer: null; subject: string };

/**
 * Schätzkönig (à la Wits & Wagers).
 * Alle tippen eine Zahl, der TV sortiert die Antworten als Karten auf einen Zahlenstrahl.
 * Dann setzt jeder 2 Chips auf die Karte, die am nächsten dran ist, ohne drüber zu liegen
 * (außen liegende Karten zahlen mehr). Gruppenfragen („Wie viele Minuten war Ben im Bad?“)
 * löst der VIP am Handy auf – ohne Eingabe zählt der Median.
 */
export class SchaetzGame implements MiniGame {
  readonly kind = 'schaetz' as const;
  private state: SchaetzState;
  private plan: RoundPlan[];
  private guesses = new Map<string, number>();
  private truth: number | null = null;
  private deadline = 0;
  /** Reguläres Phasenende (ohne „alle fertig“-Abkürzung) */
  private phaseEnd = 0;
  private timers = new Timers();
  private pending: (() => void) | null = null;
  private seq = 0;
  /** Bester Riecher des Spiels (kleinster relativer Fehler) */
  private best: { id: string; err: number; guess: number; answer: number; unit: string } | null = null;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const party = ctx.mode === 'party';
    const rounds = party ? SCHAETZ.PARTY_ROUNDS : SCHAETZ.ROUNDS;
    const facts = shuffle(SCHAETZ_FACTS).slice(0, rounds);
    this.plan = facts.map((f) => ({ question: f.q, unit: f.unit, answer: f.a, subject: null }));
    // Arcade: eine der Runden 2–4 ist eine Gruppenfrage über einen (menschlichen) Mitspieler
    if (!party && rounds >= 2) {
      const humans = ids.filter((id) => !ctx.isBot?.(id));
      const pool = humans.length ? humans : ids;
      const subject = pool[Math.floor(Math.random() * pool.length)];
      const g = SCHAETZ_GROUP[Math.floor(Math.random() * SCHAETZ_GROUP.length)];
      const at = 1 + Math.floor(Math.random() * (rounds - 1));
      this.plan[at] = { question: groupQuestion(g, ctx.nameOf(subject)), unit: g.unit, answer: null, subject };
    }
    const zero = () => Object.fromEntries(ids.map((id) => [id, 0]));
    this.state = {
      sub: 'guess',
      round: 0,
      rounds: this.plan.length,
      endsIn: 0,
      question: '',
      unit: '',
      subject: null,
      players: [...ids],
      guessed: [],
      cards: null,
      lowOdds: SCHAETZ.LOW_ODDS,
      chips: {},
      betDone: [],
      answer: null,
      answerByMedian: false,
      winner: null,
      gain: null,
      points: zero(),
    };
    this.startRound(1);
  }

  // ---------------------------------------------------------------- Ablaufsteuerung (wie Sprüche-Duell)

  /** Nächsten Schritt nach `ms` – VIP/Laptop können ihn vorziehen */
  private schedule(ms: number, fn: () => void) {
    this.timers.clear();
    this.deadline = Date.now() + ms;
    this.phaseEnd = this.deadline;
    const token = ++this.seq;
    const run = () => {
      if (this.seq !== token) return;
      this.seq++;
      this.pending = null;
      this.timers.clear();
      fn();
    };
    this.pending = run;
    this.timers.later(ms, run);
  }

  /** Alle fertig → kurz durchatmen, dann weiter */
  private soon(ms = 900) {
    const run = this.pending;
    if (!run || this.deadline - Date.now() <= ms) return;
    this.timers.clear();
    this.deadline = Date.now() + ms;
    this.timers.later(ms, run);
  }

  /** Doch nicht alle fertig (Chips zurückgenommen) → wieder die normale Restzeit */
  private resume() {
    const run = this.pending;
    if (!run || this.deadline >= this.phaseEnd) return;
    this.timers.clear();
    this.deadline = this.phaseEnd;
    this.timers.later(Math.max(0, this.phaseEnd - Date.now()), run);
  }

  private connected = (id: string) => this.ctx.isConnected(id);

  // ---------------------------------------------------------------- Runden

  private startRound(round: number) {
    const s = this.state;
    const p = this.plan[round - 1];
    s.round = round;
    s.sub = 'guess';
    s.question = p.question;
    s.unit = p.unit;
    s.subject = p.subject;
    s.guessed = [];
    s.cards = null;
    s.chips = {};
    s.betDone = [];
    s.answer = null;
    s.answerByMedian = false;
    s.winner = null;
    s.gain = null;
    this.guesses.clear();
    this.truth = p.answer;
    this.schedule(SCHAETZ.GUESS_MS, () => this.endGuess());
    this.ctx.onChange();
  }

  private endGuess() {
    const s = this.state;
    const byValue = new Map<number, string[]>();
    for (const id of this.ids) {
      const v = this.guesses.get(id);
      if (v === undefined) continue;
      byValue.set(v, [...(byValue.get(v) ?? []), id]);
    }
    const values = [...byValue.keys()].sort((a, b) => a - b);
    s.cards = values.map((value, i): SchaetzCard => ({ value, by: byValue.get(value)!, odds: schaetzOdds(i, values.length) }));
    s.sub = 'line';
    // Keiner hat geschätzt → gleich auflösen
    this.schedule(SCHAETZ.LINE_MS, () => (s.cards!.length ? this.startBet() : this.endBet()));
    this.ctx.onChange();
  }

  private startBet() {
    const s = this.state;
    s.sub = 'bet';
    s.chips = {};
    s.betDone = [];
    this.schedule(SCHAETZ.BET_MS, () => this.endBet());
    this.ctx.onChange();
  }

  private endBet() {
    const s = this.state;
    if (this.truth !== null) return this.drum();
    // Gruppenfrage: der VIP tippt die richtige Zahl ein
    s.sub = 'truth';
    this.schedule(SCHAETZ.TRUTH_MS, () => this.truthByMedian());
    this.ctx.onChange();
  }

  private truthByMedian() {
    const vals = [...this.guesses.values()].sort((a, b) => a - b);
    this.truth = vals.length ? vals[Math.floor((vals.length - 1) / 2)] : 0;
    this.state.answerByMedian = true;
    this.drum();
  }

  private drum() {
    this.state.sub = 'drum';
    this.schedule(SCHAETZ.DRUM_MS, () => this.reveal());
    this.ctx.onChange();
  }

  private reveal() {
    const s = this.state;
    const answer = this.truth ?? 0;
    const cards = s.cards ?? [];
    // Gewinner: größte Karte ≤ Antwort, sonst „Alle zu hoch“
    let winner = -1;
    cards.forEach((c, i) => {
      if (c.value <= answer) winner = i;
    });
    const gain: Record<string, number> = Object.fromEntries(this.ids.map((id) => [id, 0]));
    const odds = winner >= 0 ? cards[winner].odds : s.lowOdds;
    for (const [id, picks] of Object.entries(s.chips)) for (const k of picks) if (k === winner && id in gain) gain[id] += odds;
    if (winner >= 0) for (const id of cards[winner].by) if (id in gain) gain[id] += SCHAETZ.AUTHOR_BONUS;
    for (const id of this.ids) s.points[id] = (s.points[id] ?? 0) + gain[id];
    // Bester Riecher: relativer Fehler (Gruppenfragen mit Median zählen nicht)
    if (!s.answerByMedian) {
      for (const [id, g] of this.guesses) {
        const err = Math.abs(g - answer) / Math.max(1, Math.abs(answer));
        if (!this.best || err < this.best.err) this.best = { id, err, guess: g, answer, unit: s.unit };
      }
    }
    s.answer = answer;
    s.winner = cards.length ? winner : null;
    s.gain = gain;
    s.sub = 'reveal';
    this.schedule(SCHAETZ.REVEAL_MS, () => (s.round >= s.rounds ? this.finish() : this.showScores()));
    this.ctx.onChange();
  }

  private showScores() {
    this.state.sub = 'scores';
    this.schedule(SCHAETZ.SCORES_MS, () => this.startRound(this.state.round + 1));
    this.ctx.onChange();
  }

  private finish() {
    const s = this.state;
    s.sub = 'over';
    this.pending = null;
    this.deadline = 0;
    this.timers.clear();
    this.ctx.onChange();
    const b = this.best;
    const subtitle = b
      ? b.guess === b.answer
        ? `Volltreffer von ${this.ctx.nameOf(b.id)}: genau ${fmtNum(b.answer)} ${b.unit}!`.replace(/\s+!$/, '!')
        : `Bester Riecher: ${this.ctx.nameOf(b.id)} (${fmtNum(b.guess)} statt ${fmtNum(b.answer)}${b.unit ? ` ${b.unit}` : ''})`
      : 'Punkte gab’s für Chips auf der besten Karte.';
    this.timers.later(600, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => s.points[id] ?? 0),
        details: Object.fromEntries(this.ids.map((id) => [id, `${s.points[id] ?? 0} Punkte`])),
        subtitle,
      }),
    );
  }

  private checkAllDone() {
    const s = this.state;
    if (!this.pending) return;
    const active = this.ids.filter(this.connected);
    if (!active.length) return;
    if (s.sub === 'guess' && active.every((id) => this.guesses.has(id))) this.soon();
    if (s.sub === 'bet' && active.every((id) => s.betDone.includes(id))) this.soon(1200);
  }

  // ---------------------------------------------------------------- Schnittstelle

  snapshot(): MiniSnapshot {
    return { kind: 'schaetz', state: { ...this.state, endsIn: endsIn(this.deadline) } };
  }

  privateFor(id: string): PrivateState {
    if (!this.ids.includes(id)) return null;
    return { kind: 'schaetz', state: { round: this.state.round, guess: this.guesses.get(id) ?? null } };
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (!this.ids.includes(id)) return;
    const p = asRecord(payload);
    if (Number(p.round) !== s.round) return;

    if (action === 'guess' && s.sub === 'guess' && !this.guesses.has(id)) {
      const v = Number(p.value);
      if (!Number.isFinite(v) || v < 0 || v > SCHAETZ.MAX_GUESS) return;
      this.guesses.set(id, Math.round(v));
      s.guessed = [...this.guesses.keys()];
      this.ctx.onChange();
      return this.checkAllDone();
    }
    if (s.sub !== 'bet' || !s.cards) return;
    if (action === 'chip') {
      const k = Number(p.card);
      if (!Number.isInteger(k) || k < -1 || k >= s.cards.length) return;
      const mine = s.chips[id] ?? [];
      if (mine.length >= SCHAETZ.CHIPS) return;
      s.chips = { ...s.chips, [id]: [...mine, k] };
      if (s.chips[id].length >= SCHAETZ.CHIPS) s.betDone = [...s.betDone, id];
      this.ctx.onChange();
      return this.checkAllDone();
    }
    if (action === 'unchip') {
      if (!s.chips[id]?.length) return;
      const { [id]: _drop, ...rest } = s.chips;
      s.chips = rest;
      s.betDone = s.betDone.filter((x) => x !== id);
      // War schon „alle fertig“ angestoßen? Dann wieder die normale Restzeit abwarten
      this.resume();
      this.ctx.onChange();
    }
  }

  /** VIP: `next` (Info-Screens vorziehen) und `truth:<Zahl>` (Gruppenfrage auflösen) */
  vipAction(action: string) {
    const s = this.state;
    if (action.startsWith('truth:')) {
      if (s.sub !== 'truth' || !this.pending) return;
      const v = Number(action.slice(6));
      if (!Number.isFinite(v) || v < 0 || v > SCHAETZ.MAX_GUESS) return;
      this.truth = Math.round(v);
      this.seq++;
      this.pending = null;
      this.drum();
      return;
    }
    if (action !== 'next' || !this.pending) return;
    if (s.sub === 'line' || s.sub === 'reveal' || s.sub === 'scores') this.pending();
  }

  skippable(): SkipInfo | null {
    if (!this.pending) return null;
    const s = this.state;
    if (s.sub === 'guess') {
      const missing = this.ids.filter((id) => this.connected(id) && !this.guesses.has(id));
      return { label: waitLabel(this.ctx, missing, 'Schätzung', 'Schätzen beenden') };
    }
    if (s.sub === 'bet') {
      const missing = this.ids.filter((id) => this.connected(id) && !s.betDone.includes(id));
      return { label: waitLabel(this.ctx, missing, 'Chips', 'Wetten beenden') };
    }
    if (s.sub === 'truth') return { label: 'Ohne Auflösung weiter (Median)' };
    if (s.sub === 'line') return { label: 'Chips setzen', info: true };
    if (s.sub === 'reveal') return { label: s.round >= s.rounds ? 'Zur Auswertung' : 'Weiter', info: true };
    if (s.sub === 'scores') return { label: 'Nächste Frage', info: true };
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
