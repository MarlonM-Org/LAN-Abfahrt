import type { MiniSnapshot, ParcoursBuilder, ParcoursGain, ParcoursRunner, ParcoursState } from '../shared/types';
import {
  BASE_SOLIDS,
  COURSE,
  DIRS,
  GOAL,
  PARCOURS as P,
  PART_DEFS,
  type ParcoursPart,
  type PartType,
  type Rect,
  SPAWN_Y,
  WATER_Y,
  canPlace,
  fanZone,
  ghostStart,
  overlaps,
  partRect,
  runnerRect,
  snap,
  spawnX,
} from '../shared/parcours';
import { type MiniCtx, type MiniGame, OFFLINE_OUT_MS, Timers, asRecord, groupByScore, shuffle } from './minigame';

const TICK_MS = 50;
const SUBSTEPS = 4;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface Runner extends ParcoursRunner {
  vx: number;
  vy: number;
  sx: number;
  groundId: number;
  onIce: boolean;
  wallDir: number;
  wallUntil: number;
  coyoteUntil: number;
  bufferUntil: number;
  held: boolean;
  lockUntil: number;
  /** Letzte Eingabe (für die AFK-Erkennung) */
  lastInput: number;
}

interface Builder extends ParcoursBuilder {
  sx: number;
  sy: number;
  lastInput: number;
}

interface Solid {
  r: Rect;
  id: number;
  type: PartType | 'base';
  oneway: boolean;
}

/**
 * Fallen-Parcours (à la Ultimate Chicken Horse): Jede Runde baut jeder ein Teil
 * in die Strecke, dann laufen alle gleichzeitig vom Handtuch zur Cocktailbar.
 * Punkte gibt es nur, wenn manche – aber nicht alle – ankommen.
 */
export class ParcoursGame implements MiniGame {
  readonly kind = 'parcours' as const;
  private sub: ParcoursState['sub'] = 'intro';
  private deadline = Date.now() + P.INTRO_MS;
  private round = 0;
  private parts: ParcoursPart[] = [];
  private partsRev = 0;
  private partSeq = 0;
  private runners = new Map<string, Runner>();
  private builders = new Map<string, Builder>();
  private colors: Record<string, number> = {};
  private points: Record<string, number> = {};
  private last: ParcoursState['last'] = null;
  private fx: ParcoursState['fx'] = [];
  private fxSeq = 0;
  private nuts: { id: number; x: number; y: number; vx: number; vy: number; owner: string; from: number }[] = [];
  private nutSeq = 0;
  private nextFire = new Map<number, number>();
  private kills: Record<string, number> = {};
  private goalCount = 0;
  private runStart = 0;
  private buildStart = 0;
  private t = 0;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    ids.forEach((id, i) => {
      this.colors[id] = i % P.COLORS.length;
      this.points[id] = 0;
    });
    let last = Date.now();
    this.timers.every(TICK_MS, () => {
      const now = Date.now();
      this.tick(now, Math.min(0.1, (now - last) / 1000));
      last = now;
    });
    this.timers.later(P.INTRO_MS, () => this.startBuild());
  }

  private active() {
    return this.ids.filter((id) => this.ctx.isConnected(id));
  }

  // ---------------------------------------------------------------- Ablauf

  private startBuild() {
    this.round += 1;
    this.sub = 'build';
    // Kein Zeitlimit: die Bauphase endet, wenn alle (verbundenen) Spieler fertig sind – AFK siehe tickBuild()
    this.buildStart = Date.now();
    this.deadline = this.buildStart;
    this.builders.clear();
    this.runners.clear();
    this.active().forEach((id, i) => {
      const pool = PART_TYPES_FOR(this.parts.length > 0);
      const g = ghostStart(i);
      this.builders.set(id, {
        stage: 'pick',
        choice: pickChoice(pool),
        pick: null,
        gx: g.x,
        gy: g.y,
        rot: 0,
        ok: false,
        afk: 0,
        skipped: false,
        sx: 0,
        sy: 0,
        lastInput: this.buildStart,
      });
    });
    this.ctx.onChange();
  }

  private endBuild() {
    if (this.sub !== 'build') return;
    this.sub = 'countdown';
    this.deadline = Date.now() + P.COUNTDOWN_MS;
    this.runners.clear();
    this.active()
      .slice(0, P.MAX_RUNNERS)
      .forEach((id, i) => {
        this.runners.set(id, {
          x: spawnX(i),
          y: SPAWN_Y,
          face: 1,
          st: 'run',
          ground: true,
          by: null,
          place: null,
          vx: 0,
          vy: 0,
          sx: 0,
          groundId: -1,
          onIce: false,
          wallDir: 0,
          wallUntil: 0,
          coyoteUntil: 0,
          bufferUntil: 0,
          held: false,
          lockUntil: 0,
          lastInput: 0,
          afk: 0,
          zzz: false,
        });
      });
    this.nuts = [];
    this.kills = {};
    this.goalCount = 0;
    this.t = 0;
    this.ctx.onChange();
  }

  private startRun() {
    this.sub = 'run';
    this.runStart = Date.now();
    // Kein Zeitlimit: die Runde läuft, bis alle im Ziel oder raus sind (AFK siehe tickAfk())
    this.deadline = this.runStart;
    for (const r of this.runners.values()) r.lastInput = this.runStart;
    this.nextFire.clear();
    this.parts
      .filter((p) => p.type === 'cannon')
      .forEach((p, i) => this.nextFire.set(p.id, this.runStart + 700 + i * 350));
    this.ctx.onChange();
  }

  private endRun() {
    if (this.sub !== 'run') return;
    const runners = [...this.runners.entries()];
    const finished = runners.filter(([, r]) => r.st === 'goal');
    const verdict: 'ok' | 'easy' | 'hard' = finished.length === 0 ? 'hard' : finished.length === runners.length ? 'easy' : 'ok';
    const gains: Record<string, ParcoursGain> = {};
    for (const id of this.ids) gains[id] = { goal: 0, first: 0, traps: 0 };
    if (verdict === 'ok') {
      for (const [id, r] of finished) {
        gains[id].goal = P.GOAL_PTS;
        if (r.place === 1) gains[id].first = P.FIRST_PTS;
      }
      for (const [id, n] of Object.entries(this.kills)) if (gains[id]) gains[id].traps = Math.min(P.TRAP_MAX, n) * P.TRAP_PTS;
      for (const id of this.ids) this.points[id] += gains[id].goal + gains[id].first + gains[id].traps;
    }
    this.last = { verdict, gains };
    this.sub = 'score';
    this.deadline = Date.now() + P.SCORE_MS;
    this.nuts = [];
    this.ctx.onChange();
  }

  private afterScore() {
    const best = Math.max(0, ...Object.values(this.points));
    if (best >= P.TARGET || this.round >= P.ROUNDS || this.active().length < 1) this.end();
    else this.startBuild();
  }

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.deadline = Date.now();
    this.ctx.onChange();
    const winner = groupByScore(this.ids, (id) => this.points[id])[0] ?? [];
    this.timers.later(3000, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => this.points[id]),
        details: Object.fromEntries(this.ids.map((id) => [id, `${this.points[id]} Punkte`])),
        subtitle:
          winner.length === 1
            ? `${this.ctx.nameOf(winner[0])} ist Parcours-König(in) nach ${this.round} Runden!`
            : `Gleichstand nach ${this.round} Runden!`,
      }),
    );
  }

  // ---------------------------------------------------------------- Takt

  private tick(now: number, dt: number) {
    if (this.sub === 'over') return;
    if (this.sub === 'build') {
      this.tickBuild(dt);
      this.tickBuildAfk(now);
      const allDone = [...this.builders.values()].every((b) => b.stage === 'done');
      if (allDone) return this.endBuild();
    } else if (this.sub === 'countdown') {
      if (now >= this.deadline) this.startRun();
    } else if (this.sub === 'run') {
      const h = dt / SUBSTEPS;
      for (let i = 0; i < SUBSTEPS; i++) this.step(now - (SUBSTEPS - 1 - i) * h * 1000, h);
      this.tickRunAfk(now);
      const running = [...this.runners.values()].some((r) => r.st === 'run');
      if (!running) return this.endRun();
    } else if (this.sub === 'score') {
      if (now >= this.deadline) return this.afterScore();
      return; // nichts bewegt sich
    } else if (this.sub === 'intro') {
      return;
    }
    this.ctx.onChange();
  }

  /** Wie lange darf dieser Spieler noch nichts tun? (Menschen: seit der letzten Eingabe; Bots: Phase gesamt) */
  private afkLeft(id: string, lastInput: number, phaseStart: number, botMs: number, now: number) {
    if (this.ctx.isBot?.(id)) return Math.min(phaseStart + botMs, lastInput + P.AFK_MS) - now;
    return lastInput + P.AFK_MS - now;
  }

  /** AFK in der Bauphase: nach langer Untätigkeit wird der Spieler übersprungen
   *  (ein gültig gesetzter Geist wird noch eingebaut). Offline-Spieler erledigt playerDisconnected(). */
  private tickBuildAfk(now: number) {
    for (const [id, b] of this.builders) {
      if (b.stage === 'done') continue;
      if (!this.ctx.isConnected(id)) {
        b.stage = 'done';
        continue;
      }
      if (b.sx !== 0 || b.sy !== 0) b.lastInput = now; // Stick gehalten = aktiv
      const left = this.afkLeft(id, b.lastInput, this.buildStart, P.BOT_BUILD_MS, now);
      b.afk = left <= P.AFK_WARN_MS ? Math.max(1, left) : 0;
      if (left > 0) continue;
      b.afk = 0;
      if (b.stage === 'place' && b.pick && b.ok) this.placePart(id, b);
      if ((b.stage as ParcoursBuilder['stage']) !== 'done') {
        b.stage = 'done';
        b.skipped = true;
        b.sx = b.sy = 0;
      }
    }
  }

  /** AFK beim Laufen: wer lange gar nichts eingibt, schläft ein und scheidet aus. Wer aktiv spielt,
   *  kann sich beliebig Zeit lassen – die Runde endet nie über die Uhr. */
  private tickRunAfk(now: number) {
    for (const [id, r] of [...this.runners]) {
      if (r.st !== 'run') {
        r.afk = 0;
        continue;
      }
      // Verbindung weg (nach der 3-s-Gnadenfrist): Läufer eingefroren, AFK-Uhr steht – nach 15 s fällt er raus
      // (zählt dann wie früher nicht für „zu leicht/zu schwer“)
      r.away = !this.ctx.isConnected(id);
      if (r.away) {
        r.afk = 0;
        r.lastInput = now;
        if ((this.ctx.offlineMs?.(id) ?? 0) >= OFFLINE_OUT_MS) this.runners.delete(id);
        continue;
      }
      if (r.sx !== 0 || r.held) r.lastInput = now; // Stick/Sprungknopf gehalten = aktiv
      const left = this.afkLeft(id, r.lastInput, this.runStart, P.BOT_RUN_MS, now);
      r.afk = left <= P.AFK_WARN_MS ? Math.max(1, left) : 0;
      if (left > 0) continue;
      r.afk = 0;
      r.zzz = true;
      this.knockOut(id, r, null);
    }
  }

  private tickBuild(dt: number) {
    for (const b of this.builders.values()) {
      if (b.stage !== 'place' || !b.pick) continue;
      const len = Math.hypot(b.sx, b.sy);
      if (len > 0.15) {
        b.gx = clamp(b.gx + (b.sx / Math.max(1, len)) * P.GHOST_SPEED * dt * Math.min(1, len), 8, COURSE.w - 8);
        b.gy = clamp(b.gy + (b.sy / Math.max(1, len)) * P.GHOST_SPEED * dt * Math.min(1, len), COURSE.y + 8, WATER_Y - 4);
      }
      b.ok = canPlace(b.pick, snap(b.gx), snap(b.gy), b.rot, this.parts);
    }
  }

  private solidsAt(t: number): Solid[] {
    const list: Solid[] = BASE_SOLIDS.map((r) => ({ r, id: -1, type: 'base' as const, oneway: false }));
    for (const p of this.parts) {
      const k = PART_DEFS[p.type].kind;
      if (k === 'solid' || k === 'oneway') list.push({ r: partRect(p, t), id: p.id, type: p.type, oneway: k === 'oneway' });
    }
    return list;
  }

  /** Ein Physik-Teilschritt (dt in Sekunden) */
  private step(now: number, dt: number) {
    const t0 = this.t;
    this.t += dt * 1000;
    const before = new Map(this.parts.filter((p) => p.type === 'mover').map((p) => [p.id, partRect(p, t0)]));
    const solids = this.solidsAt(this.t);
    const fans = this.parts.filter((p) => p.type === 'fan');
    const urchins = this.parts.filter((p) => p.type === 'urchin');

    for (const [id, r] of this.runners) {
      if (r.st !== 'run' || r.away) continue;
      // Auf der Schwebeplattform mitfahren
      if (r.ground && before.has(r.groundId)) {
        const a = before.get(r.groundId)!;
        const b = solids.find((s) => s.id === r.groundId)!.r;
        r.x += b.x - a.x;
        r.y += b.y - a.y;
      }
      // Springen (mit Puffer & Coyote-Zeit), Wandsprung
      if (r.bufferUntil > now) {
        if (r.ground || r.coyoteUntil > now) {
          r.vy = -P.JUMP_V;
          r.ground = false;
          r.coyoteUntil = 0;
          r.bufferUntil = 0;
          if (!r.held) r.vy *= P.JUMP_CUT;
        } else if (r.wallUntil > now && r.wallDir !== 0) {
          r.vy = -P.JUMP_V * 0.92;
          r.vx = -r.wallDir * P.RUN * 1.25;
          r.face = r.vx > 0 ? 1 : -1;
          r.lockUntil = now + 170;
          r.wallUntil = 0;
          r.bufferUntil = 0;
        }
      }
      // Laufen
      const target = Math.abs(r.sx) > 0.2 ? Math.sign(r.sx) * P.RUN * Math.min(1, Math.abs(r.sx) * 1.3) : 0;
      const acc = now < r.lockUntil ? 0 : r.ground ? (r.onIce ? P.ICE_ACC : P.GROUND_ACC) : P.AIR_ACC;
      if (r.vx < target) r.vx = Math.min(target, r.vx + acc * dt);
      else if (r.vx > target) r.vx = Math.max(target, r.vx - acc * dt);
      if (Math.abs(r.sx) > 0.2) r.face = r.sx > 0 ? 1 : -1;
      // Wind
      const box0 = runnerRect(r.x, r.y);
      for (const f of fans) {
        if (!overlaps(box0, fanZone(f))) continue;
        const [dx, dy] = DIRS[f.rot % 4];
        r.vx += dx * P.WIND_ACC * dt;
        r.vy += dy * P.WIND_ACC * dt;
      }
      // Schwerkraft
      r.vy = clamp(r.vy + P.GRAVITY * dt, -P.SPRING_V, P.MAX_FALL);
      if (!r.ground && r.wallUntil > now && r.vy > P.WALL_SLIDE && Math.sign(r.sx) === r.wallDir) r.vy = P.WALL_SLIDE;

      // X-Achse
      r.x += r.vx * dt;
      for (const s of solids) {
        if (s.oneway) continue;
        const box = runnerRect(r.x, r.y);
        if (!overlaps(box, s.r)) continue;
        const left = s.r.x - P.PW / 2 - 0.01;
        const right = s.r.x + s.r.w + P.PW / 2 + 0.01;
        const dir = r.vx > 0 ? 1 : r.vx < 0 ? -1 : r.x < s.r.x + s.r.w / 2 ? 1 : -1;
        r.x = dir > 0 ? left : right;
        r.vx = 0;
        r.wallDir = dir;
        r.wallUntil = now + 110;
      }
      r.x = clamp(r.x, P.PW / 2, COURSE.w - P.PW / 2);

      // Y-Achse
      const prevY = r.y;
      r.y += r.vy * dt;
      const wasGround = r.ground;
      r.ground = false;
      for (const s of solids) {
        const box = runnerRect(r.x, r.y);
        if (!overlaps(box, s.r)) continue;
        const fromAbove = prevY <= s.r.y + 4 && r.vy >= 0;
        if (s.oneway) {
          if (!(r.vy >= 0 && prevY <= s.r.y + 1.5)) continue;
        }
        if (fromAbove || s.oneway) {
          r.y = s.r.y;
          if (s.type === 'spring') {
            r.vy = -P.SPRING_V;
            r.bufferUntil = 0;
            this.addFx('place', r.x, r.y, null);
          } else {
            r.vy = 0;
            r.ground = true;
            r.groundId = s.id;
            r.onIce = s.type === 'ice';
          }
        } else if (r.vy < 0) {
          r.y = s.r.y + s.r.h + P.PH + 0.01;
          r.vy = 0;
        } else {
          // seitlich hineingeschoben (z. B. von einer Schwebeplattform) → nach oben drücken
          r.y = s.r.y;
          r.vy = 0;
          r.ground = true;
          r.groundId = s.id;
        }
      }
      if (wasGround && !r.ground && r.vy >= 0) r.coyoteUntil = now + P.COYOTE_MS;
      if (r.ground) r.wallUntil = 0;
      if (r.y - P.PH < COURSE.y - 30) {
        r.y = COURSE.y - 30 + P.PH;
        r.vy = Math.max(0, r.vy);
      }

      // Gefahren
      const box = runnerRect(r.x, r.y);
      const hit = urchins.find((u) => overlaps(box, shrink(partRect(u), 2)));
      if (hit) this.knockOut(id, r, hit.owner);
      else if (r.y > WATER_Y + 6) this.knockOut(id, r, null);
      else if (overlaps(box, GOAL)) {
        r.st = 'goal';
        r.place = ++this.goalCount;
        r.vx = r.vy = 0;
        this.addFx('goal', r.x, r.y, id);
      }
    }

    // Kokosnuss-Kanonen
    for (const c of this.parts) {
      if (c.type !== 'cannon') continue;
      const next = this.nextFire.get(c.id) ?? now;
      if (now < next) continue;
      this.nextFire.set(c.id, now + P.NUT_EVERY_MS);
      const rc = partRect(c);
      const [dx, dy] = DIRS[c.rot % 4];
      this.nuts.push({
        id: ++this.nutSeq,
        x: rc.x + rc.w / 2 + dx * (rc.w / 2 + P.NUT_R + 1),
        y: rc.y + rc.h / 2 + dy * (rc.h / 2 + P.NUT_R + 1),
        vx: dx * P.NUT_SPEED,
        vy: dy * P.NUT_SPEED,
        owner: c.owner,
        from: c.id,
      });
    }
    this.nuts = this.nuts.filter((n) => {
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      const nr: Rect = { x: n.x - P.NUT_R, y: n.y - P.NUT_R, w: P.NUT_R * 2, h: P.NUT_R * 2 };
      if (n.x < -10 || n.x > COURSE.w + 10 || n.y < COURSE.y - 20 || n.y > WATER_Y + 4) return false;
      if (solids.some((s) => s.id !== n.from && !s.oneway && overlaps(nr, s.r))) return false;
      for (const [id, r] of this.runners) {
        if (r.st !== 'run' || r.away) continue; // eingefroren = unverwundbar
        if (overlaps(nr, runnerRect(r.x, r.y))) {
          this.knockOut(id, r, n.owner);
          return false;
        }
      }
      return true;
    });
  }

  private knockOut(id: string, r: Runner, by: string | null) {
    r.st = 'dead';
    r.by = by;
    r.vx = r.vy = 0;
    if (by && by !== id) this.kills[by] = (this.kills[by] ?? 0) + 1;
    this.addFx('ko', r.x, Math.min(r.y, WATER_Y), id);
  }

  private addFx(kind: ParcoursState['fx'][number]['kind'], x: number, y: number, who: string | null) {
    this.fx.push({ seq: ++this.fxSeq, kind, x: Math.round(x), y: Math.round(y), who });
    if (this.fx.length > 8) this.fx.shift();
  }

  private placePart(id: string, b: Builder) {
    if (!b.pick) return;
    const x = snap(b.gx);
    const y = snap(b.gy);
    if (!canPlace(b.pick, x, y, b.rot, this.parts)) return;
    if (b.pick === 'bomb') {
      const before = this.parts.length;
      this.parts = this.parts.filter((p) => {
        const r = partRect(p);
        const cx = clamp(x, r.x, r.x + r.w);
        const cy = clamp(y, r.y, r.y + r.h);
        return Math.hypot(cx - x, cy - y) > P.BOMB_R;
      });
      if (this.parts.length !== before) this.partsRev++;
      this.addFx('boom', x, y, id);
    } else {
      this.parts.push({ id: ++this.partSeq, type: b.pick, x, y, rot: b.rot, owner: id });
      this.partsRev++;
      this.addFx('place', x, y, id);
    }
    b.stage = 'done';
    b.sx = b.sy = 0;
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const pl = asRecord(payload);
    if (this.sub === 'build') {
      const b = this.builders.get(id);
      if (!b) return;
      if (b.stage !== 'done') b.lastInput = Date.now();
      if (action === 'pick' && b.stage === 'pick') {
        const type = String(pl.type) as PartType;
        if (!b.choice.includes(type)) return;
        b.pick = type;
        b.stage = 'place';
        b.rot = 0;
      } else if (action === 'unpick' && b.stage === 'place') {
        b.stage = 'pick';
        b.pick = null;
        b.sx = b.sy = 0;
      } else if (action === 'stick') {
        b.sx = clamp(Number(pl.x) || 0, -1, 1);
        b.sy = clamp(Number(pl.y) || 0, -1, 1);
      } else if (action === 'rotate' && b.stage === 'place' && b.pick) {
        b.rot = (b.rot + 1) % PART_DEFS[b.pick].rots;
      } else if (action === 'place' && b.stage === 'place') {
        this.placePart(id, b);
      }
      this.ctx.onChange();
      return;
    }
    const r = this.runners.get(id);
    if (!r) return;
    if (this.sub === 'run') r.lastInput = Date.now();
    if (action === 'stick') r.sx = clamp(Number(pl.x) || 0, -1, 1);
    else if (action === 'jump') {
      const down = pl.down !== false;
      if (down) {
        r.held = true;
        r.bufferUntil = Date.now() + P.BUFFER_MS;
      } else {
        r.held = false;
        if (r.vy < 0 && this.sub === 'run') r.vy *= P.JUMP_CUT;
      }
    }
  }

  // ---------------------------------------------------------------- Zustand

  snapshot(): MiniSnapshot {
    const rnd = (v: number) => Math.round(v * 10) / 10;
    return {
      kind: 'parcours',
      state: {
        sub: this.sub,
        endsIn: this.sub === 'build' || this.sub === 'run' ? 0 : Math.max(0, this.deadline - Date.now()),
        round: this.round,
        rounds: P.ROUNDS,
        target: P.TARGET,
        parts: this.parts,
        partsRev: this.partsRev,
        t: Math.round(this.t),
        nuts: this.nuts.map((n) => ({ id: n.id, x: rnd(n.x), y: rnd(n.y) })),
        runners: Object.fromEntries(
          [...this.runners.entries()].map(([id, r]) => [id, { x: rnd(r.x), y: rnd(r.y), face: r.face, st: r.st, ground: r.ground, by: r.by, place: r.place, afk: r.afk, zzz: r.zzz, ...(r.away ? { away: true } : {}) }]),
        ),
        builders: Object.fromEntries(
          [...this.builders.entries()].map(([id, b]) => [id, { stage: b.stage, choice: b.choice, pick: b.pick, gx: snap(b.gx), gy: snap(b.gy), rot: b.rot, ok: b.ok, afk: b.afk, skipped: b.skipped }]),
        ),
        colors: this.colors,
        points: this.points,
        last: this.last,
        fx: this.fx,
      },
    };
  }

  playerDisconnected(id: string) {
    const b = this.builders.get(id);
    if (b) b.stage = 'done';
    const r = this.runners.get(id);
    if (!r) return;
    r.sx = 0;
    r.held = false;
    // Entfernt: läuft nicht mehr mit. Sonst bleibt der Läufer eingefroren stehen (siehe tickRunAfk), bis er zurück ist.
    if (this.ctx.isGone?.(id)) this.runners.delete(id);
  }

  dispose() {
    this.timers.clear();
  }
}

const shrink = (r: Rect, d: number): Rect => ({ x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d });

/** Bombe nur, wenn es schon etwas zum Sprengen gibt */
function PART_TYPES_FOR(hasParts: boolean): PartType[] {
  const all: PartType[] = ['platform', 'plank', 'spring', 'urchin', 'cannon', 'fan', 'ice', 'mover', 'urchin', 'platform'];
  return hasParts ? [...all, 'bomb'] : all;
}

function pickChoice(pool: PartType[]): PartType[] {
  const out: PartType[] = [];
  for (const t of shuffle(pool)) {
    if (!out.includes(t)) out.push(t);
    if (out.length === 3) break;
  }
  return out;
}
