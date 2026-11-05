import type { FliegerControl, FliegerControlType, FliegerPrivate, FliegerState, MiniSnapshot, PrivateState } from '../shared/types';
import { FLIEGER, FLIEGER_NAMES, FLIEGER_SWITCHES, fliegerMissCost, fliegerPanelSize, fliegerTarget } from '../shared/games';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const TICK_MS = 200;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

interface Control extends FliegerControl {
  owner: string;
}

interface Order {
  /** Wer die Anweisung auf dem Handy sieht */
  owner: string;
  control: string;
  /** Zielstellung (Kippschalter/Schalter) bzw. benötigte Taps */
  target: number;
  taps: number;
  text: string;
  seq: number;
  totalMs: number;
  deadline: number;
}

/**
 * Urlaubsflieger – kooperatives Schreispiel à la Spaceteam.
 *
 * Jedes Handy zeigt ein eigenes Cockpit mit albernen Knöpfen und Schaltern und oben eine
 * geheime Anweisung, die meist ein Bedienelement auf einem ANDEREN Handy betrifft.
 * Also: laut rufen! Erledigte Anweisungen bringen den Flieger voran, verpasste kosten Treibstoff.
 */
export class FliegerGame implements MiniGame {
  readonly kind = 'flieger' as const;
  private state: FliegerState;
  private controls = new Map<string, Control>();
  private orders = new Map<string, Order>();
  /** Frühester Zeitpunkt für die nächste Anweisung pro Spieler */
  private nextAt = new Map<string, number>();
  private feedback = new Map<string, FliegerPrivate['feedback']>();
  private gotDone = new Map<string, number>();
  private deadline = 0;
  private seq = 0;
  private timers = new Timers();
  private ended = false;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.state = {
      sub: 'intro',
      endsIn: 0,
      stage: 0,
      route: FLIEGER.ROUTE,
      progress: 0,
      target: fliegerTarget(0, ids.length),
      fuel: 100,
      done: Object.fromEntries(ids.map((id) => [id, 0])),
      ticker: null,
      okCount: 0,
      missCount: 0,
    };
    this.startStage(0);
    this.timers.every(TICK_MS, () => this.tick());
  }

  private get stages() {
    return FLIEGER.ROUTE.length - 1;
  }

  // ---------------------------------------------------------------- Ablauf

  private startStage(stage: number) {
    const s = this.state;
    s.stage = stage;
    s.progress = 0;
    s.target = fliegerTarget(stage, this.ids.length);
    s.sub = 'intro';
    this.orders.clear();
    this.rollPanels();
    const ms = stage === 0 ? FLIEGER.FIRST_INTRO_MS : FLIEGER.INTRO_MS;
    this.deadline = Date.now() + ms;
    this.timers.later(ms, () => {
      if (this.ended) return;
      s.sub = 'fly';
      const now = Date.now();
      // Leicht versetzt starten, damit nicht alle gleichzeitig losbrüllen
      shuffle(this.ids).forEach((id, i) => this.nextAt.set(id, now + i * 350));
      this.deadline = 0;
      this.ctx.onChange();
    });
    this.ctx.onChange();
  }

  /** Jeder bekommt ein neues Cockpit mit eindeutigen Namen */
  private rollPanels() {
    this.controls.clear();
    const size = fliegerPanelSize(this.ids.length);
    const names = shuffle(FLIEGER_NAMES);
    let n = 0;
    this.ids.forEach((owner, oi) => {
      // Mindestens ein Knopf, ein Kippschalter und ein Schalter; max. zwei Schalter (die sind breit)
      const types: FliegerControlType[] = ['button', 'toggle', 'switch'];
      while (types.length < size) {
        const t = pick<FliegerControlType>(['button', 'toggle', 'toggle', 'switch', 'tap', 'tap']);
        if (t === 'switch' && types.filter((x) => x === 'switch').length >= 2) continue;
        types.push(t);
      }
      shuffle(types).forEach((type, i) => {
        const id = `${this.state.stage}-${oi}-${i}`;
        const labels = type === 'toggle' ? ['AUS', 'AN'] : type === 'switch' ? pick(FLIEGER_SWITCHES) : [];
        const value = type === 'toggle' ? Math.round(Math.random()) : type === 'switch' ? Math.floor(Math.random() * labels.length) : 0;
        this.controls.set(id, { id, owner, name: names[n++ % names.length], type, labels, value });
      });
    });
  }

  private tick() {
    const s = this.state;
    if (s.sub !== 'fly' || this.ended) return;
    const now = Date.now();
    let changed = false;

    for (const o of [...this.orders.values()]) {
      const target = this.controls.get(o.control)!;
      if (!this.ctx.isConnected(o.owner) || !this.ctx.isConnected(target.owner)) {
        // Wer weg ist, kann weder rufen noch drücken → Anweisung ohne Strafe streichen
        this.orders.delete(o.owner);
        this.nextAt.set(o.owner, now + FLIEGER.NEXT_ORDER_MS);
        changed = true;
      } else if (now >= o.deadline) {
        this.miss(o);
        changed = true;
        if (this.ended || s.sub !== 'fly') return;
      }
    }

    for (const id of this.ids) {
      if (this.orders.has(id) || !this.ctx.isConnected(id) || now < (this.nextAt.get(id) ?? 0)) continue;
      if (this.issue(id, now)) changed = true;
    }
    if (changed) this.ctx.onChange();
  }

  /** Neue Anweisung für `owner` – immer erfüllbar (Zielstellung ≠ aktuelle Stellung) */
  private issue(owner: string, now: number): boolean {
    const taken = new Set([...this.orders.values()].map((o) => o.control));
    const free = [...this.controls.values()].filter((c) => !taken.has(c.id) && this.ctx.isConnected(c.owner));
    if (!free.length) return false;
    const own = free.filter((c) => c.owner === owner);
    const others = free.filter((c) => c.owner !== owner);
    let pool: Control[];
    if (others.length && (Math.random() >= FLIEGER.OWN_CHANCE || !own.length)) {
      // Erst einen anderen Spieler wählen, dann ein Element – so wird gleichmäßig gerufen
      const otherOwner = pick([...new Set(others.map((c) => c.owner))]);
      pool = others.filter((c) => c.owner === otherOwner);
    } else {
      pool = own;
    }
    const c = pick(pool);
    let target = 0;
    let taps = 0;
    let text: string;
    switch (c.type) {
      case 'button':
        text = `${c.name} drücken!`;
        break;
      case 'toggle':
        target = 1 - c.value;
        text = `${c.name} ${target ? 'einschalten' : 'ausschalten'}!`;
        break;
      case 'switch': {
        const options = c.labels.map((_, i) => i).filter((i) => i !== c.value);
        target = pick(options);
        text = `${c.name} auf ${c.labels[target].toUpperCase()} stellen!`;
        break;
      }
      case 'tap':
        target = 3 + Math.floor(Math.random() * 4);
        text = `${c.name} ${target}× antippen!`;
        break;
    }
    const totalMs = FLIEGER.ORDER_MS[Math.min(this.state.stage, FLIEGER.ORDER_MS.length - 1)];
    this.orders.set(owner, { owner, control: c.id, target, taps, text, seq: ++this.seq, totalMs, deadline: now + totalMs });
    return true;
  }

  private miss(o: Order) {
    const s = this.state;
    this.orders.delete(o.owner);
    this.nextAt.set(o.owner, Date.now() + FLIEGER.NEXT_ORDER_MS);
    const cost = fliegerMissCost(this.ids.length);
    s.fuel = Math.max(0, s.fuel - cost);
    s.missCount += 1;
    s.ticker = { text: `Anweisung verpasst! -${cost} Treibstoff`, ok: false, seq: ++this.seq };
    this.feedback.set(o.owner, { ok: false, text: 'Zu spät! Treibstoff verloren', seq: this.seq });
    if (s.fuel <= 0) this.end('crash');
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (action !== 'act' || this.ended || (s.sub !== 'fly' && s.sub !== 'intro')) return;
    const p = asRecord(payload);
    const c = this.controls.get(String(p.c ?? ''));
    // Nur der Besitzer kann sein eigenes Cockpit bedienen
    if (!c || c.owner !== id) return;
    let changed = false;
    if (c.type === 'toggle') {
      c.value = 1 - c.value;
      changed = true;
    } else if (c.type === 'switch') {
      const v = Number(p.v);
      if (!Number.isInteger(v) || v < 0 || v >= c.labels.length || v === c.value) return;
      c.value = v;
      changed = true;
    }
    if (s.sub === 'fly') {
      const o = [...this.orders.values()].find((x) => x.control === c.id);
      if (o) {
        if (c.type === 'button') this.complete(o, id, c, `${c.name} gedrückt!`);
        else if (c.type === 'toggle' && c.value === o.target) this.complete(o, id, c, `${c.name} ${c.value ? 'AN' : 'AUS'}!`);
        else if (c.type === 'switch' && c.value === o.target) this.complete(o, id, c, `${c.name} auf ${c.labels[c.value]}!`);
        else if (c.type === 'tap') {
          o.taps += 1;
          changed = true;
          if (o.taps >= o.target) this.complete(o, id, c, `${c.name} ${o.target}× getippt!`);
        }
      }
    }
    if (changed) this.ctx.onChange();
  }

  private complete(o: Order, actor: string, c: Control, what: string) {
    const s = this.state;
    this.orders.delete(o.owner);
    this.nextAt.set(o.owner, Date.now() + FLIEGER.NEXT_ORDER_MS);
    s.done[actor] = (s.done[actor] ?? 0) + 1;
    this.gotDone.set(o.owner, (this.gotDone.get(o.owner) ?? 0) + 1);
    s.progress += 1;
    s.okCount += 1;
    s.ticker = { text: `${this.ctx.nameOf(actor)}: ${what}`, ok: true, seq: ++this.seq };
    this.feedback.set(actor, { ok: true, text: actor === o.owner ? 'Erledigt!' : `Treffer! ${c.name} war gefragt`, seq: this.seq });
    if (actor !== o.owner) this.feedback.set(o.owner, { ok: true, text: `${this.ctx.nameOf(actor)} hat's erledigt!`, seq: this.seq });
    if (s.progress >= s.target) this.stageCleared();
    this.ctx.onChange();
  }

  private stageCleared() {
    const s = this.state;
    this.orders.clear();
    if (s.stage >= this.stages - 1) return this.end('arrived');
    s.sub = 'cleared';
    s.fuel = Math.min(100, s.fuel + FLIEGER.REFUEL);
    this.deadline = Date.now() + FLIEGER.CLEARED_MS;
    this.timers.later(FLIEGER.CLEARED_MS, () => !this.ended && this.startStage(s.stage + 1));
  }

  private end(how: 'crash' | 'arrived') {
    if (this.ended) return;
    this.ended = true;
    const s = this.state;
    s.sub = how;
    if (how === 'arrived') s.progress = s.target;
    this.orders.clear();
    this.deadline = Date.now() + FLIEGER.END_MS;
    this.ctx.onChange();
    const R = FLIEGER.ROUTE;
    const score = (id: string) => (s.done[id] ?? 0) + (this.gotDone.get(id) ?? 0);
    const subtitle =
      how === 'arrived'
        ? `Gelandet auf ${R[R.length - 1]}! ${s.okCount} Anweisungen erledigt.`
        : s.stage === 0
          ? `Absturz kurz nach dem Start in ${R[0]}!`
          : `Absturz zwischen ${R[s.stage]} und ${R[s.stage + 1]} – Etappe ${s.stage + 1}/${this.stages}.`;
    // Koop-Münzen: alle bekommen dasselbe nach Ergebnis (Bali 8, je fehlender Etappe weniger, Absturz am Start 1),
    // wer die meisten Anweisungen ausgeführt hat (MVP), +2.
    const base = how === 'arrived' ? 8 : Math.max(1, Math.round(1 + (6 * s.stage) / Math.max(1, this.stages - 1)));
    const best = Math.max(0, ...this.ids.map((id) => s.done[id] ?? 0));
    const mvp = best > 0 ? this.ids.filter((id) => (s.done[id] ?? 0) === best) : [];
    const rest = this.ids.filter((id) => !mvp.includes(id));
    // MVP-Gruppe vorne; haben alle gleich viel (oder niemand etwas), gibt es eine gemeinsame Gruppe ohne Bonus
    const split = mvp.length > 0 && rest.length > 0;
    const groups = split ? [mvp, ...groupByScore(rest, score)] : [this.ids];
    const coins = split ? [base + 2, base] : [base];
    this.timers.clear();
    this.timers.later(FLIEGER.END_MS, () =>
      this.ctx.finish({
        groups,
        details: Object.fromEntries(
          this.ids.map((id) => [id, `${s.done[id] ?? 0}× ausgeführt · ${this.gotDone.get(id) ?? 0} eigene erledigt${split && mvp.includes(id) ? ' · MVP' : ''}`]),
        ),
        subtitle,
        coins,
      }),
    );
  }

  // ---------------------------------------------------------------- Zustand

  snapshot(): MiniSnapshot {
    return { kind: 'flieger', state: { ...this.state, endsIn: Math.max(0, this.deadline - Date.now()) } };
  }

  privateFor(id: string): PrivateState {
    if (!this.ids.includes(id)) return null;
    const now = Date.now();
    const o = this.orders.get(id);
    const panel = [...this.controls.values()].filter((c) => c.owner === id).map(({ owner: _o, ...c }) => c);
    const priv: FliegerPrivate = {
      panel,
      order: o
        ? { text: o.text, endsIn: Math.max(0, o.deadline - now), totalMs: o.totalMs, seq: o.seq, taps: this.controls.get(o.control)?.type === 'tap' ? `${o.taps}/${o.target}` : null }
        : null,
      feedback: this.feedback.get(id) ?? null,
    };
    if (this.ctx.isBot?.(id)) {
      // Bots können nicht zuhören – sie bekommen die offenen Anweisungen für ihr Cockpit direkt
      priv.botHints = [...this.orders.values()]
        .filter((x) => this.controls.get(x.control)?.owner === id)
        .map((x) => ({ c: x.control, v: x.target, taps: Math.max(0, x.target - x.taps) }));
    }
    return { kind: 'flieger', state: priv };
  }

  playerDisconnected(id: string) {
    // Offene Anweisungen werden im nächsten Tick ohne Strafe gestrichen
    this.nextAt.set(id, Date.now());
  }

  dispose() {
    this.ended = true;
    this.timers.clear();
  }
}
