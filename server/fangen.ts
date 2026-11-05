import { fairRoleScores } from './rolefair';
import type { FangenHunter, FangenOutcome, FangenPrint, FangenState, MiniSnapshot, PrivateState } from '../shared/types';
import {
  FANGEN,
  WALK_TILES,
  bfsFrom,
  distAt,
  fangenRoundMs,
  heatLevel,
  isWalkTile,
  moveInMaze,
  tileCenter,
  tileOf,
} from '../shared/fangen';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const TICK_MS = 50;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface Mover {
  x: number;
  y: number;
  sx: number;
  sy: number;
  dir: 1 | -1;
  moving: boolean;
}

interface Runner extends Mover {
  decoyReady: number;
  decoy: { col: number; row: number; left: number } | null;
  /** Gefangen (Ergebnis steht dann schon fest) */
  outcome: FangenOutcome | null;
}

/** Ab so vielen Spielern laufen zwei Animateure gleichzeitig */
const TWO_RUNNERS_FROM = 7;

interface Hunter extends Mover {
  sprintUntil: number;
  sprintReady: number;
  heat: FangenHunter['heat'];
}

/**
 * Urlaubs-Fangen (inspiriert von "Mario Chase"): Ein Spieler ist der Flüchtling (Animateur mit
 * Sonnenhut) und auf dem TV unsichtbar – nur sein eigenes Handy zeigt die ganze Karte.
 * Alle anderen jagen ihn mit Fußspuren und "warm/kalt"-Fährte und müssen sich zurufen.
 * Ab 7 Spielern verstecken sich zwei Animateure gleichzeitig; die Runde endet, wenn beide
 * gefangen sind oder die Zeit um ist.
 */
export class FangenGame implements MiniGame {
  readonly kind = 'fangen' as const;
  private sub: FangenState['sub'] = 'intro';
  private round = 0;
  private rounds: number;
  private order: string[];
  private runnerCount: number;
  private runners = new Map<string, Runner>();
  private hunters = new Map<string, Hunter>();
  private prints: (FangenPrint & { until: number })[] = [];
  private printSeq = 0;
  private nextPrint = 0;
  private points: Record<string, number>;
  /** Anteil der Punkte aus der Animateur-Rolle (für die faire Wertung) */
  private runnerPts: Record<string, number>;
  private huntedRounds: Record<string, number>;
  private outcomes: FangenOutcome[] = [];
  private history: FangenOutcome[] = [];
  private deadline = 0;
  private chaseStart = 0;
  private timers = new Timers();
  private lastTick = 0;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.runnerCount = ids.length >= TWO_RUNNERS_FROM ? 2 : 1;
    this.rounds = Math.min(Math.ceil(ids.length / this.runnerCount), FANGEN.MAX_ROUNDS);
    this.order = shuffle(ids);
    this.points = Object.fromEntries(ids.map((id) => [id, 0]));
    this.runnerPts = Object.fromEntries(ids.map((id) => [id, 0]));
    this.huntedRounds = Object.fromEntries(ids.map((id) => [id, 0]));
    this.timers.every(TICK_MS, () => this.tick());
    this.startRound();
  }

  // ---------------------------------------------------------------- Ablauf

  private startRound() {
    this.round += 1;
    const rids: string[] = [];
    for (let j = 0; j < this.runnerCount; j++) rids.push(this.order[((this.round - 1) * this.runnerCount + j) % this.order.length]);
    this.outcomes = [];
    this.prints = [];
    this.hunters.clear();
    this.runners.clear();

    // Fänger starten an der Rezeption (Holzdeck), dicht beieinander
    const spawn = FANGEN.HUNTER_SPAWN;
    const fromSpawn = bfsFrom([spawn]);
    const near = [...WALK_TILES].sort((a, b) => distAt(fromSpawn, a.col, a.row) - distAt(fromSpawn, b.col, b.row));
    const hunterIds = this.ids.filter((id) => !rids.includes(id));
    for (const id of hunterIds) this.huntedRounds[id] += 1;
    hunterIds.forEach((id, i) => {
      const t = near[i % near.length];
      const c = tileCenter(t.col, t.row);
      this.hunters.set(id, { x: c.x, y: c.y, sx: 0, sy: 0, dir: 1, moving: false, sprintUntil: 0, sprintReady: 0, heat: 0 });
    });

    // Flüchtlinge starten weit weg von der Rezeption (und nicht nebeneinander)
    const far = WALK_TILES.filter((t) => distAt(fromSpawn, t.col, t.row) >= 16);
    const used: { x: number; y: number }[] = [];
    for (const id of rids) {
      const opts = far.filter((t) => used.every((u) => Math.hypot(tileCenter(t.col, t.row).x - u.x, tileCenter(t.col, t.row).y - u.y) > 120));
      const pool = opts.length ? opts : far;
      const t = pool[Math.floor(Math.random() * pool.length)] ?? WALK_TILES[0];
      const c = tileCenter(t.col, t.row);
      used.push(c);
      this.runners.set(id, { x: c.x, y: c.y, sx: 0, sy: 0, dir: 1, moving: false, decoyReady: 0, decoy: null, outcome: null });
    }

    this.sub = 'intro';
    this.deadline = Date.now() + FANGEN.INTRO_MS;
    this.lastTick = Date.now();
    this.ctx.onChange();
  }

  private startChase() {
    const now = Date.now();
    this.sub = 'chase';
    this.chaseStart = now;
    this.deadline = now + fangenRoundMs(this.hunters.size);
    this.nextPrint = now + FANGEN.PRINT_EVERY;
    this.ctx.onChange();
  }

  /** Ergebnis für einen Animateur festhalten (gefangen von `by` oder entkommen) */
  private settle(id: string, r: Runner, by: string | null, now: number) {
    const survivedMs = Math.min(now, this.deadline) - this.chaseStart;
    const caught = by !== null;
    r.outcome = { runner: id, caught, by, survivedMs, x: Math.round(r.x), y: Math.round(r.y) };
    r.sx = r.sy = 0;
    r.moving = false;
    r.decoy = null;
    this.outcomes.push(r.outcome);
    this.history.push(r.outcome);
    // Punkte: Flüchtling nach Überlebenszeit + Bonus fürs Entkommen; Fänger: Team-Punkte + Fang-Bonus
    const runPts = Math.floor(survivedMs / FANGEN.SURVIVE_MS_PER_POINT) + (caught ? 0 : FANGEN.WIN_BONUS);
    this.points[id] += runPts;
    this.runnerPts[id] += runPts;
    if (by) {
      for (const hid of this.hunters.keys()) this.points[hid] += FANGEN.TEAM_POINTS;
      this.points[by] += FANGEN.CATCH_BONUS;
    }
  }

  private endRound() {
    const now = Date.now();
    for (const [id, r] of this.runners) if (!r.outcome) this.settle(id, r, null, now);
    // Gefangene zuerst nicht nach vorne sortieren: Reihenfolge wie `runners`
    const order = [...this.runners.keys()];
    this.outcomes.sort((a, b) => order.indexOf(a.runner) - order.indexOf(b.runner));
    this.prints = [];
    this.sub = 'roundEnd';
    this.deadline = now + FANGEN.ROUND_END_MS;
    this.ctx.onChange();
  }

  private finishGame() {
    this.sub = 'over';
    this.timers.clear();
    this.ctx.onChange();
    const escaped = new Map<string, number>();
    const catches = new Map<string, number>();
    for (const h of this.history) {
      if (!h.caught) escaped.set(h.runner, (escaped.get(h.runner) ?? 0) + 1);
      if (h.by) catches.set(h.by, (catches.get(h.by) ?? 0) + 1);
    }
    const caughtCount = this.history.filter((h) => h.caught).length;
    // Mehr Spieler als Runden: Animateur-Punkte nur unter Animateuren vergleichen (sonst entscheidet das Los)
    const fair = fairRoleScores(this.ids, this.rounds, this.points, this.runnerPts, this.huntedRounds, this.history.map((h) => h.runner));
    this.timers.later(2500, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => fair[id]),
        details: Object.fromEntries(
          this.ids.map((id) => {
            // max. 16 Zeichen (Ergebnis-Tafel)
            const extra = escaped.get(id) ? ' Flucht' : catches.get(id) ? ` ${catches.get(id)}× Fang` : '';
            return [id, `${Math.round(fair[id])} Pkt${extra}`];
          }),
        ),
        subtitle:
          caughtCount === this.history.length
            ? 'Kein Animateur ist entkommen!'
            : caughtCount === 0
              ? 'Die Animateure waren zu schnell für euch!'
              : `${caughtCount} von ${this.history.length} Flüchtlingen geschnappt.`,
      }),
    );
  }

  // ---------------------------------------------------------------- Spielschleife

  private tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (this.sub === 'intro') {
      // Vorsprung: Nur die Flüchtlinge dürfen schon laufen
      for (const r of this.runners.values()) this.move(r, FANGEN.RUNNER_SPEED, dt);
      if (now >= this.deadline) this.startChase();
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
    if (this.sub !== 'chase') return;

    const active = [...this.runners.entries()].filter(([, r]) => !r.outcome);
    for (const [, r] of active) this.move(r, FANGEN.RUNNER_SPEED, dt);
    for (const h of this.hunters.values()) this.move(h, now < h.sprintUntil ? FANGEN.SPRINT_SPEED : FANGEN.HUNTER_SPEED, dt);
    this.separateHunters();

    // Fangen? (Fährte zeigt den nächsten Animateur, der noch frei ist)
    for (const h of this.hunters.values()) {
      const d = Math.min(Infinity, ...active.map(([, r]) => Math.hypot(h.x - r.x, h.y - r.y)));
      h.heat = heatLevel(d) as Hunter['heat'];
    }
    for (const [rid, r] of active) {
      let catcher: string | null = null;
      let best = Infinity;
      for (const [id, h] of this.hunters) {
        const d = Math.hypot(h.x - r.x, h.y - r.y);
        if (d < FANGEN.CATCH_DIST && d < best) {
          best = d;
          catcher = id;
        }
      }
      if (catcher) this.settle(rid, r, catcher, now);
    }
    if ([...this.runners.values()].every((r) => r.outcome) || now >= this.deadline) return this.endRound();

    // Fußspuren (echte + ggf. falsche gleichzeitig, damit man sie nicht unterscheiden kann)
    if (now >= this.nextPrint) {
      this.nextPrint = now + FANGEN.PRINT_EVERY;
      for (const [, r] of this.runners) {
        if (r.outcome) continue;
        const angle = Math.atan2(r.sy, r.sx || r.dir * 0.01);
        this.addPrint(r.x, r.y, angle, now);
        if (r.decoy) this.advanceDecoy(r, now);
      }
    }
    this.prints = this.prints.filter((p) => p.until > now);
    this.ctx.onChange();
  }

  private move(m: Mover, speed: number, dt: number) {
    const len = Math.hypot(m.sx, m.sy);
    m.moving = len > 0.15;
    if (!m.moving) return;
    const k = (speed * dt * Math.min(1, len)) / len;
    moveInMaze(m, m.sx * k, m.sy * k);
    if (Math.abs(m.sx) > 0.2) m.dir = m.sx > 0 ? 1 : -1;
  }

  /** Fänger schieben sich sanft auseinander (sonst stehen 11 Figuren übereinander) */
  private separateHunters() {
    const list = [...this.hunters.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= 8 || d === 0) continue;
        const push = (8 - d) / 4;
        moveInMaze(a, (-dx / d) * push, (-dy / d) * push);
        moveInMaze(b, (dx / d) * push, (dy / d) * push);
      }
    }
  }

  private addPrint(x: number, y: number, angle: number, now: number) {
    this.prints.push({
      id: ++this.printSeq,
      x: Math.round(x + (Math.random() - 0.5) * 6),
      y: Math.round(y + (Math.random() - 0.5) * 6),
      angle: Math.round(angle * 10) / 10,
      ttl: FANGEN.PRINT_TTL,
      until: now + FANGEN.PRINT_TTL,
    });
  }

  /** Ablenkung: eine falsche Spur, die ein paar Fußspur-Takte lang woanders "weiterläuft" */
  private startDecoy(r: Runner) {
    const me = tileOf(r.x, r.y);
    const fromMe = bfsFrom([me]);
    const hunterTiles = [...this.hunters.values()].map((h) => tileOf(h.x, h.y));
    const fromHunters = bfsFrom(hunterTiles);
    const options = WALK_TILES.filter((t) => distAt(fromMe, t.col, t.row) >= 8 && distAt(fromHunters, t.col, t.row) >= 3);
    const pick = options[Math.floor(Math.random() * options.length)] ?? WALK_TILES[Math.floor(Math.random() * WALK_TILES.length)];
    r.decoy = { col: pick.col, row: pick.row, left: 3 };
  }

  private advanceDecoy(r: Runner, now: number) {
    const d = r.decoy!;
    const prev = tileCenter(d.col, d.row);
    // zufällig 1–2 Kacheln weiter
    for (let s = 0; s < 2; s++) {
      const nb = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].filter(([dc, dr]) => isWalkTile(d.col + dc, d.row + dr));
      const [dc, dr] = nb[Math.floor(Math.random() * nb.length)] ?? [0, 0];
      d.col += dc;
      d.row += dr;
    }
    const c = tileCenter(d.col, d.row);
    const angle = Math.atan2(c.y - prev.y, c.x - prev.x || 0.01);
    this.addPrint(c.x, c.y, angle, now);
    d.left -= 1;
    if (d.left <= 0) r.decoy = null;
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const now = Date.now();
    const r = this.runners.get(id);
    const isRunner = !!r;
    const h = this.hunters.get(id);
    if (!isRunner && !h) return;
    if (action === 'stick') {
      if (r?.outcome) return;
      const pl = asRecord(payload);
      const m: Mover = r ?? h!;
      m.sx = clamp(Number(pl.x) || 0, -1, 1);
      m.sy = clamp(Number(pl.y) || 0, -1, 1);
    } else if (action === 'sprint' && h && this.sub === 'chase') {
      if (now < h.sprintReady) return;
      h.sprintUntil = now + FANGEN.SPRINT_MS;
      h.sprintReady = now + FANGEN.SPRINT_COOLDOWN;
    } else if (action === 'decoy' && r && !r.outcome && this.sub === 'chase') {
      if (now < r.decoyReady || r.decoy) return;
      r.decoyReady = now + FANGEN.DECOY_COOLDOWN;
      this.startDecoy(r);
      this.ctx.onChange();
    }
  }

  // ---------------------------------------------------------------- Zustand

  snapshot(): MiniSnapshot {
    const now = Date.now();
    return {
      kind: 'fangen',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - now),
        round: this.round,
        rounds: this.rounds,
        runner: [...this.runners.keys()][0] ?? '',
        runners: [...this.runners.keys()],
        // WICHTIG: Die Position des Flüchtlings steht hier NIE drin (außer im Rundenergebnis)
        hunters: Object.fromEntries(
          [...this.hunters.entries()].map(([id, h]) => [
            id,
            {
              x: Math.round(h.x * 10) / 10,
              y: Math.round(h.y * 10) / 10,
              dir: h.dir,
              moving: h.moving,
              sprintLeft: Math.max(0, h.sprintReady - now),
              sprinting: now < h.sprintUntil,
              heat: this.sub === 'chase' ? h.heat : 0,
            },
          ]),
        ),
        prints: this.prints.map(({ id, x, y, angle, until }) => ({ id, x, y, angle, ttl: Math.max(0, until - now) })),
        points: this.points,
        outcome: this.sub === 'roundEnd' || this.sub === 'over' ? this.outcomes[0] ?? null : null,
        outcomes: this.outcomes,
      },
    };
  }

  privateFor(id: string): PrivateState {
    const r = this.runners.get(id);
    if (!r || this.sub === 'over') return null;
    const mate = [...this.runners.entries()].find(([oid]) => oid !== id)?.[1];
    return {
      kind: 'fangen',
      state: {
        role: 'runner',
        x: Math.round(r.x * 10) / 10,
        y: Math.round(r.y * 10) / 10,
        dir: r.dir,
        decoyLeft: Math.max(0, r.decoyReady - Date.now()),
        decoyActive: !!r.decoy,
        caught: !!r.outcome?.caught,
        mate: mate ? { x: Math.round(mate.x), y: Math.round(mate.y), caught: !!mate.outcome?.caught } : null,
      },
    };
  }

  playerDisconnected(id: string) {
    const m = this.runners.get(id) ?? this.hunters.get(id);

    if (m) m.sx = m.sy = 0;
  }

  dispose() {
    this.timers.clear();
  }
}
