import type { KartCar, KartEvent, KartItem, KartState, MiniSnapshot } from '../shared/types';
import { KART, KART_TRACKS, type Track, autopilot, getTrack, project } from '../shared/kart';
import { type MiniCtx, type MiniGame, Timers, asRecord, shuffle } from './minigame';

const TICK_MS = 50;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const mod = (v: number, m: number) => ((v % m) + m) % m;
const r1 = (v: number) => Math.round(v * 10) / 10;

const ITEM_NAMES: Record<KartItem, string> = { coconut: 'Kokosnuss', banana: 'Bananenschale', ice: 'Turbo-Eis', gull: 'Möwe' };

interface Car extends KartCar {
  id: string;
  vx: number;
  vy: number;
  steerIn: number;
  brakeIn: boolean;
  nextCp: number;
  prog: number;
  spinUntil: number;
  safeUntil: number;
  boostUntil: number;
  driftDir: number;
  driftCharge: number;
}

interface Hazard {
  id: number;
  kind: 'banana' | 'coconut';
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: string;
  born: number;
  until: number;
}

interface Gull {
  id: number;
  x: number;
  y: number;
  from: string;
  target: string;
}

/**
 * Kart-Rennen (Draufsicht): Gas gibt das Spiel automatisch, gelenkt wird per Kippen oder Touch.
 * Bremse/Drift-Knopf: ohne Lenkung bremsen, mit Lenkung driften (lange driften → Mini-Turbo).
 * Items aus den ?-Boxen: Kokosnuss (nach vorn), Bananenschale (nach hinten), Turbo-Eis, Möwe (nur hinten im Feld).
 */
export class KartGame implements MiniGame {
  readonly kind = 'kart' as const;
  private track: Track;
  private trackIndex: number;
  private cars = new Map<string, Car>();
  private boxes: { x: number; y: number; on: boolean; back: number }[];
  private hazards: Hazard[] = [];
  private gulls: Gull[] = [];
  private finishOrder: string[] = [];
  private events: KartEvent[] = [];
  private seq = 0;
  private sub: KartState['sub'] = 'countdown';
  private deadline = Date.now() + KART.COUNTDOWN_MS;
  private closing = false;
  private startedAt = 0;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
    trackIndex = Math.floor(Math.random() * KART_TRACKS.length),
  ) {
    this.trackIndex = trackIndex;
    this.track = getTrack(trackIndex);
    this.boxes = this.track.boxes.map((b) => ({ ...b, on: true, back: 0 }));
    shuffle(ids).forEach((id, i) => {
      const g = this.track.grid[i % this.track.grid.length];
      this.cars.set(id, {
        id,
        x: g.x,
        y: g.y,
        angle: g.a,
        steer: 0,
        lap: 0,
        place: i + 1,
        finished: false,
        finishMs: null,
        item: null,
        spin: 0,
        boost: false,
        drift: 0,
        charged: false,
        offroad: false,
        vx: 0,
        vy: 0,
        steerIn: 0,
        brakeIn: false,
        nextCp: 0,
        prog: 0,
        spinUntil: 0,
        safeUntil: 0,
        boostUntil: 0,
        driftDir: 0,
        driftCharge: 0,
      });
    });
    for (const c of this.cars.values()) c.prog = this.progressOf(c, project(this.track, c.x, c.y).s);
    this.updatePlaces();
    this.timers.later(KART.COUNTDOWN_MS, () => this.start());
  }

  private start() {
    this.sub = 'race';
    this.startedAt = Date.now();
    this.deadline = this.startedAt + KART.MAX_RACE_MS;
    let last = Date.now();
    this.timers.every(TICK_MS, () => {
      const now = Date.now();
      this.tick(now, Math.min(0.1, (now - last) / 1000));
      last = now;
    });
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Simulation

  private tick(now: number, dt: number) {
    const T = this.track;
    const limit = T.half + KART.SAND;
    for (const c of this.cars.values()) {
      let steer = c.steerIn;
      let brake = c.brakeIn;
      const speed = Math.hypot(c.vx, c.vy);
      const connected = this.ctx.isConnected(c.id);
      if (c.finished) {
        // Ehrenrunde auf Autopilot
        const ap = autopilot(T, c.x, c.y, c.angle, speed);
        steer = ap.steer;
        brake = false;
      }
      const spinning = now < c.spinUntil;
      const fx = Math.cos(c.angle);
      const fy = Math.sin(c.angle);
      let vf = c.vx * fx + c.vy * fy;
      let vl = -c.vx * fy + c.vy * fx;
      const before = project(T, c.x, c.y);
      c.offroad = before.dist > T.half + 1;
      const boosting = now < c.boostUntil;

      if (spinning) {
        vf *= Math.exp(-4 * dt);
        vl *= Math.exp(-4 * dt);
        c.driftDir = 0;
        c.driftCharge = 0;
      } else {
        // Drift starten / beenden
        if (c.driftDir === 0 && brake && Math.abs(steer) > 0.35 && vf > KART.DRIFT_MIN_SPEED && !c.offroad) {
          c.driftDir = Math.sign(steer);
          c.driftCharge = 0;
        } else if (c.driftDir !== 0 && (!brake || vf < 25)) {
          if (brake === false && c.driftCharge >= KART.DRIFT_CHARGE_S) c.boostUntil = Math.max(c.boostUntil, now + KART.MINI_TURBO_MS);
          c.driftDir = 0;
          c.driftCharge = 0;
        }
        const drifting = c.driftDir !== 0;
        let max = c.offroad ? KART.SAND_SPEED * (boosting ? 1.7 : 1) : KART.MAX_SPEED * (boosting ? KART.BOOST_FACTOR : 1);
        if (c.finished) max *= 0.6;
        if (!connected && !c.finished) max = 0;
        if (brake && !drifting) {
          vf = Math.max(0, vf - KART.BRAKE * dt);
        } else if (vf < max) {
          vf = Math.min(max, vf + KART.ACCEL * (boosting ? 2.2 : 1) * dt);
        } else {
          vf = Math.max(max, vf - (c.offroad ? 260 : 90) * dt);
        }
        const grip = drifting ? KART.DRIFT_GRIP : KART.GRIP;
        vl *= Math.exp(-grip * dt);
        let turn: number;
        if (drifting) {
          // Driften lenkt immer etwas in Driftrichtung; Gegenlenken macht den Bogen weiter
          turn = clamp(c.driftDir * 0.5 + steer * 0.45, -0.95, 0.95) * KART.TURN;
          // Lenken in Driftrichtung lädt schneller
          c.driftCharge += dt * (Math.sign(steer) === c.driftDir ? 1.25 : 0.8);
          // Beim Driften rutscht das Kart nach außen
          vl -= c.driftDir * vf * 0.6 * dt;
        } else {
          turn = steer * KART.TURN * clamp(Math.abs(vf) / 40, 0.35, 1);
        }
        c.angle += turn * dt;
      }
      const nfx = Math.cos(c.angle);
      const nfy = Math.sin(c.angle);
      c.vx = nfx * vf - nfy * vl;
      c.vy = nfy * vf + nfx * vl;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.steer = spinning ? 0 : steer;
      c.spin = Math.max(0, c.spinUntil - now);
      c.boost = now < c.boostUntil;
      c.drift = c.driftDir;
      c.charged = c.driftDir !== 0 && c.driftCharge >= KART.DRIFT_CHARGE_S;
    }

    // Karts schubsen sich gegenseitig (Ehrenrunden-Karts sind "Geister")
    const list = [...this.cars.values()].filter((c) => !c.finished);
    const R2 = KART.RADIUS * 2;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= R2 || d === 0) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (R2 - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        const va = a.vx * nx + a.vy * ny;
        const vb = b.vx * nx + b.vy * ny;
        if (va - vb > 0) {
          const ex = (va - vb) * 0.9;
          a.vx -= nx * ex;
          a.vy -= ny * ex;
          b.vx += nx * ex;
          b.vy += ny * ex;
        }
      }
    }

    for (const c of this.cars.values()) {
      // Bande hinter dem Sand
      let p = project(T, c.x, c.y);
      if (p.dist > limit) {
        c.x = p.cx + p.nx * limit;
        c.y = p.cy + p.ny * limit;
        const vn = c.vx * p.nx + c.vy * p.ny;
        if (vn > 0) {
          c.vx -= p.nx * vn * 1.3;
          c.vy -= p.ny * vn * 1.3;
        }
        c.vx *= 0.93;
        c.vy *= 0.93;
        p = project(T, c.x, c.y);
      }
      this.checkpoint(c, p, now);
      c.prog = this.progressOf(c, p.s);
    }

    this.updateBoxes(now);
    this.updateHazards(now, dt);
    this.updateGulls(now, dt);
    this.updatePlaces();

    const racing = [...this.cars.values()].filter((c) => !c.finished && this.ctx.isConnected(c.id));
    if (now >= this.deadline || (this.finishOrder.length > 0 && racing.length === 0)) this.end();
    else this.ctx.onChange();
  }

  private checkpoint(c: Car, p: { s: number; dist: number }, now: number) {
    if (c.finished) return;
    const T = this.track;
    const N = T.checkpoints.length;
    const rel = mod(p.s - T.checkpoints[c.nextCp], T.length);
    if (rel > 45 || p.dist > T.half + KART.SAND + 2) return;
    if (c.nextCp === 0) {
      c.lap += 1;
      if (c.lap > KART.LAPS) {
        c.lap = KART.LAPS;
        c.finished = true;
        c.finishMs = now - this.startedAt;
        c.item = null;
        c.driftDir = 0;
        this.finishOrder.push(c.id);
        const place = this.finishOrder.length;
        this.event('finish', c.id, null, `${this.ctx.nameOf(c.id)} ist im Ziel – Platz ${place}!`);
        if (place === 1) {
          this.closing = true;
          this.deadline = Math.min(this.deadline, now + KART.AFTER_WINNER_MS);
        }
        return;
      }
    }
    c.nextCp = (c.nextCp + 1) % N;
  }

  /** Fortschritt in Pixeln seit der Startlinie – gedeckelt durch die Checkpoints (keine Abkürzungen) */
  private progressOf(c: Car, s: number) {
    const T = this.track;
    const N = T.checkpoints.length;
    const L = T.length;
    const base = T.checkpoints[(c.nextCp - 1 + N) % N];
    const segLen = mod(T.checkpoints[c.nextCp] - base, L) || L;
    let r = mod(s - base, L);
    if (r > segLen) r = r > segLen + (L - segLen) / 2 ? 0 : segLen;
    return (c.lap - 1) * L + base + r;
  }

  private updatePlaces() {
    const order = [...this.cars.values()].sort((a, b) => {
      if (a.finished || b.finished) {
        if (a.finished && b.finished) return this.finishOrder.indexOf(a.id) - this.finishOrder.indexOf(b.id);
        return a.finished ? -1 : 1;
      }
      return b.prog - a.prog;
    });
    order.forEach((c, i) => (c.place = i + 1));
  }

  private updateBoxes(now: number) {
    for (const b of this.boxes) {
      if (!b.on) {
        if (now >= b.back) b.on = true;
        continue;
      }
      for (const c of this.cars.values()) {
        if (c.finished || Math.hypot(c.x - b.x, c.y - b.y) > KART.RADIUS + KART.BOX_R) continue;
        b.on = false;
        b.back = now + KART.BOX_RESPAWN_MS;
        if (!c.item) c.item = this.rollItem(c);
        break;
      }
    }
  }

  /** Wer hinten liegt, bekommt bessere Items */
  private rollItem(c: Car): KartItem {
    const n = this.cars.size;
    const f = n <= 1 ? 0 : (c.place - 1) / (n - 1);
    const table: [KartItem, number][] =
      f < 0.34
        ? [['banana', 45], ['coconut', 40], ['ice', 15]]
        : f < 0.67
          ? [['coconut', 40], ['banana', 20], ['ice', 40]]
          : [['gull', n >= 3 ? 35 : 25], ['ice', 40], ['coconut', 25]];
    if (c.place === 1) return Math.random() < 0.55 ? 'banana' : 'coconut';
    let roll = Math.random() * table.reduce((sum, [, w]) => sum + w, 0);
    for (const [item, w] of table) {
      roll -= w;
      if (roll < 0) return item;
    }
    return 'banana';
  }

  private updateHazards(now: number, dt: number) {
    const T = this.track;
    const limit = T.half + KART.SAND;
    const gone = new Set<number>();
    for (const h of this.hazards) {
      if (now >= h.until) {
        gone.add(h.id);
        continue;
      }
      if (h.kind === 'coconut') {
        h.x += h.vx * dt;
        h.y += h.vy * dt;
        const p = project(T, h.x, h.y);
        if (p.dist > limit) {
          // Abprallen an der Bande
          const vn = h.vx * p.nx + h.vy * p.ny;
          h.vx -= 2 * vn * p.nx;
          h.vy -= 2 * vn * p.ny;
          h.x = p.cx + p.nx * limit;
          h.y = p.cy + p.ny * limit;
          h.vx *= 0.8;
          h.vy *= 0.8;
        }
      }
      for (const c of this.cars.values()) {
        if (c.finished || now < c.safeUntil) continue;
        if (h.owner === c.id && now - h.born < (h.kind === 'coconut' ? 400 : 700)) continue;
        if (Math.hypot(c.x - h.x, c.y - h.y) > KART.RADIUS + 4) continue;
        gone.add(h.id);
        this.spinOut(c, now, h.kind === 'coconut' ? KART.SPIN_MS : KART.SPIN_MS * 0.85);
        const name = this.ctx.nameOf(c.id);
        this.event('hit', c.id, h.owner, h.kind === 'coconut' ? `${name} kassiert eine Kokosnuss!` : `${name} rutscht auf der Banane aus!`);
        break;
      }
    }
    // Kokosnuss trifft Banane → beide weg
    for (const a of this.hazards) {
      if (a.kind !== 'coconut' || gone.has(a.id)) continue;
      for (const b of this.hazards) {
        if (b.kind === 'banana' && !gone.has(b.id) && Math.hypot(a.x - b.x, a.y - b.y) < 7) {
          gone.add(a.id);
          gone.add(b.id);
          break;
        }
      }
    }
    if (gone.size) this.hazards = this.hazards.filter((h) => !gone.has(h.id));
  }

  private updateGulls(now: number, dt: number) {
    this.gulls = this.gulls.filter((g) => {
      const t = this.cars.get(g.target);
      if (!t) return false;
      const dx = t.x - g.x;
      const dy = t.y - g.y;
      const d = Math.hypot(dx, dy);
      const step = KART.GULL_SPEED * dt;
      if (d > step + 4) {
        g.x += (dx / d) * step;
        g.y += (dy / d) * step;
        return true;
      }
      // Angekommen: erschrecken + Item klauen
      const from = this.cars.get(g.from);
      const stolen = t.item;
      t.item = null;
      if (!t.finished) this.spinOut(t, now, 700, true);
      if (from && !from.finished && !from.item) from.item = stolen ?? 'ice';
      const victim = this.ctx.nameOf(t.id);
      this.event('gull', t.id, g.from, stolen ? `Möwe klaut ${victim} die ${ITEM_NAMES[stolen]}!` : `Möwe erschreckt ${victim}!`);
      return false;
    });
  }

  private spinOut(c: Car, now: number, ms: number, ignoreSafe = false) {
    if (!ignoreSafe && now < c.safeUntil) return;
    c.spinUntil = now + ms;
    c.safeUntil = c.spinUntil + KART.SAFE_MS;
    c.boostUntil = 0;
    c.driftDir = 0;
    c.driftCharge = 0;
    c.vx *= 0.3;
    c.vy *= 0.3;
  }

  private event(kind: KartEvent['kind'], who: string, by: string | null, text: string) {
    this.events.push({ seq: ++this.seq, kind, who, by, text });
    if (this.events.length > 5) this.events.shift();
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const c = this.cars.get(id);
    if (!c) return;
    const pl = asRecord(payload);
    if (action === 'steer') {
      c.steerIn = clamp(Number(pl.x) || 0, -1, 1);
      if (typeof pl.brake === 'boolean') c.brakeIn = pl.brake;
    } else if (action === 'brake') {
      c.brakeIn = !!pl.on;
    } else if (action === 'item' && this.sub === 'race') {
      this.useItem(c, Date.now());
    }
  }

  private useItem(c: Car, now: number) {
    if (!c.item || c.finished || now < c.spinUntil) return;
    const item = c.item;
    c.item = null;
    const fx = Math.cos(c.angle);
    const fy = Math.sin(c.angle);
    if (item === 'ice') {
      c.boostUntil = now + KART.BOOST_MS;
    } else if (item === 'coconut' || item === 'banana') {
      if (this.hazards.length >= KART.MAX_HAZARDS) this.hazards.shift();
      const fwd = item === 'coconut';
      const speed = Math.max(KART.COCONUT_SPEED, Math.hypot(c.vx, c.vy) + 90);
      this.hazards.push({
        id: ++this.seq,
        kind: item,
        x: c.x + fx * (fwd ? 9 : -10),
        y: c.y + fy * (fwd ? 9 : -10),
        vx: fwd ? fx * speed : 0,
        vy: fwd ? fy * speed : 0,
        owner: c.id,
        born: now,
        until: now + (fwd ? KART.COCONUT_MS : KART.BANANA_MS),
      });
    } else if (item === 'gull') {
      const leader = [...this.cars.values()].filter((o) => o.id !== c.id && !o.finished).sort((a, b) => a.place - b.place)[0];
      if (!leader || leader.place > c.place) {
        c.boostUntil = now + KART.BOOST_MS;
      } else {
        this.gulls.push({ id: ++this.seq, x: c.x, y: c.y - 6, from: c.id, target: leader.id });
      }
    }
    this.event('item', c.id, null, `${this.ctx.nameOf(c.id)}: ${ITEM_NAMES[item]}!`);
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Ende

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.timers.clear();
    this.ctx.onChange();
    const dnf = [...this.cars.values()].filter((c) => !c.finished).sort((a, b) => b.prog - a.prog);
    const groups = [...this.finishOrder.map((id) => [id]), ...dnf.map((c) => [c.id])].filter((g) => this.ids.includes(g[0]));
    const details: Record<string, string> = {};
    for (const c of this.cars.values()) {
      details[c.id] = c.finished ? `Ziel: ${((c.finishMs ?? 0) / 1000).toFixed(1)}s` : `DNF (Runde ${Math.max(1, c.lap)}/${KART.LAPS})`;
    }
    const winner = this.finishOrder[0];
    this.timers.later(3000, () =>
      this.ctx.finish({
        groups,
        details,
        subtitle: winner ? `${this.ctx.nameOf(winner)} gewinnt ${this.track.def.at}!` : `Keiner ist ${this.track.def.at} ins Ziel gekommen ...`,
      }),
    );
  }

  snapshot(): MiniSnapshot {
    const karts: Record<string, KartCar> = {};
    for (const c of this.cars.values()) {
      karts[c.id] = {
        x: r1(c.x),
        y: r1(c.y),
        angle: Math.round(c.angle * 100) / 100,
        steer: Math.round(c.steer * 10) / 10,
        lap: c.lap,
        place: c.place,
        finished: c.finished,
        finishMs: c.finishMs,
        item: c.item,
        spin: c.spin,
        boost: c.boost,
        drift: c.drift,
        charged: c.charged,
        offroad: c.offroad,
      };
    }
    return {
      kind: 'kart',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - Date.now()),
        closing: this.closing,
        track: this.trackIndex,
        laps: KART.LAPS,
        karts,
        boxes: this.boxes.map(({ x, y, on }) => ({ x, y, on })),
        hazards: this.hazards.map(({ id, kind, x, y }) => ({ id, kind, x: r1(x), y: r1(y) })),
        gulls: this.gulls.map(({ id, x, y, target, from }) => ({ id, x: r1(x), y: r1(y), target, from })),
        finishOrder: this.finishOrder,
        events: this.events,
      },
    };
  }

  playerDisconnected(id: string) {
    const c = this.cars.get(id);
    if (c) {
      c.steerIn = 0;
      c.brakeIn = false;
    }
  }

  dispose() {
    this.timers.clear();
  }
}
