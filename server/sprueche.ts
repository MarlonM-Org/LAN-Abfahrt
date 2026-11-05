import type { MiniSnapshot, PrivateState, SkipInfo, SpruecheState } from '../shared/types';
import { QUIP_NO_ANSWER, QUIP_PROMPTS, QUIP_SAFETY, SPRUECHE, quipMultiplier } from '../shared/sprueche';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, groupByScore, shuffle, waitLabel } from './minigame';

/** Eine Frage der aktuellen Runde mit ihren Autoren */
interface QuipPrompt {
  text: string;
  authors: string[];
  answers: Map<string, string>;
  drafts: Map<string, string>;
  /** Wer nichts abgegeben hat ("(keine Antwort)") */
  missing: Set<string>;
}

/**
 * Sprüche-Duell (à la Quiplash).
 * Runde 1 + 2: Jede Frage beantworten genau zwei Spieler, jeder Spieler beantwortet zwei Fragen
 * (Kreis: Frage i → order[i] und order[i + 1]). Danach Duell für Duell abstimmen.
 * Finale: alle beantworten dieselbe Frage, jeder hat bis zu 3 Stimmen.
 */
export class SpruecheGame implements MiniGame {
  readonly kind = 'sprueche' as const;
  private state: SpruecheState;
  private pool: string[];
  private prompts: QuipPrompt[] = [];
  /** Duell: [Autor links, Autor rechts] */
  private pair: [string, string] = ['', ''];
  /** Finale: Antworten in Anzeige-Reihenfolge */
  private finalOrder: { by: string; text: string }[] = [];
  private votes = new Map<string, number[]>();
  private voteDone = new Set<string>();
  private suggestions = new Map<string, { text: string; seq: number }>();
  private best: { by: string; text: string; votes: number } | null = null;
  private deadline = 0;
  private timers = new Timers();
  private pending: (() => void) | null = null;
  private seq = 0;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
    customPrompts: string[] = [],
  ) {
    // Eigene Fragen der Gruppe zuerst, dann die Standardfragen
    const custom = shuffle(customPrompts);
    this.pool = [...custom, ...shuffle(QUIP_PROMPTS.filter((p) => !custom.includes(p)))];
    const zero = () => Object.fromEntries(ids.map((id) => [id, 0]));
    this.state = {
      sub: 'intro',
      round: 0,
      rounds: SPRUECHE.ROUNDS,
      final: false,
      multiplier: 1,
      endsIn: 0,
      players: [...ids],
      answered: zero(),
      need: 2,
      prompt: '',
      match: 0,
      matches: 0,
      duel: null,
      finalAnswers: null,
      voters: [],
      voted: [],
      points: zero(),
      roundGain: zero(),
    };
    this.startRound(1);
  }

  // ---------------------------------------------------------------- Ablaufsteuerung

  /** Nächsten Schritt nach `ms` ausführen (null = erst, wenn alle fertig sind) – der VIP kann ihn vorziehen */
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
  private soon(ms = 700) {
    const run = this.pending;
    if (!run) return;
    this.timers.clear();
    this.timers.later(ms, run);
  }

  private connected = (id: string) => this.ctx.isConnected(id);

  private nextPrompt() {
    const p = this.pool.shift() ?? QUIP_PROMPTS[Math.floor(Math.random() * QUIP_PROMPTS.length)];
    this.pool.push(p);
    return p;
  }

  // ---------------------------------------------------------------- Runden

  private startRound(round: number) {
    const s = this.state;
    s.round = round;
    s.final = round >= s.rounds;
    s.multiplier = quipMultiplier(round);
    s.sub = 'intro';
    s.duel = null;
    s.finalAnswers = null;
    s.prompt = '';
    s.match = 0;
    s.matches = 0;
    s.voters = [];
    s.voted = [];
    for (const id of this.ids) s.roundGain[id] = 0;
    this.schedule(SPRUECHE.INTRO_MS, () => this.startAnswer());
    this.ctx.onChange();
  }

  private startAnswer() {
    const s = this.state;
    const make = (text: string, authors: string[]): QuipPrompt => ({ text, authors, answers: new Map(), drafts: new Map(), missing: new Set() });
    if (s.final) {
      this.prompts = [make(this.nextPrompt(), [...this.ids])];
      s.need = 1;
    } else {
      // Kreis-Paarung: jede Frage 2 Autoren, jeder Spieler 2 Fragen (klappt für jede Anzahl ≥ 3)
      const order = shuffle(this.ids);
      const n = order.length;
      this.prompts = order.map((_, i) => make(this.nextPrompt(), [order[i], order[(i + 1) % n]]));
      s.need = 2;
    }
    for (const id of this.ids) s.answered[id] = 0;
    this.suggestions.clear();
    s.sub = 'answer';
    s.matches = s.final ? 1 : this.prompts.length;
    this.schedule(s.final ? SPRUECHE.FINAL_ANSWER_MS : SPRUECHE.ANSWER_MS, () => this.endAnswer());
    this.ctx.onChange();
  }

  private todoOf(id: string) {
    return this.prompts.flatMap((p, i) => (p.authors.includes(id) && !p.answers.has(id) ? [{ id: i, prompt: p.text }] : []));
  }

  private endAnswer() {
    for (const p of this.prompts) {
      for (const a of p.authors) {
        if (p.answers.has(a)) continue;
        const draft = p.drafts.get(a);
        if (draft) p.answers.set(a, draft);
        else {
          p.answers.set(a, QUIP_NO_ANSWER);
          p.missing.add(a);
        }
      }
    }
    if (this.state.final) this.startFinalVote();
    else {
      this.state.match = -1;
      this.nextDuel();
    }
  }

  // ---------------------------------------------------------------- Duelle (Runde 1 + 2)

  private nextDuel() {
    const s = this.state;
    let i = s.match + 1;
    // Duelle, in denen beide nichts geschrieben haben, überspringen
    while (i < this.prompts.length && this.prompts[i].authors.every((a) => this.prompts[i].missing.has(a))) i++;
    if (i >= this.prompts.length) return this.showScores();
    const p = this.prompts[i];
    s.match = i;
    this.pair = shuffle(p.authors) as [string, string];
    s.prompt = p.text;
    s.duel = {
      answers: [p.answers.get(this.pair[0]) ?? QUIP_NO_ANSWER, p.answers.get(this.pair[1]) ?? QUIP_NO_ANSWER],
      authors: null,
      votes: null,
      voters: null,
      gained: null,
      sweep: null,
    };
    s.voters = this.ids.filter((id) => !this.pair.includes(id) && this.connected(id));
    s.voted = [];
    this.votes.clear();
    s.sub = 'vote';
    this.schedule(SPRUECHE.VOTE_MS, () => this.revealDuel());
    if (!s.voters.length) this.soon(1500);
    this.ctx.onChange();
  }

  private revealDuel() {
    const s = this.state;
    const p = this.prompts[s.match];
    const duel = s.duel;
    if (!duel || !p) return this.showScores();
    const voters: [string[], string[]] = [[], []];
    for (const [voter, picks] of this.votes) if (picks[0] === 0 || picks[0] === 1) voters[picks[0]].push(voter);
    const votes: [number, number] = [voters[0].length, voters[1].length];
    const total = votes[0] + votes[1];
    const mult = s.multiplier;
    const gained: [number, number] = [votes[0] * SPRUECHE.POINTS * mult, votes[1] * SPRUECHE.POINTS * mult];
    let sweep: 0 | 1 | null = null;
    if (total >= 2 && (votes[0] === 0 || votes[1] === 0)) {
      sweep = votes[0] ? 0 : 1;
      gained[sweep] += SPRUECHE.BONUS * mult;
    }
    this.pair.forEach((id, k) => {
      s.points[id] = (s.points[id] ?? 0) + gained[k];
      s.roundGain[id] = (s.roundGain[id] ?? 0) + gained[k];
      if (!p.missing.has(id) && votes[k] > 0 && (!this.best || votes[k] > this.best.votes)) this.best = { by: id, text: duel.answers[k], votes: votes[k] };
    });
    s.duel = { ...duel, authors: [...this.pair], votes, voters, gained, sweep };
    s.sub = 'reveal';
    this.schedule(SPRUECHE.REVEAL_MS, () => this.nextDuel());
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Finale

  private startFinalVote() {
    const s = this.state;
    const p = this.prompts[0];
    s.prompt = p.text;
    this.finalOrder = shuffle(p.authors.filter((a) => !p.missing.has(a)).map((by) => ({ by, text: p.answers.get(by)! })));
    s.finalAnswers = this.finalOrder.map((a) => ({ text: a.text, by: null, votes: null, gained: null }));
    s.match = 0;
    s.voters = this.ids.filter((id) => this.connected(id) && this.finalOptions(id) > 0);
    s.voted = [];
    this.votes.clear();
    this.voteDone.clear();
    s.sub = 'vote';
    this.schedule(SPRUECHE.FINAL_VOTE_MS, () => this.revealFinal());
    if (this.finalOrder.length < 2 || !s.voters.length) this.soon(1500);
    this.ctx.onChange();
  }

  /** Für wie viele Antworten darf dieser Spieler im Finale stimmen? */
  private finalOptions(id: string) {
    return this.finalOrder.filter((a) => a.by !== id).length;
  }

  private revealFinal() {
    const s = this.state;
    const counts = this.finalOrder.map(() => 0);
    for (const picks of this.votes.values()) for (const i of picks) counts[i] += 1;
    const per = SPRUECHE.POINTS * s.multiplier;
    s.finalAnswers = this.finalOrder.map((a, i) => {
      const gained = counts[i] * per;
      s.points[a.by] = (s.points[a.by] ?? 0) + gained;
      s.roundGain[a.by] = (s.roundGain[a.by] ?? 0) + gained;
      if (counts[i] > 0 && (!this.best || counts[i] > this.best.votes)) this.best = { by: a.by, text: a.text, votes: counts[i] };
      return { text: a.text, by: a.by, votes: counts[i], gained };
    });
    s.sub = 'reveal';
    this.schedule(SPRUECHE.FINAL_REVEAL_MS, () => this.showScores());
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Wertung

  private showScores() {
    const s = this.state;
    s.sub = 'scores';
    s.duel = null;
    s.voters = [];
    s.voted = [];
    this.schedule(SPRUECHE.SCORES_MS, () => (s.final ? this.finish() : this.startRound(s.round + 1)));
    this.ctx.onChange();
  }

  private finish() {
    const s = this.state;
    s.sub = 'over';
    this.deadline = 0;
    this.ctx.onChange();
    const best = this.best;
    const subtitle = best
      ? `Bester Spruch: „${shorten(best.text, 34)}“ von ${this.ctx.nameOf(best.by)}`
      : 'Punkte gab’s für jede Stimme.';
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
    if (s.sub === 'answer') {
      const active = this.ids.filter(this.connected);
      if (active.length && active.every((id) => s.answered[id] >= s.need)) this.soon();
    } else if (s.sub === 'vote') {
      const active = s.voters.filter(this.connected);
      const done = s.final
        ? active.every((id) => this.voteDone.has(id) || (this.votes.get(id)?.length ?? 0) >= Math.min(SPRUECHE.FINAL_PICKS, this.finalOptions(id)))
        : active.every((id) => this.votes.has(id));
      if (done) this.soon();
    }
  }

  // ---------------------------------------------------------------- Schnittstelle

  snapshot(): MiniSnapshot {
    const s = this.state;
    return {
      kind: 'sprueche',
      state: {
        ...s,
        voted: s.final && s.sub === 'vote' ? s.voters.filter((id) => this.voteDone.has(id) || (this.votes.get(id)?.length ?? 0) >= Math.min(SPRUECHE.FINAL_PICKS, this.finalOptions(id))) : s.voted,
        endsIn: endsIn(this.deadline),
      },
    };
  }

  privateFor(id: string): PrivateState {
    const s = this.state;
    if (!this.ids.includes(id)) return null;
    let mine: number | null = null;
    if (s.sub === 'vote' || s.sub === 'reveal') {
      if (s.final) {
        const i = this.finalOrder.findIndex((a) => a.by === id);
        mine = i >= 0 ? i : null;
      } else if (s.duel) {
        const i = this.pair.indexOf(id);
        mine = i >= 0 ? i : null;
      }
    }
    return {
      kind: 'sprueche',
      state: {
        round: s.round,
        sub: s.sub,
        todo: s.sub === 'answer' ? this.todoOf(id) : [],
        answered: s.answered[id] ?? 0,
        suggest: s.sub === 'answer' ? (this.suggestions.get(id) ?? null) : null,
        mine,
        canVote: s.sub === 'vote' && s.voters.includes(id),
        myVotes: this.votes.get(id) ?? [],
        voteDone: this.voteDone.has(id),
      },
    };
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (!this.ids.includes(id)) return;
    const p = asRecord(payload);

    if (s.sub === 'answer' && (action === 'draft' || action === 'answer')) {
      const prompt = this.prompts[Number(p.prompt)];
      if (Number(p.round) !== s.round || !prompt || !prompt.authors.includes(id) || prompt.answers.has(id)) return;
      const text = cleanText(p.text);
      if (action === 'draft') {
        prompt.drafts.set(id, text);
        return;
      }
      if (!text) return;
      prompt.answers.set(id, text);
      s.answered[id] = (s.answered[id] ?? 0) + 1;
      this.suggestions.delete(id);
      this.ctx.onChange();
      return this.checkAllDone();
    }
    if (action === 'safety' && s.sub === 'answer') {
      const used = new Set(this.prompts.flatMap((q) => [...q.answers.values()]));
      const fresh = QUIP_SAFETY.filter((t) => !used.has(t) && t !== this.suggestions.get(id)?.text);
      const list = fresh.length ? fresh : QUIP_SAFETY;
      const text = list[Math.floor(Math.random() * list.length)];
      this.suggestions.set(id, { text, seq: (this.suggestions.get(id)?.seq ?? 0) + 1 });
      return this.ctx.onChange();
    }
    if (s.sub !== 'vote' || !s.voters.includes(id)) return;
    if (action === 'vote' && !s.final) {
      const pick = Number(p.pick);
      if (Number(p.match) !== s.match || this.votes.has(id) || (pick !== 0 && pick !== 1)) return;
      this.votes.set(id, [pick]);
      s.voted = [...this.votes.keys()];
      this.ctx.onChange();
      return this.checkAllDone();
    }
    if (action === 'fvote' && s.final && !this.voteDone.has(id)) {
      const idx = Number(p.idx);
      const a = this.finalOrder[idx];
      if (!Number.isInteger(idx) || !a || a.by === id) return;
      const picks = (this.votes.get(id) ?? []).filter((i) => i !== idx);
      if (p.on && picks.length < SPRUECHE.FINAL_PICKS) picks.push(idx);
      this.votes.set(id, picks);
      this.ctx.onChange();
      return this.checkAllDone();
    }
    if (action === 'fdone' && s.final && (this.votes.get(id)?.length ?? 0) > 0) {
      this.voteDone.add(id);
      this.ctx.onChange();
      return this.checkAllDone();
    }
  }

  vipAction(action: string) {
    if (action !== 'next' || !this.pending) return;
    const sub = this.state.sub;
    // Antwortphase nicht per Knopf abkürzen – da tippen noch alle
    if (sub === 'intro' || sub === 'vote' || sub === 'reveal' || sub === 'scores') this.pending();
  }

  /** VIP/Laptop: jeden Schritt vorziehen – beim Schreiben zählen Entwürfe, Leeres wird zum Sicherheits-Spruch */
  skippable(): SkipInfo | null {
    if (!this.pending) return null;
    const s = this.state;
    if (s.sub === 'intro') return { label: 'Los geht’s', info: true };
    if (s.sub === 'answer') {
      const missing = this.ids.filter((id) => this.connected(id) && this.todoOf(id).length > 0);
      return { label: waitLabel(this.ctx, missing, 'Antworten', 'Schreiben beenden') };
    }
    if (s.sub === 'vote') {
      const missing = s.voters.filter((id) => this.connected(id) && !s.voted.includes(id));
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

const shorten = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 3).trimEnd()}...` : t);

function cleanText(raw: unknown) {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SPRUECHE.MAX_TEXT);
}
