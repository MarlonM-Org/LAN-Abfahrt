import Matter from 'matter-js';
import type { MiniSnapshot } from '../shared/types';
import { KOFFER, KOFFER_BAG, KOFFER_ITEMS, type KofferActive, type KofferCar, kofferCellOffsets, kofferCellsInside, kofferSnapX } from '../shared/koffer';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const { Bodies, Body, Composite, Engine } = Matter;

const TICK_MS = 50;
/** Rundenlänge (zum Testen kürzer: KOFFER_TIME_MS=60000 npm run dev) */
const TIME_MS = Number(process.env.KOFFER_TIME_MS) || KOFFER.TIME_MS;
const STEP_MS = 1000 / 60;
const B = KOFFER.BLOCK;
const W = KOFFER.W * B;
/** Liegt der Schwerpunkt tiefer (Physik-y nach unten) oder weiter weg, ist das Teil rausgefallen */
const LOST_Y = 1.5 * B;
const LOST_X0 = -2 * B;
const LOST_X1 = (KOFFER.W + KOFFER.OVERHANG + 4) * B;
const STEP = KOFFER.STEP * B;
/** Erlaubte Überlappung des gesteuerten Teils mit liegenden Teilen (wie beim Wackelturm) */
const SKIN = 0.35;
const NUDGES = Array.from({ length: 16 }, (_, i) => (i + 1) * 0.25).flatMap((n) => [n, -n]);

type Offs = { x: number; y: number }[];

function cellsOf(item: number, rot: number): Offs {
  return kofferCellOffsets(item, (rot * Math.PI) / 2).map((o) => ({ x: Math.round(o.x * 1000) / 1000, y: Math.round(o.y * 1000) / 1000 }));
}

/** Gesteuertes Teil (noch kein Physik-Körper) – bewegt sich kinematisch wie beim Wackelturm */
interface Active {
  id: number;
  item: number;
  v: number;
  x: number;
  y: number;
  rot: number;
  offs: Offs;
  grounded: boolean;
  contactAt: number;
  groundedAt: number;
  lockAt: number;
  ghost: number | null;
  owner: string;
}

/** Überlappungstiefe (SAT) eines achsparallelen Quadrats mit einem konvexen Teil */
function overlapDepth(cx: number, cy: number, h: number, part: Matter.Body): number {
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

interface Car {
  id: string;
  owners: string[];
  /** Wer als Nächstes ein Teil steuert (Index in owners) */
  turn: number;
  engine: Matter.Engine;
  /** Boden, Lehne, Ladekante */
  statics: Matter.Body[];
  bodies: Matter.Body[];
  /** Physik-Körper → [Teil-ID, Gepäckstück, Variante] */
  meta: Map<number, [number, number, number]>;
  active: Active | null;
  spawnAt: number;
  /** Position in der gemeinsamen Teile-Reihenfolge */
  seqIdx: number;
  fast: boolean;
  liters: number;
  pct: number;
  count: number;
  lost: number;
  lostSeq: number;
  full: boolean;
}

/** Kompound-Körper aus quadratischen Zellen (Schwerpunkt = (x, y)) */
function makeBody(item: number, x: number, y: number, angle: number): Matter.Body {
  const parts = kofferCellOffsets(item, 0).map((o) => Bodies.rectangle(x + o.x, y + o.y, B, B));
  const body = Body.create({ parts, friction: 1, frictionStatic: 4, restitution: 0, frictionAir: 0.03, slop: 0.03 });
  Body.setDensity(body, 0.001 * KOFFER_ITEMS[item].density);
  Body.setInertia(body, body.inertia * 4);
  Body.setAngle(body, angle);
  // Länger wach bleiben als beim Wackelturm: ein Teil, das hinten über die Ladekante hängt, kippt
  // langsam an – es soll dabei nicht „einschlafen“, sondern wirklich rausfallen.
  body.sleepThreshold = 200;
  return body;
}

/**
 * Kofferpacken: Jeder (ab 9 Spielern je zwei) packt den Kofferraum seines Kombis für die Urlaubsfahrt.
 * Gesteuert wird wie beim Wackelturm (verschieben, drehen, fallen lassen); liegende Teile sind echte
 * Physik-Körper. Hinten ist die Heckklappe offen: Was über die Ladekante kippt, fällt auf die Straße.
 * Nach Ablauf der Zeit klappt die Heckklappe zu – gezählt wird das Volumen im Kofferraum.
 */
export class KofferGame implements MiniGame {
  readonly kind = 'koffer' as const;
  private cars: Car[] = [];
  private sub: KofferState['sub'] = 'countdown';
  private deadline = Date.now() + KOFFER.COUNTDOWN_MS;
  private seq = 0;
  /** Gemeinsame Teile-Reihenfolge: alle Autos bekommen dieselben Teile (fair) */
  private order: [number, number][] = [];
  private timers = new Timers();
  private allFullAt = 0;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const teams: string[][] = [];
    if (ids.length >= KOFFER.TEAM_FROM) {
      const mixed = shuffle(ids);
      for (let i = 0; i < mixed.length; i += 2) teams.push(mixed.slice(i, i + 2));
    } else for (const id of ids) teams.push([id]);
    teams.forEach((owners, i) => {
      const engine = Engine.create({ enableSleeping: true, positionIterations: 10, velocityIterations: 8 });
      engine.gravity.scale = 0.0006;
      const opts = { isStatic: true, friction: 1, frictionStatic: 1.5 };
      const floor = Bodies.rectangle((W - B) / 2 + (KOFFER.LIP_T * B) / 2, B / 2, W + B + KOFFER.LIP_T * B, B, opts);
      const wallH = (KOFFER.VIEW_TOP + 4) * B;
      const seat = Bodies.rectangle(-B / 2, -wallH / 2 + B, B, wallH + 2 * B, opts);
      const lip = Bodies.rectangle(W + (KOFFER.LIP_T * B) / 2, (-KOFFER.LIP * B) / 2, KOFFER.LIP_T * B, KOFFER.LIP * B, opts);
      const statics = [floor, seat, lip];
      Composite.add(engine.world, statics);
      this.cars.push({
        id: `car${i}`,
        owners,
        turn: 0,
        engine,
        statics,
        bodies: [],
        meta: new Map(),
        active: null,
        spawnAt: 0,
        seqIdx: 0,
        fast: false,
        liters: 0,
        pct: 0,
        count: 0,
        lost: 0,
        lostSeq: 0,
        full: false,
      });
    });
    this.timers.later(KOFFER.COUNTDOWN_MS, () => this.start());
  }

  private pieceAt(i: number): [number, number] {
    while (this.order.length <= i) {
      for (const item of shuffle(KOFFER_BAG)) this.order.push([item, Math.floor(Math.random() * 3)]);
    }
    return this.order[i];
  }

  private start() {
    this.sub = 'play';
    this.deadline = Date.now() + TIME_MS;
    for (const car of this.cars) this.spawn(car);
    let last = Date.now();
    let carry = 0;
    this.timers.every(TICK_MS, () => {
      const now = Date.now();
      carry += now - last;
      last = now;
      const steps = Math.min(6, Math.floor(carry / STEP_MS));
      carry = Math.min(carry - steps * STEP_MS, STEP_MS);
      this.tick(now, steps);
    });
    this.ctx.onChange();
  }

  private tick(now: number, steps: number) {
    if (this.sub !== 'play' && this.sub !== 'settle') return;
    for (const car of this.cars) {
      for (let i = 0; i < steps; i++) {
        if (this.sub === 'play') this.moveActive(car, now);
        Engine.update(car.engine, STEP_MS);
      }
      this.cleanup(car);
      this.measure(car);
      if (this.sub !== 'play') continue;
      if (car.active) car.active.ghost = this.ghost(car, car.active);
      if (!car.active && now >= car.spawnAt) this.spawn(car);
    }
    // Alle Kofferräume bis oben voll → nicht unnötig warten
    if (this.sub === 'play' && this.cars.every((c) => c.full && !c.active)) {
      if (!this.allFullAt) this.allFullAt = now;
      if (now - this.allFullAt > 2500) this.deadline = Math.min(this.deadline, now);
    } else this.allFullAt = 0;
    if (now >= this.deadline) {
      if (this.sub === 'play') {
        // Zeit um: das gerade gesteuerte Teil fällt weg, der Rest darf sich noch kurz setzen
        this.sub = 'settle';
        this.deadline = now + KOFFER.SETTLE_MS;
        for (const car of this.cars) car.active = null;
      } else return this.end();
    }
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Gesteuertes Teil

  private spawn(car: Car) {
    const top = this.topY(car);
    const [item, v] = this.pieceAt(car.seqIdx);
    const y = -Math.min((KOFFER.VIEW_TOP - 1.5) * B, Math.max(-top + KOFFER.SPAWN_GAP * B, KOFFER.SPAWN_MIN * B));
    // Platz zum Erscheinen: Mitte, sonst nach links/rechts ausweichen. Nirgends Platz → bis oben voll,
    // es kommt erst wieder ein Teil, wenn etwas rausgefallen ist oder nachgibt.
    const offs = cellsOf(item, 0);
    let x: number | null = null;
    for (let d = 0; d <= KOFFER.W * B && x === null; d += STEP) {
      for (const c of d ? [W / 2 - d, W / 2 + d] : [W / 2]) {
        const sx = kofferSnapX(item, 0, c);
        if (this.inLane(offs, sx) && sx <= W && this.fits(car, offs, sx, y)) {
          x = sx;
          break;
        }
      }
    }
    car.full = x === null;
    if (x === null) {
      car.spawnAt = Date.now() + 500;
      return;
    }
    car.seqIdx++;
    car.fast = false;
    // Abwechselnd steuern (Teams); wer gerade nicht verbunden ist, wird übersprungen
    let owner = car.owners[car.turn % car.owners.length];
    for (let k = 0; k < car.owners.length; k++) {
      const o = car.owners[(car.turn + k) % car.owners.length];
      if (this.ctx.isConnected(o)) {
        owner = o;
        car.turn = (car.turn + k) % car.owners.length;
        break;
      }
    }
    car.turn = (car.turn + 1) % car.owners.length;
    car.active = this.makeActive(++this.seq, item, v, x, y, 0, owner);
    car.active.ghost = this.ghost(car, car.active);
  }

  private makeActive(id: number, item: number, v: number, x: number, y: number, rot: number, owner: string): Active {
    return { id, item, v, x: kofferSnapX(item, rot, x), y, rot, offs: cellsOf(item, rot), grounded: false, contactAt: 0, groundedAt: 0, lockAt: 0, ghost: null, owner };
  }

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

  private fits(car: Car, offs: Offs, x: number, y: number) {
    for (const b of car.statics) if (this.bodyDepth(b, offs, x, y) > SKIN) return false;
    for (const b of car.bodies) if (this.bodyDepth(b, offs, x, y) > SKIN) return false;
    return true;
  }

  private fitsFlush(car: Car, offs: Offs, x0: number, y0: number, x: number, y: number) {
    for (const b of [...car.statics, ...car.bodies]) {
      const d = this.bodyDepth(b, offs, x, y);
      if (d <= 0.05) continue;
      if (d > SKIN || d > this.bodyDepth(b, offs, x0, y0) + 0.01) return false;
    }
    return true;
  }

  /** Zellkanten zwischen Lehne und „knapp hinter der Ladekante“ */
  private inLane(offs: Offs, x: number) {
    const left = x + Math.min(...offs.map((o) => o.x)) - B / 2;
    const right = x + Math.max(...offs.map((o) => o.x)) + B / 2;
    return left >= -0.01 && right <= W + KOFFER.OVERHANG * B + 0.01;
  }

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

  private touched(a: Active, now: number) {
    if (a.grounded) a.lockAt = Math.min(a.contactAt + KOFFER.LOCK_MAX_MS, now + KOFFER.LOCK_MS);
  }

  private moveActive(car: Car, now: number) {
    const a = car.active;
    if (!a) return;
    if (!this.fits(car, a.offs, a.x, a.y)) {
      for (let k = 1; k <= B; k++) {
        if (this.fits(car, a.offs, a.x, a.y - k)) {
          a.y -= k;
          break;
        }
      }
      return this.land(car);
    }
    const dy = ((car.fast ? KOFFER.FAST : KOFFER.FALL) * B) / 60;
    if (this.fits(car, a.offs, a.x, a.y + dy)) {
      a.y += dy;
      a.grounded = false;
    } else {
      const nudge = a.grounded ? undefined : NUDGES.find((n) => this.inLane(a.offs, a.x + n) && this.fits(car, a.offs, a.x + n, a.y + dy));
      if (nudge !== undefined) {
        a.x += nudge;
        a.y += dy;
      } else {
        a.y += this.sweep((d) => this.fitsFlush(car, a.offs, a.x, a.y, a.x, a.y + d), dy);
        if (!a.grounded) {
          a.grounded = true;
          a.groundedAt = now;
          if (!a.contactAt) a.contactAt = now;
          a.lockAt = Math.min(a.contactAt + KOFFER.LOCK_MAX_MS, now + KOFFER.LOCK_MS);
        }
        const lockAt = car.fast ? Math.min(a.lockAt, a.groundedAt + KOFFER.LOCK_FAST_MS) : a.lockAt;
        if (now >= lockAt) return this.land(car);
      }
    }
    // Hinter dem Auto auf die Straße gefallen
    if (a.y > LOST_Y) {
      car.active = null;
      car.spawnAt = now + 400;
      car.lost += 1;
      car.lostSeq += 1;
    }
  }

  private ghost(car: Car, a: Active): number | null {
    if (a.grounded) return a.y;
    let y = a.y;
    const step = B / 2;
    while (this.fits(car, a.offs, a.x, y + step)) {
      y += step;
      if (y > LOST_Y) return null;
    }
    return y + this.sweep((d) => this.fitsFlush(car, a.offs, a.x, y, a.x, y + d), step);
  }

  private land(car: Car) {
    const a = car.active!;
    const body = makeBody(a.item, a.x, a.y, (a.rot * Math.PI) / 2);
    Composite.add(car.engine.world, body);
    car.bodies.push(body);
    car.meta.set(body.id, [a.id, a.item, a.v]);
    car.active = null;
    car.spawnAt = Date.now() + 200;
  }

  private shift(car: Car, a: Active, dir: number, now: number) {
    const left = a.x + Math.min(...a.offs.map((o) => o.x)) - B / 2;
    const target = dir > 0 ? (Math.floor((left + 0.5) / STEP) + 1) * STEP : (Math.ceil((left - 0.5) / STEP) - 1) * STEP;
    const nx = Math.round((a.x + target - left) * 1000) / 1000;
    if (!this.inLane(a.offs, nx)) return false;
    const dist = Math.abs(nx - a.x);
    const kicks = [0];
    for (let k = 0.25; k <= KOFFER.KICK * B; k += 0.25) kicks.push(k, -k);
    for (const ky of kicks) {
      if (this.fits(car, a.offs, nx, a.y + ky) && (ky === 0 || this.fits(car, a.offs, a.x, a.y + ky))) {
        a.x = nx;
        a.y += ky;
        this.touched(a, now);
        return true;
      }
    }
    let best = { d: 0, ky: 0 };
    for (const ky of kicks) {
      if (!this.fits(car, a.offs, a.x, a.y + ky)) continue;
      const d = this.sweep((t) => this.fitsFlush(car, a.offs, a.x, a.y + ky, a.x + dir * t, a.y + ky), dist);
      if (d > best.d + 0.25) best = { d, ky };
      if (ky === 0 && d >= 1) break;
    }
    if (best.d < 0.05) return false;
    a.x += dir * best.d;
    a.y += best.ky;
    this.touched(a, now);
    return true;
  }

  private rotate(car: Car, a: Active, now: number) {
    const rot = (a.rot + 1) % 4;
    const offs = cellsOf(a.item, rot);
    const bx = kofferSnapX(a.item, rot, a.x);
    const cands: [number, number][] = [];
    for (const kx of [0, -STEP, STEP, -2 * STEP, 2 * STEP, -3 * STEP, 3 * STEP]) {
      for (let ky = 0; ky <= KOFFER.KICK * B; ky += 1) {
        cands.push([kx, -ky]);
        if (ky) cands.push([kx, ky]);
      }
    }
    cands.sort((p, q) => Math.abs(p[0]) + Math.abs(p[1]) * 0.9 - (Math.abs(q[0]) + Math.abs(q[1]) * 0.9));
    for (const [kx, ky] of cands) {
      const nx = bx + kx;
      if (!this.inLane(offs, nx) || !this.fits(car, offs, nx, a.y + ky)) continue;
      a.x = nx;
      a.y += ky;
      a.rot = rot;
      a.offs = offs;
      this.touched(a, now);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- Messen

  /** Höchster Punkt (Physik-y, negativ = hoch) aller Teile im Auto */
  private topY(car: Car) {
    let top = 0;
    for (const b of car.bodies) if (b.position.x < W + B) top = Math.min(top, b.bounds.min.y);
    return top;
  }

  /** Rausgefallene Teile entfernen */
  private cleanup(car: Car) {
    for (let i = car.bodies.length - 1; i >= 0; i--) {
      const b = car.bodies[i];
      if (b.position.y > LOST_Y || b.position.x < LOST_X0 || b.position.x > LOST_X1) {
        Composite.remove(car.engine.world, b);
        car.bodies.splice(i, 1);
        car.meta.delete(b.id);
        car.lost += 1;
        car.lostSeq += 1;
      }
    }
  }

  private measure(car: Car) {
    let inside = 0;
    let outside = 0;
    for (const b of car.bodies) {
      const meta = car.meta.get(b.id);
      if (!meta) continue;
      const r = kofferCellsInside(meta[1], b.position.x, -b.position.y, b.angle);
      inside += r.inside;
      outside += r.outside;
    }
    car.count = car.bodies.length;
    car.liters = Math.round((inside + outside * KOFFER.OUTSIDE) * KOFFER.LITER);
    car.pct = Math.min(100, Math.round((inside / (KOFFER.W * KOFFER.ROOF)) * 100));
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    if (this.sub !== 'play') return;
    const car = this.cars.find((c) => c.owners.includes(id));
    const a = car?.active;
    if (!car || !a || a.owner !== id) return;
    if (action === 'drop') {
      car.fast = !!asRecord(payload).on;
      return;
    }
    const now = Date.now();
    const moved = action === 'shift' ? this.shift(car, a, Number(asRecord(payload).dir) < 0 ? -1 : 1, now) : action === 'rotate' ? this.rotate(car, a, now) : false;
    if (!moved) return;
    a.ghost = this.ghost(car, a);
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Ende

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.timers.clear();
    for (const car of this.cars) {
      car.active = null;
      this.measure(car);
    }
    this.ctx.onChange();
    const carOf = new Map<string, Car>();
    for (const c of this.cars) for (const o of c.owners) carOf.set(o, c);
    const score = (id: string) => carOf.get(id)?.liters ?? -1;
    const best = [...this.cars].sort((a, b) => b.liters - a.liters)[0];
    const names = (c: Car) => c.owners.map((o) => this.ctx.nameOf(o)).join(' & ');
    const subtitle = !best || best.liters <= 0 ? 'Leerer Kofferraum – dann eben ohne Gepäck!' : `${names(best)} ${best.owners.length > 1 ? 'packen' : 'packt'} am meisten ein: ${best.liters} Liter!`;
    this.timers.later(KOFFER.OVER_MS, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, score),
        details: Object.fromEntries(
          this.ids.map((id) => {
            const c = carOf.get(id);
            return [id, c ? `${c.liters} L · ${c.pct} %` : '–'];
          }),
        ),
        subtitle,
      }),
    );
  }

  // ---------------------------------------------------------------- Zustand

  private activeSnap(a: Active | null): KofferActive | null {
    if (!a) return null;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return { id: a.id, item: a.item, v: a.v, x: r1(a.x), y: r1(-a.y), rot: a.rot, gy: a.ghost === null ? null : r1(-a.ghost), rest: a.grounded, owner: a.owner };
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const cars: KofferCar[] = this.cars.map((c) => {
      const pieces: number[] = [];
      for (const b of c.bodies) {
        const meta = c.meta.get(b.id);
        if (!meta) continue;
        pieces.push(meta[0], meta[1], meta[2], Math.round(b.position.x), Math.round(-b.position.y), Math.round(b.angle * 100));
      }
      return {
        id: c.id,
        owners: c.owners,
        next: this.pieceAt(c.seqIdx),
        active: this.activeSnap(c.active),
        pieces,
        liters: c.liters,
        pct: c.pct,
        count: c.count,
        lost: c.lost,
        lostSeq: c.lostSeq,
        full: c.full,
      };
    });
    return { kind: 'koffer', state: { sub: this.sub, endsIn: Math.max(0, this.deadline - now), cars } };
  }

  playerDisconnected(id: string) {
    const car = this.cars.find((c) => c.owners.includes(id));
    if (!car) return;
    car.fast = false;
    // Im Team übernimmt der Partner das aktuelle Teil
    const partner = car.owners.find((o) => o !== id && this.ctx.isConnected(o));
    if (car.active?.owner === id && partner) car.active.owner = partner;
  }

  dispose() {
    this.timers.clear();
    for (const c of this.cars) {
      Composite.clear(c.engine.world, false);
      Engine.clear(c.engine);
    }
  }
}

type KofferState = import('../shared/koffer').KofferState;
