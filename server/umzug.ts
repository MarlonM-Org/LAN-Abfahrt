import Matter from 'matter-js';
import type { MiniSnapshot, Team } from '../shared/types';
import { TEAM_INFO } from '../shared/flunky';
import { SHIRTS } from '../shared/avatar';
import {
  K,
  UMZUG as U,
  UMZUG_KINDS,
  UMZUG_LAYOUTS,
  type UmzugEvent,
  type UmzugGeo,
  type UmzugHouse,
  type UmzugItem,
  type UmzugLayoutId,
  type UmzugPlayer,
  type UmzugState,
  grabPoints,
  inRect,
  umzugCols,
  umzugGrid,
  umzugIsWall,
  umzugItemPos,
  umzugRows,
  umzugStars,
  umzugTileCh,
  umzugTileOf,
  umzugTruckZone,
  umzugWalkable,
} from '../shared/umzug';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const { Bodies, Body, Composite, Constraint, Engine, Events } = Matter;

const TICK_MS = 50;
const STEP_MS = 1000 / 60;
/** Rundenlänge (zum Testen kürzer: UMZUG_TIME_MS=60000 npm run dev) */
const TIME_MS = Number(process.env.UMZUG_TIME_MS) || U.TIME_MS;
const T = U.TILE;
const R = U.PLAYER_R;
/** Luftreibung der Figuren (pro Schritt) – daraus ergibt sich die Kraft für die Zielgeschwindigkeit */
const PLAYER_FA = 0.2;
/** Matter: Δv pro Schritt = F/m · dt² */
const DT2 = STEP_MS * STEP_MS;
const ACC = ((U.SPEED / 60) * PLAYER_FA) / DT2;
const CAT_WALL = 1;
const CAT_ITEM = 2;
const playerCat = (i: number) => 1 << (2 + i);

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const hexNum = (s: string) => parseInt(s.slice(1), 16);

interface House extends UmzugGeo {
  team: Team | null;
  engine: Matter.Engine;
  zone: { x: number; y: number; w: number; h: number };
  windows: Map<string, Matter.Body>;
  broken: Set<string>;
  score: number;
  max: number;
  bonus: number;
  delivered: number[];
  left: number;
  brokenCount: number;
  doneAt: number;
  size: number;
}

interface Item {
  id: number;
  k: number;
  h: number;
  body: Matter.Body | null;
  /** 0 Boden, 1 getragen (leicht), 2 fliegt */
  s: 0 | 1 | 2;
  /** Träger pro Griffende (schwer) bzw. [Träger] (leicht) */
  by: (string | null)[];
  cons: (Matter.Constraint | null)[];
  /** Wer zuletzt dran war (Wertung für geschobene/geworfene Teile) */
  last: string | null;
  fly: { x: number; y: number; dx: number; dy: number; t: number; range: number; who: string } | null;
  x: number;
  y: number;
  a: number;
  gone: boolean;
}

interface P {
  id: string;
  idx: number;
  k: number;
  body: Matter.Body;
  fx: number;
  fy: number;
  sx: number;
  sy: number;
  moving: boolean;
  grab: Item | null;
  grabUntil: number;
  dashUntil: number;
  dashCd: number;
  ddx: number;
  ddy: number;
  color: number;
  no: number;
  st: [number, number, number, number, number];
  pts: number;
  /** Getragene Arten (für „trug 7 Kartons“) */
  carried: Map<number, number>;
  brokeKinds: Map<number, number>;
  zwergFenster: boolean;
}

/**
 * Umzugschaos: Das Ferienhaus muss leer sein, bevor der Vermieter kommt. Leichte Sachen trägt man
 * (und wirft sie – gern durchs Fenster), Schweres packt man zu zweit an den Enden an und zerrt es
 * durch die Türrahmen. Physik (matter-js) läuft auf dem Server; bis 6 Spieler ein Haus, ab 7 zwei
 * Häuser nebeneinander (Team Sonne gegen Team Meer).
 */
export class UmzugGame implements MiniGame {
  readonly kind = 'umzug' as const;
  private players = new Map<string, P>();
  private houses: House[] = [];
  private items: Item[] = [];
  private byBody = new Map<number, Item>();
  private playerByBody = new Map<number, P>();
  private events: (UmzugEvent & { at: number })[] = [];
  private seq = 0;
  private itemSeq = 0;
  private sub: UmzugState['sub'] = 'countdown';
  private deadline = Date.now() + U.COUNTDOWN_MS;
  private timers = new Timers();
  private readonly teams: boolean;
  private stars = 0;
  private winner: Team | null = null;
  /** Tick-Zeit messen: UMZUG_PROF=1 npm run dev */
  private prof = process.env.UMZUG_PROF ? { n: 0, sum: 0, max: 0, slow: 0 } : null;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const n = ids.length;
    this.teams = n >= U.TEAM_FROM;
    const order = shuffle(ids);
    const sizes = this.teams ? [Math.ceil(n / 2), Math.floor(n / 2)] : [n];
    if (this.teams) {
      this.makeHouse('small', false, 0, 'A', sizes[0]);
      this.makeHouse('small', true, 240, 'B', sizes[1]);
    } else this.makeHouse('wide', false, 0, null, n);

    // Startplätze: Bodenkacheln in der Mitte des Hauses, verteilt
    const used: { x: number; y: number }[] = this.items.map((i) => ({ x: i.x, y: i.y }));
    order.forEach((id, i) => {
      const k = this.teams ? i % 2 : 0;
      const house = this.houses[k];
      const spots: { x: number; y: number }[] = [];
      for (let r = 2; r < umzugRows(house.layout) - 2; r++) {
        for (let c = 2; c < umzugCols(house.layout) - 2; c++) {
          if (umzugTileCh(house, c, r) !== '.') continue;
          const x = house.x0 + (c + 0.5) * T;
          const y = U.Y0 + (r + 0.5) * T;
          if (used.every((u) => Math.hypot(u.x - x, u.y - y) > 20)) spots.push({ x, y });
        }
      }
      const spot = spots[Math.floor((i * 7919) % Math.max(1, spots.length))] ?? { x: house.x0 + 120, y: 150 };
      used.push(spot);
      const look = ctx.lookOf?.(id);
      const body = Bodies.circle(spot.x, spot.y, R, {
        frictionAir: PLAYER_FA,
        friction: 0,
        restitution: 0.1,
        inertia: Infinity,
        label: `p:${id}`,
        collisionFilter: { category: playerCat(i), mask: 0xffffffff },
      });
      Composite.add(house.engine.world, body);
      const p: P = {
        id,
        idx: i,
        k,
        body,
        fx: 0,
        fy: 1,
        sx: 0,
        sy: 0,
        moving: false,
        grab: null,
        grabUntil: 0,
        dashUntil: 0,
        dashCd: 0,
        ddx: 0,
        ddy: 1,
        color: house.team ? TEAM_INFO[house.team].colorNum : hexNum(SHIRTS[look?.shirt ?? i % SHIRTS.length] ?? '#f2c33a'),
        no: 0,
        st: [0, 0, 0, 0, 0],
        pts: 0,
        carried: new Map(),
        brokeKinds: new Map(),
        zwergFenster: false,
      };
      this.players.set(id, p);
      this.playerByBody.set(body.id, p);
    });
    this.timers.later(U.COUNTDOWN_MS, () => this.start());
  }

  // ---------------------------------------------------------------- Aufbau

  private makeHouse(layout: UmzugLayoutId, mirror: boolean, x0: number, team: Team | null, size: number): House {
    const grid = umzugGrid(layout, mirror);
    const engine = Engine.create({ enableSleeping: false, positionIterations: 6, velocityIterations: 4 });
    engine.gravity.scale = 0;
    const geo: UmzugGeo = { x0, layout, mirror, grid };
    const house: House = {
      ...geo,
      team,
      engine,
      zone: umzugTruckZone(geo),
      windows: new Map(),
      broken: new Set(),
      score: 0,
      max: 0,
      bonus: 0,
      delivered: [],
      left: 0,
      brokenCount: 0,
      doneAt: 0,
      size,
    };
    const wallOpts = { isStatic: true, friction: 0, restitution: 0, label: 'wall', collisionFilter: { category: CAT_WALL, mask: 0xffffffff } };
    const statics: Matter.Body[] = [];
    // Wände zeilenweise zu Balken zusammenfassen (Fenster einzeln, damit sie zerbrechen können)
    grid.forEach((row, r) => {
      let c = 0;
      while (c < row.length) {
        const ch = row[c];
        if (ch === 'W') {
          const b = Bodies.rectangle(x0 + (c + 0.5) * T, U.Y0 + (r + 0.5) * T, T, T, { ...wallOpts, label: 'window' });
          house.windows.set(`${c},${r}`, b);
          statics.push(b);
          c++;
          continue;
        }
        if (!umzugIsWall(ch)) {
          c++;
          continue;
        }
        let e = c;
        while (e + 1 < row.length && umzugIsWall(row[e + 1]) && row[e + 1] !== 'W') e++;
        statics.push(Bodies.rectangle(x0 + ((c + e + 1) / 2) * T, U.Y0 + (r + 0.5) * T, (e - c + 1) * T, T, wallOpts));
        c = e + 1;
      }
    });
    // Außenrand (HUD-Kante oben, Spielfeldrand)
    const W = umzugCols(layout) * T;
    const H = umzugRows(layout) * T;
    statics.push(
      Bodies.rectangle(x0 + W / 2, U.Y0 - T / 2, W + 2 * T, T, wallOpts),
      Bodies.rectangle(x0 + W / 2, U.Y0 + H + T / 2, W + 2 * T, T, wallOpts),
      Bodies.rectangle(x0 - T / 2, U.Y0 + H / 2, T, H + 2 * T, wallOpts),
      Bodies.rectangle(x0 + W + T / 2, U.Y0 + H / 2, T, H + 2 * T, wallOpts),
    );
    Composite.add(engine.world, statics);

    // Möbel
    const hi = this.houses.length;
    this.houses.push(house);
    for (const [k, c, r, a, from] of UMZUG_LAYOUTS[layout].items) {
      if (size < from) continue;
      const pos = umzugItemPos(geo, c, r);
      const ang = mirror ? -a : a;
      const item = this.makeItem(k, hi, pos.x, pos.y, (ang * Math.PI) / 180);
      this.items.push(item);
      house.max += UMZUG_KINDS[k].pts;
      house.left++;
    }
    Events.on(engine, 'collisionStart', (e) => this.onCollision(e));
    return house;
  }

  private makeItem(k: number, h: number, x: number, y: number, angle: number): Item {
    const item: Item = { id: ++this.itemSeq, k, h, body: null, s: 0, by: UMZUG_KINDS[k].heavy ? [null, null] : [null], cons: [null, null], last: null, fly: null, x, y, a: angle, gone: false };
    this.addBody(item, x, y, angle);
    return item;
  }

  private addBody(item: Item, x: number, y: number, angle: number, vx = 0, vy = 0) {
    const kind = UMZUG_KINDS[item.k];
    const body = Bodies.rectangle(x, y, kind.w, kind.h, {
      frictionAir: kind.heavy ? 0.2 : 0.14,
      friction: 0.02,
      restitution: kind.heavy ? 0 : 0.25,
      density: 0.001 * kind.density,
      angle,
      label: `i:${item.id}`,
      collisionFilter: { category: CAT_ITEM, mask: 0xffffffff },
    });
    if (kind.heavy) Body.setInertia(body, body.inertia * 1.5);
    item.body = body;
    item.s = 0;
    item.x = x;
    item.y = y;
    item.a = angle;
    this.byBody.set(body.id, item);
    Composite.add(this.houses[item.h].engine.world, body);
    if (vx || vy) Body.setVelocity(body, { x: vx, y: vy });
  }

  private removeBody(item: Item) {
    if (!item.body) return;
    const world = this.houses[item.h].engine.world;
    for (let i = 0; i < item.cons.length; i++) {
      const c = item.cons[i];
      if (c) Composite.remove(world, c);
      item.cons[i] = null;
    }
    Composite.remove(world, item.body);
    this.byBody.delete(item.body.id);
    item.body = null;
  }

  private start() {
    this.sub = 'play';
    const now = Date.now();
    this.deadline = now + TIME_MS;
    let last = now;
    let carry = 0;
    this.timers.every(TICK_MS, () => {
      const t = Date.now();
      carry += t - last;
      last = t;
      const steps = Math.min(5, Math.floor(carry / STEP_MS));
      carry = Math.min(carry - steps * STEP_MS, STEP_MS);
      const t0 = this.prof ? performance.now() : 0;
      this.tick(t, steps);
      if (this.prof) {
        const ms = performance.now() - t0;
        this.prof.n++;
        this.prof.sum += ms;
        this.prof.max = Math.max(this.prof.max, ms);
        if (ms > 10) this.prof.slow++;
        if (this.prof.n % 100 === 0) console.log(`[umzug] tick ø ${(this.prof.sum / this.prof.n).toFixed(2)} ms, max ${this.prof.max.toFixed(2)} ms, ${this.prof.slow}× >10 ms, ${this.players.size} Spieler, ${this.items.filter((i) => !i.gone).length} Teile`);
      }
    });
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Tick

  private tick(now: number, steps: number) {
    if (this.sub !== 'play') return;
    for (let s = 0; s < steps; s++) {
      for (const p of this.players.values()) this.drive(p, now);
      for (const it of this.items) if (it.fly) this.flyStep(it, STEP_MS);
      for (const h of this.houses) Engine.update(h.engine, STEP_MS);
    }
    for (const p of this.players.values()) {
      const b = p.body;
      // Sicherheitsnetz: im Spielfeld halten
      const h = this.houses[p.k];
      const cx = clamp(b.position.x, h.x0 + R, h.x0 + umzugCols(h.layout) * T - R);
      const cy = clamp(b.position.y, U.Y0 + R, U.Y0 + umzugRows(h.layout) * T - R);
      if (cx !== b.position.x || cy !== b.position.y) Body.setPosition(b, { x: cx, y: cy });
      p.moving = Math.hypot(p.sx, p.sy) > 0.3;
      if (p.grab && now > p.grabUntil) this.release(p);
    }
    for (const it of this.items) {
      if (it.gone || !it.body) continue;
      it.x = it.body.position.x;
      it.y = it.body.position.y;
      it.a = it.body.angle;
      // Schweres: allein zerrt man es nur im Schneckentempo, zu zweit geht es
      if (UMZUG_KINDS[it.k].heavy) {
        const n = it.by.filter((b) => b).length;
        it.body.frictionAir = n >= 2 ? 0.22 : n === 1 ? 0.97 : 0.3;
      }
    }
    this.checkDeliveries();
    this.events = this.events.filter((e) => now - e.at < 3000);
    // Alles draußen?
    for (const h of this.houses) {
      if (h.left > 0 || h.doneAt) continue;
      const left = Math.max(0, this.deadline - now);
      h.doneAt = left || 1;
      h.bonus = Math.ceil((left / 1000) * U.BONUS_PER_S);
      h.score += h.bonus;
      this.events.push({ seq: ++this.seq, kind: 'bonus', x: h.zone.x + h.zone.w / 2, y: h.zone.y - 10, pts: h.bonus, at: now });
    }
    if (now >= this.deadline || this.houses.every((h) => h.left <= 0)) this.end();
    else this.ctx.onChange();
  }

  /** Kraft aus Stick (und Sprint) auf die Figur */
  private drive(p: P, now: number) {
    const b = p.body;
    const len = Math.hypot(p.sx, p.sy);
    if (len > 0.15) {
      p.fx = p.sx / len;
      p.fy = p.sy / len;
    }
    let fx = 0;
    let fy = 0;
    if (now < p.dashUntil) {
      fx = p.ddx * 3.4;
      fy = p.ddy * 3.4;
    } else if (len > 0.3) {
      const heavy = p.grab && UMZUG_KINDS[p.grab.k].heavy;
      // Beim Schleppen fester ziehen – allein bewegt sich ein Sofa trotzdem nur im Schneckentempo
      const k = Math.min(1, len) * (heavy ? 4 : 1);
      fx = p.fx * k;
      fy = p.fy * k;
    }
    if (fx || fy) Body.applyForce(b, b.position, { x: fx * ACC * b.mass, y: fy * ACC * b.mass });
  }

  // ---------------------------------------------------------------- Würfe

  private flyStep(it: Item, dt: number) {
    const f = it.fly!;
    const house = this.houses[it.h];
    const prevX = it.x;
    const prevY = it.y;
    f.t += dt;
    const u = Math.min(1, f.t / U.THROW_MS);
    const nx = f.x + f.dx * f.range * u;
    const ny = f.y + f.dy * f.range * u;
    // Kachel unter dem fliegenden Teil: Fenster zerbrechen, Wände stoppen
    const { c, r } = umzugTileOf(house, nx, ny);
    const ch = umzugTileCh(house, c, r);
    if (ch === 'W' && !house.broken.has(`${c},${r}`)) this.smashWindow(house, c, r, f.who, it.k);
    else if (umzugIsWall(ch) && ch !== 'W') {
      it.x = prevX;
      it.y = prevY;
      return this.land(it, 0.3);
    }
    it.x = nx;
    it.y = ny;
    if (u >= 1) this.land(it, 1);
  }

  private land(it: Item, slide: number) {
    const f = it.fly!;
    it.fly = null;
    const who = this.players.get(f.who) ?? null;
    const kind = UMZUG_KINDS[it.k];
    if (kind.fragile) return this.breakItem(it, who, it.x, it.y);
    const house = this.houses[it.h];
    if (inRect(it.x, it.y, house.zone)) return this.deliver(it, who ? [who] : []);
    this.addBody(it, it.x, it.y, it.a, f.dx * 1.6 * slide, f.dy * 1.6 * slide);
  }

  private smashWindow(house: House, c: number, r: number, who: string, k: number) {
    const key = `${c},${r}`;
    const b = house.windows.get(key);
    if (b) Composite.remove(house.engine.world, b);
    house.windows.delete(key);
    house.broken.add(key);
    const p = this.players.get(who);
    if (p) {
      p.st[4]++;
      if (k === K.ZWERG) p.zwergFenster = true;
    }
    this.events.push({ seq: ++this.seq, kind: 'glass', x: house.x0 + (c + 0.5) * T, y: U.Y0 + (r + 0.5) * T, who, at: Date.now() });
  }

  // ---------------------------------------------------------------- Kollisionen (Zerbrechliches)

  private onCollision(e: Matter.IEventCollision<Matter.Engine>) {
    if (this.sub !== 'play') return;
    for (const pair of e.pairs) {
      const a = this.byBody.get(pair.bodyA.id);
      const b = this.byBody.get(pair.bodyB.id);
      const frag = a && UMZUG_KINDS[a.k].fragile ? a : b && UMZUG_KINDS[b.k].fragile ? b : null;
      if (!frag || frag.gone || !frag.body) continue;
      const other = frag === a ? pair.bodyB : pair.bodyA;
      const rel = Math.hypot(frag.body.velocity.x - other.velocity.x, frag.body.velocity.y - other.velocity.y);
      if (rel < U.BREAK_V) continue;
      // Schuldiger: der Spieler bzw. die Träger des anderen Körpers, sonst wer das Teil zuletzt hatte
      let culprit = this.playerByBody.get(other.id) ?? null;
      if (!culprit) {
        const oi = this.byBody.get(other.id);
        const carrier = oi?.by.find((x) => x) ?? null;
        culprit = (carrier && this.players.get(carrier)) || (frag.last && this.players.get(frag.last)) || null;
      }
      this.breakItem(frag, culprit, frag.body.position.x, frag.body.position.y);
    }
  }

  private breakItem(it: Item, culprit: P | null, x: number, y: number) {
    if (it.gone) return;
    const house = this.houses[it.h];
    this.detachAll(it);
    this.removeBody(it);
    it.gone = true;
    it.x = x;
    it.y = y;
    house.left--;
    house.brokenCount++;
    house.score = Math.max(0, house.score - U.BREAK_PENALTY);
    if (culprit) {
      culprit.st[3]++;
      culprit.pts -= U.BREAK_PENALTY;
      culprit.brokeKinds.set(it.k, (culprit.brokeKinds.get(it.k) ?? 0) + 1);
    }
    this.events.push({ seq: ++this.seq, kind: 'break', x: Math.round(x), y: Math.round(y), pts: -U.BREAK_PENALTY, k: it.k, who: culprit?.id, at: Date.now() });
  }

  // ---------------------------------------------------------------- Greifen / Loslassen

  private detachAll(it: Item) {
    for (const id of it.by) {
      const p = id ? this.players.get(id) : null;
      if (p && p.grab === it) p.grab = null;
    }
    it.by = it.by.map(() => null);
    if (it.body) {
      const world = this.houses[it.h].engine.world;
      for (let i = 0; i < it.cons.length; i++) {
        if (it.cons[i]) Composite.remove(world, it.cons[i]!);
        it.cons[i] = null;
      }
      it.body.collisionFilter.mask = 0xffffffff;
    }
  }

  private grabPointWorld(it: Item, i: number) {
    const gp = grabPoints(it.k)[i];
    const out = R + 1;
    const len = Math.hypot(gp.x, gp.y) || 1;
    const lx = gp.x + (gp.x / len) * out;
    const ly = gp.y + (gp.y / len) * out;
    const cos = Math.cos(it.a);
    const sin = Math.sin(it.a);
    return { x: it.x + lx * cos - ly * sin, y: it.y + lx * sin + ly * cos, lx, ly };
  }

  private tryGrab(p: P): boolean {
    if (p.grab) return true;
    const b = p.body;
    const hx = b.position.x + p.fx * 5;
    const hy = b.position.y + p.fy * 5;
    let best: { it: Item; i: number; d: number } | null = null;
    // Bevorzugt, was vor der Figur liegt (und Leichtes vor Enden schwerer Teile)
    const score = (x: number, y: number, d: number) => {
      const dx = x - b.position.x;
      const dy = y - b.position.y;
      const l = Math.hypot(dx, dy) || 1;
      return d - 8 * ((dx / l) * p.fx + (dy / l) * p.fy);
    };
    for (const it of this.items) {
      if (it.gone || it.h !== p.k || it.s !== 0 || !it.body) continue;
      const kind = UMZUG_KINDS[it.k];
      if (!kind.heavy) {
        const d = Math.hypot(it.x - hx, it.y - hy) - Math.max(kind.w, kind.h) / 2;
        const sc = score(it.x, it.y, d) - 3;
        if (d < U.REACH && (!best || sc < best.d)) best = { it, i: 0, d: sc };
      } else {
        for (let i = 0; i < 2; i++) {
          if (it.by[i]) continue;
          const g = this.grabPointWorld(it, i);
          const d = Math.hypot(g.x - b.position.x, g.y - b.position.y) - 6;
          const sc = score(g.x, g.y, d);
          if (d < U.REACH && (!best || sc < best.d)) best = { it, i, d: sc };
        }
      }
    }
    if (!best) return false;
    const { it, i } = best;
    const kind = UMZUG_KINDS[it.k];
    it.last = p.id;
    p.grab = it;
    if (!kind.heavy) {
      this.removeBody(it);
      it.s = 1;
      it.by = [p.id];
      it.x = b.position.x;
      it.y = b.position.y;
      return true;
    }
    it.by[i] = p.id;
    const g = this.grabPointWorld(it, i);
    const c = Constraint.create({ bodyA: b, bodyB: it.body!, pointB: { x: g.lx, y: g.ly }, length: 0, stiffness: 0.5, damping: 0.08 });
    it.cons[i] = c;
    Composite.add(this.houses[p.k].engine.world, c);
    // Träger und Teil stoßen sich nicht gegenseitig (sonst zittert es)
    let mask = 0xffffffff;
    for (const id of it.by) {
      const q = id ? this.players.get(id) : null;
      if (q) mask &= ~playerCat(q.idx);
    }
    it.body!.collisionFilter.mask = mask >>> 0;
    return true;
  }

  private release(p: P) {
    const it = p.grab;
    if (!it) return;
    p.grab = null;
    const kind = UMZUG_KINDS[it.k];
    if (!kind.heavy) {
      if (it.gone || it.s !== 1) return;
      // Vor die Füße legen (nicht in eine Wand)
      const b = p.body;
      const house = this.houses[p.k];
      let x = b.position.x + p.fx * (R + Math.max(kind.w, kind.h) / 2 + 1);
      let y = b.position.y + p.fy * (R + Math.max(kind.w, kind.h) / 2 + 1);
      const t = umzugTileOf(house, x, y);
      if (!umzugWalkable(house, t.c, t.r, house.broken)) {
        x = b.position.x;
        y = b.position.y;
      }
      it.by = [null];
      this.addBody(it, x, y, 0, b.velocity.x * 0.5, b.velocity.y * 0.5);
      return;
    }
    const i = it.by.indexOf(p.id);
    if (i < 0) return;
    it.by[i] = null;
    const world = this.houses[it.h].engine.world;
    if (it.cons[i]) Composite.remove(world, it.cons[i]!);
    it.cons[i] = null;
    if (it.body) {
      let mask = 0xffffffff;
      for (const id of it.by) {
        const q = id ? this.players.get(id) : null;
        if (q) mask &= ~playerCat(q.idx);
      }
      it.body.collisionFilter.mask = mask >>> 0;
    }
  }

  private throwItem(p: P) {
    const it = p.grab;
    const now = Date.now();
    if (!it) {
      // Ohne Gegenstand: kurzer Sprint
      if (now < p.dashCd) return;
      p.dashUntil = now + U.DASH_MS;
      p.dashCd = now + U.DASH_CD_MS;
      p.ddx = p.fx;
      p.ddy = p.fy;
      return;
    }
    if (UMZUG_KINDS[it.k].heavy || it.s !== 1) return;
    p.grab = null;
    it.by = [null];
    it.s = 2;
    it.last = p.id;
    it.x = p.body.position.x + p.fx * (R + 2);
    it.y = p.body.position.y + p.fy * (R + 2);
    it.fly = { x: it.x, y: it.y, dx: p.fx, dy: p.fy, t: 0, range: U.THROW_RANGE, who: p.id };
    p.st[2]++;
    this.events.push({ seq: ++this.seq, kind: 'throw', x: Math.round(it.x), y: Math.round(it.y), who: p.id, k: it.k, at: now });
  }

  // ---------------------------------------------------------------- Abliefern

  private checkDeliveries() {
    for (const it of this.items) {
      if (it.gone) continue;
      const house = this.houses[it.h];
      if (it.s === 1) {
        const carrier = it.by[0] ? this.players.get(it.by[0]) : null;
        if (!carrier) continue;
        if (inRect(carrier.body.position.x, carrier.body.position.y, house.zone)) this.deliver(it, [carrier]);
      } else if (it.s === 0 && it.body) {
        if (!inRect(it.x, it.y, house.zone)) continue;
        const carriers = it.by.map((id) => (id ? this.players.get(id) : null)).filter((p): p is P => !!p);
        if (!carriers.length && it.last) {
          const l = this.players.get(it.last);
          if (l) carriers.push(l);
        }
        this.deliver(it, carriers);
      }
    }
  }

  private deliver(it: Item, credit: P[]) {
    if (it.gone) return;
    const house = this.houses[it.h];
    const kind = UMZUG_KINDS[it.k];
    this.detachAll(it);
    this.removeBody(it);
    it.gone = true;
    it.fly = null;
    house.left--;
    house.score += kind.pts;
    house.delivered.push(it.k);
    for (const p of credit) {
      p.pts += kind.pts;
      if (kind.heavy) p.st[1]++;
      else {
        p.st[0]++;
        p.carried.set(it.k, (p.carried.get(it.k) ?? 0) + 1);
      }
    }
    this.events.push({ seq: ++this.seq, kind: 'deliver', x: Math.round(house.zone.x + house.zone.w / 2), y: Math.round(house.zone.y + house.zone.h / 2), pts: kind.pts, k: it.k, who: credit[0]?.id, at: Date.now() });
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p) return;
    const pl = asRecord(payload);
    if (action === 'stick') {
      let x = clamp(Number(pl.x) || 0, -1, 1);
      let y = clamp(Number(pl.y) || 0, -1, 1);
      const l = Math.hypot(x, y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
      p.sx = x;
      p.sy = y;
    } else if (action === 'grab') {
      if (this.sub !== 'play') return;
      if (pl.down) {
        p.grabUntil = Date.now() + U.GRAB_LATCH_MS;
        if (!p.grab && !this.tryGrab(p)) {
          if (!pl.again) p.no++;
        } else this.ctx.onChange();
      } else {
        p.grabUntil = 0;
        this.release(p);
      }
    } else if (action === 'throw') {
      if (this.sub !== 'play') return;
      this.throwItem(p);
    }
  }

  // ---------------------------------------------------------------- Ende

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.timers.clear();
    for (const p of this.players.values()) {
      p.sx = p.sy = 0;
      p.moving = false;
    }
    const ps = [...this.players.values()];
    const details = Object.fromEntries(ps.map((p) => [p.id, this.funStats(p)]));
    let result: Parameters<MiniCtx['finish']>[0];
    if (!this.teams) {
      const h = this.houses[0];
      this.stars = umzugStars(h.score, h.max);
      const groups = groupByScore(this.ids, (id) => this.players.get(id)!.pts);
      const starTxt = this.stars === 0 ? 'kein Stern' : this.stars === 1 ? '1 Stern' : `${this.stars} Sterne`;
      const all = h.left <= 0 && h.brokenCount === 0;
      result = {
        groups,
        details,
        subtitle: `${starTxt} – ${h.delivered.length} von ${h.delivered.length + h.left + h.brokenCount} Sachen im Laster${all ? ', nichts kaputt' : h.brokenCount ? `, ${h.brokenCount} zerbrochen` : ''}${h.bonus ? ` (+${h.bonus} Zeitbonus)` : ''}!`,
        coins: groups.map((_, i) => Math.max(1, 3 + this.stars * 2 - i * 2)),
      };
    } else {
      const [A, B] = this.houses;
      const val = (h: House) => h.score * 1000 + h.delivered.length;
      this.winner = val(A) === val(B) ? null : val(A) > val(B) ? 'A' : 'B';
      const win = this.winner;
      const teamOf = (id: string) => this.houses[this.players.get(id)!.k].team;
      const score = { A: A.score, B: B.score };
      result = {
        groups: win ? groupByScore(this.ids, (id) => (teamOf(id) === win ? 1 : 0)) : [this.ids],
        details,
        subtitle: win
          ? `${TEAM_INFO[win].name} räumt schneller: ${score[win]}:${score[win === 'A' ? 'B' : 'A']}${A.score === B.score ? ' (mehr Sachen)' : ''}!`
          : `Unentschieden – ${A.score}:${B.score}!`,
        coins: win ? [10, 3] : [6],
      };
    }
    this.ctx.onChange();
    this.timers.later(U.OVER_MS, () => this.ctx.finish(result));
  }

  /**
   * „trug 7 Kartons · 2× geschleppt · zerbrach 2 Vasen“ – der TV zeigt nur die ersten 16 Zeichen,
   * deshalb steht das Auffälligste vorn und jeder Teil ist kurz.
   */
  private funStats(p: P): string {
    const parts: string[] = [];
    const plural: Record<number, string> = { 0: 'Kartons', 1: 'Lampen', 2: 'Pflanzen', 3: 'Zwerge', 4: 'Vasen', 5: 'Kartons', 6: 'Kühlschränke', 7: 'Sofas', 8: 'Betten', 9: 'Klaviere' };
    const single: Record<number, string> = { 0: 'Karton', 1: 'Lampe', 2: 'Pflanze', 3: 'Zwerg', 4: 'Vase', 5: 'Karton' };
    const only = (m: Map<number, number>) => (m.size === 1 ? [...m.keys()][0] : null);
    if (p.zwergFenster) parts.push('Zwerg: Fenster!');
    if (p.st[3]) {
      const k = only(p.brokeKinds);
      parts.push(k !== null && k !== K.FRAGILE ? `zerbrach ${p.st[3]} ${p.st[3] === 1 ? single[k] : plural[k]}` : `${p.st[3]}× zerbrochen`);
    }
    if (p.st[0]) {
      const k = only(p.carried);
      parts.push(`trug ${p.st[0]} ${k !== null ? (p.st[0] === 1 ? single[k] : plural[k]) : p.st[0] === 1 ? 'Teil' : 'Teile'}`);
    }
    if (p.st[1]) parts.push(`${p.st[1]}× geschleppt`);
    if (p.st[4] && !p.zwergFenster) parts.push(`${p.st[4]} Fenster`);
    if (p.st[2] && parts.length < 3) parts.push(`${p.st[2]}× geworfen`);
    return parts.slice(0, 3).join(' · ') || 'stand nur im Weg';
  }

  // ---------------------------------------------------------------- Zustand

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const players: Record<string, UmzugPlayer> = {};
    for (const p of this.players.values()) {
      players[p.id] = {
        x: r1(p.body.position.x),
        y: r1(p.body.position.y),
        k: p.k,
        fx: r2(p.fx),
        fy: r2(p.fy),
        m: p.moving,
        c: p.color,
        g: p.grab?.id ?? null,
        cd: Math.max(0, p.dashCd - now),
        d: now < p.dashUntil,
        no: p.no,
        st: p.st,
        pts: p.pts,
      };
    }
    const items: UmzugItem[] = [];
    for (const it of this.items) {
      if (it.gone) continue;
      let x = it.x;
      let y = it.y;
      let z: number | undefined;
      if (it.s === 1) {
        const c = it.by[0] ? this.players.get(it.by[0]) : null;
        if (c) {
          x = c.body.position.x;
          y = c.body.position.y;
        }
      } else if (it.s === 2 && it.fly) {
        const u = Math.min(1, it.fly.t / U.THROW_MS);
        z = r2(4 * u * (1 - u));
      }
      const snap: UmzugItem = { id: it.id, k: it.k, x: r1(x), y: r1(y), a: Math.round((it.a * 180) / Math.PI), s: it.s, by: it.by, h: it.h };
      if (z !== undefined) snap.z = z;
      items.push(snap);
    }
    const houses: UmzugHouse[] = this.houses.map((h) => ({
      team: h.team,
      layout: h.layout,
      mirror: h.mirror,
      x0: h.x0,
      score: h.score,
      max: h.max,
      bonus: h.bonus,
      delivered: h.delivered,
      left: h.left,
      broken: h.brokenCount,
      glass: [...h.broken],
      doneAt: h.doneAt,
    }));
    return {
      kind: 'umzug',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - now),
        teams: this.teams,
        houses,
        players,
        items,
        events: this.events.map(({ at: _at, ...e }) => e),
        stars: this.stars,
        winner: this.winner,
      },
    };
  }

  playerDisconnected(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.sx = p.sy = 0;
    p.grabUntil = 0;
    this.release(p);
  }

  dispose() {
    this.timers.clear();
    for (const h of this.houses) {
      Events.off(h.engine, 'collisionStart');
      Composite.clear(h.engine.world, false);
      Engine.clear(h.engine);
    }
  }
}
