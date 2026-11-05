import type { MaexReveal, MaexState, MiniSnapshot, PrivateState, SkipInfo } from '../shared/types';
import { MAEX, MAEXCHEN, MAEX_ORDER, maexBeats, maexRank, maexValue } from '../shared/maexchen';
import { possessive } from '../shared/players';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore } from './minigame';
import { BetBook } from './spectator';

const die = () => 1 + Math.floor(Math.random() * 6);

/**
 * Mäxchen am Pool: reihum würfelt einer geheim (nur sein Handy sieht die Würfel) und sagt einen Wert an,
 * der die letzte Ansage schlagen muss – ehrlich oder geblufft. Der Nächste glaubt (schüttelt selbst)
 * oder deckt auf. Wer gelogen hat bzw. zu Unrecht zweifelt, verliert ein Leben (Trinkspiel: Schluck),
 * bei angesagtem Mäxchen doppelt; ein geglaubtes Mäxchen kostet einfach.
 */
export class MaexGame implements MiniGame {
  readonly kind = 'maexchen' as const;
  private state: MaexState;
  private timers = new Timers();
  private deadline = 0;
  /** Würfel des aktuellen Zugs bzw. der letzten Ansage (nur der Server kennt sie) */
  private dice: [number, number] | null = null;
  /** Würfel hinter der aktuellen Ansage */
  private claimDice: [number, number] | null = null;
  /** Abgeschlossene Würfe (für „Runden um den Tisch“) */
  private turns = 0;
  private finished = false;
  private bets = new BetBook();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const drink = ctx.mode === 'drink';
    this.state = {
      order: [...ids],
      turn: ids[Math.floor(Math.random() * ids.length)],
      sub: 'roll',
      phaseNo: 0,
      endsIn: 0,
      round: 1,
      // Runden um den Tisch nach Spielerzahl, damit es bei 12 Leuten nicht 8 Minuten dauert
      rounds: drink ? MAEX.ROUNDS_DRINK : ids.length <= 6 ? MAEX.ROUNDS : ids.length <= 9 ? 4 : 3,
      claim: null,
      chain: [],
      rollSeq: 0,
      reveal: null,
      drink,
      lives: Object.fromEntries(ids.map((id) => [id, MAEX.LIVES])),
      sips: Object.fromEntries(ids.map((id) => [id, 0])),
      out: [],
      bluffs: Object.fromEntries(ids.map((id) => [id, 0])),
    };
    this.bets.newRound(1);
    this.startTurn(this.state.turn);
  }

  // ---------------------------------------------------------------- Hilfen

  private alive = (id: string) => this.state.drink || (this.state.lives[id] ?? 0) > 0;
  private live = (id: string) => this.alive(id) && this.ctx.isConnected(id) && !this.ctx.isGone?.(id);
  private aliveIds = () => this.state.order.filter(this.alive);
  private liveIds = () => this.state.order.filter(this.live);
  private name = (id: string) => this.ctx.nameOf(id);

  /** Nächster Anwesende(r) mit Leben im Uhrzeigersinn nach `id` */
  private nextLive(id: string): string | null {
    const o = this.state.order;
    const i = o.indexOf(id);
    for (let k = 1; k <= o.length; k++) {
      const c = o[(i + k) % o.length];
      if (c !== id && this.live(c)) return c;
    }
    return null;
  }

  private phase(sub: MaexState['sub'], ms: number, fn: () => void) {
    this.timers.clear();
    this.state.sub = sub;
    this.state.phaseNo += 1;
    this.deadline = ms ? Date.now() + ms : 0;
    if (ms) this.timers.later(ms, fn);
  }

  // ---------------------------------------------------------------- Ablauf

  /** `id` ist dran: glauben/würfeln (bzw. eine neue Kette beginnen) oder aufdecken */
  private startTurn(id: string) {
    const s = this.state;
    s.turn = id;
    this.dice = null;
    this.phase('roll', MAEX.TURN_MS, () => this.believe(id));
    this.ctx.onChange();
    // Wer gar nicht (mehr) verbunden ist, wird sofort automatisch gespielt
    if (!this.ctx.isConnected(id)) this.timers.later(600, () => this.autoTurn());
  }

  /** Schütteln = glauben und selbst würfeln; bei angesagtem Mäxchen heißt glauben: verloren, ohne aufzudecken */
  private believe(id: string) {
    const s = this.state;
    if (this.finished || s.sub !== 'roll' || id !== s.turn) return;
    if (s.claim?.value === MAEXCHEN) return this.acceptMaexchen();
    // Gelogen und geglaubt = gelungener Bluff
    if (s.claim && this.claimDice && maexRank(maexValue(...this.claimDice)) < maexRank(s.claim.value)) s.bluffs[s.claim.by] = (s.bluffs[s.claim.by] ?? 0) + 1;
    this.dice = [die(), die()];
    s.rollSeq += 1;
    this.phase('announce', MAEX.TURN_MS, () => this.announce(id, this.autoValue()));
    this.ctx.onChange();
    if (!this.ctx.isConnected(id)) this.timers.later(600, () => this.autoTurn());
  }

  /** Ehrlich, wenn der Wurf reicht – sonst die knappste Lüge */
  private autoValue(): number {
    const claim = this.state.claim?.value;
    const v = this.dice ? maexValue(...this.dice) : MAEX_ORDER[0];
    if (maexBeats(v, claim)) return v;
    return MAEX_ORDER[Math.min(MAEX_ORDER.length - 1, (claim == null ? -1 : maexRank(claim)) + 1)];
  }

  private announce(id: string, value: number) {
    const s = this.state;
    if (this.finished || s.sub !== 'announce' || id !== s.turn || !this.dice) return;
    if (!maexBeats(value, s.claim?.value)) return;
    s.claim = { by: id, value };
    s.chain = [...s.chain, s.claim];
    this.claimDice = this.dice;
    this.dice = null;
    this.turns += 1;
    s.round = Math.min(s.rounds, Math.floor(this.turns / Math.max(1, s.order.length)) + 1);
    const next = this.nextLive(id);
    if (!next) return this.end();
    this.startTurn(next);
  }

  private doubt(id: string) {
    const s = this.state;
    if (this.finished || s.sub !== 'roll' || id !== s.turn || !s.claim || !this.claimDice) return;
    const claimed = s.claim.value;
    s.reveal = { by: s.claim.by, doubter: id, claimed, dice: null, actual: null, lied: null, loser: null, cost: 0, accepted: false, out: false };
    this.phase('lift', MAEX.LIFT_MS, () => this.uncover());
    this.ctx.onChange();
  }

  /** Becher hoch: wer hat recht? */
  private uncover() {
    const s = this.state;
    const r = s.reveal;
    if (!r || s.sub !== 'lift' || !this.claimDice) return;
    const actual = maexValue(...this.claimDice);
    const lied = maexRank(actual) < maexRank(r.claimed);
    r.dice = this.claimDice;
    r.actual = actual;
    r.lied = lied;
    r.loser = lied ? r.by : r.doubter;
    r.cost = r.claimed === MAEXCHEN ? MAEX.COST_MAEXCHEN : MAEX.COST;
    this.penalize(r);
    this.phase('reveal', MAEX.REVEAL_MS, () => this.afterReveal());
    this.ctx.onChange();
  }

  private acceptMaexchen() {
    const s = this.state;
    const c = s.claim!;
    s.reveal = { by: c.by, doubter: s.turn, claimed: c.value, dice: null, actual: null, lied: null, loser: s.turn, cost: MAEX.COST, accepted: true, out: false };
    this.penalize(s.reveal);
    this.phase('reveal', MAEX.ACCEPT_MS, () => this.afterReveal());
    this.ctx.onChange();
  }

  private penalize(r: MaexReveal) {
    const s = this.state;
    const loser = r.loser!;
    if (s.drink) {
      s.sips[loser] = (s.sips[loser] ?? 0) + r.cost;
      return;
    }
    const before = s.lives[loser] ?? 0;
    s.lives[loser] = Math.max(0, before - r.cost);
    if (before > 0 && s.lives[loser] === 0) {
      r.out = true;
      s.out = [...s.out, loser];
    }
  }

  /** Neue Kette – beim Verlierer (bzw. dem nächsten, der noch kann) */
  private afterReveal() {
    const s = this.state;
    if (this.finished) return;
    const loser = s.reveal?.loser ?? s.turn;
    s.claim = null;
    s.chain = [];
    this.claimDice = null;
    s.reveal = null;
    if (this.turns >= s.rounds * s.order.length) return this.end();
    if (!s.drink && this.aliveIds().length <= 1) return this.end();
    const start = this.live(loser) ? loser : this.nextLive(loser);
    if (!start || this.liveIds().length < 2) return this.end();
    this.startTurn(start);
  }

  /** Für Abwesende/Überspringen: glauben bzw. automatisch ansagen, Info-Phasen weiterschalten */
  private autoTurn() {
    const s = this.state;
    if (this.finished) return;
    switch (s.sub) {
      case 'roll':
        return this.believe(s.turn);
      case 'announce':
        return this.announce(s.turn, this.autoValue());
      case 'lift':
        return this.uncover();
      case 'reveal':
        return this.afterReveal();
    }
  }

  private end() {
    if (this.finished) return;
    this.finished = true;
    const s = this.state;
    this.timers.clear();
    s.sub = 'over';
    s.phaseNo += 1;
    this.deadline = 0;
    s.claim = null;
    s.chain = [];
    const ids = this.ids;
    const name = (id: string) => this.name(id).replace(/^Bot\s+/, '');
    const topBluff = [...ids].sort((a, b) => (s.bluffs[b] ?? 0) - (s.bluffs[a] ?? 0))[0];
    const bluffNote = topBluff && s.bluffs[topBluff] ? `${name(topBluff)} hat ${s.bluffs[topBluff]}× erfolgreich geblufft!` : 'Ehrliche Haut am Pool …';
    const bluffText = (id: string) => (s.bluffs[id] ? ` · ${s.bluffs[id]}× geblufft` : '');
    this.ctx.onChange();
    if (s.drink) {
      this.timers.later(800, () =>
        this.ctx.finish({
          groups: groupByScore(ids, (id) => s.sips[id] ?? 0),
          details: Object.fromEntries(ids.map((id) => [id, `${s.sips[id] === 1 ? '1 Schluck' : `${s.sips[id] ?? 0} Schlücke`}${bluffText(id)}`])),
          subtitle: bluffNote,
          sips: { ...s.sips },
        }),
      );
      return;
    }
    // Arcade: Leben zählen, Ausgeschiedene nach Reihenfolge (später raus = besser)
    const score = (id: string) => (s.lives[id] > 0 ? 100 + s.lives[id] : s.out.indexOf(id) + 1);
    const alive = this.aliveIds();
    const best = Math.max(...ids.map(score));
    const leaders = ids.filter((id) => score(id) === best);
    this.bets.resolve(leaders.length === 1 ? leaders[0] : null);
    const groups = this.bets.rank(ids, score);
    const winner = leaders.length === 1 ? name(leaders[0]) : null;
    this.timers.later(800, () =>
      this.ctx.finish({
        groups,
        details: Object.fromEntries(ids.map((id) => [id, `${s.lives[id] > 0 ? `${s.lives[id]} Leben übrig` : 'raus'}${bluffText(id)}${this.bets.detail(id)}`])),
        subtitle: alive.length === 1 && winner ? `${winner} sitzt als Letzte(r) am Pool! ${bluffNote}` : bluffNote,
      }),
    );
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (!s.order.includes(id)) return;
    const p = asRecord(payload);
    switch (action) {
      case 'roll':
        return this.believe(id);
      case 'doubt':
        return this.doubt(id);
      case 'announce':
        return this.announce(id, Number(p.value));
      case 'bet':
        if (!s.drink && this.bets.place(id, payload, s.order, this.aliveIds(), !this.finished)) this.ctx.onChange();
        return;
    }
  }

  skippable(): SkipInfo | null {
    const s = this.state;
    if (this.finished) return null;
    const who = possessive(this.name(s.turn));
    switch (s.sub) {
      case 'roll':
        return { label: `${who} Zug überspringen` };
      case 'announce':
        return { label: `${who} Ansage überspringen` };
      case 'lift':
      case 'reveal':
        return { label: 'Weiter', info: true };
    }
    return null;
  }

  /** Fehlende Entscheidung = glauben, fehlende Ansage = ehrlich (oder knappste Lüge) */
  skip() {
    this.autoTurn();
  }

  vipAction(action: string) {
    if (action === 'end') return this.end();
    if (action === 'skip' || action === 'next') this.autoTurn();
  }

  privateFor(playerId: string): PrivateState {
    const s = this.state;
    if (s.sub !== 'announce' || playerId !== s.turn || !this.dice) return null;
    return { kind: 'maexchen', state: { phaseNo: s.phaseNo, dice: this.dice, value: maexValue(...this.dice) } };
  }

  snapshot(): MiniSnapshot {
    const s = this.state;
    return {
      kind: 'maexchen',
      state: {
        ...s,
        endsIn: this.deadline ? Math.max(0, this.deadline - Date.now()) : 0,
        ...(s.drink ? {} : { spectator: this.bets.info(this.aliveIds(), 1, !this.finished) }),
      },
    };
  }

  playerDisconnected(id: string) {
    const s = this.state;
    if (this.finished) return;
    if (this.liveIds().length < 2 && (s.sub === 'roll' || s.sub === 'announce')) return this.end();
    if (id === s.turn && (s.sub === 'roll' || s.sub === 'announce')) this.autoTurn();
  }

  dispose() {
    this.finished = true;
    this.timers.clear();
  }
}
