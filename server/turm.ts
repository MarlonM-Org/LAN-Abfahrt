import Matter from 'matter-js';
import type { MiniSnapshot, TurmActive, TurmLane } from '../shared/types';
import { TURM, TURM_SHAPES, turmCellOffsets, turmSnapX } from '../shared/games';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore } from './minigame';

const { Bodies, Body, Composite, Engine } = Matter;

const TICK_MS = 50;
const STEP_MS = 1000 / 60;
const B = TURM.BLOCK;
const PLATFORM_HALF = (TURM.PLATFORM_W / 2) * B;
/** Unterhalb dieser Tiefe (Physik-y, nach unten) gilt ein Teil als verloren */
const LOST_Y = (TURM.VIEW_BOTTOM + 2) * B;
const LOST_X = (TURM.LANE_HALF + 4) * B;
const PROF = !!process.env.TURM_PROF;
/** Seitliches Raster (Physik-Einheiten) */
const STEP = TURM.STEP * B;
/**
 * Erlaubte Überlappung des gesteuerten Teils mit liegenden Teilen (Physik-Einheiten, ≈ 0,2 px am TV).
 * Liegende Teile sinken minimal ein oder sind um Bruchteile eines Grads verdreht – ohne diese Toleranz
 * klemmt das Teil, obwohl optisch nichts im Weg ist.
 */
const SKIN = 0.35;

type Offs = { x: number; y: number }[];
/** Seitliches Ausweichen beim Fallen (Physik-Einheiten), kleinste zuerst */
const NUDGES = Array.from({ length: 16 }, (_, i) => (i + 1) * 0.25).flatMap((n) => [n, -n]);

/** Zellmitten relativ zum Schwerpunkt bei rot × 90° (gerundet: keine Fließkomma-Reste von cos/sin) */
function cellsOf(shape: number, rot: number): Offs {
  return turmCellOffsets(shape, (rot * Math.PI) / 2).map((o) => ({ x: Math.round(o.x * 1000) / 1000, y: Math.round(o.y * 1000) / 1000 }));
}

/**
 * Das gesteuerte Teil – noch kein Physik-Körper. Es bewegt sich kinematisch (fallen, schieben, drehen)
 * und prüft dabei seine Zellen (Quadrate in exakt der gezeichneten Größe) gegen liegende Teile.
 */
interface Active {
  id: number;
  shape: number;
  v: number;
  x: number;
  /** Physik-y (nach unten) */
  y: number;
  rot: number;
  offs: Offs;
  /** Liegt gerade auf (Lock-Delay läuft) */
  grounded: boolean;
  /** Erstes Aufsetzen überhaupt (0 = noch nie) – begrenzt das Lock-Delay insgesamt */
  contactAt: number;
  /** Letztes Aufsetzen */
  groundedAt: number;
  lockAt: number;
  /** Landehöhe (Physik-y) für die Fall-Vorschau am TV; null = fällt ins Meer */
  ghost: number | null;
}

/** Überlappungstiefe (SAT) eines achsparallelen Quadrats (Mitte cx/cy, halbe Kante h) mit einem konvexen Teil */
function overlapDepth(cx: number, cy: number, h: number, part: Matter.Body): number {
  // Achsen des Quadrats: x und y (die Bounds von Matter sind um die Geschwindigkeit erweitert → selbst projizieren)
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of part.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  let depth = Math.min(cx + h - minX, maxX - (cx - h), cy + h - minY, maxY - (cy - h));
  if (depth <= 0) return 0;
  for (const ax of part.axes) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of part.vertices) {
      const d = v.x * ax.x + v.y * ax.y;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    const c = cx * ax.x + cy * ax.y;
    const r = h * (Math.abs(ax.x) + Math.abs(ax.y));
    const o = Math.min(c + r - lo, hi - (c - r));
    if (o <= 0) return 0;
    if (o < depth) depth = o;
  }
  return depth;
}

interface Lane {
  id: string;
  engine: Matter.Engine;
  platform: Matter.Body;
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
  /** Uhr für Eingaben/Lock-Delay (in Tests ersetzbar) */
  private clock = () => Date.now();

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
        platform,
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
      if (lane.active) lane.active.ghost = this.ghost(lane, lane.active);
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
    lane.active = this.makeActive(++this.seq, shape, v, x, y, 0);
    lane.active.ghost = this.ghost(lane, lane.active);
  }

  private makeActive(id: number, shape: number, v: number, x: number, y: number, rot: number): Active {
    return { id, shape, v, x: turmSnapX(shape, rot, x), y, rot, offs: cellsOf(shape, rot), grounded: false, contactAt: 0, groundedAt: 0, lockAt: 0, ghost: null };
  }

  /** Überlappung der Zellen an (x, y) mit einem Körper */
  private bodyDepth(body: Matter.Body, offs: Offs, x: number, y: number): number {
    const h = B / 2;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const o of offs) {
      minX = Math.min(minX, x + o.x - h);
      maxX = Math.max(maxX, x + o.x + h);
      minY = Math.min(minY, y + o.y - h);
      maxY = Math.max(maxY, y + o.y + h);
    }
    const bb = body.bounds;
    if (bb.max.x <= minX || bb.min.x >= maxX || bb.max.y <= minY || bb.min.y >= maxY) return 0;
    let worst = 0;
    const parts = body.parts.length === 1 ? body.parts : body.parts.slice(1);
    for (const part of parts) {
      const pb = part.bounds;
      if (pb.max.x <= minX || pb.min.x >= maxX || pb.max.y <= minY || pb.min.y >= maxY) continue;
      for (const o of offs) {
        const d = overlapDepth(x + o.x, y + o.y, h, part);
        if (d > worst) worst = d;
      }
    }
    return worst;
  }

  /** Passt das Teil an (x, y)? Kleine Überlappungen bis SKIN sind erlaubt. */
  private fits(lane: Lane, offs: Offs, x: number, y: number) {
    if (this.bodyDepth(lane.platform, offs, x, y) > SKIN) return false;
    for (const b of lane.bodies) if (this.bodyDepth(b, offs, x, y) > SKIN) return false;
    return true;
  }

  /**
   * Strengere Probe für „bis zum Kontakt“ (Aufsetzen, Heranschieben): an (x0, y0) → (x, y) darf das Teil
   * in keinen Körper tiefer als 0,05 eindringen, außer es streift ihn schon (schräger Nachbar) – dann
   * höchstens so tief wie vorher. Ergebnis: bündig anliegend statt um SKIN eingesunken.
   */
  private fitsFlush(lane: Lane, offs: Offs, x0: number, y0: number, x: number, y: number) {
    for (const b of [lane.platform, ...lane.bodies]) {
      const d = this.bodyDepth(b, offs, x, y);
      if (d <= 0.05) continue;
      if (d > SKIN || d > this.bodyDepth(b, offs, x0, y0) + 0.01) return false;
    }
    return true;
  }

  private inLane(x: number) {
    return Math.abs(x) <= TURM.LANE_HALF * B + 0.01;
  }

  /** Größter Weg d ∈ [0, max], für den `test(d)` noch gilt (Bisektion, auf ~1/30 Einheit genau) */
  private sweep(test: (d: number) => boolean, max: number): number {
    if (test(max)) return max;
    let lo = 0;
    let hi = max;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (test(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Nach einer erfolgreichen Bewegung im Liegen: Lock-Delay verlängern (aber nie über LOCK_MAX_MS hinaus) */
  private touched(a: Active, now: number) {
    if (a.grounded) a.lockAt = Math.min(a.contactAt + TURM.LOCK_MAX_MS, now + TURM.LOCK_MS);
  }

  private moveActive(lane: Lane, now: number) {
    const a = lane.active;
    if (!a) return;
    // Der wackelnde Turm hat sich ins Teil geschoben → nach oben ausweichen und sofort ablegen
    if (!this.fits(lane, a.offs, a.x, a.y)) {
      for (let k = 1; k <= B; k++) {
        if (this.fits(lane, a.offs, a.x, a.y - k)) {
          a.y -= k;
          break;
        }
      }
      return this.land(lane, 0);
    }
    // Windböe schiebt seitlich
    if (lane.gustDir && now < lane.gustUntil) {
      const nx = a.x + (lane.gustDir * 1.3 * B) / 60;
      if (this.inLane(nx) && this.fits(lane, a.offs, nx, a.y)) a.x = nx;
    } else lane.gustDir = 0;
    const dy = ((lane.fast ? TURM.FAST : TURM.FALL) * B) / 60;
    if (this.fits(lane, a.offs, a.x, a.y + dy)) {
      a.y += dy;
      a.grounded = false;
    } else {
      // Seitliches Entlangstreifen ist kein Aufsetzen: minimal zur Seite ausweichen und weiterfallen.
      // Bis zu einem Viertelblock – so rutscht ein Teil auch in einen genau 1 Block breiten Schacht,
      // dessen Wände nicht exakt im Raster stehen (wer nur mit einer Ecke aufkommt, kippt eh herunter).
      const nudge = a.grounded ? undefined : NUDGES.find((n) => this.fits(lane, a.offs, a.x + n, a.y + dy));
      if (nudge !== undefined) {
        a.x += nudge;
        a.y += dy;
      } else {
        // Aufsetzen: bündig bis zum Kontakt absenken, dann läuft das Lock-Delay
        a.y += this.sweep((d) => this.fitsFlush(lane, a.offs, a.x, a.y, a.x, a.y + d), dy);
        if (!a.grounded) {
          a.grounded = true;
          a.groundedAt = now;
          if (!a.contactAt) a.contactAt = now;
          a.lockAt = Math.min(a.contactAt + TURM.LOCK_MAX_MS, now + TURM.LOCK_MS);
        }
        const lockAt = lane.fast ? Math.min(a.lockAt, a.groundedAt + TURM.LOCK_FAST_MS) : a.lockAt;
        if (now >= lockAt) return this.land(lane, 0);
      }
    }
    // Neben der Plattform ins Meer gefallen
    if (a.y > LOST_Y) {
      lane.active = null;
      this.lose(lane);
    }
  }

  /** Landehöhe für die Fall-Vorschau: in Halbblock-Schritten nach unten tasten, dann genau */
  private ghost(lane: Lane, a: Active): number | null {
    if (a.grounded) return a.y;
    let y = a.y;
    const step = B / 2;
    while (this.fits(lane, a.offs, a.x, y + step)) {
      y += step;
      if (y > LOST_Y) return null;
    }
    return y + this.sweep((d) => this.fitsFlush(lane, a.offs, a.x, y, a.x, y + d), step);
  }

  /** Lock: Teil wird zum echten Physik-Körper */
  private land(lane: Lane, vy: number) {
    const a = lane.active!;
    const body = makeBody(a.shape, a.x, a.y, (a.rot * Math.PI) / 2, B, true);
    Body.setVelocity(body, { x: 0, y: vy });
    Composite.add(lane.engine.world, body);
    lane.bodies.push(body);
    lane.meta.set(body.id, [a.id, a.shape, a.v]);
    lane.active = null;
    lane.spawnAt = this.clock() + 350;
  }

  /**
   * Seitlich schieben im Halbblock-Raster (Zellkanten auf dem Raster). Klemmt es knapp, wird erst ein
   * kleines Stück nach oben/unten ausgewichen (zum Hineinschieben in Lücken), sonst bis zum Kontakt
   * geschoben – so liegt das Teil immer bündig am Nachbarn, auch wenn der nicht genau im Raster liegt.
   */
  private shift(lane: Lane, a: Active, dir: number, now: number) {
    const left = a.x + Math.min(...a.offs.map((o) => o.x)) - B / 2;
    const target = dir > 0 ? (Math.floor((left + 0.5) / STEP) + 1) * STEP : (Math.ceil((left - 0.5) / STEP) - 1) * STEP;
    const nx = Math.round((a.x + target - left) * 1000) / 1000;
    if (!this.inLane(nx)) return false;
    const dist = Math.abs(nx - a.x);
    // Feine Schritte: eine Lücke von genau einem Block lässt kaum Spiel (siehe SKIN)
    const kicks = [0];
    for (let k = 0.25; k <= TURM.KICK * B; k += 0.25) kicks.push(k, -k);
    // 1. voller Schritt, notfalls mit kleinem Ausweichen nach unten/oben
    for (const ky of kicks) {
      if (this.fits(lane, a.offs, nx, a.y + ky) && (ky === 0 || this.fits(lane, a.offs, a.x, a.y + ky))) {
        a.x = nx;
        a.y += ky;
        this.touched(a, now);
        return true;
      }
    }
    // 2. bis zum Kontakt schieben (bündig an den Nachbarn)
    let best = { d: 0, ky: 0 };
    for (const ky of kicks) {
      if (!this.fits(lane, a.offs, a.x, a.y + ky)) continue;
      const d = this.sweep((t) => this.fitsFlush(lane, a.offs, a.x, a.y + ky, a.x + dir * t, a.y + ky), dist);
      if (d > best.d + 0.25) best = { d, ky };
      if (ky === 0 && d >= 1) break;
    }
    if (best.d < 0.05) return false;
    a.x += dir * best.d;
    a.y += best.ky;
    this.touched(a, now);
    return true;
  }

  /** Drehen um den Schwerpunkt, Kanten wieder ins Raster; klemmt es, kleine Ausweich-Versuche („Kicks“) */
  private rotate(lane: Lane, a: Active, now: number) {
    const rot = (a.rot + 1) % 4;
    const offs = cellsOf(a.shape, rot);
    const bx = turmSnapX(a.shape, rot, a.x);
    const cands: [number, number][] = [];
    for (const kx of [0, -STEP, STEP, -2 * STEP, 2 * STEP]) {
      for (let ky = 0; ky <= TURM.KICK * B; ky += 1) {
        cands.push([kx, -ky]);
        if (ky) cands.push([kx, ky]);
      }
    }
    // Kleine Ausweichbewegungen zuerst; bei Gleichstand lieber nach oben als zur Seite
    cands.sort((p, q) => Math.abs(p[0]) + Math.abs(p[1]) * 0.9 - (Math.abs(q[0]) + Math.abs(q[1]) * 0.9));
    for (const [kx, ky] of cands) {
      const nx = bx + kx;
      if (!this.inLane(nx) || !this.fits(lane, offs, nx, a.y + ky)) continue;
      a.x = nx;
      a.y += ky;
      a.rot = rot;
      a.offs = offs;
      this.touched(a, now);
      return true;
    }
    return false;
  }

  private lose(lane: Lane) {
    lane.lostSeq += 1;
    // Stürzt der halbe Turm ein, kostet das nicht sofort alle Leben: kurze Schonfrist
    const now = this.clock();
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
    const now = this.clock();
    const moved = action === 'shift' ? this.shift(lane, a, Number(asRecord(payload).dir) < 0 ? -1 : 1, now) : action === 'rotate' ? this.rotate(lane, a, now) : false;
    if (!moved) return;
    a.ghost = this.ghost(lane, a);
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
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return { id: a.id, shape: a.shape, v: a.v, x: r1(a.x), y: r1(-a.y), rot: a.rot, gy: a.ghost === null ? null : r1(-a.ghost), rest: a.grounded };
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

  /** Nur für `scripts/test-turm.ts`: Spiel ohne Timer steuern (Uhr und Physik-Schritte von außen) */
  testApi() {
    const g = this;
    let t = Date.now();
    g.clock = () => t;
    return {
      begin() {
        g.timers.clear();
        g.sub = 'play';
        g.startedAt = t;
        g.deadline = Infinity;
        g.nextGust = Infinity;
        for (const l of g.lanes) l.spawnAt = Infinity;
      },
      lane: (i: number) => g.lanes[i],
      /** Liegendes Teil (Physik-y nach unten, x/y = Schwerpunkt) */
      place(i: number, shape: number, x: number, y: number, rot: number, isStatic: boolean) {
        const lane = g.lanes[i];
        const body = makeBody(shape, x, y, (rot * Math.PI) / 2, B, !isStatic);
        Composite.add(lane.engine.world, body);
        lane.bodies.push(body);
        lane.meta.set(body.id, [++g.seq, shape, 0]);
        return body;
      },
      activate(i: number, shape: number, x: number, y: number, rot: number) {
        const lane = g.lanes[i];
        lane.active = g.makeActive(++g.seq, shape, 0, x, y, rot);
        lane.active.ghost = g.ghost(lane, lane.active);
        return lane.active;
      },
      /** Ein Physik-Schritt (1/60 s) */
      step(n = 1) {
        for (let k = 0; k < n; k++) {
          t += STEP_MS;
          g.tick(t, 1);
        }
      },
      input: (id: string, action: string, payload?: unknown) => g.input(id, action, payload),
      cells: (shape: number, rot: number) => cellsOf(shape, rot),
      SKIN,
    };
  }

  dispose() {
    this.timers.clear();
    for (const l of this.lanes) {
      Composite.clear(l.engine.world, false);
      Engine.clear(l.engine);
    }
  }
}
