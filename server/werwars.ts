import type { MiniSnapshot, PrivateState, SkipInfo, WerwarsReveal, WerwarsState } from '../shared/types';
import { WERWARS, WERWARS_QUESTIONS, WERWARS_SAFETY, werwarsPerPlayer } from '../shared/werwars';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, groupByScore, shuffle, waitLabel } from './minigame';

/** Eine persönliche Frage eines Spielers */
interface Task {
  author: string;
  question: string;
  answer: string | null;
  draft: string;
}

/**
 * Wer war's? (à la „Who's Who“ / Mr. & Mrs.)
 * Schreiben: Jeder beantwortet 2 persönliche Fragen (ab 7 Spielern eine). Raten: Der TV zeigt eine Antwort
 * nach der anderen anonym, alle tippen am Handy auf den vermuteten Autor. Richtig = +2, der Autor bekommt +3,
 * wenn ihn niemand errät, +1, wenn höchstens ein Drittel richtig lag.
 * Der Autor tippt zum Schein mit (zählt nicht) – so verrät ihn keiner, der als Einziger nicht abstimmt.
 */
export class WerwarsGame implements MiniGame {
  readonly kind = 'werwars' as const;
  private state: WerwarsState;
  private tasks: Task[] = [];
  /** Reihenfolge der Raterunden (Indizes in `tasks`) */
  private order: number[] = [];
  private guesses = new Map<string, string>();
  private suggestions = new Map<string, { text: string; seq: number }>();
  /** Statistik für den Untertitel */
  private hits = new Map<string, number>();
  private hidden = new Map<string, number>();
  private deadline = 0;
  private timers = new Timers();
  private pending: (() => void) | null = null;
  private seq = 0;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
    customQuestions: string[] = [],
  ) {
    // Eigene Fragen der Gruppe zuerst (gemischt), dann die Standardfragen – jeder bekommt andere Fragen
    const custom = shuffle(customQuestions);
    const pool = [...custom, ...shuffle(WERWARS_QUESTIONS.filter((q) => !custom.includes(q)))];
    const need = werwarsPerPlayer(ids.length);
    let k = 0;
    for (let r = 0; r < need; r++) {
      for (const author of ids) {
        const question = pool[k % pool.length];
        k++;
        this.tasks.push({ author, question, answer: null, draft: '' });
      }
    }
    const zero = () => Object.fromEntries(ids.map((id) => [id, 0]));
    this.state = {
      sub: 'intro',
      endsIn: 0,
      players: [...ids],
      need,
      answered: zero(),
      round: 0,
      rounds: 0,
      question: '',
      answer: '',
      votedCount: 0,
      voterCount: 0,
      reveal: null,
      points: zero(),
    };
    this.schedule(WERWARS.INTRO_MS, () => this.startAnswer());
  }

  // ---------------------------------------------------------------- Ablaufsteuerung (wie Sprüche-Duell)

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

  // ---------------------------------------------------------------- Schreiben

  private startAnswer() {
    this.state.sub = 'answer';
    this.schedule(WERWARS.ANSWER_MS, () => this.endAnswer());
    this.ctx.onChange();
  }

  private todoOf(id: string) {
    return this.tasks.flatMap((t, i) => (t.author === id && t.answer === null ? [{ id: i, question: t.question }] : []));
  }

  private endAnswer() {
    // Entwürfe zählen, wer gar nichts hat, fällt aus der Raterunde (raten darf er trotzdem)
    for (const t of this.tasks) if (t.answer === null && t.draft) t.answer = t.draft;
    const done = this.tasks.flatMap((t, i) => (t.answer ? [i] : []));
    this.order = spread(shuffle(done), (i) => this.tasks[i].author);
    this.state.rounds = this.order.length;
    this.state.round = 0;
    this.suggestions.clear();
    this.nextRound();
  }

  // ---------------------------------------------------------------- Raten

  private nextRound() {
    const s = this.state;
    if (s.round >= this.order.length) return this.showScores();
    const t = this.tasks[this.order[s.round]];
    s.round++;
    s.question = t.question;
    s.answer = t.answer ?? '';
    s.reveal = null;
    this.guesses.clear();
    s.votedCount = 0;
    s.voterCount = this.ids.filter(this.connected).length;
    s.sub = 'guess';
    this.schedule(WERWARS.GUESS_MS, () => this.revealRound());
    if (!this.realGuessers().length) this.soon(2500);
    this.ctx.onChange();
  }

  private current() {
    const s = this.state;
    return s.round >= 1 ? this.tasks[this.order[s.round - 1]] : null;
  }

  /** Wer darf wirklich raten (alle außer dem Autor, die noch da sind) */
  private realGuessers() {
    const author = this.current()?.author;
    return this.ids.filter((id) => id !== author && this.connected(id));
  }

  private revealRound() {
    const s = this.state;
    const t = this.current();
    if (!t) return this.showScores();
    const guesses: Record<string, string> = {};
    for (const [voter, target] of this.guesses) if (voter !== t.author) guesses[voter] = target;
    const cast = Object.keys(guesses).length;
    const correct = Object.keys(guesses).filter((v) => guesses[v] === t.author);
    const gains: Record<string, number> = {};
    for (const id of correct) {
      gains[id] = WERWARS.POINTS_GUESS;
      this.hits.set(id, (this.hits.get(id) ?? 0) + 1);
    }
    let bonus: WerwarsReveal['bonus'] = null;
    if (cast > 0 && correct.length === 0) {
      bonus = 'hidden';
      gains[t.author] = WERWARS.POINTS_HIDDEN;
      this.hidden.set(t.author, (this.hidden.get(t.author) ?? 0) + 1);
    } else if (cast > 0 && correct.length * 3 <= cast) {
      bonus = 'sneaky';
      gains[t.author] = WERWARS.POINTS_SNEAKY;
    }
    for (const [id, g] of Object.entries(gains)) s.points[id] = (s.points[id] ?? 0) + g;
    s.reveal = { author: t.author, guesses, correct, gains, bonus };
    s.sub = 'reveal';
    this.schedule(WERWARS.REVEAL_MS, () => this.nextRound());
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Wertung

  private showScores() {
    const s = this.state;
    s.sub = 'scores';
    s.reveal = null;
    s.question = '';
    s.answer = '';
    this.schedule(WERWARS.SCORES_MS, () => this.finish());
    this.ctx.onChange();
  }

  private finish() {
    const s = this.state;
    s.sub = 'over';
    this.deadline = 0;
    this.ctx.onChange();
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    const det = top(this.hits);
    const poker = top(this.hidden);
    const parts: string[] = [];
    if (det) parts.push(`Meisterdetektiv: ${this.ctx.nameOf(det[0])} (${det[1]}× richtig)`);
    if (poker) parts.push(`Pokerface: ${this.ctx.nameOf(poker[0])}`);
    const subtitle = parts.join(' · ') || (s.rounds ? 'Ihr kennt euch wohl kaum ...' : 'Keiner hat etwas geschrieben?!');
    this.timers.later(600, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => s.points[id] ?? 0),
        details: Object.fromEntries(this.ids.map((id) => [id, `${s.points[id] ?? 0} Punkt${s.points[id] === 1 ? '' : 'e'}`])),
        subtitle,
      }),
    );
  }

  private checkAllDone() {
    const s = this.state;
    if (!this.pending) return;
    if (s.sub === 'answer') {
      const active = this.ids.filter(this.connected);
      if (active.length && active.every((id) => this.todoOf(id).length === 0)) this.soon();
    } else if (s.sub === 'guess') {
      // Der Schein-Tipp des Autors ist egal – sobald alle echten Rater getippt haben, geht's weiter
      const real = this.realGuessers();
      if (real.every((id) => this.guesses.has(id))) this.soon(900);
    }
  }

  // ---------------------------------------------------------------- Schnittstelle

  snapshot(): MiniSnapshot {
    return { kind: 'werwars', state: { ...this.state, endsIn: endsIn(this.deadline) } };
  }

  privateFor(id: string): PrivateState {
    const s = this.state;
    if (!this.ids.includes(id)) return null;
    const t = this.current();
    return {
      kind: 'werwars',
      state: {
        sub: s.sub,
        round: s.round,
        todo: s.sub === 'answer' ? this.todoOf(id) : [],
        answered: s.answered[id] ?? 0,
        suggest: s.sub === 'answer' ? (this.suggestions.get(id) ?? null) : null,
        mine: (s.sub === 'guess' || s.sub === 'reveal') && t?.author === id,
        myGuess: this.guesses.get(id) ?? null,
      },
    };
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (!this.ids.includes(id)) return;
    const p = asRecord(payload);

    if (s.sub === 'answer' && (action === 'draft' || action === 'answer')) {
      const t = this.tasks[Number(p.task)];
      if (!t || t.author !== id || t.answer !== null) return;
      const text = cleanText(p.text);
      if (action === 'draft') {
        t.draft = text;
        return;
      }
      if (!text) return;
      t.answer = text;
      s.answered[id] = (s.answered[id] ?? 0) + 1;
      this.suggestions.delete(id);
      this.ctx.onChange();
      return this.checkAllDone();
    }
    if (action === 'safety' && s.sub === 'answer') {
      const used = new Set(this.tasks.map((t) => t.answer ?? t.draft));
      const fresh = WERWARS_SAFETY.filter((t) => !used.has(t) && t !== this.suggestions.get(id)?.text);
      const list = fresh.length ? fresh : WERWARS_SAFETY;
      const text = list[Math.floor(Math.random() * list.length)];
      this.suggestions.set(id, { text, seq: (this.suggestions.get(id)?.seq ?? 0) + 1 });
      return this.ctx.onChange();
    }
    if (action === 'guess' && s.sub === 'guess') {
      const target = String(p.target ?? '');
      if (Number(p.round) !== s.round || this.guesses.has(id) || target === id || !this.ids.includes(target)) return;
      this.guesses.set(id, target);
      s.votedCount = this.guesses.size;
      this.ctx.onChange();
      return this.checkAllDone();
    }
  }

  vipAction(action: string) {
    if (action !== 'next' || !this.pending) return;
    const sub = this.state.sub;
    // Schreiben nicht per Knopf abkürzen – da tippen noch alle (dafür gibt es „Überspringen“ im VIP-Menü)
    if (sub === 'intro' || sub === 'reveal' || sub === 'scores') this.pending();
  }

  skippable(): SkipInfo | null {
    if (!this.pending) return null;
    const s = this.state;
    if (s.sub === 'intro') return { label: 'Los geht’s', info: true };
    if (s.sub === 'answer') {
      const missing = this.ids.filter((id) => this.connected(id) && this.todoOf(id).length > 0);
      return { label: waitLabel(this.ctx, missing, 'Antworten', 'Schreiben beenden') };
    }
    // Beim Raten nie einen Namen nennen – sonst ließe sich auf den Autor schließen
    if (s.sub === 'guess') return { label: 'Raten beenden' };
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

/** Gleiche Autoren möglichst nicht direkt hintereinander (zwei Antworten von Ben am Stück verraten zu viel) */
function spread<T>(items: T[], key: (t: T) => string): T[] {
  const rest = [...items];
  const out: T[] = [];
  while (rest.length) {
    const last = out.length ? key(out[out.length - 1]) : null;
    const i = rest.findIndex((t) => key(t) !== last);
    out.push(rest.splice(i >= 0 ? i : 0, 1)[0]);
  }
  return out;
}

function cleanText(raw: unknown) {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, WERWARS.MAX_TEXT);
}
