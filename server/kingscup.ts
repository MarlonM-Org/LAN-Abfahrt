import type { MiniSnapshot, SkipInfo } from '../shared/types';
import { possessive } from '../shared/players';
import {
  KINGS,
  KINGS_CATEGORIES,
  KINGS_PRESET_RULES,
  KINGS_RACE,
  KINGS_RHYMES,
  KINGS_RULES,
  type KingsCard,
  type KingsState,
  kingsMateClosure,
} from '../shared/kingscup';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const clean = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * Kings Cup: reihum (Sitzordnung = Spielerreihenfolge, im Uhrzeigersinn) zieht jeder eine Karte,
 * jede Karte hat eine Regel. Gezählt wird, wie oft jemand trinken musste (Kumpel trinken mit).
 */
export class KingsCupGame implements MiniGame {
  readonly kind = 'kingscup' as const;
  private state: KingsState;
  private deck: KingsCard[] = [];
  private timers = new Timers();
  private deadline = 0;
  /** Zeitpunkt von „JETZT!“ (Knopf-Rennen) */
  private goAt = 0;
  private turnIdx = 0;
  private fooledThisTurn = new Set<string>();
  private finished = false;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    for (let suit = 0; suit < 4; suit++) for (let rank = 2; rank <= 14; rank++) this.deck.push({ rank, suit });
    this.deck = shuffle(this.deck);
    const total = ctx.mode === 'drink' ? KINGS.CARDS_DRINK : KINGS.CARDS_SOLO;
    this.state = {
      order: [...ids],
      drawer: ids[0],
      drawn: 0,
      total: Math.min(total, this.deck.length),
      card: null,
      drawSeq: 0,
      sub: 'draw',
      endsIn: 0,
      pickFor: null,
      race: null,
      chain: null,
      rules: [],
      qm: null,
      mates: {},
      drinks: Object.fromEntries(ids.map((id) => [id, 0])),
      announce: null,
      waterfall: null,
      fooled: null,
    };
    // Zufälliger Startspieler, danach im Uhrzeigersinn
    this.turnIdx = Math.floor(Math.random() * ids.length);
    this.startTurn(false);
  }

  // ---------------------------------------------------------------- Hilfen

  private live = (id: string) => this.ctx.isConnected(id) && !this.ctx.isGone?.(id);
  private liveIds = () => this.state.order.filter(this.live);

  /** Nächster anwesender Spieler im Uhrzeigersinn nach `id` (oder `id` selbst, wenn sonst keiner da ist) */
  private nextLive(id: string): string {
    const o = this.state.order;
    const i = o.indexOf(id);
    for (let k = 1; k <= o.length; k++) {
      const c = o[(i + k) % o.length];
      if (this.live(c)) return c;
    }
    return id;
  }

  private wait(ms: number, fn: () => void) {
    this.timers.clear();
    this.deadline = ms ? Date.now() + ms : 0;
    if (ms) this.timers.later(ms, fn);
  }

  /** Trinken (mit Kumpel) zählen und ansagen */
  private drink(main: string[], title: string, note?: string) {
    const s = this.state;
    const extra = kingsMateClosure(s.mates, main);
    for (const id of [...main, ...extra.map((e) => e.id)]) s.drinks[id] = (s.drinks[id] ?? 0) + 1;
    s.announce = { title, main, extra, drink: true, note };
  }

  private name = (id: string) => this.ctx.nameOf(id);

  /** Zufälliger anderer Spieler (bevorzugt anwesend) */
  private randomOther(): string {
    const s = this.state;
    const others = s.order.filter((id) => id !== s.drawer);
    return pick(others.filter(this.live).length ? others.filter(this.live) : others);
  }

  // ---------------------------------------------------------------- Ablauf

  private startTurn(advance = true) {
    const s = this.state;
    if (this.finished) return;
    if (s.drawn >= s.total || !this.deck.length) return this.end();
    const o = s.order;
    if (advance) this.turnIdx = (this.turnIdx + 1) % o.length;
    // Abwesende überspringen
    for (let k = 0; k < o.length && !this.live(o[this.turnIdx]); k++) this.turnIdx = (this.turnIdx + 1) % o.length;
    s.drawer = o[this.turnIdx];
    s.sub = 'draw';
    s.card = null;
    s.pickFor = null;
    s.race = null;
    s.chain = null;
    s.announce = null;
    s.waterfall = null;
    this.fooledThisTurn.clear();
    this.wait(0, () => {});
    this.ctx.onChange();
  }

  private draw() {
    const s = this.state;
    if (s.sub !== 'draw') return;
    const card = this.deck.pop();
    if (!card) return this.end();
    s.card = card;
    s.drawn += 1;
    s.drawSeq += 1;
    s.sub = 'reveal';
    this.wait(KINGS.REVEAL_MS, () => this.act());
    this.ctx.onChange();
  }

  /** Nach dem Umdrehen: was macht die Karte? */
  private act() {
    const s = this.state;
    const card = s.card!;
    const rule = KINGS_RULES[card.rank];
    const who = this.name(s.drawer);
    switch (rule.action) {
      case 'pick':
      case 'mate':
        s.sub = 'pick';
        s.pickFor = rule.action === 'pick' ? 'drink' : 'mate';
        this.wait(0, () => {});
        break;
      case 'self':
        this.drink([s.drawer], `${who} trinkt!`);
        return this.result();
      case 'show':
        s.announce = { title: rule.text, main: [], extra: [], drink: false, note: 'Ehrensache – ihr wisst selbst, wer gemeint ist.' };
        return this.result();
      case 'qm':
        s.qm = s.drawer;
        s.announce = { title: `${who} ist Fragenmeister!`, main: [], extra: [], drink: false, note: 'Wer eine Frage von ihm beantwortet, trinkt.' };
        return this.result();
      case 'race':
        return this.startRace();
      case 'chain':
        s.sub = 'word';
        this.wait(0, () => {});
        break;
      case 'rule':
        s.sub = 'rule';
        this.wait(0, () => {});
        break;
      case 'waterfall': {
        const order: string[] = [];
        let cur = s.drawer;
        for (let k = 0; k < s.order.length; k++) {
          if (this.live(cur) || cur === s.drawer) order.push(cur);
          const i = s.order.indexOf(cur);
          cur = s.order[(i + 1) % s.order.length];
        }
        s.waterfall = order;
        s.sub = 'waterfall';
        this.wait(KINGS.WATERFALL_MS + KINGS.WATERFALL_PER_MS * order.length, () => this.finishWaterfall());
        break;
      }
    }
    this.ctx.onChange();
  }

  private finishWaterfall() {
    const s = this.state;
    if (s.sub !== 'waterfall') return;
    const order = s.waterfall ?? [];
    // Jeder trinkt einmal mit – Kumpel sind sowieso dabei
    for (const id of order) s.drinks[id] = (s.drinks[id] ?? 0) + 1;
    s.announce = { title: 'Wasserfall vorbei!', main: order, extra: [], drink: true, note: 'Alle haben getrunken.' };
    this.result();
  }

  private result() {
    const s = this.state;
    s.sub = 'result';
    s.race = s.race && { ...s.race, phase: 'done' };
    this.wait(KINGS.RESULT_MS, () => this.startTurn());
    this.ctx.onChange();
  }

  private end() {
    if (this.finished) return;
    this.finished = true;
    const s = this.state;
    this.timers.clear();
    s.sub = 'over';
    this.deadline = 0;
    this.ctx.onChange();
    const ids = this.ids;
    const sips = Object.fromEntries(ids.map((id) => [id, s.drinks[id] ?? 0]));
    this.timers.later(800, () =>
      this.ctx.finish({
        groups: groupByScore(ids, (id) => sips[id]),
        details: Object.fromEntries(ids.map((id) => [id, `${sips[id]}× getrunken`])),
        subtitle: `${s.drawn} Karten gezogen – auf den König!`,
        sips,
      }),
    );
  }

  // ---------------------------------------------------------------- 2 / 8: Spieler wählen

  private choose(by: string, target: string) {
    const s = this.state;
    if (s.sub !== 'pick' || by !== s.drawer) return;
    if (!s.order.includes(target) || target === s.drawer) return;
    const who = this.name(s.drawer);
    if (s.pickFor === 'drink') {
      this.drink([target], `${this.name(target)} trinkt!`, `${who} hat ausgewählt.`);
    } else {
      // Neue 8 ersetzt den bisherigen Kumpel des Ziehenden
      s.mates = { ...s.mates, [s.drawer]: target };
      s.announce = { title: `${who} & ${this.name(target)} sind Kumpel!`, main: [s.drawer, target], extra: [], drink: false, note: 'Trinkt einer, trinkt der andere mit.' };
    }
    this.result();
  }

  // ---------------------------------------------------------------- 4 / 7 / König: Knopf-Rennen

  private startRace() {
    const s = this.state;
    const r = KINGS_RACE[s.card!.rank];
    const players = this.liveIds().filter((id) => r.kind !== 'rudern' || id !== s.drawer);
    if (!players.length) {
      s.announce = { title: 'Keiner da zum Mitmachen ...', main: [], extra: [], drink: false };
      return this.result();
    }
    s.race = { kind: r.kind, phase: 'ready', players, times: {}, slow: [] };
    s.sub = 'race';
    const ready = KINGS.RACE_READY_MS + Math.random() * KINGS.RACE_JITTER_MS;
    this.wait(ready, () => {
      s.race!.phase = 'go';
      this.goAt = Date.now();
      this.wait(KINGS.RACE_GO_MAX_MS, () => this.endRace());
      this.ctx.onChange();
    });
    this.ctx.onChange();
  }

  private tap(id: string) {
    const r = this.state.race;
    if (this.state.sub !== 'race' || !r || r.phase !== 'go' || !r.players.includes(id) || id in r.times) return;
    r.times[id] = Date.now() - this.goAt;
    if (r.players.filter(this.live).every((p) => p in r.times)) this.endRace();
    else this.ctx.onChange();
  }

  private endRace() {
    const s = this.state;
    const r = s.race;
    if (s.sub !== 'race' || !r) return;
    const missing = r.players.filter((id) => !(id in r.times) && this.live(id));
    let slow: string[];
    if (missing.length) slow = missing;
    else {
      const tapped = Object.entries(r.times).sort((a, b) => b[1] - a[1]);
      slow = tapped.length ? [tapped[0][0]] : [];
    }
    r.slow = slow;
    if (slow.length) {
      const label = r.kind === 'rudern' ? 'rudert zuletzt' : 'war zu langsam';
      this.drink(slow, slow.length === 1 ? `${this.name(slow[0])} ${label}!` : `${slow.map(this.name).join(', ')} – zu langsam!`, missing.length ? 'Gar nicht getippt!' : `${(r.times[slow[0]] / 1000).toFixed(2).replace('.', ',')} s`);
    } else s.announce = { title: 'Alle gleich schnell?!', main: [], extra: [], drink: false };
    this.result();
  }

  // ---------------------------------------------------------------- 9 / 10: Reim / Kategorie

  private setWord(by: string, raw: unknown) {
    const s = this.state;
    if (s.sub !== 'word' || by !== s.drawer) return;
    const mode = s.card!.rank === 9 ? 'reim' : 'kategorie';
    const word = clean(raw, KINGS.WORD_LEN) || pick(mode === 'reim' ? KINGS_RHYMES : KINGS_CATEGORIES);
    const n = Math.max(1, this.liveIds().length);
    s.chain = { mode, word, turn: this.nextLive(s.drawer), step: 1, maxSteps: n * KINGS.CHAIN_LAPS };
    s.sub = 'chain';
    this.chainTimer();
    this.ctx.onChange();
  }

  private chainTimer() {
    this.timers.clear();
    // Nur Richtwert für die Anzeige – weiter geht es erst, wenn der Schiri tippt (oder der VIP überspringt)
    this.deadline = Date.now() + KINGS.CHAIN_TURN_MS;
  }

  /** Wer darf „Weiter“/„Verloren“ drücken? Der Ziehende – ist er weg, jeder */
  private canJudge(id: string) {
    return id === this.state.drawer || !this.live(this.state.drawer);
  }

  private chainNext() {
    const s = this.state;
    const c = s.chain;
    if (s.sub !== 'chain' || !c) return;
    if (c.step >= c.maxSteps) {
      s.announce = { title: 'Alle geschafft!', main: [], extra: [], drink: false, note: `${c.maxSteps}× ${c.mode === 'reim' ? 'gereimt' : 'genannt'} – keiner muss trinken.` };
      return this.result();
    }
    c.turn = this.nextLive(c.turn);
    c.step += 1;
    this.chainTimer();
    this.ctx.onChange();
  }

  private chainFail() {
    const s = this.state;
    const c = s.chain;
    if (s.sub !== 'chain' || !c) return;
    this.drink([c.turn], `${this.name(c.turn)} hat verloren!`, c.mode === 'reim' ? `Kein Reim auf „${c.word}“` : `Nichts mehr zu „${c.word}“`);
    this.result();
  }

  // ---------------------------------------------------------------- Bube: neue Regel

  private setRule(by: string, raw: unknown) {
    const s = this.state;
    if (s.sub !== 'rule' || by !== s.drawer) return;
    const text = clean(raw, KINGS.RULE_LEN) || pick(KINGS_PRESET_RULES.filter((r) => !s.rules.some((x) => x.text === r))) || pick(KINGS_PRESET_RULES);
    s.rules = [...s.rules, { text, by: s.drawer }].slice(-KINGS.MAX_RULES);
    s.announce = { title: 'Neue Regel!', main: [s.drawer], extra: [], drink: false, note: `„${text}“` };
    this.result();
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (!s.order.includes(id)) return;
    const p = asRecord(payload);
    switch (action) {
      case 'draw':
        if (s.sub === 'draw' && id === s.drawer) this.draw();
        break;
      case 'pick':
        this.choose(id, String(p.target ?? ''));
        break;
      case 'tap':
        this.tap(id);
        break;
      case 'word':
        this.setWord(id, p.text);
        break;
      case 'rule':
        this.setRule(id, p.text);
        break;
      case 'next':
      case 'fail':
        // Schritt mitschicken: ein Doppeltipp schaltet nicht zwei Spieler weiter
        if (s.sub !== 'chain' || !s.chain || !this.canJudge(id)) break;
        if (p.step !== undefined && Number(p.step) !== s.chain.step) break;
        if (action === 'next') this.chainNext();
        else this.chainFail();
        break;
      case 'fooled':
        // „Ich bin auf den Fragenmeister reingefallen“ – höchstens einmal pro Zug
        if (s.qm && s.qm !== id && !this.fooledThisTurn.has(id) && s.sub !== 'over') {
          this.fooledThisTurn.add(id);
          const extra = kingsMateClosure(s.mates, [id]);
          for (const x of [id, ...extra.map((e) => e.id)]) s.drinks[x] = (s.drinks[x] ?? 0) + 1;
          s.fooled = { id, seq: (s.fooled?.seq ?? 0) + 1, extra: extra.map((e) => e.id) };
          this.ctx.onChange();
        }
        break;
    }
  }

  /** Generisches VIP-Menü / Taste S: was `skipTurn()` gerade bewirken würde */
  skippable(): SkipInfo | null {
    const s = this.state;
    if (this.finished) return null;
    const who = possessive(this.name(s.drawer));
    switch (s.sub) {
      case 'draw':
        return { label: `${who} Zug überspringen` };
      case 'pick':
      case 'word':
      case 'rule':
        return { label: `${who} Wahl überspringen` };
      case 'chain':
        return { label: 'Runde beenden' };
      case 'reveal':
      case 'waterfall':
      case 'result':
        return { label: 'Weiter', info: true };
    }
    return null;
  }

  skip() {
    this.skipTurn();
  }

  /**
   * Überspringen (VIP-Handy, Laptop, generisches Skip-Menü): beim Ziehen ist der Nächste dran,
   * sonst wird die laufende Phase beendet (Standardwahl bzw. ohne Trinken).
   */
  skipTurn(): void {
    const s = this.state;
    if (this.finished) return;
    switch (s.sub) {
      case 'draw':
        s.announce = null;
        return this.startTurn();
      case 'pick':
        return this.choose(s.drawer, this.randomOther());
      case 'word':
        return this.setWord(s.drawer, '');
      case 'rule':
        return this.setRule(s.drawer, '');
      case 'chain':
        s.announce = { title: 'Runde übersprungen', main: [], extra: [], drink: false };
        return this.result();
      case 'race':
        if (s.race?.phase === 'go') return this.endRace();
        this.timers.clear();
        s.announce = { title: 'Rennen übersprungen', main: [], extra: [], drink: false };
        return this.result();
      case 'reveal':
        return this.act();
      case 'waterfall':
      case 'result':
        this.timers.clear();
        return this.timers.later(0, () => (s.sub === 'waterfall' ? this.finishWaterfall() : this.startTurn()));
    }
  }

  vipAction(action: string) {
    if (action === 'end') return this.end();
    if (action === 'skip') return this.skipTurn();
    // „Weiter“ (z. B. vom Laptop): hängenden Schritt überspringen
    const s = this.state;
    if (action !== 'next') return;
    if (s.sub === 'draw') this.draw();
    else if (s.sub === 'pick') this.choose(s.drawer, this.randomOther());
    else if (s.sub === 'word') this.setWord(s.drawer, '');
    else if (s.sub === 'rule') this.setRule(s.drawer, '');
    else if (s.sub === 'chain') this.chainNext();
    else if (s.sub === 'race' && s.race?.phase === 'go') this.endRace();
  }

  snapshot(): MiniSnapshot {
    return { kind: 'kingscup', state: { ...this.state, endsIn: this.deadline ? Math.max(0, this.deadline - Date.now()) : 0 } };
  }

  playerDisconnected(id: string) {
    const s = this.state;
    if (this.finished) return;
    if (id === s.drawer) {
      // Ziehender weg: Karte überspringen bzw. Standardwahl
      if (s.sub === 'draw') return this.startTurn();
      if (s.sub === 'pick') return this.choose(s.drawer, this.randomOther());
      if (s.sub === 'word') return this.setWord(s.drawer, '');
      if (s.sub === 'rule') return this.setRule(s.drawer, '');
    }
    if (s.sub === 'chain' && s.chain?.turn === id) return this.chainNext();
    if (s.sub === 'race' && s.race?.phase === 'go' && s.race.players.filter(this.live).every((p) => p in s.race!.times)) return this.endRace();
    if (!this.liveIds().length) return this.end();
  }

  dispose() {
    this.finished = true;
    this.timers.clear();
  }
}
