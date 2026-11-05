import type { MiniSnapshot, PrivateState, SkipInfo, TourOutcome, TourState } from '../shared/types';
import { possessive } from '../shared/players';
import { TOUR, TOUR_LOCATIONS, tourRoundMs } from '../shared/tourist';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, groupByScore, phaseTimer, shuffle, waitLabel } from './minigame';

/**
 * Wer ist der Tourist? – Spyfall im Urlaub.
 *
 * Alle außer dem Touristen sehen am Handy den geheimen Ort und eine Rolle dort.
 * Reihum stellt man sich laut Fragen; das Handy sagt nur, wer wen fragt.
 * Einmal pro Runde darf jeder jemanden anklagen (einstimmig → Auflösung),
 * der Tourist darf jederzeit den Ort raten.
 */
export class TouristGame implements MiniGame {
  readonly kind = 'tourist' as const;
  private state: TourState;
  private touristen: string[] = [];
  private touristPool: string[] = [];
  private locOrder: number[];
  private location = 0;
  private roles = new Map<string, string>();
  private votes = new Map<string, boolean>();
  private touristCounts: Record<string, number> = {};
  private deadline = 0;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const roundMs = tourRoundMs(ids.length);
    this.locOrder = shuffle(TOUR_LOCATIONS.map((_, i) => i));
    for (const id of ids) this.touristCounts[id] = 0;
    this.state = {
      sub: 'intro',
      round: 0,
      rounds: Math.min(ids.length, TOUR.MAX_ROUNDS),
      endsIn: 0,
      roundLeft: roundMs,
      roundMs,
      phaseNo: 0,
      points: Object.fromEntries(ids.map((id) => [id, 0])),
      touristCount: ids.length >= TOUR.TWO_TOURISTS_FROM ? 2 : 1,
      asker: null,
      lastAsk: null,
      askSeq: 0,
      accusers: [],
      vote: null,
      reveal: null,
    };
    this.nextRound();
  }

  snapshot(): MiniSnapshot {
    const s = this.state;
    const left = endsIn(this.deadline);
    return { kind: 'tourist', state: { ...s, endsIn: left, roundLeft: s.sub === 'play' ? left : s.roundLeft } };
  }

  privateFor(id: string): PrivateState {
    if (!this.ids.includes(id) || this.state.round === 0) return null;
    const tourist = this.touristen.includes(id);
    return {
      kind: 'tourist',
      state: {
        round: this.state.round,
        tourist,
        location: tourist ? null : TOUR_LOCATIONS[this.location].name,
        role: tourist ? null : (this.roles.get(id) ?? null),
        myVote: this.votes.get(id) ?? null,
      },
    };
  }

  input(id: string, action: string, payload: unknown) {
    if (!this.ids.includes(id)) return;
    const s = this.state;
    const p = asRecord(payload);

    if (action === 'ask' && s.sub === 'play' && s.asker === id) {
      const target = String(p.target ?? '');
      if (!this.askable(id).includes(target)) return;
      s.lastAsk = { from: id, to: target };
      s.askSeq += 1;
      s.asker = target;
      this.ctx.onChange();
    } else if (action === 'accuse' && s.sub === 'play' && !s.accusers.includes(id)) {
      const target = String(p.target ?? '');
      if (target === id || !this.ids.includes(target)) return;
      this.startVote(id, target);
    } else if (action === 'vote' && s.sub === 'vote' && s.vote && s.vote.passed === null) {
      if (id === s.vote.accuser || id === s.vote.accused || this.votes.has(id)) return;
      this.votes.set(id, p.yes === true);
      s.vote.voted = [...this.votes.keys()];
      if (this.voters().every((v) => this.votes.has(v))) this.resolveVote();
      else this.ctx.onChange();
    } else if (action === 'guess' && s.sub === 'play' && this.touristen.includes(id)) {
      const loc = Number(p.loc);
      if (!Number.isInteger(loc) || loc < 0 || loc >= TOUR_LOCATIONS.length) return;
      this.endRound(loc === this.location ? 'guess-right' : 'guess-wrong', { guesser: id, guess: TOUR_LOCATIONS[loc].name });
    }
  }

  playerDisconnected(id: string) {
    const s = this.state;
    if (s.sub === 'play' && s.asker === id) {
      const others = this.ids.filter((o) => o !== id && this.ctx.isConnected(o));
      if (others.length) {
        s.asker = others[Math.floor(Math.random() * others.length)];
        this.ctx.onChange();
      }
    }
    if (s.sub === 'vote' && s.vote?.passed === null && this.voters().every((v) => this.votes.has(v))) this.resolveVote();
  }

  dispose() {
    this.timers.clear();
  }

  // ---------------------------------------------------------------- Ablauf

  /** Wen darf `id` fragen? Alle anderen – außer die Person, die einen gerade gefragt hat. */
  private askable(id: string): string[] {
    const back = this.state.lastAsk?.to === id ? this.state.lastAsk.from : null;
    const others = this.ids.filter((o) => o !== id);
    return others.length > 1 && back ? others.filter((o) => o !== back) : others;
  }

  private voters(): string[] {
    const v = this.state.vote;
    if (!v) return [];
    return this.ids.filter((id) => id !== v.accuser && id !== v.accused && this.ctx.isConnected(id));
  }

  private nextRound() {
    const s = this.state;
    if (s.round >= s.rounds) return this.finishGame();
    s.round += 1;
    s.phaseNo += 1;

    // Touristen reihum, aber zufällig: erst wenn alle einmal dran waren, geht es von vorne los
    const picks: string[] = [];
    while (picks.length < s.touristCount) {
      if (!this.touristPool.length) this.touristPool = shuffle(this.ids);
      const id = this.touristPool.shift()!;
      if (!picks.includes(id)) picks.push(id);
    }
    this.touristen = picks;
    for (const id of picks) this.touristCounts[id] += 1;

    this.location = this.locOrder[(s.round - 1) % this.locOrder.length];
    const locals = shuffle(this.ids.filter((id) => !picks.includes(id)));
    let pool: string[] = [];
    this.roles.clear();
    for (const id of locals) {
      if (!pool.length) pool = shuffle(TOUR_LOCATIONS[this.location].roles);
      this.roles.set(id, pool.shift()!);
    }

    const connected = this.ids.filter((id) => this.ctx.isConnected(id));
    const starters = connected.length ? connected : this.ids;
    s.sub = 'intro';
    s.asker = starters[Math.floor(Math.random() * starters.length)];
    s.lastAsk = null;
    s.accusers = [];
    s.vote = null;
    s.reveal = null;
    s.roundLeft = s.roundMs;
    this.votes.clear();
    this.setDeadline(TOUR.INTRO_MS);
    this.timers.later(TOUR.INTRO_MS, () => this.resumePlay());
    this.after = () => this.resumePlay();
    this.ctx.onChange();
  }

  /** Fragerunde (weiter)laufen lassen – mit der Restzeit aus `roundLeft` */
  private resumePlay() {
    const s = this.state;
    s.sub = 'play';
    s.phaseNo += 1;
    s.vote = null;
    this.votes.clear();
    this.setDeadline(s.roundLeft);
    this.timers.later(s.roundLeft, () => this.endRound('timeout'));
    this.ctx.onChange();
  }

  private startVote(accuser: string, accused: string) {
    const s = this.state;
    this.timers.clear();
    s.roundLeft = Math.max(1000, this.deadline - Date.now());
    s.accusers = [...s.accusers, accuser];
    s.vote = { accuser, accused, voted: [], yes: null, no: null, passed: null };
    s.sub = 'vote';
    s.phaseNo += 1;
    this.votes.clear();
    this.deadline = phaseTimer(this.timers, TOUR.VOTE_MS, () => this.resolveVote());
    if (this.voters().length === 0) return this.resolveVote();
    this.ctx.onChange();
  }

  /** Einstimmig ja (außer dem Angeklagten) → Auflösung, sonst geht die Runde weiter. Fehlende Stimmen zählen als nein. */
  private resolveVote() {
    const s = this.state;
    const v = s.vote;
    if (!v || v.passed !== null) return;
    this.timers.clear();
    const voters = this.ids.filter((id) => id !== v.accuser && id !== v.accused);
    const yes = voters.filter((id) => this.votes.get(id) === true).length;
    v.yes = yes;
    v.no = voters.length - yes;
    const needed = this.voters();
    v.passed = needed.every((id) => this.votes.get(id) === true);
    this.setDeadline(TOUR.VOTE_RESULT_MS);
    this.ctx.onChange();
    this.after = () => {
      if (v.passed) {
        this.endRound(this.touristen.includes(v.accused) ? 'caught' : 'wrong-accuse', { accuser: v.accuser, accused: v.accused });
      } else {
        this.resumePlay();
      }
    };
    const after = this.after;
    this.timers.later(TOUR.VOTE_RESULT_MS, after);
  }

  private endRound(outcome: TourOutcome, extra: { guesser?: string; guess?: string; accuser?: string; accused?: string } = {}) {
    const s = this.state;
    this.timers.clear();
    if (s.sub === 'play') s.roundLeft = Math.max(0, this.deadline - Date.now());
    const locals = this.ids.filter((id) => !this.touristen.includes(id));
    const gains: Record<string, number> = {};
    const give = (id: string, n: number) => (gains[id] = (gains[id] ?? 0) + n);
    if (outcome === 'guess-right') {
      for (const t of this.touristen) give(t, t === extra.guesser ? TOUR.GUESS_POINTS : TOUR.SURVIVE_POINTS);
    } else if (outcome === 'guess-wrong') {
      for (const id of locals) give(id, TOUR.CATCH_POINTS);
    } else if (outcome === 'caught') {
      for (const id of locals) give(id, id === extra.accuser ? TOUR.ACCUSER_POINTS : TOUR.CATCH_POINTS);
    } else {
      for (const t of this.touristen) give(t, TOUR.SURVIVE_POINTS);
    }
    for (const [id, n] of Object.entries(gains)) s.points[id] += n;
    s.sub = 'reveal';
    s.phaseNo += 1;
    s.vote = null;
    s.reveal = {
      location: TOUR_LOCATIONS[this.location].name,
      touristen: [...this.touristen],
      outcome,
      accuser: extra.accuser ?? null,
      accused: extra.accused ?? null,
      guesser: extra.guesser ?? null,
      guess: extra.guess ?? null,
      gains,
    };
    this.setDeadline(TOUR.REVEAL_MS);
    this.timers.later(TOUR.REVEAL_MS, () => this.nextRound());
    this.after = () => this.nextRound();
    this.ctx.onChange();
  }

  private finishGame() {
    const s = this.state;
    s.sub = 'over';
    s.phaseNo += 1;
    s.reveal = null;
    s.vote = null;
    this.setDeadline(0);
    this.ctx.onChange();
    this.timers.later(800, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => s.points[id]),
        details: Object.fromEntries(
          this.ids.map((id) => {
            const n = this.touristCounts[id];
            return [id, `${s.points[id]} ${s.points[id] === 1 ? 'Punkt' : 'Punkte'}${n ? ` · ${n}× Tourist` : ''}`];
          }),
        ),
        subtitle: 'Punkte fürs Entlarven, Erraten und Durchmogeln.',
      }),
    );
  }

  /** Nächster Schritt nach einem Info-Screen (Intro, Abstimmungsergebnis, Auflösung) */
  private after: (() => void) | null = null;

  /**
   * VIP/Laptop: Info-Screens überspringen, Abstimmung beenden (fehlende Stimmen = nein) oder
   * die Frage weitergeben, wenn der Gefragte nicht reagiert. Die Rundenuhr selbst bleibt Spielzeit.
   */
  skippable(): SkipInfo | null {
    const s = this.state;
    if (s.sub === 'intro' || s.sub === 'reveal') return { label: 'Weiter', info: true };
    if (s.sub === 'vote' && s.vote) {
      if (s.vote.passed !== null) return { label: 'Weiter', info: true };
      const missing = this.voters().filter((id) => !this.votes.has(id));
      return { label: waitLabel(this.ctx, missing, 'Stimme', 'Abstimmung beenden') };
    }
    if (s.sub === 'play' && s.asker) return { label: `${possessive(this.ctx.nameOf(s.asker))} Frage überspringen` };
    return null;
  }

  skip() {
    const s = this.state;
    if (s.sub === 'play') {
      const others = this.ids.filter((o) => o !== s.asker && this.ctx.isConnected(o));
      const pool = others.length ? others : this.ids.filter((o) => o !== s.asker);
      if (pool.length) s.asker = pool[Math.floor(Math.random() * pool.length)];
      s.lastAsk = null;
      return this.ctx.onChange();
    }
    if (s.sub === 'vote' && s.vote?.passed === null) return this.resolveVote();
    const after = this.after;
    if (!after) return;
    this.after = null;
    this.timers.clear();
    after();
  }

  private setDeadline(ms: number) {
    this.deadline = Date.now() + ms;
  }
}
