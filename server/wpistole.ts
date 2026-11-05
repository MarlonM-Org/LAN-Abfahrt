import type { MiniSnapshot } from '../shared/types';
import { WP, WP_FAKES, type WpDuel, type WpPlayer, type WpShot, type WpSide, type WpistoleState, wpHits, wpTargetAt, wpRandomPath, wpSec } from '../shared/wpistole';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const TICK_MS = 25;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Server-interne Zusatzdaten einer Duell-Seite */
interface SideX {
  /** Server-Zeit, zu der das Handy das „ZIEHT!“ bestätigt hat */
  ackAt: number | null;
  lastShot: number;
  /** Zwerg: wann er trifft */
  gnomeAt: number;
}

/**
 * Wasserpistolen-Duell: Western-Duell im Ferienhaus-Garten.
 *
 * Ablauf einer Runde: „Hand ans Holster!“ (arm) → zufällige Wartezeit, evtl. falscher Ruf (wait)
 * → „ZIEHT!“ (draw): ziehen, auf den tänzelnden Gegner zielen, spritzen → Ergebnis.
 * Alle Duelle einer Runde laufen gleichzeitig nebeneinander (bis 6 Bahnen auf dem TV).
 * Vorrunde nach Schweizer System, danach Finale der beiden Besten (zu zweit nur „Finale“).
 *
 * Zeitmessung (fair trotz WLAN): Der Server misst ab dem Moment, in dem das jeweilige Handy das
 * „ZIEHT!“ bestätigt (`ack`). Bestätigung und Schuss laufen über dieselbe Verbindung, die
 * Funkstrecke hebt sich also heraus. Die eigene Messung des Handys wird als Hinweis genutzt,
 * darf aber höchstens WP.HINT_TOL_MS von der Server-Messung abweichen.
 */
export class WpistoleGame implements MiniGame {
  readonly kind = 'wpistole' as const;
  private sub: WpistoleState['sub'] = 'intro';
  private deadline = Date.now() + WP.INTRO_MS;
  private round = 0;
  private rounds: number;
  private final = false;
  private finalTo: number;
  private finalMax: number;
  private finalists: string[] = [];
  private finalDuels = 0;
  private players = new Map<string, WpPlayer>();
  private duels: WpDuel[] = [];
  private x = new Map<WpSide, SideX>();
  private shots: WpShot[] = [];
  private shotSeq = 0;
  private drawSeq = 0;
  private drawAt = 0;
  private call: string | null = null;
  private callReal = false;
  private callSeq = 0;
  private fakeAt = 0;
  private fakeEnd = 0;
  private settleAt = 0;
  /** Bereits gegeneinander angetreten */
  private met = new Set<string>();
  private gnomeCount = new Map<string, number>();
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    ids.forEach((id, i) => this.players.set(id, { wins: 0, best: null, fouls: 0, color: WP.COLORS[i % WP.COLORS.length], fw: 0 }));
    const two = ids.length <= 2;
    this.rounds = two ? 0 : ids.length <= 4 ? WP.ROUNDS_FEW : WP.ROUNDS_MANY;
    this.finalTo = two ? WP.FINAL_TO_2P : WP.FINAL_TO;
    this.finalMax = two ? WP.FINAL_MAX_DUELS_2P : WP.FINAL_MAX_DUELS;
    if (two) {
      this.final = true;
      this.finalists = [...ids];
    }
    this.timers.every(TICK_MS, () => this.tick(Date.now()));
  }

  // ---------------------------------------------------------------- Ablauf

  private tick(now: number) {
    if (this.sub === 'over') return;
    switch (this.sub) {
      case 'intro':
      case 'result':
      case 'table':
        if (now >= this.deadline) this.next(now);
        break;
      case 'arm': {
        const ready = this.allSides().every((s) => s.id === WP.GNOME_ID || s.armed || !this.ctx.isConnected(s.id));
        if (now >= this.deadline || (ready && now >= this.deadline - WP.ARM_MS + WP.ARM_MIN_MS)) this.startWait(now);
        break;
      }
      case 'wait':
        if (this.fakeAt && now >= this.fakeAt && !this.call) {
          this.call = WP_FAKES[Math.floor(Math.random() * WP_FAKES.length)];
          this.callReal = false;
          this.callSeq += 1;
          this.fakeEnd = now + WP.FAKE_MS;
          this.fakeAt = 0;
          this.ctx.onChange();
        }
        if (this.fakeEnd && now >= this.fakeEnd) {
          this.fakeEnd = 0;
          this.call = null;
          this.ctx.onChange();
        }
        if (now >= this.deadline) this.startDraw(now);
        break;
      case 'draw':
        this.duelTick(now);
        break;
    }
  }

  /** Nächster Abschnitt nach Intro / Ergebnis / Zwischenstand */
  private next(now: number) {
    if (this.sub === 'result' && this.final) {
      const [a, b] = this.finalists;
      const fa = this.players.get(a)!.fw;
      const fb = this.players.get(b)!.fw;
      if (fa >= this.finalTo || fb >= this.finalTo || (this.finalDuels >= this.finalMax && fa !== fb)) return this.end();
      if (this.finalDuels >= this.finalMax + 2) return this.end();
    }
    if (this.sub === 'result' && !this.final && this.round >= this.rounds) {
      // Vorrunde vorbei → Zwischenstand mit Finalisten
      this.finalists = this.ranked().slice(0, 2);
      this.final = true;
      this.sub = 'table';
      this.deadline = now + WP.TABLE_MS;
      this.duels = [];
      this.ctx.onChange();
      return;
    }
    this.startRound(now);
  }

  private startRound(now: number) {
    this.round += 1;
    if (this.final) this.finalDuels += 1;
    this.duels = this.final ? [this.makeDuel(this.finalists[0], this.finalists[1])] : this.pairings();
    this.x.clear();
    this.hitArrival.clear();
    for (const s of this.allSides()) this.x.set(s, { ackAt: null, lastShot: 0, gnomeAt: 0 });
    this.shots = [];
    this.call = null;
    this.sub = 'arm';
    this.deadline = now + WP.ARM_MS;
    this.ctx.onChange();
  }

  private startWait(now: number) {
    this.sub = 'wait';
    const wait = rand(WP.WAIT_MIN_MS, WP.WAIT_MAX_MS);
    this.deadline = now + wait;
    this.call = null;
    this.fakeAt = 0;
    this.fakeEnd = 0;
    // Ab Runde 2 ab und zu ein falscher Ruf
    const fake = (this.round >= 2 || this.final) && Math.random() < 0.45;
    if (fake) {
      this.fakeAt = now + rand(600, Math.max(700, wait - WP.FAKE_GAP_MS));
      this.deadline = Math.max(this.deadline, this.fakeAt + WP.FAKE_MS + WP.FAKE_GAP_MS);
    }
    this.ctx.onChange();
  }

  private startDraw(now: number) {
    this.sub = 'draw';
    this.drawSeq += 1;
    this.drawAt = now;
    this.call = 'ZIEHT!';
    this.callReal = true;
    this.callSeq += 1;
    this.fakeAt = 0;
    this.fakeEnd = 0;
    this.deadline = now + WP.DUEL_MS;
    this.settleAt = 0;
    for (const s of this.allSides()) {
      if (s.id === WP.GNOME_ID) this.x.get(s)!.gnomeAt = now + WP.NO_ACK_MS + rand(WP.GNOME_MIN_MS, WP.GNOME_MAX_MS);
    }
    this.ctx.onChange();
  }

  private duelTick(now: number) {
    let changed = false;
    this.duels.forEach((d, i) => {
      if (d.done) return;
      // Zwerg spritzt
      for (const [me, other] of [[d.a, d.b], [d.b, d.a]] as const) {
        if (me.id !== WP.GNOME_ID || me.hitMs !== null) continue;
        const gx = this.x.get(me)!;
        if (now < gx.gnomeAt) continue;
        const t = gx.gnomeAt - this.drawAt - WP.NO_ACK_MS;
        me.drawMs = Math.round(t * 0.55);
        me.shots = 1;
        me.hitMs = Math.round(t);
        this.hitArrival.set(me, now);
        this.pushShot(i, d.a === me ? 'a' : 'b', other, t, true);
        changed = true;
      }
      // Erster Treffer da → kurz auf langsamere Funkwege warten, dann entscheiden
      const hits = [d.a, d.b].filter((s) => s.hitMs !== null);
      if (!hits.length) return;
      const first = Math.min(...[d.a, d.b].map((s) => this.firstHitArrival(s)));
      if (now < first + WP.GRACE_MS) return;
      const win = hits.sort((p, q) => p.hitMs! - q.hitMs!)[0];
      this.decide(d, win, '');
      changed = true;
    });
    // Beide ohne Wasser → Patt
    for (const d of this.duels) {
      if (d.done) continue;
      const empty = (s: WpSide) => s.foul || (s.shots >= WP.SHOTS && s.hitMs === null);
      if (empty(d.a) && empty(d.b) && d.a.hitMs === null && d.b.hitMs === null) {
        this.decide(d, null, 'Beide leer – Patt!');
        changed = true;
      }
    }
    if (now >= this.deadline) {
      for (const d of this.duels) if (!d.done) this.decide(d, null, 'Zu langsam – Patt!');
      changed = true;
    }
    if (this.duels.every((d) => d.done)) {
      if (!this.settleAt) this.settleAt = now + WP.SETTLE_MS;
      if (now >= this.settleAt) this.toResult(now);
    }
    if (changed) this.ctx.onChange();
  }

  /** Wann kam der Treffer dieser Seite beim Server an? (für die Gnadenfrist) */
  private hitArrival = new Map<WpSide, number>();
  private firstHitArrival(s: WpSide) {
    return s.hitMs === null ? Infinity : (this.hitArrival.get(s) ?? 0);
  }

  private decide(d: WpDuel, win: WpSide | null, note: string) {
    if (d.done) return;
    d.done = true;
    d.note = note;
    d.winner = win?.id ?? null;
    if (win) {
      const lose = win === d.a ? d.b : d.a;
      lose.wet = true;
      const p = this.players.get(win.id);
      if (p) {
        if (this.final) p.fw += 1;
        else p.wins += 1;
        if (win.hitMs !== null && !note) p.best = p.best === null ? win.hitMs : Math.min(p.best, win.hitMs);
      }
      if (!note) d.note = win.hitMs !== null ? wpSec(win.hitMs) : '';
    }
    // Frühstarter werden ebenfalls nass (Eimer-Strafe)
    for (const s of [d.a, d.b]) if (s.foul) s.wet = true;
    if (!win && d.a.foul && d.b.foul) d.note = 'Doppelter Frühstart!';
  }

  private toResult(now: number) {
    this.sub = 'result';
    this.call = null;
    this.deadline = now + WP.RESULT_MS;
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Paarungen

  private allSides(): WpSide[] {
    return this.duels.flatMap((d) => [d.a, d.b]);
  }

  private speed() {
    return this.final ? 1.35 : Math.min(1.35, 0.85 + 0.07 * this.round);
  }

  private makeDuel(a: string, b: string): WpDuel {
    const side = (id: string): WpSide => ({ id, path: wpRandomPath(this.speed()), armed: id === WP.GNOME_ID, drawMs: null, hitMs: null, shots: 0, foul: false, wet: false, aim: null });
    // Zufällig, wer links steht
    return Math.random() < 0.5 ? { a: side(a), b: side(b), done: false, winner: null, note: '' } : { a: side(b), b: side(a), done: false, winner: null, note: '' };
  }

  private pairKey(a: string, b: string) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  /** Schweizer System: Gleichstarke gegeneinander, möglichst ohne Wiederholung; Ungerade → Gartenzwerg */
  private pairings(): WpDuel[] {
    const active = this.ids.filter((id) => !this.ctx.isGone?.(id));
    const order = shuffle(active).sort((a, b) => this.players.get(b)!.wins - this.players.get(a)!.wins);
    let gnome: string | null = null;
    if (order.length % 2 === 1) {
      // Der Schwächste, der am seltensten gegen den Zwerg dran war
      const pick = [...order].reverse().sort((a, b) => (this.gnomeCount.get(a) ?? 0) - (this.gnomeCount.get(b) ?? 0))[0];
      gnome = pick;
      this.gnomeCount.set(pick, (this.gnomeCount.get(pick) ?? 0) + 1);
      order.splice(order.indexOf(pick), 1);
    }
    const duels: WpDuel[] = [];
    const left = [...order];
    while (left.length >= 2) {
      const a = left.shift()!;
      let j = left.findIndex((b) => !this.met.has(this.pairKey(a, b)));
      if (j < 0) j = 0;
      const b = left.splice(j, 1)[0];
      this.met.add(this.pairKey(a, b));
      duels.push(this.makeDuel(a, b));
    }
    if (gnome) duels.push(this.makeDuel(gnome, WP.GNOME_ID));
    return duels;
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const d = this.duels.find((x) => x.a.id === id || x.b.id === id);
    if (!d) return;
    const me = d.a.id === id ? d.a : d.b;
    const other = me === d.a ? d.b : d.a;
    const mx = this.x.get(me);
    if (!mx) return;
    const pl = asRecord(payload);
    const now = Date.now();
    const seq = Number(pl.seq);

    if (action === 'arm') {
      if (this.sub !== 'arm' && this.sub !== 'wait') return;
      const on = pl.on !== false;
      if (on === me.armed) return;
      me.armed = on;
      this.ctx.onChange();
      return;
    }

    if (action === 'ack') {
      if (this.sub === 'draw' && seq === this.drawSeq && mx.ackAt === null) mx.ackAt = now;
      return;
    }

    if (action === 'aim') {
      const ax = Number(pl.x);
      const ay = Number(pl.y);
      if (this.sub !== 'draw' || !Number.isFinite(ax) || !Number.isFinite(ay)) return;
      me.aim = { x: r1(clamp(ax, 0, WP.BOX_W)), y: r1(clamp(ay, 0, WP.BOX_H)) };
      this.ctx.onChange();
      return;
    }

    if (action !== 'draw' && action !== 'shoot') return;
    if (me.foul || d.done) return;

    // Zu früh: noch kein „ZIEHT!“ oder das Handy hatte es beim Abschicken noch nicht gesehen
    if (this.sub === 'wait' || (this.sub === 'draw' && seq !== this.drawSeq)) return this.foul(d, me, other, 'Frühstart!');
    if (this.sub !== 'draw') return;

    const t = this.reaction(mx, now, Number(pl.t));
    if (t < WP.MIN_REACT_MS && me.drawMs === null) return this.foul(d, me, other, 'Geraten!');

    if (me.drawMs === null) me.drawMs = Math.round(t);
    if (action === 'draw') {
      this.ctx.onChange();
      return;
    }

    // Spritzen
    if (me.shots >= WP.SHOTS || now - mx.lastShot < WP.SHOT_COOLDOWN_MS || me.hitMs !== null) return;
    mx.lastShot = now;
    me.shots += 1;
    const x = clamp(Number(pl.x), 0, WP.BOX_W);
    const y = clamp(Number(pl.y), 0, WP.BOX_H);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const r = pl.m === 'motion' ? WP.HIT_R_MOTION : WP.HIT_R_TOUCH;
    const hit = wpHits(other.path, t, x, y, r);
    if (hit) {
      me.hitMs = Math.round(t);
      this.hitArrival.set(me, now);
    }
    this.shots.push({ seq: ++this.shotSeq, duel: this.duels.indexOf(d), from: me === d.a ? 'a' : 'b', x: r1(x), y: r1(y), hit });
    if (this.shots.length > 40) this.shots.shift();
    this.ctx.onChange();
  }

  /** Reaktionszeit in ms: Server-Messung ab Bestätigung, Handy-Messung als Feinkorrektur */
  private reaction(mx: SideX, now: number, hint: number) {
    const base = mx.ackAt ?? this.drawAt + WP.NO_ACK_MS;
    const server = now - base;
    if (!Number.isFinite(hint) || hint < 0) return server;
    return clamp(hint, server - WP.HINT_TOL_MS, server + WP.HINT_TOL_MS);
  }

  private pushShot(duel: number, from: 'a' | 'b', target: WpSide, t: number, hit: boolean) {
    // Zwerg trifft genau die Körpermitte zum Trefferzeitpunkt
    const c = wpTargetAt(target.path, t);
    this.shots.push({ seq: ++this.shotSeq, duel, from, x: r1(c.x), y: r1(c.y), hit });
  }

  private foul(d: WpDuel, me: WpSide, other: WpSide, note: string) {
    me.foul = true;
    const p = this.players.get(me.id);
    if (p) p.fouls += 1;
    // Gegner gewinnt – außer er hat selbst schon einen Frühstart
    if (other.foul) this.decide(d, null, 'Doppelter Frühstart!');
    else if (this.sub === 'wait' || this.sub === 'draw') {
      // Im Warten: sofort entschieden. Im Duell: nur, wenn der Gegner noch nicht getroffen hat
      if (other.hitMs === null) this.decide(d, other, `${note} ${this.ctx.nameOf(me.id)}`);
    }
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Ende

  /** Rangfolge nach Siegen, dann Bestzeit */
  private ranked(): string[] {
    return [...this.ids].sort((a, b) => this.score(b) - this.score(a));
  }

  private score(id: string) {
    const p = this.players.get(id)!;
    return p.wins * 100000 - (p.best ?? 99999) - p.fouls * 0.1;
  }

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.call = null;
    this.deadline = Date.now() + WP.OVER_MS;
    this.ctx.onChange();
    const [a, b] = this.finalists;
    const pa = this.players.get(a)!;
    const pb = this.players.get(b)!;
    const champ = pa.fw === pb.fw ? (this.score(a) >= this.score(b) ? a : b) : pa.fw > pb.fw ? a : b;
    const second = champ === a ? b : a;
    const rest = this.ids.filter((id) => id !== a && id !== b);
    const groups = [[champ], [second], ...groupByScore(rest, (id) => this.score(id))];
    const fastest = [...this.ids].filter((id) => this.players.get(id)!.best !== null).sort((x, y) => this.players.get(x)!.best! - this.players.get(y)!.best!)[0];
    const details: Record<string, string> = {};
    for (const id of this.ids) {
      const p = this.players.get(id)!;
      const parts: string[] = [];
      if (id === a || id === b) parts.push(`${this.rounds ? 'Finale' : 'Duelle'} ${p.fw}:${(id === a ? pb : pa).fw}`);
      if (this.rounds) parts.push(`${p.wins} ${p.wins === 1 ? 'Sieg' : 'Siege'}`);
      parts.push(`Bestzeit ${wpSec(p.best)}`);
      if (p.fouls) parts.push(`${p.fouls}× Frühstart`);
      details[id] = parts.join(' · ');
    }
    const subtitle = `${this.ctx.nameOf(champ)} zieht am schnellsten im ganzen Garten!${fastest ? ` Schnellster Treffer: ${this.ctx.nameOf(fastest)} (${wpSec(this.players.get(fastest)!.best)})` : ''}`;
    this.timers.later(WP.OVER_MS, () => {
      this.timers.clear();
      this.ctx.finish({ groups, details, subtitle });
    });
  }

  snapshot(): MiniSnapshot {
    return {
      kind: 'wpistole',
      state: {
        sub: this.sub,
        round: this.round,
        rounds: this.rounds,
        final: this.final,
        finalTo: this.finalTo,
        finalists: this.finalists,
        endsIn: Math.max(0, this.deadline - Date.now()),
        drawSeq: this.drawSeq,
        call: this.call,
        callReal: this.callReal,
        callSeq: this.callSeq,
        duels: this.duels,
        players: Object.fromEntries(this.players),
        shots: this.shots,
      },
    };
  }

  playerDisconnected() {}

  dispose() {
    this.timers.clear();
  }
}

