import type { MiniSnapshot, PrivateState, SpionPlayer, SpionPrivate, SpionState, SpionTag, SpionThrow } from '../shared/types';
import { SPION, SP_A, STATIONS, type SpAnimId, besideSpot, findPath, packGuest, randomSpot, stationAt, stationSpot } from '../shared/spion';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Guest {
  i: number;
  x: number;
  y: number;
  dir: 1 | -1;
  v: number;
  a: SpAnimId;
  path: { x: number; y: number }[];
  /** Ende von Stehen/Plaudern/Erledigen/Nass */
  until: number;
  /** NPC: Ziel war ein Auftragsort */
  goal: number;
  /** Gerade benutzter Auftragsort */
  using: number;
  owner: string | null;
}

interface P {
  id: string;
  g: number;
  out: boolean;
  outBy: string | null;
  balloons: number;
  done: boolean[];
  /** öffentlich angezeigter (verzögerter) Fortschritt */
  shown: number;
  cooldownUntil: number;
  score: number;
  unmasks: number;
  tasksTotal: number;
  survived: number;
  wins: number;
  note: { text: string; seq: number } | null;
}

/**
 * Spion unter Gästen (à la „Hidden in Plain Sight“ / „Spy Party“).
 *
 * Gartenparty mit 40–60 gleich aussehenden Gästen. Jeder Spieler steuert heimlich einen davon
 * (Handy: auf die Karte tippen = dorthin schlendern, so schnell wie alle NPCs). Wer zuerst alle vier
 * Aufträge (Buffet, Grill, Pool, Hängematte) erledigt, gewinnt die Runde. Mit zwei Wasserballons
 * pro Runde enttarnt man andere Spieler – ein Fehlwurf auf einen echten Gast verrät aber kurz einen selbst.
 *
 * Alle Positionen sind öffentlich (es sind ja nur Gäste) – welcher Gast wem gehört, geht nur per privateFor().
 */
export class SpionGame implements MiniGame {
  readonly kind = 'spion' as const;
  private ps = new Map<string, P>();
  private guests: Guest[] = [];
  private sub: SpionState['sub'] = 'intro';
  private round = 0;
  private rounds: number;
  private roundMs: number;
  private deadline = 0;
  private throws: SpionThrow[] = [];
  private tags: (SpionTag & { until: number })[] = [];
  private news: SpionState['news'] = null;
  private winner: string | null = null;
  private seq = 0;
  private noteSeq = 0;
  private timers = new Timers();
  private last = Date.now();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    for (const id of ids) {
      this.ps.set(id, {
        id, g: 0, out: false, outBy: null, balloons: SPION.BALLOONS, done: STATIONS.map(() => false), shown: 0, cooldownUntil: 0,
        score: 0, unmasks: 0, tasksTotal: 0, survived: 0, wins: 0, note: null,
      });
    }
    const party = ctx.mode === 'party';
    this.rounds = party ? 2 : ids.length <= 4 ? 3 : 2;
    this.roundMs = party ? 100000 : ids.length >= 8 ? 150000 : 120000;
    this.startRound();
    this.timers.every(SPION.TICK_MS, () => this.tick());
  }

  // ---------------------------------------------------------------- Ablauf

  private startRound() {
    this.round += 1;
    this.throws = [];
    this.tags = [];
    this.winner = null;
    this.news = { seq: ++this.seq, text: `Runde ${this.round}: Mischt euch unter die Gäste!` };
    const n = SPION.guests(this.ids.length);
    const now = Date.now();
    this.guests = [];
    for (let i = 0; i < n; i++) {
      // Etwa jeder Dritte steht schon in einer Plauder-Gruppe
      const near = i > 0 && Math.random() < 0.4 ? this.guests[Math.floor(Math.random() * this.guests.length)] : null;
      const spot = (near && besideSpot(near.x, near.y)) || randomSpot();
      const g: Guest = { i, x: spot.x, y: spot.y, dir: Math.random() < 0.5 ? 1 : -1, v: Math.floor(Math.random() * 3), a: SP_A.STAND, path: [], until: 0, goal: -1, using: -1, owner: null };
      if (near && Math.abs(near.x - g.x) < SPION.CHAT_R) {
        g.a = SP_A.CHAT;
        g.dir = near.x > g.x ? 1 : -1;
      }
      g.until = now + SPION.INTRO_MS + rand(300, 5000) + (g.a === SP_A.CHAT ? 3000 : 0);
      this.guests.push(g);
    }
    const slots = shuffle(this.guests.map((g) => g.i));
    this.ids.forEach((id, k) => {
      const p = this.ps.get(id)!;
      Object.assign(p, { g: slots[k], out: false, outBy: null, balloons: SPION.BALLOONS, done: STATIONS.map(() => false), shown: 0, cooldownUntil: 0, note: null });
      this.guests[p.g].owner = id;
      this.note(p, `Du bist Gast Nr. ${p.g + 1} – unauffällig bleiben!`);
    });
    this.setPhase('intro', SPION.INTRO_MS);
    this.timers.later(SPION.INTRO_MS, () => {
      this.setPhase('play', this.roundMs);
      this.news = { seq: ++this.seq, text: 'Die Party läuft – Aufträge erledigen, Spione enttarnen!' };
    });
  }

  private setPhase(sub: SpionState['sub'], ms: number) {
    this.sub = sub;
    this.deadline = Date.now() + ms;
    this.ctx.onChange();
  }

  private alive() {
    return this.ids.filter((id) => !this.ps.get(id)!.out);
  }

  private endRound(reason: 'tasks' | 'last' | 'time') {
    if (this.sub !== 'play') return;
    const alive = this.alive();
    for (const id of alive) {
      const p = this.ps.get(id)!;
      p.score += SPION.POINTS.SURVIVE;
      p.survived += 1;
    }
    for (const p of this.ps.values()) p.shown = p.done.filter(Boolean).length;
    for (const g of this.guests) {
      g.path = [];
      if (g.a === SP_A.WALK || g.a === SP_A.USE || g.a === SP_A.WET) g.a = SP_A.STAND;
    }
    this.tags = [
      ...this.tags.filter((t) => t.why === 'out'),
      ...alive.map((id) => ({ g: this.ps.get(id)!.g, id, why: 'reveal' as const, until: Infinity })),
    ];
    const text =
      reason === 'tasks'
        ? `${this.ctx.nameOf(this.winner!)} hat alle Aufträge erledigt!`
        : reason === 'last'
          ? alive.length
            ? `${this.ctx.nameOf(alive[0])} ist als letzter Spion übrig!`
            : 'Alle Spione sind enttarnt!'
          : 'Die Zeit ist um – wer noch unerkannt ist, bekommt Punkte.';
    this.news = { seq: ++this.seq, text };
    this.setPhase('reveal', SPION.REVEAL_MS);
    this.timers.later(SPION.REVEAL_MS, () => {
      if (this.round < this.rounds) this.startRound();
      else this.finishGame();
    });
  }

  private finishGame() {
    this.setPhase('over', SPION.OVER_MS);
    const score = (id: string) => this.ps.get(id)!.score;
    const best = [...this.ids].sort((a, b) => score(b) - score(a))[0];
    const hunter = [...this.ids].sort((a, b) => this.ps.get(b)!.unmasks - this.ps.get(a)!.unmasks)[0];
    const extra = this.ps.get(hunter)!.unmasks > 0 ? ` Schärfster Blick: ${this.ctx.nameOf(hunter)}.` : '';
    this.timers.later(SPION.OVER_MS, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, score),
        details: Object.fromEntries(
          this.ids.map((id) => {
            const p = this.ps.get(id)!;
            return [id, `${p.score} Pkt · ${p.tasksTotal} Aufträge · ${p.unmasks} enttarnt`];
          }),
        ),
        subtitle: `${this.ctx.nameOf(best)} ist Meisterspion!${extra}`,
      }),
    );
  }

  // ---------------------------------------------------------------- Spielschleife

  private tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.sub !== 'play') return;
    for (const g of this.guests) {
      if (g.a === SP_A.OUT) continue;
      if (g.a === SP_A.WALK) this.walk(g, dt, now);
      else if (g.a === SP_A.USE && now >= g.until) this.useDone(g, now);
      else if (g.a === SP_A.WET && now >= g.until) this.stand(g, now, rand(400, 1200));
      // NPCs (und Gäste von Spielern ohne Verbindung) machen ihr eigenes Ding
      const npc = !g.owner || !this.ctx.isConnected(g.owner);
      if (npc && g.until === Infinity) g.until = now + rand(1000, 4000);
      if (npc && (g.a === SP_A.STAND || g.a === SP_A.CHAT) && now >= g.until) this.npcNext(g, now);
    }
    this.tags = this.tags.filter((t) => t.until > now);
    if (now >= this.deadline) this.endRound('time');
    this.ctx.onChange();
  }

  private walk(g: Guest, dt: number, now: number) {
    let step = SPION.SPEED * dt;
    while (step > 0 && g.path.length) {
      const t = g.path[0];
      const dx = t.x - g.x, dy = t.y - g.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.3) g.dir = dx > 0 ? 1 : -1;
      if (d <= step) {
        g.x = t.x;
        g.y = t.y;
        step -= d;
        g.path.shift();
      } else {
        g.x += (dx / d) * step;
        g.y += (dy / d) * step;
        step = 0;
      }
    }
    if (g.path.length) return;
    // Angekommen
    const npc = !g.owner || !this.ctx.isConnected(g.owner);
    if (npc && g.goal >= 0 && stationAt(g.x, g.y) === g.goal) return this.startUse(g, g.goal, now);
    if (npc) {
      const mate = this.chatMate(g);
      if (mate && Math.random() < 0.75) return this.startChat(g, mate, now + rand(3000, 9000));
    }
    this.stand(g, now, rand(800, 4500));
  }

  private stand(g: Guest, now: number, ms: number) {
    g.a = SP_A.STAND;
    g.path = [];
    g.goal = -1;
    g.using = -1;
    g.until = now + ms;
  }

  private chatMate(g: Guest) {
    let best: Guest | null = null, bd = SPION.CHAT_R;
    for (const o of this.guests) {
      if (o === g || o.a === SP_A.OUT || o.a === SP_A.WALK) continue;
      const d = Math.hypot(o.x - g.x, (o.y - g.y) * 1.5);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  private startChat(g: Guest, mate: Guest, until: number) {
    g.a = SP_A.CHAT;
    g.path = [];
    g.until = until;
    if (Math.abs(mate.x - g.x) > 1) g.dir = mate.x > g.x ? 1 : -1;
    // Ein stehender NPC dreht sich zum Gesprächspartner um
    const mateNpc = !mate.owner || !this.ctx.isConnected(mate.owner);
    if (mateNpc && mate.a === SP_A.STAND && Math.random() < 0.7) {
      mate.a = SP_A.CHAT;
      mate.until = Math.max(mate.until, Date.now() + rand(2500, 7000));
      if (Math.abs(mate.x - g.x) > 1) mate.dir = g.x > mate.x ? 1 : -1;
    }
  }

  private startUse(g: Guest, st: number, now: number) {
    g.a = SP_A.USE;
    g.path = [];
    g.using = st;
    g.until = now + SPION.USE_MS;
    const s = STATIONS[st];
    if (Math.abs(s.x - g.x) > 2) g.dir = s.x > g.x ? 1 : -1;
  }

  private goTo(g: Guest, x: number, y: number, now: number) {
    const path = findPath(g.x, g.y, x, y);
    if (!path.length) return false;
    g.path = path;
    g.a = SP_A.WALK;
    g.using = -1;
    g.until = now;
    return true;
  }

  private npcNext(g: Guest, now: number) {
    const r = Math.random();
    g.goal = -1;
    if (r < 0.3) {
      const st = Math.floor(Math.random() * STATIONS.length);
      const spot = stationSpot(st);
      if (this.goTo(g, spot.x, spot.y, now)) {
        g.goal = st;
        return;
      }
    } else if (r < 0.6) {
      const others = this.guests.filter((o) => o !== g && o.a !== SP_A.OUT && o.a !== SP_A.WALK && Math.hypot(o.x - g.x, o.y - g.y) < 170);
      const o = others[Math.floor(Math.random() * others.length)];
      const spot = o && besideSpot(o.x, o.y);
      if (spot && this.goTo(g, spot.x, spot.y, now)) return;
    }
    for (let k = 0; k < 6; k++) {
      const spot = randomSpot();
      if (Math.hypot(spot.x - g.x, spot.y - g.y) > 160) continue;
      if (this.goTo(g, spot.x, spot.y, now)) return;
    }
    this.stand(g, now, rand(1000, 3000));
  }

  private useDone(g: Guest, now: number) {
    const st = g.using;
    this.stand(g, now, rand(600, 2500));
    const p = g.owner ? this.ps.get(g.owner) : null;
    if (!p || p.out || st < 0 || !this.ctx.isConnected(p.id)) return;
    if (p.done[st]) return this.note(p, `${STATIONS[st].name} hattest du schon – gut getarnt!`);
    if (now < p.cooldownUntil) return this.note(p, `Zählt nicht – erst in ${Math.ceil((p.cooldownUntil - now) / 1000)} s wieder!`);
    p.done[st] = true;
    p.cooldownUntil = now + SPION.TASK_COOLDOWN_MS;
    p.score += SPION.POINTS.TASK;
    p.tasksTotal += 1;
    const count = p.done.filter(Boolean).length;
    if (count >= STATIONS.length) {
      p.score += SPION.POINTS.ALL;
      p.wins += 1;
      p.shown = count;
      this.winner = p.id;
      this.note(p, 'Alle Aufträge erledigt!');
      this.endRound('tasks');
      return;
    }
    this.note(p, `${STATIONS[st].name} erledigt! (${count}/${STATIONS.length})`);
    // Öffentlich erst etwas später – sonst wäre sofort klar, wer gerade dort stand
    const round = this.round;
    this.timers.later(rand(...SPION.PROGRESS_DELAY_MS), () => {
      if (this.round !== round || this.sub !== 'play') return;
      p.shown = Math.max(p.shown, count);
      this.news = { seq: ++this.seq, text: `${this.ctx.nameOf(p.id)} hat ${count} von ${STATIONS.length} Aufträgen!` };
      this.ctx.onChange();
    });
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.ps.get(id);
    if (!p || p.out || this.sub !== 'play') return;
    const g = this.guests[p.g];
    const now = Date.now();
    const pl = asRecord(payload);
    if (action === 'goto') {
      const x = Number(pl.x), y = Number(pl.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (!this.goTo(g, x, y, now)) this.note(p, 'Da kommst du nicht hin.');
    } else if (action === 'stop') {
      if (g.a === SP_A.WALK) this.stand(g, now, 0);
    } else if (action === 'chat') {
      if (g.a === SP_A.CHAT) this.stand(g, now, 0);
      else if (g.a === SP_A.STAND || g.a === SP_A.WALK) {
        const mate = this.chatMate(g);
        g.path = [];
        if (mate) this.startChat(g, mate, Infinity);
        else {
          g.a = SP_A.CHAT;
          g.until = Infinity;
        }
      }
    } else if (action === 'use') {
      if (g.a === SP_A.USE || g.a === SP_A.WET) return;
      const st = stationAt(g.x, g.y);
      if (st < 0) return this.note(p, 'Hier gibt es nichts zu tun.');
      this.startUse(g, st, now);
    } else if (action === 'throw') {
      const t = Math.floor(Number(pl.g));
      const tg = this.guests[t];
      if (!tg || t === p.g || tg.a === SP_A.OUT || p.balloons <= 0) return;
      if (this.throws.some((x) => x.hit === null && x.g === t)) return;
      p.balloons -= 1;
      const th: SpionThrow = { seq: ++this.seq, by: id, g: t, hit: null, victim: null };
      this.throws = [...this.throws, th].slice(-10);
      this.news = { seq: ++this.seq, text: `${this.ctx.nameOf(id)} wirft einen Wasserballon!` };
      const round = this.round;
      this.timers.later(SPION.FLY_MS, () => {
        if (this.round === round && this.sub === 'play') this.land(th, p);
      });
    }
    this.ctx.onChange();
  }

  private land(th: SpionThrow, thrower: P) {
    const now = Date.now();
    const g = this.guests[th.g];
    const victim = g.owner ? this.ps.get(g.owner)! : null;
    if (victim && victim.id !== thrower.id && !victim.out) {
      th.hit = true;
      th.victim = victim.id;
      victim.out = true;
      victim.outBy = thrower.id;
      g.a = SP_A.OUT;
      g.path = [];
      thrower.score += SPION.POINTS.UNMASK;
      thrower.unmasks += 1;
      this.tags.push({ g: g.i, id: victim.id, why: 'out', until: Infinity });
      this.note(victim, `${this.ctx.nameOf(thrower.id)} hat dich enttarnt!`);
      this.note(thrower, `Treffer! Das war ${this.ctx.nameOf(victim.id)}!`);
      this.news = { seq: ++this.seq, text: `ENTTARNT! ${this.ctx.nameOf(thrower.id)} erwischt ${this.ctx.nameOf(victim.id)}!` };
      this.throws = [...this.throws];
      this.ctx.onChange();
      if (this.alive().length <= 1) this.endRound('last');
      return;
    }
    th.hit = false;
    this.throws = [...this.throws];
    if (g.a !== SP_A.OUT) {
      g.a = SP_A.WET;
      g.path = [];
      g.using = -1;
      g.until = now + SPION.WET_MS;
    }
    // Fehlwurf: der Werfer fliegt kurz auf
    if (!thrower.out) {
      this.tags = this.tags.filter((t) => !(t.why === 'miss' && t.id === thrower.id));
      this.tags.push({ g: thrower.g, id: thrower.id, why: 'miss', until: now + SPION.EXPOSE_MS });
    }
    this.note(thrower, 'Daneben – ein echter Gast! Du bist kurz aufgeflogen ...');
    this.news = { seq: ++this.seq, text: `Daneben! ${this.ctx.nameOf(thrower.id)} hat einen echten Gast erwischt – und fliegt auf!` };
    this.ctx.onChange();
  }

  private note(p: P, text: string) {
    p.note = { text, seq: ++this.noteSeq };
  }

  // ---------------------------------------------------------------- Zustand

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const players: Record<string, SpionPlayer> = {};
    for (const p of this.ps.values()) {
      players[p.id] = { out: p.out, outBy: p.outBy, balloons: p.balloons, tasks: p.shown, score: p.score, unmasks: p.unmasks };
    }
    const state: SpionState = {
      sub: this.sub,
      endsIn: Math.max(0, this.deadline - now),
      round: this.round,
      rounds: this.rounds,
      guests: this.guests.map((g) => packGuest(g.x, g.y, g.a, g.dir, g.v)),
      players,
      throws: this.throws,
      tags: this.tags.map(({ g, id, why }) => ({ g, id, why })),
      news: this.news,
      winner: this.winner,
    };
    return { kind: 'spion', state };
  }

  privateFor(id: string): PrivateState {
    const p = this.ps.get(id);
    if (!p) return null;
    const g = this.guests[p.g];
    const now = Date.now();
    const priv: SpionPrivate = {
      g: p.g,
      done: [...p.done],
      cooldown: Math.max(0, p.cooldownUntil - now),
      near: g ? stationAt(g.x, g.y) : -1,
      using: g?.a === SP_A.USE ? Math.max(0, g.until - now) : 0,
      walking: g?.a === SP_A.WALK,
      chatting: g?.a === SP_A.CHAT,
      out: p.out,
      note: p.note,
    };
    return { kind: 'spion', state: priv };
  }

  playerDisconnected() {
    // Der Gast macht einfach als NPC weiter (siehe tick)
  }

  dispose() {
    this.timers.clear();
  }
}
