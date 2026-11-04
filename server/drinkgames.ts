import type { BombState, HiloState, MiniSnapshot, NhieState } from '../shared/types';
import { BOMB, BOMB_CATEGORIES, HILO, NHIE } from '../shared/games';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const zeroSips = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 0]));

function sipResult(ids: string[], sips: Record<string, number>, subtitle: string) {
  return {
    groups: groupByScore(ids, (id) => sips[id] ?? 0),
    details: Object.fromEntries(ids.map((id) => [id, `${sips[id] ?? 0} Schlücke`])),
    subtitle,
    sips,
  };
}

// ================================================================== Ich hab noch nie

export class NhieGame implements MiniGame {
  readonly kind = 'nhie' as const;
  private state: NhieState;
  private answers = new Map<string, boolean>();
  private statements: string[];
  private deadline = 0;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
    custom: string[],
    defaults: string[],
  ) {
    const own = shuffle(custom);
    this.statements = [...own, ...shuffle(defaults.filter((d) => !own.includes(d)))].slice(0, NHIE.ROUNDS);
    this.state = { round: 0, rounds: this.statements.length, statement: '', sub: 'question', endsIn: 0, answered: [], have: null, sips: zeroSips(ids) };
    this.next();
  }

  private next() {
    const s = this.state;
    if (s.round >= this.statements.length) {
      s.sub = 'over';
      this.ctx.onChange();
      return this.timers.later(500, () => this.ctx.finish(sipResult(this.ids, s.sips, 'Jetzt wisst ihr mehr übereinander ...')));
    }
    s.statement = this.statements[s.round];
    s.round += 1;
    s.sub = 'question';
    s.answered = [];
    s.have = null;
    this.answers.clear();
    this.deadline = Date.now() + NHIE.QUESTION_MS;
    this.timers.later(NHIE.QUESTION_MS, () => this.reveal());
    this.ctx.onChange();
  }

  private reveal() {
    const s = this.state;
    this.timers.clear();
    s.have = [...this.answers.entries()].filter(([, v]) => v).map(([id]) => id);
    // Wer es als Einziger getan hat, trinkt doppelt – und muss erzählen!
    for (const id of s.have) s.sips[id] += s.have.length === 1 ? 2 : 1;
    s.sub = 'reveal';
    this.deadline = Date.now() + NHIE.REVEAL_MS;
    this.timers.later(NHIE.REVEAL_MS, () => this.next());
    this.ctx.onChange();
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (action !== 'answer' || s.sub !== 'question' || !this.ids.includes(id)) return;
    this.answers.set(id, !!asRecord(payload).have);
    s.answered = [...this.answers.keys()];
    if (this.ids.filter((p) => this.ctx.isConnected(p)).every((p) => this.answers.has(p))) this.reveal();
    else this.ctx.onChange();
  }

  snapshot(): MiniSnapshot {
    return { kind: 'nhie', state: { ...this.state, endsIn: Math.max(0, this.deadline - Date.now()) } };
  }

  playerDisconnected() {}
  dispose() {
    this.timers.clear();
  }
}

// ================================================================== Höher oder Tiefer

export class HiloGame implements MiniGame {
  readonly kind = 'hilo' as const;
  private state: HiloState;
  private guesses = new Map<string, 'higher' | 'lower'>();
  private deadline = 0;
  private timers = new Timers();
  private deck: number[] = [];

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    for (let s = 0; s < 4; s++) for (let v = 2; v <= 14; v++) this.deck.push(v);
    this.deck = shuffle(this.deck);
    this.state = { round: 0, rounds: HILO.ROUNDS, sub: 'guess', endsIn: 0, card: this.deck.pop()!, nextCard: null, guessed: [], guesses: null, roundSips: null, sips: zeroSips(ids) };
    this.next();
  }

  private next() {
    const s = this.state;
    if (s.nextCard !== null) s.card = s.nextCard;
    if (s.round >= s.rounds) {
      s.sub = 'over';
      this.ctx.onChange();
      return this.timers.later(500, () => this.ctx.finish(sipResult(this.ids, s.sips, 'Die Karten waren gnadenlos.')));
    }
    s.round += 1;
    s.sub = 'guess';
    s.nextCard = null;
    s.guessed = [];
    s.guesses = null;
    s.roundSips = null;
    this.guesses.clear();
    this.deadline = Date.now() + HILO.GUESS_MS;
    this.timers.later(HILO.GUESS_MS, () => this.reveal());
    this.ctx.onChange();
  }

  private reveal() {
    const s = this.state;
    this.timers.clear();
    const next = this.deck.pop() ?? 2 + Math.floor(Math.random() * 13);
    s.nextCard = next;
    s.guesses = Object.fromEntries(this.guesses);
    s.roundSips = {};
    for (const id of this.ids) {
      const g = this.guesses.get(id);
      const right = next !== s.card && ((g === 'higher' && next > s.card) || (g === 'lower' && next < s.card));
      // Gleiche Karte: alle trinken
      if (!right) s.roundSips[id] = 1;
    }
    for (const [id, n] of Object.entries(s.roundSips)) s.sips[id] += n;
    s.sub = 'reveal';
    this.deadline = Date.now() + HILO.REVEAL_MS;
    this.timers.later(HILO.REVEAL_MS, () => this.next());
    this.ctx.onChange();
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (action !== 'guess' || s.sub !== 'guess' || !this.ids.includes(id)) return;
    const g = asRecord(payload).dir === 'lower' ? 'lower' : 'higher';
    this.guesses.set(id, g);
    s.guessed = [...this.guesses.keys()];
    if (this.ids.filter((p) => this.ctx.isConnected(p)).every((p) => this.guesses.has(p))) this.reveal();
    else this.ctx.onChange();
  }

  snapshot(): MiniSnapshot {
    return { kind: 'hilo', state: { ...this.state, endsIn: Math.max(0, this.deadline - Date.now()) } };
  }

  playerDisconnected() {}
  dispose() {
    this.timers.clear();
  }
}

// ================================================================== Tick-Tack-Bumm

export class BombGame implements MiniGame {
  readonly kind = 'bomb' as const;
  private state: BombState;
  private timers = new Timers();
  private heldSince = 0;
  private categories = shuffle(BOMB_CATEGORIES);

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.state = { round: 0, rounds: BOMB.ROUNDS, sub: 'pass', category: '', holder: ids[0], passes: 0, passSeq: 0, sips: zeroSips(ids) };
    this.next();
  }

  private next() {
    const s = this.state;
    if (s.round >= s.rounds) {
      s.sub = 'over';
      this.ctx.onChange();
      return this.timers.later(500, () => this.ctx.finish(sipResult(this.ids, s.sips, 'BUMM! Wer zögert, trinkt.')));
    }
    s.category = this.categories[s.round % this.categories.length];
    s.round += 1;
    s.sub = 'pass';
    s.passes = 0;
    s.holder = this.ids[Math.floor(Math.random() * this.ids.length)];
    this.heldSince = Date.now();
    const fuse = BOMB.MIN_FUSE_MS + Math.random() * (BOMB.MAX_FUSE_MS - BOMB.MIN_FUSE_MS);
    this.timers.later(fuse, () => this.boom());
    this.ctx.onChange();
  }

  private boom() {
    const s = this.state;
    s.sub = 'boom';
    s.sips[s.holder] += BOMB.SIPS;
    this.ctx.onChange();
    this.timers.later(BOMB.BOOM_MS, () => this.next());
  }

  input(id: string, action: string) {
    const s = this.state;
    if (action !== 'pass' || s.sub !== 'pass' || id !== s.holder) return;
    if (Date.now() - this.heldSince < BOMB.MIN_HOLD_MS) return;
    const live = this.ids.filter((p) => this.ctx.isConnected(p));
    const order = live.length ? live : this.ids;
    s.holder = order[(order.indexOf(id) + 1) % order.length];
    s.passes += 1;
    s.passSeq += 1;
    this.heldSince = Date.now();
    this.ctx.onChange();
  }

  snapshot(): MiniSnapshot {
    return { kind: 'bomb', state: this.state };
  }

  playerDisconnected(id: string) {
    if (this.state.holder === id && this.state.sub === 'pass') {
      this.heldSince = 0;
      this.input(id, 'pass');
    }
  }

  dispose() {
    this.timers.clear();
  }
}
