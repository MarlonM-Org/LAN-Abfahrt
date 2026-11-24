import type { MiniSnapshot, SkipInfo } from '../shared/types';
import { BUS, type BusCard, type BusState, type BusTipp, busAnswer, busAnswerText, busDeck, busFragenOk, busOptions, busSips, sipText } from '../shared/busfahrer';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, groupByScore, phaseTimer, shuffle, waitLabel } from './minigame';

/**
 * Busfahrer (Trinkspiel, MiniKind `hilo`): vier verdeckte Karten, alle tippen gleichzeitig am Handy.
 * Aufgedeckt wird, sobald alle Verbundenen getippt haben oder der VIP überspringt – kein Zeitlimit.
 * Falsch (oder gar nicht) getippt = so viele Schlücke wie die Nummer der Karte; wer bei der Auflösung
 * offline ist und nicht getippt hat, setzt diese Karte aus. Regeln: `shared/busfahrer.ts`.
 */
export class BusfahrerGame implements MiniGame {
  readonly kind = 'hilo' as const;
  private state: BusState;
  private guesses = new Map<string, BusTipp>();
  private deck: BusCard[] = [];
  private deadline = 0;
  private timers = new Timers();
  /** Neuer, gemischter Stapel (Tests geben einen festen vor) */
  private newDeck: () => BusCard[];

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
    opts: { fragen?: BusState['fragen']; passes?: number; deck?: () => BusCard[] } = {},
  ) {
    const fragen = opts.fragen && busFragenOk(opts.fragen) ? opts.fragen : BUS.FRAGEN;
    const passes = Math.max(1, opts.passes ?? BUS.DURCHGAENGE);
    this.newDeck = opts.deck ?? (() => shuffle(busDeck()));
    this.state = {
      pass: 1, passes, step: 0, fragen, round: 0, rounds: fragen.length * passes, sub: 'guess', endsIn: 0,
      cards: [], options: [], chosen: [], guesses: null, answer: null, answerText: '', roundSips: null, out: [],
      sips: Object.fromEntries(ids.map((id) => [id, 0])),
    };
    this.deck = this.newDeck();
    this.ask();
  }

  private live() {
    return this.ids.filter((p) => this.ctx.isConnected(p));
  }

  /** Nächste verdeckte Karte: Tipps sammeln */
  private ask() {
    const s = this.state;
    s.round += 1;
    s.sub = 'guess';
    s.options = busOptions(s.fragen[s.step], s.cards);
    s.chosen = [];
    s.guesses = null;
    s.answer = null;
    s.answerText = '';
    s.roundSips = null;
    s.out = [];
    this.guesses.clear();
    this.deadline = phaseTimer(this.timers, BUS.GUESS_MS, () => this.reveal());
    this.ctx.onChange();
  }

  /** Karte umdrehen und abrechnen */
  private reveal() {
    const s = this.state;
    if (s.sub !== 'guess') return;
    this.timers.clear();
    const frage = s.fragen[s.step];
    const next = this.deck.shift() ?? this.newDeck()[0];
    const answer = busAnswer(frage, s.cards, next);
    s.answerText = busAnswerText(frage, s.cards, next, answer);
    s.cards = [...s.cards, next];
    s.answer = answer;
    s.guesses = Object.fromEntries(this.guesses);
    s.roundSips = {};
    s.out = [];
    for (const id of this.ids) {
      const g = this.guesses.get(id);
      // Handy weg und kein Tipp: diese Karte aussetzen (nicht für ihn wählen, nicht trinken lassen)
      if (!g && !this.ctx.isConnected(id)) {
        s.out.push(id);
        s.roundSips[id] = 0;
        continue;
      }
      const n = busSips(s.step, g, answer);
      s.roundSips[id] = n;
      s.sips[id] = (s.sips[id] ?? 0) + n;
    }
    s.sub = 'reveal';
    this.deadline = phaseTimer(this.timers, BUS.REVEAL_MS, () => this.advance());
    this.ctx.onChange();
  }

  /** Nach der Auflösung: nächste Karte, nächster Durchgang oder Zusammenfassung */
  private advance() {
    const s = this.state;
    if (s.sub !== 'reveal') return;
    this.timers.clear();
    if (s.step + 1 < s.fragen.length) {
      s.step += 1;
      return this.ask();
    }
    if (s.pass < s.passes) {
      s.pass += 1;
      s.step = 0;
      s.cards = [];
      this.deck = this.newDeck();
      return this.ask();
    }
    s.sub = 'over';
    s.options = [];
    this.deadline = phaseTimer(this.timers, BUS.OVER_MS, () => this.end());
    this.ctx.onChange();
  }

  private end() {
    this.timers.clear();
    const s = this.state;
    const sips = Object.fromEntries(this.ids.map((id) => [id, s.sips[id] ?? 0]));
    const most = Math.max(0, ...Object.values(sips));
    const drivers = this.ids.filter((id) => most > 0 && sips[id] === most);
    const subtitle = !most
      ? 'Keiner musste trinken – der Bus fährt nüchtern weiter!'
      : drivers.length === 1
        ? `${this.ctx.nameOf(drivers[0])} fährt den Bus (${sipText(most)}).`
        : `Busfahrer: ${drivers.map((id) => this.ctx.nameOf(id)).join(', ')} (je ${sipText(most)}).`;
    this.ctx.finish({
      groups: groupByScore(this.ids, (id) => sips[id]),
      details: Object.fromEntries(this.ids.map((id) => [id, sipText(sips[id])])),
      subtitle,
      sips,
    });
  }

  skippable(): SkipInfo | null {
    const s = this.state;
    if (s.sub === 'guess') {
      const missing = this.live().filter((p) => !this.guesses.has(p));
      return { label: waitLabel(this.ctx, missing, 'Tipp', 'Karte jetzt aufdecken') };
    }
    if (s.sub === 'reveal') return { label: s.step + 1 < s.fragen.length || s.pass < s.passes ? 'Nächste Karte' : 'Zur Zusammenfassung', info: true };
    if (s.sub === 'over') return { label: 'Zum Ergebnis', info: true };
    return null;
  }

  /** VIP überspringt: Wer verbunden ist und nicht getippt hat, liegt daneben (trinkt) */
  skip() {
    const s = this.state;
    if (s.sub === 'guess') this.reveal();
    else if (s.sub === 'reveal') this.advance();
    else if (s.sub === 'over') this.end();
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (action !== 'guess' || s.sub !== 'guess' || !this.ids.includes(id) || this.guesses.has(id)) return;
    const p = asRecord(payload);
    // Tipp nur für die aktuelle Karte (ein verspäteter Tipp von der vorigen zählt nicht)
    if (p.round !== undefined && p.round !== s.round) return;
    const tipp = p.tipp as BusTipp;
    if (!s.options.includes(tipp)) return;
    this.guesses.set(id, tipp);
    s.chosen = [...this.guesses.keys()];
    if (this.allIn()) this.reveal();
    else this.ctx.onChange();
  }

  /** Alle Verbundenen haben getippt (und mindestens einer überhaupt) */
  private allIn() {
    const live = this.live();
    return this.guesses.size > 0 && live.every((p) => this.guesses.has(p));
  }

  snapshot(): MiniSnapshot {
    return { kind: 'hilo', state: { ...this.state, endsIn: endsIn(this.deadline) } };
  }

  playerDisconnected(_id: string) {
    if (this.state.sub === 'guess' && this.allIn()) this.reveal();
    else this.ctx.onChange();
  }

  dispose() {
    this.timers.clear();
  }
}
