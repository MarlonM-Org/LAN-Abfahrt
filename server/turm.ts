import Matter from 'matter-js';
import type { MiniSnapshot, TurmActive, TurmLane } from '../shared/types';
import { TURM, TURM_SHAPES, turmCellOffsets } from '../shared/games';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore } from './minigame';

const { Bodies, Body, Composite, Engine, Query } = Matter;

const TICK_MS = 50;
const STEP_MS = 1000 / 60;
const B = TURM.BLOCK;
const PLATFORM_HALF = (TURM.PLATFORM_W / 2) * B;
/** Unterhalb dieser Tiefe (Physik-y, nach unten) gilt ein Teil als verloren */
const LOST_Y = (TURM.VIEW_BOTTOM + 2) * B;
const LOST_X = (TURM.LANE_HALF + 4) * B;
const PROF = !!process.env.TURM_PROF;

/** Das gesteuerte Teil – noch kein Physik-Körper, nur eine Probe für Kollisionstests. */
interface Active {
  id: number;
  shape: number;
  v: number;
  x: number;
  /** Physik-y (nach unten) */
  y: number;
  rot: number;
  probe: Matter.Body;
}

interface Lane {
  id: string;
  engine: Matter.Engine;
  bodies: Matter.Body[];
  /** Physik-Körper → [Teil-ID, Form, Variante] */
  meta: Map<number, [number, number, number]>;
  active: Active | null;
  spawnAt: number;
  bag: number[];
  next: [number, number];
  fast: boolean;
  lives: number;
  height: number;
  best: number;
  place: number;
  finishMs: number | null;
  frozen: boolean;
  holdSince: number;
  gustDir: number;
  gustUntil: number;
  lostSeq: number;
  lastLoss: number;
}

/** Kompound-Körper aus quadratischen Zellen (Schwerpunkt = (x, y)) */
function makeBody(shape: number, x: number, y: number, angle: number, size: number, dynamic: boolean): Matter.Body {
  const parts = turmCellOffsets(shape, 0).map((o) => Bodies.rectangle(x + o.x, y + o.y, size, size));
  const body = Body.create({
    parts,
    friction: 1,
    frictionStatic: 4,
    restitution: 0,
    frictionAir: 0.03,
    slop: 0.03,
    isStatic: !dynamic,
  });
  // Höhere Trägheit: Teile kippen etwas gemütlicher – der Turm wackelt, stürzt aber nicht bei jedem Hauch ein
  if (dynamic) Body.setInertia(body, body.inertia * 4);
  Body.setAngle(body, angle);
  return body;
}

/**
 * Wackelturm: Jeder stapelt seinen eigenen Turm aus fallenden Urlaubs-Teilen.
 * Das fallende Teil wird gesteuert (verschieben, drehen, schneller fallen) und wird zum
 * echten Physik-Körper, sobald es etwas berührt. Wer zuerst das Gipfelkreuz erreicht
 * (und den Turm kurz hält), gewinnt; sonst zählt nach Ablauf der Zeit die Höhe.
 */
export class TurmGame implements MiniGame {
  readonly kind = 'turm' as const;
  private lanes: Lane[] = [];
  private sub: 'countdown' | 'play' | 'over' = 'countdown';
  private deadline = Date.now() + TURM.COUNTDOWN_MS;
  private startedAt = 0;
  private nextGust = 0;
  private seq = 0;
  private finishedCount = 0;
  private timers = new Timers();
  private prof = { n: 0, sum: 0, max: 0, since: Date.now() };

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    for (const id of ids) {
      const engine = Engine.create({ enableSleeping: true, positionIterations: 10, velocityIterations: 8 });
      engine.gravity.scale = 0.0006;
      // Plattform (Steg im Meer); Oberkante bei y = 0
      const platform = Bodies.rectangle(0, B, TURM.PLATFORM_W * B, 2 * B, { isStatic: true, friction: 1, frictionStatic: 1.5 });
      Composite.add(engine.world, platform);
      const lane: Lane = {
        id,
        engine,
        bodies: [],
        meta: new Map(),
        active: null,
        spawnAt: 0,
        bag: [],
        next: [0, 0],
        fast: false,
        lives: TURM.LIVES,
        height: 0,
        best: 0,
        place: 0,
        finishMs: null,
        frozen: false,
        holdSince: 0,
        gustDir: 0,
        gustUntil: 0,
        lostSeq: 0,
        lastLoss: 0,
      };
      lane.next = this.draw(lane);
      this.lanes.push(lane);
    }
    this.timers.later(TURM.COUNTDOWN_MS, () => this.start());
  }

  /** "7-Bag": jede Form kommt einmal pro sieben Teile – fair für alle */
  private draw(lane: Lane): [number, number] {
    if (!lane.bag.length) {
      lane.bag = TURM_SHAPES.map((_, i) => i);
      for (let i = lane.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lane.bag[i], lane.bag[j]] = [lane.bag[j], lane.bag[i]];
      }
    }
    return [lane.bag.pop()!, Math.floor(Math.random() * 3)];
  }

  private start() {
    this.sub = 'play';
    this.startedAt = Date.now();
    this.deadline = this.startedAt + TURM.TIME_MS;
    this.nextGust = this.startedAt + TURM.GUST_EVERY_MS;
    for (const lane of this.lanes) this.spawn(lane);
    let last = Date.now();
    let carry = 0;
    this.timers.every(TICK_MS, () => {
      const now = Date.now();
      carry += now - last;
      last = now;
      // Feste 60-Hz-Schritte; nach Rucklern höchstens 6 nachholen
      const steps = Math.min(6, Math.floor(carry / STEP_MS));
      carry = Math.min(carry - steps * STEP_MS, STEP_MS);
      const t0 = PROF ? performance.now() : 0;
      this.tick(now, steps);
      if (PROF) this.profile(performance.now() - t0, steps);
    });
    this.ctx.onChange();
  }

  private profile(ms: number, steps: number) {
    const p = this.prof;
    p.n++;
    p.sum += ms;
    p.max = Math.max(p.max, ms);
    if (Date.now() - p.since > 10000) {
      const pieces = this.lanes.reduce((a, l) => a + l.bodies.length, 0);
      console.log(`[turm] ${this.lanes.length} Bahnen, ${pieces} Teile: Tick Ø ${(p.sum / p.n).toFixed(2)} ms, max ${p.max.toFixed(2)} ms (${steps} Physik-Schritte/Tick)`);
      this.prof = { n: 0, sum: 0, max: 0, since: Date.now() };
    }
  }

  private tick(now: number, steps: number) {
    if (this.sub !== 'play') return;
    if (now >= this.nextGust) this.gust(now);
    for (const lane of this.lanes) {
      if (lane.frozen || lane.place) continue;
      for (let i = 0; i < steps; i++) {
        this.moveActive(lane, now);
        Engine.update(lane.engine, STEP_MS);
      }
      this.cleanup(lane);
      this.measure(lane, now);
      // Während der Turm über dem Ziel gehalten wird, kommt kein neues Teil
      if (!lane.active && !lane.frozen && !lane.place && !lane.holdSince && now >= lane.spawnAt) this.spawn(lane);
    }
    const running = this.lanes.filter((l) => !l.frozen && !l.place);
    if (!running.length || now >= this.deadline) this.end();
    else this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Gesteuertes Teil

  private spawn(lane: Lane) {
    const [shape, v] = lane.next;
    lane.next = this.draw(lane);
    lane.fast = false;
    const top = this.topY(lane, true);
    const y = -Math.min((TURM.VIEW_TOP - 1.5) * B, Math.max(-top + TURM.SPAWN_GAP * B, 6 * B));
    // Nicht immer exakt mittig – sonst wächst ein Turm ganz ohne Zutun gerade nach oben
    const steps = Math.round(TURM.SPAWN_JITTER * 2);
    const x = ((Math.floor(Math.random() * (2 * steps + 1)) - steps) * B) / 2;
    const probe = makeBody(shape, x, y, 0, B - 1.2, false);
    lane.active = { id: ++this.seq, shape, v, x, y, rot: 0, probe };
  }

  /** Kollidiert die Probe an (x, y, rot) mit Plattform oder liegenden Teilen? */
  private blocked(lane: Lane, a: Active, x: number, y: number, rot: number) {
    Body.setAngle(a.probe, (rot * Math.PI) / 2);
    Body.setPosition(a.probe, { x, y });
    const others = Composite.allBodies(lane.engine.world);
    const hit = a.probe.parts.slice(1).some((part) => Query.collides(part, others).length > 0);
    Body.setAngle(a.probe, (a.rot * Math.PI) / 2);
    Body.setPosition(a.probe, { x: a.x, y: a.y });
    return hit;
  }

  private moveActive(lane: Lane, now: number) {
    const a = lane.active;
    if (!a) return;
    // Windböe schiebt seitlich
    if (lane.gustDir && now < lane.gustUntil) {
      const nx = a.x + (lane.gustDir * 1.3 * B) / 60;
      if (Math.abs(nx) <= TURM.LANE_HALF * B && !this.blocked(lane, a, nx, a.y, a.rot)) a.x = nx;
    } else lane.gustDir = 0;
    const dy = ((lane.fast ? TURM.FAST : TURM.FALL) * B) / 60;
    if (this.blocked(lane, a, a.x, a.y + dy, a.rot)) return this.land(lane, dy);
    a.y += dy;
    Body.setPosition(a.probe, { x: a.x, y: a.y });
    // Neben der Plattform ins Meer gefallen
    if (a.y > LOST_Y) {
      lane.active = null;
      this.lose(lane);
    }
  }

  /** Teil berührt etwas → wird zum echten Physik-Körper */
  private land(lane: Lane, dy: number) {
    const a = lane.active!;
    const body = makeBody(a.shape, a.x, a.y, (a.rot * Math.PI) / 2, B, true);
    // Geschwindigkeit in Einheiten pro 16,7-ms-Schritt: halbe Fallgeschwindigkeit mitnehmen
    Body.setVelocity(body, { x: 0, y: dy * 0.5 });
    Composite.add(lane.engine.world, body);
    lane.bodies.push(body);
    lane.meta.set(body.id, [a.id, a.shape, a.v]);
    lane.active = null;
    lane.spawnAt = Date.now() + 350;
  }

  private lose(lane: Lane) {
    lane.lostSeq += 1;
    // Stürzt der halbe Turm ein, kostet das nicht sofort alle Leben: kurze Schonfrist
    const now = Date.now();
    lane.spawnAt = Math.max(lane.spawnAt, now + 600);
    if (now - lane.lastLoss < TURM.LOSS_GRACE_MS) return;
    lane.lastLoss = now;
    lane.lives -= 1;
    if (lane.lives <= 0) this.freeze(lane);
  }

  private freeze(lane: Lane) {
    lane.frozen = true;
    lane.active = null;
    lane.height = this.stableHeight(lane);
    for (const b of lane.bodies) Body.setStatic(b, true);
  }

  // ---------------------------------------------------------------- Turm messen

  /** Höchster Punkt (Physik-y, also negativ = hoch) aller Teile */
  private topY(lane: Lane, all: boolean) {
    let top = 0;
    for (const b of lane.bodies) {
      if (!all && !this.settled(b)) continue;
      if (b.position.y > B) continue;
      top = Math.min(top, b.bounds.min.y);
    }
    return top;
  }

  private settled(b: Matter.Body) {
    return b.isSleeping || b.isStatic || (b.speed < 0.25 && b.angularSpeed < 0.01);
  }

  private stableHeight(lane: Lane) {
    return Math.max(0, Math.round(-this.topY(lane, false)));
  }

  /** Heruntergefallene Teile entfernen */
  private cleanup(lane: Lane) {
    for (let i = lane.bodies.length - 1; i >= 0; i--) {
      const b = lane.bodies[i];
      if (b.position.y > LOST_Y || Math.abs(b.position.x) > LOST_X) {
        Composite.remove(lane.engine.world, b);
        lane.bodies.splice(i, 1);
        lane.meta.delete(b.id);
        this.lose(lane);
        if (lane.frozen) return;
      }
    }
  }

  private measure(lane: Lane, now: number) {
    if (lane.frozen) return;
    lane.height = this.stableHeight(lane);
    lane.best = Math.max(lane.best, lane.height);
    if (lane.height >= TURM.GOAL * B) {
      if (!lane.holdSince) lane.holdSince = now;
      if (now - lane.holdSince >= TURM.HOLD_MS) this.finish(lane, now);
    } else lane.holdSince = 0;
  }

  private finish(lane: Lane, now: number) {
    lane.place = ++this.finishedCount;
    lane.finishMs = now - this.startedAt;
    lane.active = null;
    lane.holdSince = 0;
    for (const b of lane.bodies) Body.setStatic(b, true);
    if (lane.place === 1) this.deadline = Math.min(this.deadline, now + TURM.AFTER_FINISH_MS);
  }

  /** Alle 30 s bekommt der Führende eine Windböe ab */
  private gust(now: number) {
    this.nextGust = now + TURM.GUST_EVERY_MS;
    const cands = this.lanes.filter((l) => !l.frozen && !l.place && l.height > 0);
    if (cands.length < 2) return;
    const lead = cands.reduce((a, b) => (b.height > a.height ? b : a));
    lead.gustDir = Math.random() < 0.5 ? -1 : 1;
    lead.gustUntil = now + TURM.GUST_MS;
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    if (this.sub !== 'play') return;
    const lane = this.lanes.find((l) => l.id === id);
    const a = lane?.active;
    if (!lane) return;
    if (action === 'drop') {
      lane.fast = !!asRecord(payload).on;
      return;
    }
    if (!a) return;
    if (action === 'shift') {
      const dir = Number(asRecord(payload).dir) < 0 ? -1 : 1;
      const nx = a.x + (dir * B) / 2;
      if (Math.abs(nx) <= TURM.LANE_HALF * B && !this.blocked(lane, a, nx, a.y, a.rot)) {
        a.x = nx;
        Body.setPosition(a.probe, { x: a.x, y: a.y });
      }
    } else if (action === 'rotate') {
      const rot = (a.rot + 1) % 4;
      // Wenn es klemmt: ein Stück zur Seite oder nach oben ausweichen
      for (const [kx, ky] of [[0, 0], [B / 2, 0], [-B / 2, 0], [B, 0], [-B, 0], [0, -B / 2]]) {
        const nx = a.x + kx;
        if (Math.abs(nx) > TURM.LANE_HALF * B) continue;
        if (this.blocked(lane, a, nx, a.y + ky, rot)) continue;
        a.x = nx;
        a.y += ky;
        a.rot = rot;
        Body.setAngle(a.probe, (rot * Math.PI) / 2);
        Body.setPosition(a.probe, { x: a.x, y: a.y });
        break;
      }
    }
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Ende

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.timers.clear();
    for (const lane of this.lanes) {
      lane.active = null;
      if (!lane.frozen && !lane.place) lane.height = this.stableHeight(lane);
    }
    this.ctx.onChange();
    const byId = new Map(this.lanes.map((l) => [l.id, l]));
    const score = (id: string) => {
      const l = byId.get(id);
      if (!l) return -1;
      return l.place ? 1e9 - l.place : l.height;
    };
    const m = (h: number) => `${(h / B).toFixed(1).replace('.', ',')} m`;
    const winner = [...this.lanes].sort((a, b) => score(b.id) - score(a.id))[0];
    const subtitle = !winner
      ? 'Wackelig war’s!'
      : winner.place
        ? `${this.ctx.nameOf(winner.id)} hat das Gipfelkreuz erreicht!`
        : winner.height > 0
          ? `${this.ctx.nameOf(winner.id)} baut den höchsten Turm!`
          : 'Alles ist ins Meer gefallen ...';
    this.timers.later(3000, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, score),
        details: Object.fromEntries(
          this.lanes.map((l) => [
            l.id,
            l.place ? `Gipfel nach ${((l.finishMs ?? 0) / 1000).toFixed(0)}s` : `${m(l.height)}${l.frozen ? ' (eingefroren)' : ''}`,
          ]),
        ),
        subtitle,
      }),
    );
  }

  // ---------------------------------------------------------------- Zustand

  private activeSnap(a: Active | null): TurmActive | null {
    if (!a) return null;
    return { id: a.id, shape: a.shape, v: a.v, x: Math.round(a.x), y: Math.round(-a.y), rot: a.rot };
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const lanes: TurmLane[] = this.lanes.map((l) => {
      const pieces: number[] = [];
      for (const b of l.bodies) {
        const meta = l.meta.get(b.id);
        if (!meta) continue;
        pieces.push(meta[0], meta[1], meta[2], Math.round(b.position.x), Math.round(-b.position.y), Math.round(b.angle * 100));
      }
      return {
        id: l.id,
        lives: l.lives,
        height: l.height,
        best: l.best,
        place: l.place,
        finishMs: l.finishMs,
        frozen: l.frozen,
        hold: l.holdSince ? Math.min(1, (now - l.holdSince) / TURM.HOLD_MS) : 0,
        next: l.next,
        active: this.activeSnap(l.active),
        pieces,
        gust: l.gustDir && now < l.gustUntil ? l.gustDir : 0,
        lostSeq: l.lostSeq,
      };
    });
    return {
      kind: 'turm',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - now),
        gustIn: this.sub === 'play' ? Math.max(0, this.nextGust - now) : 0,
        lanes,
      },
    };
  }

  playerDisconnected(id: string) {
    const lane = this.lanes.find((l) => l.id === id);
    if (lane) lane.fast = false;
  }

  dispose() {
    this.timers.clear();
    for (const l of this.lanes) {
      Composite.clear(l.engine.world, false);
      Engine.clear(l.engine);
    }
  }
}
