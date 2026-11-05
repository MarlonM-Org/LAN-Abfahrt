import type { MiniSnapshot } from '../shared/types';
import {
  CANDY_KINDS,
  SOURCE_TILES,
  STASHES,
  SUESS,
  SUESS_WALK,
  type SuessCandy,
  type SuessEvent,
  type SuessOutcome,
  type SuessState,
  type SuessStats,
  boxFree,
  distAt,
  inStash,
  moveSuess,
  suessBfs,
  suessGuardCount,
  suessSpawnEvery,
  suessSpeedFactor,
  suessTarget,
  tileCenter,
  tileOf,
} from '../shared/suess';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const TICK_MS = 50;
const EVENT_TTL = 2200;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Testen: kürzere Runden per Umgebungsvariable (z. B. SUESS_ROUND_MS=40000) */
const ROUND_MS = Number(process.env.SUESS_ROUND_MS) || SUESS.ROUND_MS;

interface Mover {
  x: number;
  y: number;
  sx: number;
  sy: number;
  dir: 1 | -1;
  moving: boolean;
}

interface Thief extends Mover {
  carry: number;
  state: 'run' | 'out';
  respawnAt: number;
  shieldUntil: number;
}

interface Guard extends Mover {
  a: number;
  sprintUntil: number;
  sprintReady: number;
}

interface Candy extends SuessCandy {
  /** Wer sie gerade fallen gelassen hat, darf sie erst nach `lockUntil` wieder nehmen */
  lockBy?: string;
  lockUntil?: number;
}

/**
 * Süßigkeiten-Klau (à la Animal Crossing: Sweet Day): Nachts im Ferienhaus plündern die Naschkatzen
 * Minibar und Kühlschrank und bringen die Beute in ihre Verstecke – je mehr man trägt, desto langsamer.
 * 1–2 Wächter jagen sie: Wer geschnappt wird, verliert alles. Ziel erreicht → Naschkatzen gewinnen,
 * Zeit um → Wächter gewinnen. Wächter wechseln jede Runde.
 */
export class SuessGame implements MiniGame {
  readonly kind = 'suess' as const;
  private sub: SuessState['sub'] = 'intro';
  private round = 0;
  private rounds: number;
  private guardCount: number;
  /** Reihenfolge, in der die Spieler Wächter werden */
  private rotation: string[];
  private thieves = new Map<string, Thief>();
  private guards = new Map<string, Guard>();
  private candy: Candy[] = [];
  private candySeq = 0;
  private events: (SuessEvent & { until: number })[] = [];
  private eventSeq = 0;
  private nextSpawn = 0;
  private target = 0;
  private total = 0;
  private roundCatches = 0;
  private points: Record<string, number>;
  private stats: Record<string, SuessStats>;
  private outcome: SuessOutcome | null = null;
  private history: SuessOutcome[] = [];
  private deadline = 0;
  private timers = new Timers();
  private lastTick = 0;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.guardCount = suessGuardCount(ids.length);
    // So viele Runden, dass möglichst jeder einmal Wächter ist (2–3)
    this.rounds = clamp(Math.ceil(ids.length / this.guardCount), 2, SUESS.MAX_ROUNDS);
    this.rotation = shuffle(ids);
    this.points = Object.fromEntries(ids.map((id) => [id, 0]));
    this.stats = Object.fromEntries(ids.map((id) => [id, { delivered: 0, caught: 0, catches: 0 }]));
    this.timers.every(TICK_MS, () => this.tick());
    this.startRound();
  }

  // ---------------------------------------------------------------- Ablauf

  private startRound() {
    this.round += 1;
    const start = ((this.round - 1) * this.guardCount) % this.ids.length;
    const guardIds = new Set<string>();
    for (let i = 0; guardIds.size < this.guardCount && i < this.ids.length; i++) guardIds.add(this.rotation[(start + i) % this.ids.length]);
    this.thieves.clear();
    this.guards.clear();
    this.candy = [];
    this.events = [];
    this.outcome = null;
    this.total = 0;
    this.roundCatches = 0;

    // Wächter im Flur, Naschkatzen abwechselnd in den beiden Verstecken
    const fromSpawn = suessBfs([SUESS.GUARD_SPAWN], true);
    const near = [...SUESS_WALK].sort((a, b) => distAt(fromSpawn, a.col, a.row) - distAt(fromSpawn, b.col, b.row));
    let gi = 0;
    let ti = 0;
    for (const id of this.ids) {
      if (guardIds.has(id)) {
        const t = near[gi++ * 2];
        const c = tileCenter(t.col, t.row);
        this.guards.set(id, { x: c.x, y: c.y, sx: 0, sy: 0, dir: 1, a: Math.PI / 2, moving: false, sprintUntil: 0, sprintReady: 0 });
      } else {
        const p = this.stashSpot(ti++);
        this.thieves.set(id, { ...p, sx: 0, sy: 0, dir: 1, moving: false, carry: 0, state: 'run', respawnAt: 0, shieldUntil: 0 });
      }
    }
    this.target = suessTarget(this.thieves.size);
    // Ein paar Süßigkeiten liegen schon bereit
    for (let i = 0; i < this.candyMax() * 0.7; i++) this.spawnCandy();

    this.sub = 'intro';
    this.deadline = Date.now() + SUESS.INTRO_MS;
    this.lastTick = Date.now();
    this.ctx.onChange();
  }

  private stashSpot(i: number) {
    const s = STASHES[i % STASHES.length];
    const t = s.tiles[Math.floor(i / STASHES.length) % s.tiles.length];
    const c = tileCenter(t.col, t.row);
    return { x: c.x + (Math.random() - 0.5) * 4, y: c.y + (Math.random() - 0.5) * 4 };
  }

  private candyMax() {
    return SUESS.CANDY_BASE + SUESS.CANDY_PER_THIEF * this.thieves.size;
  }

  private spawnCandy() {
    const fromStash = suessBfs(STASHES.flatMap((s) => s.tiles));
    const atSource = Math.random() < 0.4;
    const pool = atSource ? SOURCE_TILES : SUESS_WALK.filter((t) => distAt(fromStash, t.col, t.row) >= 5);
    const used = new Set(this.candy.map((c) => `${tileOf(c.x, c.y).col},${tileOf(c.x, c.y).row}`));
    const free = pool.filter((t) => !used.has(`${t.col},${t.row}`));
    const t = free[Math.floor(Math.random() * free.length)];
    if (!t) return;
    const c = tileCenter(t.col, t.row);
    const r = Math.random();
    // An Minibar/Kühlschrank gibt es öfter die großen Sachen
    const kind = atSource ? (r < 0.3 ? 3 : r < 0.7 ? 2 : r < 0.85 ? 1 : 0) : r < 0.08 ? 3 : r < 0.3 ? 2 : r < 0.65 ? 1 : 0;
    this.candy.push({ id: ++this.candySeq, x: Math.round(c.x + (Math.random() - 0.5) * 6), y: Math.round(c.y + (Math.random() - 0.5) * 6), t: kind });
  }

  private startPlay() {
    const now = Date.now();
    this.sub = 'play';
    this.deadline = now + ROUND_MS;
    this.nextSpawn = now + suessSpawnEvery(this.thieves.size);
    this.ctx.onChange();
  }

  private endRound(winner: SuessOutcome['winner']) {
    const now = Date.now();
    this.outcome = { winner, total: this.total, target: this.target, catches: this.roundCatches, leftMs: Math.max(0, this.deadline - now) };
    this.history.push(this.outcome);
    if (process.env.SUESS_LOG) console.log('[suess]', this.thieves.size, 'Naschkatzen', JSON.stringify(this.outcome));
    const winners = winner === 'thieves' ? this.thieves.keys() : this.guards.keys();
    for (const id of winners) this.points[id] += SUESS.WIN_POINTS;
    for (const t of this.thieves.values()) t.sx = t.sy = 0;
    for (const g of this.guards.values()) g.sx = g.sy = 0;
    this.sub = 'roundEnd';
    this.deadline = now + SUESS.ROUND_END_MS;
    this.ctx.onChange();
  }

  private finishGame() {
    this.sub = 'over';
    this.timers.clear();
    this.ctx.onChange();
    const thiefWins = this.history.filter((h) => h.winner === 'thieves').length;
    const guardWins = this.history.length - thiefWins;
    this.timers.later(2500, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => this.points[id]),
        details: Object.fromEntries(
          this.ids.map((id) => {
            const s = this.stats[id];
            // max. 16 Zeichen (Ergebnis-Tafel)
            const extra = s.catches > 0 ? `${s.catches}x Fang` : `${s.delivered} Bonb.`;
            return [id, `${this.points[id]} P · ${extra}`];
          }),
        ),
        subtitle:
          thiefWins === this.history.length
            ? 'Die Naschkatzen haben jede Runde die Minibar leergeräumt!'
            : guardWins === this.history.length
              ? 'Die Wächter haben jede Runde die Süßigkeiten gerettet!'
              : `Naschkatzen ${thiefWins} : ${guardWins} Wächter`,
      }),
    );
  }

  // ---------------------------------------------------------------- Spielschleife

  private tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (this.sub === 'intro') {
      if (now >= this.deadline) this.startPlay();
      else this.ctx.onChange();
      return;
    }
    if (this.sub === 'roundEnd') {
      if (now >= this.deadline) {
        if (this.round >= this.rounds) this.finishGame();
        else this.startRound();
      }
      return;
    }
    if (this.sub !== 'play') return;

    // Bewegung
    for (const [id, t] of this.thieves) {
      if (t.state === 'out') {
        if (now >= t.respawnAt) this.respawn(id, t, now);
        continue;
      }
      this.move(t, SUESS.THIEF_SPEED * suessSpeedFactor(t.carry), dt, false);
    }
    for (const g of this.guards.values()) {
      this.move(g, now < g.sprintUntil ? SUESS.SPRINT_SPEED : SUESS.GUARD_SPEED, dt, true);
      if (g.moving) g.a = Math.atan2(g.sy, g.sx);
    }
    this.separate();

    for (const [id, t] of this.thieves) {
      if (t.state !== 'run') continue;
      // Aufsammeln
      for (let i = this.candy.length - 1; i >= 0; i--) {
        const c = this.candy[i];
        if (c.lockBy === id && now < (c.lockUntil ?? 0)) continue;
        const v = CANDY_KINDS[c.t].v;
        if (t.carry + v > SUESS.CARRY_MAX) continue;
        if (Math.hypot(c.x - t.x, c.y - (t.y + 2)) > SUESS.PICK_DIST) continue;
        t.carry += v;
        this.candy.splice(i, 1);
      }
      // Abliefern im Versteck
      if (t.carry > 0 && inStash(t.x, t.y)) {
        this.total += t.carry;
        this.stats[id].delivered += t.carry;
        this.points[id] += t.carry * SUESS.POINT_PER_CANDY;
        this.event({ kind: 'deposit', id, n: t.carry, x: t.x, y: t.y }, now);
        t.carry = 0;
        if (this.total >= this.target) return this.endRound('thieves');
      }
    }

    // Fangen
    for (const [gid, g] of this.guards) {
      for (const [id, t] of this.thieves) {
        if (t.state !== 'run' || now < t.shieldUntil || inStash(t.x, t.y)) continue;
        if (Math.hypot(g.x - t.x, g.y - t.y) > SUESS.CATCH_DIST) continue;
        this.catchThief(id, t, gid, now);
      }
    }

    if (now >= this.deadline) return this.endRound('guards');

    // Nachschub aus Minibar & Co.
    if (now >= this.nextSpawn) {
      this.nextSpawn = now + suessSpawnEvery(this.thieves.size);
      if (this.candy.length < this.candyMax()) this.spawnCandy();
    }
    this.events = this.events.filter((e) => e.until > now);
    this.ctx.onChange();
  }

  private catchThief(id: string, t: Thief, by: string, now: number) {
    const n = t.carry;
    this.scatter(t.x, t.y, Math.floor(n * SUESS.CATCH_SPILL), id, now);
    this.event({ kind: 'catch', id, by, n, x: t.x, y: t.y }, now);
    t.carry = 0;
    t.state = 'out';
    t.sx = t.sy = 0;
    t.moving = false;
    t.respawnAt = now + SUESS.RESPAWN_MS;
    this.stats[id].caught += 1;
    this.stats[by].catches += 1;
    this.points[by] += SUESS.POINT_PER_CATCH;
    this.roundCatches += 1;
  }

  private respawn(id: string, t: Thief, now: number) {
    // im Versteck, das am weitesten vom nächsten Wächter weg ist
    const gs = [...this.guards.values()];
    const best = STASHES.map((s, i) => ({ i, d: Math.min(...gs.map((g) => Math.hypot(g.x - s.x, g.y - s.y)), 9999) })).sort((a, b) => b.d - a.d)[0];
    const p = this.stashSpot(best.i + STASHES.length * Math.floor(Math.random() * 4));
    t.x = p.x;
    t.y = p.y;
    t.state = 'run';
    t.shieldUntil = now + SUESS.SHIELD_MS;
    void id;
  }

  /** Verteilt `value` Süßigkeiten rund um (x, y) auf begehbare Stellen */
  private scatter(x: number, y: number, value: number, by: string, now: number) {
    let left = value;
    let k = 0;
    while (left > 0 && k < 40) {
      k++;
      const kind = left >= 3 && Math.random() < 0.3 ? 3 : left >= 2 && Math.random() < 0.4 ? 2 : Math.random() < 0.5 ? 1 : 0;
      const ang = Math.random() * Math.PI * 2;
      const r = 6 + Math.random() * 12;
      let cx = x + Math.cos(ang) * r;
      let cy = y + Math.sin(ang) * r;
      if (!boxFree(cx, cy, false, 2) || inStash(cx, cy)) {
        cx = x + (Math.random() - 0.5) * 6;
        cy = y + (Math.random() - 0.5) * 6;
        if (!boxFree(cx, cy, false, 2) || inStash(cx, cy)) continue;
      }
      this.candy.push({ id: ++this.candySeq, x: Math.round(cx), y: Math.round(cy), t: kind, lockBy: by, lockUntil: now + SUESS.DROP_LOCK_MS });
      left -= CANDY_KINDS[kind].v;
    }
  }

  private event(e: Omit<SuessEvent, 'seq'>, now: number) {
    this.events.push({ ...e, x: Math.round(e.x), y: Math.round(e.y), seq: ++this.eventSeq, until: now + EVENT_TTL });
  }

  private move(m: Mover, speed: number, dt: number, guard: boolean) {
    const len = Math.hypot(m.sx, m.sy);
    m.moving = len > 0.15;
    if (!m.moving) return;
    const k = (speed * dt * Math.min(1, len)) / len;
    moveSuess(m, m.sx * k, m.sy * k, guard);
    if (Math.abs(m.sx) > 0.2) m.dir = m.sx > 0 ? 1 : -1;
  }

  /** Wächter schieben sich sanft auseinander (Naschkatzen dürfen sich drängeln – sonst verstopfen die Türen) */
  private separate() {
    const sep = (list: Mover[], guard: boolean) => {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d >= 8 || d === 0) continue;
          const push = (8 - d) / 4;
          moveSuess(a, (-dx / d) * push, (-dy / d) * push, guard);
          moveSuess(b, (dx / d) * push, (dy / d) * push, guard);
        }
      }
    };
    sep([...this.guards.values()], true);
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const now = Date.now();
    const t = this.thieves.get(id);
    const g = this.guards.get(id);
    if (!t && !g) return;
    if (action === 'stick') {
      const pl = asRecord(payload);
      const m: Mover = (t ?? g)!;
      if (t && t.state !== 'run') return;
      m.sx = clamp(Number(pl.x) || 0, -1, 1);
      m.sy = clamp(Number(pl.y) || 0, -1, 1);
    } else if (action === 'sprint' && g && this.sub === 'play') {
      if (now < g.sprintReady) return;
      g.sprintUntil = now + SUESS.SPRINT_MS;
      g.sprintReady = now + SUESS.SPRINT_COOLDOWN;
      this.ctx.onChange();
    } else if (action === 'drop' && t && this.sub === 'play' && t.state === 'run' && t.carry > 0) {
      this.scatter(t.x, t.y, t.carry, id, now);
      this.event({ kind: 'drop', id, n: t.carry, x: t.x, y: t.y }, now);
      t.carry = 0;
      this.ctx.onChange();
    }
  }

  // ---------------------------------------------------------------- Zustand

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const state: SuessState = {
      sub: this.sub,
      endsIn: Math.max(0, this.deadline - now),
      round: this.round,
      rounds: this.rounds,
      target: this.target,
      total: this.total,
      thieves: Object.fromEntries(
        [...this.thieves.entries()].map(([id, t]) => [
          id,
          {
            x: r1(t.x),
            y: r1(t.y),
            dir: t.dir,
            moving: t.moving,
            carry: t.carry,
            state: t.state,
            respawnIn: t.state === 'out' ? Math.max(0, t.respawnAt - now) : 0,
            shield: t.state === 'run' && now < t.shieldUntil,
            safe: inStash(t.x, t.y),
          },
        ]),
      ),
      guards: Object.fromEntries(
        [...this.guards.entries()].map(([id, g]) => [
          id,
          { x: r1(g.x), y: r1(g.y), dir: g.dir, a: r1(g.a), moving: g.moving, sprinting: now < g.sprintUntil, sprintLeft: Math.max(0, g.sprintReady - now) },
        ]),
      ),
      candy: this.candy.map(({ id, x, y, t }) => ({ id, x, y, t })),
      events: this.events.map(({ until: _u, ...e }) => e),
      points: this.points,
      stats: this.stats,
      outcome: this.outcome,
      history: this.history,
    };
    return { kind: 'suess', state };
  }

  playerDisconnected(id: string) {
    const m = this.thieves.get(id) ?? this.guards.get(id);
    if (m) m.sx = m.sy = 0;
  }

  dispose() {
    this.timers.clear();
  }
}
