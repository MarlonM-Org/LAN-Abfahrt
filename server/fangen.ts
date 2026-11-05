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

interface Hunter extends Mover {
  sprintUntil: number;
  sprintReady: number;
  heat: FangenHunter['heat'];
}

/**
 * Urlaubs-Fangen (inspiriert von "Mario Chase"): Ein Spieler ist der Flüchtling (Animateur mit
 * Sonnenhut) und auf dem TV unsichtbar – nur sein eigenes Handy zeigt die ganze Karte.
 * Alle anderen jagen ihn mit Fußspuren und "warm/kalt"-Fährte und müssen sich zurufen.
 */
export class FangenGame implements MiniGame {
  readonly kind = 'fangen' as const;
  private sub: FangenState['sub'] = 'intro';
  private round = 0;
  private rounds: number;
  private order: string[];
  private runnerId = '';
  private runner: Mover = { x: 0, y: 0, sx: 0, sy: 0, dir: 1, moving: false };
  private hunters = new Map<string, Hunter>();
  private prints: (FangenPrint & { until: number })[] = [];
  private printSeq = 0;
  private nextPrint = 0;
  private decoyReady = 0;
  private decoy: { col: number; row: number; left: number } | null = null;
  private points: Record<string, number>;
  /** Anteil der Punkte aus der Animateur-Rolle (für die faire Wertung) */
  private runnerPts: Record<string, number>;
  private huntedRounds: Record<string, number>;
  private outcome: FangenOutcome | null = null;
  private history: FangenOutcome[] = [];
  private deadline = 0;
  private chaseStart = 0;
  private timers = new Timers();
  private lastTick = 0;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.rounds = Math.min(ids.length, FANGEN.MAX_ROUNDS);
    this.order = shuffle(ids).slice(0, this.rounds);
    this.points = Object.fromEntries(ids.map((id) => [id, 0]));
    this.runnerPts = Object.fromEntries(ids.map((id) => [id, 0]));
    this.huntedRounds = Object.fromEntries(ids.map((id) => [id, 0]));
    this.timers.every(TICK_MS, () => this.tick());
    this.startRound();
  }

  // ---------------------------------------------------------------- Ablauf

  private startRound() {
    this.round += 1;
    this.runnerId = this.order[this.round - 1];
    this.outcome = null;
    this.prints = [];
    this.decoy = null;
    this.decoyReady = 0;
    this.hunters.clear();

    // Fänger starten an der Rezeption (Holzdeck), dicht beieinander
    const spawn = FANGEN.HUNTER_SPAWN;
    const fromSpawn = bfsFrom([spawn]);
    const near = [...WALK_TILES].sort((a, b) => distAt(fromSpawn, a.col, a.row) - distAt(fromSpawn, b.col, b.row));
    const hunterIds = this.ids.filter((id) => id !== this.runnerId);
    for (const id of hunterIds) this.huntedRounds[id] += 1;
    hunterIds.forEach((id, i) => {
      const t = near[i % near.length];
      const c = tileCenter(t.col, t.row);
      this.hunters.set(id, { x: c.x, y: c.y, sx: 0, sy: 0, dir: 1, moving: false, sprintUntil: 0, sprintReady: 0, heat: 0 });
    });

    // Flüchtling startet weit weg von der Rezeption
    const far = WALK_TILES.filter((t) => distAt(fromSpawn, t.col, t.row) >= 16);
    const t = far[Math.floor(Math.random() * far.length)] ?? WALK_TILES[0];
    const c = tileCenter(t.col, t.row);
    this.runner = { x: c.x, y: c.y, sx: 0, sy: 0, dir: 1, moving: false };

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

  private endRound(by: string | null) {
    const now = Date.now();
    const survivedMs = Math.min(now, this.deadline) - this.chaseStart;
    const caught = by !== null;
    this.outcome = { runner: this.runnerId, caught, by, survivedMs, x: Math.round(this.runner.x), y: Math.round(this.runner.y) };
    this.history.push(this.outcome);
    // Punkte: Flüchtling nach Überlebenszeit + Bonus fürs Entkommen; Fänger: Team-Punkte + Fang-Bonus
    const runPts = Math.floor(survivedMs / FANGEN.SURVIVE_MS_PER_POINT) + (caught ? 0 : FANGEN.WIN_BONUS);
    this.points[this.runnerId] += runPts;
    this.runnerPts[this.runnerId] += runPts;
    if (by) {
      for (const id of this.hunters.keys()) this.points[id] += FANGEN.TEAM_POINTS;
      this.points[by] += FANGEN.CATCH_BONUS;
    }
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
      // Vorsprung: Nur der Flüchtling darf schon laufen
      this.move(this.runner, FANGEN.RUNNER_SPEED, dt);
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

    this.move(this.runner, FANGEN.RUNNER_SPEED, dt);
    for (const h of this.hunters.values()) this.move(h, now < h.sprintUntil ? FANGEN.SPRINT_SPEED : FANGEN.HUNTER_SPEED, dt);
    this.separateHunters();

    // Fangen?
    let catcher: string | null = null;
    let best = Infinity;
    for (const [id, h] of this.hunters) {
      const d = Math.hypot(h.x - this.runner.x, h.y - this.runner.y);
      h.heat = heatLevel(d) as Hunter['heat'];
      if (d < FANGEN.CATCH_DIST && d < best) {
        best = d;
        catcher = id;
      }
    }
    if (catcher) return this.endRound(catcher);
    if (now >= this.deadline) return this.endRound(null);

    // Fußspuren (echte + ggf. falsche gleichzeitig, damit man sie nicht unterscheiden kann)
    if (now >= this.nextPrint) {
      this.nextPrint = now + FANGEN.PRINT_EVERY;
      const angle = Math.atan2(this.runner.sy, this.runner.sx || this.runner.dir * 0.01);
      this.addPrint(this.runner.x, this.runner.y, angle, now);
      if (this.decoy) this.advanceDecoy(now);
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
  private startDecoy() {
    const me = tileOf(this.runner.x, this.runner.y);
    const fromMe = bfsFrom([me]);
    const hunterTiles = [...this.hunters.values()].map((h) => tileOf(h.x, h.y));
    const fromHunters = bfsFrom(hunterTiles);
    const options = WALK_TILES.filter((t) => distAt(fromMe, t.col, t.row) >= 8 && distAt(fromHunters, t.col, t.row) >= 3);
    const pick = options[Math.floor(Math.random() * options.length)] ?? WALK_TILES[Math.floor(Math.random() * WALK_TILES.length)];
    this.decoy = { col: pick.col, row: pick.row, left: 3 };
  }

  private advanceDecoy(now: number) {
    const d = this.decoy!;
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
    if (d.left <= 0) this.decoy = null;
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const now = Date.now();
    const isRunner = id === this.runnerId;
    const h = this.hunters.get(id);
    if (!isRunner && !h) return;
    if (action === 'stick') {
      const pl = asRecord(payload);
      const m: Mover = isRunner ? this.runner : h!;
      m.sx = clamp(Number(pl.x) || 0, -1, 1);
      m.sy = clamp(Number(pl.y) || 0, -1, 1);
    } else if (action === 'sprint' && h && this.sub === 'chase') {
      if (now < h.sprintReady) return;
      h.sprintUntil = now + FANGEN.SPRINT_MS;
      h.sprintReady = now + FANGEN.SPRINT_COOLDOWN;
    } else if (action === 'decoy' && isRunner && this.sub === 'chase') {
      if (now < this.decoyReady || this.decoy) return;
      this.decoyReady = now + FANGEN.DECOY_COOLDOWN;
      this.startDecoy();
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
        runner: this.runnerId,
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
        outcome: this.outcome,
      },
    };
  }

  privateFor(id: string): PrivateState {
    if (id !== this.runnerId || this.sub === 'over') return null;
    return {
      kind: 'fangen',
      state: {
        role: 'runner',
        x: Math.round(this.runner.x * 10) / 10,
        y: Math.round(this.runner.y * 10) / 10,
        dir: this.runner.dir,
        decoyLeft: Math.max(0, this.decoyReady - Date.now()),
        decoyActive: !!this.decoy,
      },
    };
  }

  playerDisconnected(id: string) {
    const m = id === this.runnerId ? this.runner : this.hunters.get(id);
    if (m) m.sx = m.sy = 0;
  }

  dispose() {
    this.timers.clear();
  }
}
