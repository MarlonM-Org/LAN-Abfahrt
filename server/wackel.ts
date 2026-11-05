import Matter from 'matter-js';
import type { MiniSnapshot } from '../shared/types';
import {
  WACKEL,
  WACKEL_STAGES,
  type WackelFx,
  type WackelPlatform,
  type WackelPlayer,
  type WackelStage,
  type WackelState,
  wackelSurfaceY,
  wackelTilt,
} from '../shared/wackel';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const { Bodies, Body, Composite, Constraint, Engine } = Matter;

const K = WACKEL;
const PROF = !!process.env.WACKEL_PROF;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const approach = (v: number, target: number, step: number) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
/** Winkel auf −π…π bringen */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Arm-Winkel, damit die Hand in Richtung (dx, dy) zeigt (0 = hängt nach unten) */
const armAngleFor = (dx: number, dy: number) => Math.atan2(-dx, dy);

type ArmIdx = 0 | 1;

interface Hold {
  c: Matter.Constraint;
  kind: 'player' | 'ledge' | 'object';
  target: string | null;
  at: number;
}

interface Punch {
  arm: ArmIdx;
  dx: number;
  dy: number;
  t0: number;
  hit: boolean;
}

interface Doll {
  id: string;
  comp: Matter.Composite;
  torso: Matter.Body;
  head: Matter.Body;
  arms: [Matter.Body, Matter.Body];
  legs: [Matter.Body, Matter.Body];
  parts: Matter.Body[];
}

interface P {
  id: string;
  doll: Doll | null;
  alive: boolean;
  f: 1 | -1;
  sx: number;
  sy: number;
  /** Zuletzt gedrückte Stick-Richtung (für Schläge/Würfe ohne Stick) */
  lx: number;
  ly: number;
  grabHeld: boolean;
  holds: [Hold | null, Hold | null];
  grabCdUntil: number;
  punch: Punch | null;
  punchSeq: number;
  punchArm: ArmIdx;
  punchReadyAt: number;
  stunUntil: number;
  /** Kurz nach dem Absprung keine Bodenfeder */
  airUntil: number;
  grounded: boolean;
  /** Bodenhöhe (Oberkante) unter den Füßen */
  groundY: number;
  heldBy: string | null;
  hookHitAt: number;
  jumpBuf: number;
  lastHitBy: string | null;
  lastHitAt: number;
  diedAt: number;
  deadX: number;
  deadY: number;
  hits: number;
  wins: number;
  outs: number;
  survival: number;
}

/**
 * Wackel-Prügelei: labbrige Physik-Puppen auf einem Steg bzw. Fischkutter über dem Meer.
 * Joystick zum Torkeln, SPRINGEN, HAUEN (betäubt – dann fällt die Puppe in sich zusammen)
 * und GREIFEN (halten: Hände kleben an Spielern, Kanten und dem Kranhaken; Spieler lassen sich
 * schleppen und beim Loslassen in Stick-Richtung werfen; an Kanten hängt man und klettert mit SPRINGEN).
 * Wer zuletzt auf der Bühne ist, gewinnt die Runde – nach 50 s steigt das Wasser.
 * Wer zuerst 3 Runden gewinnt (max. 5), ist Wackel-Champion.
 */
export class WackelGame implements MiniGame {
  readonly kind = 'wackel' as const;
  private players = new Map<string, P>();
  private engine: Matter.Engine;
  private stage: WackelStage = WACKEL_STAGES[0];
  private stageIdx = Math.floor(Math.random() * WACKEL_STAGES.length);
  private platBodies: { p: WackelPlatform; b: Matter.Body }[] = [];
  private hook: Matter.Body | null = null;
  private wave: { x: number; dir: 1 | -1 } | null = null;
  private nextWaveAt = 0;
  private sub: WackelState['sub'] = 'countdown';
  private round = 0;
  private deadline = 0;
  private playStart = 0;
  private sea = K.SEA_Y;
  private sudden = false;
  private endAt = 0;
  private roundWinner: string | null = null;
  private deaths: string[] = [];
  private fx: WackelFx[] = [];
  private fxSeq = 0;
  /** Physik-Zeit (ms) seit Rundenstart – für Schaukeln und Haken */
  private simT = 0;
  private timers = new Timers();
  private prof = { n: 0, sum: 0, max: 0 };

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.engine = Engine.create({ positionIterations: 6, velocityIterations: 4, constraintIterations: 2 });
    this.engine.gravity.scale = 0.00075;
    for (const id of ids) {
      this.players.set(id, {
        id, doll: null, alive: false, f: 1, sx: 0, sy: 0, lx: 1, ly: 0, grabHeld: false, holds: [null, null], grabCdUntil: 0,
        punch: null, punchSeq: 0, punchArm: 1, punchReadyAt: 0, stunUntil: 0, airUntil: 0, grounded: false, groundY: 0, heldBy: null,
        hookHitAt: 0, jumpBuf: 0, lastHitBy: null, lastHitAt: 0, diedAt: 0, deadX: 0, deadY: 0, hits: 0, wins: 0, outs: 0, survival: 0,
      });
    }
    let last = Date.now();
    let carry = 0;
    this.timers.every(K.TICK_MS, () => {
      const now = Date.now();
      carry = Math.min(carry + (now - last), K.STEP_MS * 4);
      last = now;
      const steps = Math.floor(carry / K.STEP_MS);
      carry -= steps * K.STEP_MS;
      const t0 = PROF ? performance.now() : 0;
      this.tick(now, steps);
      if (PROF) this.profile(performance.now() - t0, steps);
    });
    this.startRound();
  }

  private profile(ms: number, steps: number) {
    const p = this.prof;
    p.n++;
    p.sum += ms;
    p.max = Math.max(p.max, ms);
    if (p.n % 50 === 0) {
      console.log(`[wackel] tick ⌀ ${(p.sum / p.n).toFixed(2)} ms, max ${p.max.toFixed(2)} ms (${steps} Schritte, ${this.alive().length} Puppen)`);
      p.max = 0;
    }
  }

  // ---------------------------------------------------------------- Bühne & Puppen

  private buildStage() {
    Composite.clear(this.engine.world, false);
    this.platBodies = [];
    this.hook = null;
    this.wave = null;
    this.stage = WACKEL_STAGES[this.stageIdx % WACKEL_STAGES.length];
    for (const p of this.stage.platforms) {
      const b = Bodies.rectangle(p.x + p.w / 2, p.y + p.h / 2, p.w, p.h, { isStatic: true, friction: 0.55, frictionStatic: 0.8, label: 'plat' });
      this.platBodies.push({ p, b });
      Composite.add(this.engine.world, b);
    }
    if (this.stage.hazard === 'hook' && this.stage.hookPivot) {
      const pv = this.stage.hookPivot;
      this.hook = Bodies.circle(pv.x, pv.y + K.HOOK_LEN, K.HOOK_R, { isStatic: true, friction: 0.9, label: 'hook' });
      Composite.add(this.engine.world, this.hook);
    }
  }

  private makeDoll(id: string, idx: number, x: number, y: number): Doll {
    const group = -(idx + 1);
    const cf = { group };
    const ty = y - K.STAND_H;
    const torso = Bodies.rectangle(x, ty, K.TORSO_W, K.TORSO_H, { collisionFilter: cf, density: 0.0028, friction: 0.35, frictionAir: 0.025, restitution: 0.05, label: `torso:${id}` });
    const head = Bodies.circle(x, ty - K.TORSO_H / 2 - K.HEAD_R + 1, K.HEAD_R, { collisionFilter: cf, density: 0.0014, friction: 0.3, frictionAir: 0.03, restitution: 0.1, label: `head:${id}` });
    const arm = (side: -1 | 1) =>
      Bodies.rectangle(x + side * (K.TORSO_W / 2 + 1), ty - K.TORSO_H / 2 + 1 + K.ARM_L / 2, K.ARM_W, K.ARM_L, {
        collisionFilter: cf, density: 0.0009, friction: 0.4, frictionAir: 0.04, restitution: 0.05, label: `arm:${id}`,
      });
    const leg = (side: -1 | 1) =>
      Bodies.rectangle(x + side * 2, ty + K.TORSO_H / 2 - 1 + K.LEG_L / 2, K.LEG_W, K.LEG_L, {
        collisionFilter: cf, density: 0.0011, friction: 0.5, frictionAir: 0.035, restitution: 0.02, label: `leg:${id}`,
      });
    const arms: [Matter.Body, Matter.Body] = [arm(-1), arm(1)];
    const legs: [Matter.Body, Matter.Body] = [leg(-1), leg(1)];
    const pin = (a: Matter.Body, pa: Matter.Vector, b: Matter.Body, pb: Matter.Vector, stiffness: number, length = 0) =>
      Constraint.create({ bodyA: a, pointA: pa, bodyB: b, pointB: pb, length, stiffness, damping: 0.1 });
    const cons = [
      pin(torso, { x: 0, y: -K.TORSO_H / 2 }, head, { x: 0, y: K.HEAD_R - 1 }, 0.9, 1),
      pin(torso, { x: -K.TORSO_W / 2, y: -K.TORSO_H / 2 + 1 }, arms[0], { x: 0, y: -K.ARM_L / 2 }, 0.75),
      pin(torso, { x: K.TORSO_W / 2, y: -K.TORSO_H / 2 + 1 }, arms[1], { x: 0, y: -K.ARM_L / 2 }, 0.75),
      pin(torso, { x: -2, y: K.TORSO_H / 2 - 1 }, legs[0], { x: 0, y: -K.LEG_L / 2 }, 0.8),
      pin(torso, { x: 2, y: K.TORSO_H / 2 - 1 }, legs[1], { x: 0, y: -K.LEG_L / 2 }, 0.8),
    ];
    const parts = [torso, head, arms[0], arms[1], legs[0], legs[1]];
    const comp = Composite.create({ label: `doll:${id}` });
    Composite.add(comp, [...parts, ...cons]);
    Composite.add(this.engine.world, comp);
    return { id, comp, torso, head, arms, legs, parts };
  }

  // ---------------------------------------------------------------- Runden

  private startRound() {
    this.round += 1;
    this.stageIdx += 1;
    this.endAt = 0;
    this.roundWinner = null;
    this.deaths = [];
    this.sudden = false;
    this.sea = K.SEA_Y;
    this.simT = 0;
    this.fx = [];
    this.buildStage();
    const active = shuffle(this.ids.filter((id) => this.ctx.isConnected(id)));
    const n = active.length;
    const [x0, x1] = this.stage.spawnX;
    for (const [id, p] of this.players) {
      const i = active.indexOf(id);
      p.alive = i >= 0;
      p.doll = null;
      p.holds = [null, null];
      p.heldBy = null;
      p.punch = null;
      p.grabHeld = false;
      p.stunUntil = p.airUntil = p.grabCdUntil = p.punchReadyAt = 0;
      p.lastHitBy = null;
      p.lastHitAt = 0;
      p.sx = p.sy = 0;
      if (i >= 0) {
        const x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1);
        p.doll = this.makeDoll(id, i, x, this.stage.spawnY);
        p.f = x < 240 ? 1 : -1;
        p.lx = p.f;
        p.ly = 0;
      }
    }
    this.sub = 'countdown';
    this.deadline = Date.now() + K.COUNTDOWN_MS;
    this.timers.later(K.COUNTDOWN_MS, () => {
      this.sub = 'play';
      this.playStart = Date.now();
      this.deadline = this.playStart + K.ROUND_MS;
      this.nextWaveAt = this.playStart + 5000 + Math.random() * 3000;
      this.ctx.onChange();
    });
    this.ctx.onChange();
  }

  private endRound(now: number) {
    const alive = this.alive();
    if (alive.length === 1) this.roundWinner = alive[0];
    else if (alive.length === 0 && this.deaths.length >= 1) {
      const lastId = this.deaths[this.deaths.length - 1];
      const prevId = this.deaths[this.deaths.length - 2];
      const lastAt = this.players.get(lastId)!.diedAt;
      const prevAt = prevId ? this.players.get(prevId)!.diedAt : 0;
      this.roundWinner = lastAt - prevAt >= 400 || this.sudden ? lastId : null;
    } else this.roundWinner = null;
    const n = this.deaths.length + alive.length;
    this.deaths.forEach((id, i) => (this.players.get(id)!.survival += i));
    for (const id of alive) this.players.get(id)!.survival += n - 1;
    if (this.roundWinner) this.players.get(this.roundWinner)!.wins += 1;
    this.sub = 'roundOver';
    this.deadline = now + K.ROUND_OVER_MS;
    for (const p of this.players.values()) {
      p.sx = p.sy = 0;
      p.grabHeld = false;
    }
    this.ctx.onChange();
    const best = Math.max(...[...this.players.values()].map((p) => p.wins));
    const done = best >= K.WIN_ROUNDS || this.round >= K.MAX_ROUNDS || this.ids.filter((id) => this.ctx.isConnected(id)).length < 2;
    this.timers.later(K.ROUND_OVER_MS, () => (done ? this.end() : this.startRound()));
  }

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.timers.clear();
    this.ctx.onChange();
    const score = (id: string) => {
      const p = this.players.get(id)!;
      return p.wins * 100000 + p.outs * 1000 + p.survival;
    };
    const groups = groupByScore(this.ids, score);
    const top = groups[0] ?? [];
    const champ = top.length === 1 ? this.ctx.nameOf(top[0]) : null;
    this.timers.later(1500, () =>
      this.ctx.finish({
        groups,
        details: Object.fromEntries(
          this.ids.map((id) => {
            const p = this.players.get(id)!;
            return [id, `${p.wins} ${p.wins === 1 ? 'Sieg' : 'Siege'} · ${p.outs}× rausgeworfen`];
          }),
        ),
        subtitle: champ ? `${champ} bleibt als Einzige(r) trocken!` : 'Alle baden gegangen – Unentschieden!',
      }),
    );
  }

  // ---------------------------------------------------------------- Hauptschleife

  private alive() {
    return [...this.players.values()].filter((p) => p.alive).map((p) => p.id);
  }

  private tick(now: number, steps: number) {
    if (this.sub === 'over') return;
    const play = this.sub === 'play';
    if (this.sub === 'countdown' || play || this.sub === 'roundOver') {
      for (let i = 0; i < steps; i++) {
        this.simT += K.STEP_MS;
        this.hazards(now, play);
        for (const p of this.players.values()) if (p.alive && p.doll) this.control(p, now, play);
        Engine.update(this.engine, K.STEP_MS);
        if (play) {
          for (const p of this.players.values()) if (p.alive && p.doll) this.afterStep(p, now);
          this.water(now);
        }
      }
    }
    if (play) {
      if (!this.sudden && now >= this.playStart + K.ROUND_MS) {
        this.sudden = true;
        this.deadline = this.playStart + K.ROUND_CAP_MS;
      }
      if (this.sudden) this.sea = K.SEA_Y - ((now - this.playStart - K.ROUND_MS) / 1000) * K.RISE_PX_S;
      if (!this.endAt && this.alive().length <= 1) this.endAt = now + K.END_DELAY_MS;
      if (!this.endAt && now >= this.playStart + K.ROUND_CAP_MS) this.endAt = now;
      if (this.endAt && now >= this.endAt) return this.endRound(now);
    }
    this.ctx.onChange();
  }

  /** Welle, Schaukeln, Kranhaken */
  private hazards(now: number, play: boolean) {
    if (this.stage.hazard === 'wave') {
      if (play && !this.wave && now >= this.nextWaveAt) {
        const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
        this.wave = { x: dir > 0 ? -50 : 530, dir };
      }
      if (this.wave) {
        this.wave.x += this.wave.dir * K.WAVE_SPEED;
        const deckY = this.stage.waveDeckY ?? 200;
        for (const p of this.players.values()) {
          if (!p.alive || !p.doll) continue;
          const t = p.doll.torso;
          if (t.position.y < deckY - 10 || Math.abs(t.position.x - this.wave.x) > K.WAVE_HALF) continue;
          for (const b of [t, ...p.doll.legs]) Body.setVelocity(b, { x: b.velocity.x + this.wave.dir * K.WAVE_PUSH, y: b.velocity.y - 0.22 });
        }
        if (this.wave.x < -60 || this.wave.x > 540) {
          this.wave = null;
          this.nextWaveAt = now + K.WAVE_MIN_MS + Math.random() * (K.WAVE_MAX_MS - K.WAVE_MIN_MS);
        }
      }
    } else {
      const tilt = wackelTilt(this.simT);
      for (const { p, b } of this.platBodies) if (p.rock) Body.setAngle(b, tilt);
      if (this.hook && this.stage.hookPivot) {
        const pv = this.stage.hookPivot;
        const th = Math.sin((this.simT / 2600) * Math.PI * 2) * 1.1;
        const nx = pv.x + Math.sin(th) * K.HOOK_LEN;
        const ny = pv.y + Math.cos(th) * K.HOOK_LEN;
        const vx = nx - this.hook.position.x;
        const vy = ny - this.hook.position.y;
        Body.setPosition(this.hook, { x: nx, y: ny });
        const speed = Math.hypot(vx, vy);
        if (play && speed > K.HOOK_STUN_V) {
          for (const p of this.players.values()) {
            if (!p.alive || !p.doll || now - p.hookHitAt < 800) continue;
            const hit = p.doll.parts.some((b) => Math.hypot(b.position.x - nx, b.position.y - ny) < K.HOOK_R + 5);
            if (!hit) continue;
            p.hookHitAt = now;
            this.stun(p, now, K.STUN_MS, { x: (vx / speed) * K.KNOCK * 1.3, y: -K.KNOCK_UP }, null);
            this.pushFx('hook', nx, ny, p.id);
          }
        }
      }
    }
  }

  /** Balance, Laufen, Arme – vor jedem Physik-Schritt */
  private control(p: P, now: number, play: boolean) {
    const d = p.doll!;
    const t = d.torso;
    const stunned = now < p.stunUntil;
    const tilt = wackelTilt(this.simT);
    // Boden unter den Füßen?
    let groundY: number | null = null;
    for (const { p: pl } of this.platBodies) {
      const sy = wackelSurfaceY(pl, t.position.x, tilt);
      if (sy === null) continue;
      const dy = sy - t.position.y;
      if (dy >= K.STAND_H - 9 && dy <= K.STAND_H + 5 && (groundY === null || sy < groundY)) groundY = sy;
    }
    const hanging = p.holds.some((h) => h && h.kind !== 'player');
    p.grounded = groundY !== null && now >= p.airUntil && !hanging;
    if (groundY !== null) p.groundY = groundY;

    const held = !!p.heldBy;
    const balance = stunned ? 0 : held ? 0.3 : hanging ? 0.35 : 1;
    const ang = wrap(t.angle);
    const vx0 = t.velocity.x;
    const vy0 = t.velocity.y;
    let vx = vx0;
    let vy = vy0;
    const sx = play ? p.sx : 0;

    if (balance > 0) {
      // Aufrichten (mit leichtem Lehnen in Laufrichtung)
      const lean = p.grounded ? sx * 0.22 : 0;
      Body.setAngularVelocity(t, t.angularVelocity * 0.78 + (lean - ang) * 0.085 * balance);
      if (p.grounded) {
        const dy = groundY! - K.STAND_H - t.position.y;
        if (dy < 0) vy = Math.max(-2.6, vy * 0.55 + dy * 0.2 * balance);
        vx = approach(vx, sx * K.WALK * (p.holds[0]?.kind === 'player' || p.holds[1]?.kind === 'player' ? 0.8 : 1) * balance, 0.22);
      } else if (!hanging) {
        vx = approach(vx, Math.abs(sx) > 0.2 ? sx * K.WALK * 0.9 : vx, 0.06);
      }
      if (vx !== vx0 || vy !== vy0) Body.setVelocity(t, { x: vx, y: vy });
      // Kopf folgt dem Rumpf
      Body.setAngularVelocity(d.head, d.head.angularVelocity * 0.8 + wrap(t.angle - d.head.angle) * 0.1);
      // Beine: hängen nach unten, beim Laufen pendeln sie
      const phase = Math.abs(sx) > 0.2 && p.grounded ? Math.sin(this.simT / 95) * 0.55 : 0;
      d.legs.forEach((l, i) => {
        const target = t.angle + (i === 0 ? phase : -phase);
        Body.setAngularVelocity(l, l.angularVelocity * 0.7 + wrap(target - l.angle) * 0.12 * balance);
      });
    }
    if (Math.abs(sx) > 0.2 && !stunned && play) p.f = sx < 0 ? -1 : 1;

    // Springen (gepuffert)
    if (play && p.jumpBuf && now <= p.jumpBuf && !stunned) {
      if (hanging) {
        p.jumpBuf = 0;
        // Hochziehen: in Richtung der haltenden Hand (also über die Kante), nicht in Blickrichtung
        const hold = p.holds.find((h) => h && h.kind !== 'player')!;
        const hx = hold.c.bodyA === d.arms[0] ? this.handPos(d.arms[0]).x : this.handPos(d.arms[1]).x;
        const dir = Math.sign(hx - t.position.x) || p.f;
        this.release(p, now, false);
        // nicht sofort wieder zupacken, sonst klettert man nie hoch
        p.grabCdUntil = now + 700;
        for (const b of d.parts) Body.setVelocity(b, { x: dir * 2.3, y: -K.JUMP * 1.12 });
        p.airUntil = now + 120;
      } else if (p.grounded && !held) {
        p.jumpBuf = 0;
        for (const b of d.parts) Body.setVelocity(b, { x: b.velocity.x + sx * 0.6, y: -K.JUMP });
        p.airUntil = now + 160;
      }
    } else if (p.jumpBuf && now > p.jumpBuf) p.jumpBuf = 0;

    // Arme: schlagen, greifen oder baumeln
    const reach = p.grabHeld && !stunned && play;
    d.arms.forEach((a, i) => {
      const pu = p.punch;
      if (pu && pu.arm === i) {
        const dt = now - pu.t0;
        const target = armAngleFor(pu.dx, pu.dy);
        Body.setAngularVelocity(a, a.angularVelocity * 0.4 + wrap(target - a.angle) * 0.45);
        if (dt < 110) Body.setVelocity(a, { x: a.velocity.x + pu.dx * 1.1, y: a.velocity.y + pu.dy * 1.1 - 0.1 });
        return;
      }
      const h = p.holds[i];
      if (h) return;
      if (reach) {
        const len = Math.hypot(p.sx, p.sy);
        const dx = len > 0.25 ? p.sx / len : p.f;
        const dy = len > 0.25 ? p.sy / len : -0.35;
        const target = armAngleFor(dx, dy);
        Body.setAngularVelocity(a, a.angularVelocity * 0.6 + wrap(target - a.angle) * 0.2);
      } else if (balance > 0) {
        // leicht nach außen baumeln
        const target = t.angle + (i === 0 ? 0.35 : -0.35);
        Body.setAngularVelocity(a, a.angularVelocity * 0.8 + wrap(target - a.angle) * 0.05);
      }
    });
  }

  /** Treffer, Greifen, Halte-Grenzen – nach jedem Physik-Schritt */
  private afterStep(p: P, now: number) {
    const d = p.doll!;
    const stunned = now < p.stunUntil;
    // Schlag auswerten
    const pu = p.punch;
    if (pu) {
      const dt = now - pu.t0;
      if (dt > K.PUNCH_MS) p.punch = null;
      else if (!pu.hit && dt >= 30) {
        const fist = this.handPos(d.arms[pu.arm]);
        for (const o of this.players.values()) {
          if (o === p || !o.alive || !o.doll) continue;
          const part = o.doll.parts.find((b) => Math.hypot(b.position.x - fist.x, b.position.y - fist.y) < K.PUNCH_R + (b === o.doll!.head ? 2 : 1));
          if (!part) continue;
          pu.hit = true;
          const head = part === o.doll.head;
          this.stun(o, now, head ? K.STUN_HEAD_MS : K.STUN_MS, { x: pu.dx * K.KNOCK, y: Math.max(-3.2, Math.min(-0.8, pu.dy * K.KNOCK) - K.KNOCK_UP) }, p.id);
          p.hits += 1;
          this.pushFx(head ? 'head' : 'hit', fist.x, fist.y, o.id);
          break;
        }
      }
    }
    // Greifen
    if (stunned) {
      if (p.holds[0] || p.holds[1]) this.release(p, now, false);
      p.jumpBuf = 0;
      return;
    }
    for (const i of [0, 1] as const) {
      const h = p.holds[i];
      if (h) {
        if (h.kind === 'player') {
          const o = h.target ? this.players.get(h.target) : null;
          if (!o?.alive || now - h.at > K.HOLD_MAX_MS) {
            this.release(p, now, false, i);
            p.grabCdUntil = now + K.GRAB_CD_MS;
          } else {
            o.lastHitBy = p.id;
            o.lastHitAt = now;
          }
        }
        continue;
      }
      if (!p.grabHeld || now < p.grabCdUntil || (p.punch && p.punch.arm === i)) continue;
      const hand = this.handPos(d.arms[i]);
      this.tryGrab(p, i, hand, now);
    }
  }

  private handPos(arm: Matter.Body) {
    const L = K.ARM_L / 2;
    return { x: arm.position.x - Math.sin(arm.angle) * L, y: arm.position.y + Math.cos(arm.angle) * L };
  }

  private tryGrab(p: P, i: ArmIdx, hand: { x: number; y: number }, now: number) {
    const d = p.doll!;
    // 1. andere Spieler
    let bestD = K.GRAB_R;
    let bestPart: Matter.Body | null = null;
    let bestOwner: P | null = null;
    for (const o of this.players.values()) {
      if (o === p || !o.alive || !o.doll) continue;
      for (const b of o.doll.parts) {
        const dist = Math.hypot(b.position.x - hand.x, b.position.y - hand.y) - (b === o.doll.head ? 2 : 0);
        if (dist < bestD) {
          bestD = dist;
          bestPart = b;
          bestOwner = o;
        }
      }
    }
    if (bestPart && bestOwner) {
      const c = Constraint.create({ bodyA: d.arms[i], pointA: { x: 0, y: K.ARM_L / 2 }, bodyB: bestPart, pointB: { x: hand.x - bestPart.position.x, y: hand.y - bestPart.position.y }, length: 0, stiffness: 0.55, damping: 0.05 });
      // pointB in lokale Koordinaten des Ziels drehen
      const ca = Math.cos(-bestPart.angle);
      const sa = Math.sin(-bestPart.angle);
      const lx = c.pointB.x * ca - c.pointB.y * sa;
      const ly = c.pointB.x * sa + c.pointB.y * ca;
      c.pointB = { x: lx, y: ly };
      Composite.add(this.engine.world, c);
      p.holds[i] = { c, kind: 'player', target: bestOwner.id, at: now };
      bestOwner.heldBy = p.id;
      bestOwner.lastHitBy = p.id;
      bestOwner.lastHitAt = now;
      this.pushFx('grab', hand.x, hand.y, p.id);
      return;
    }
    // 2. Kranhaken
    if (this.hook && Math.hypot(this.hook.position.x - hand.x, this.hook.position.y - hand.y) < K.HOOK_R + 4) {
      this.attachStatic(p, i, this.hook, hand, 'object', now);
      return;
    }
    // 3. Kante (nur, wenn man nicht ohnehin darauf steht): die Hand schnappt an die obere Ecke
    if (p.grounded) return;
    const tilt = wackelTilt(this.simT);
    const ty = d.torso.position.y;
    for (const { p: pl, b } of this.platBodies) {
      for (const side of [-1, 1] as const) {
        const ex = side < 0 ? pl.x + 1 : pl.x + pl.w - 1;
        const ey = wackelSurfaceY(pl, ex, tilt);
        if (ey === null || ty < ey - 10) continue;
        const dist = Math.hypot(hand.x - ex, hand.y - ey);
        // auch wenn die Hand schon flach auf der Kante liegt
        const onTop = hand.y >= ey - 4 && hand.y <= ey + 8 && (hand.x - ex) * side <= 0 && Math.abs(hand.x - ex) < 16;
        if (dist > K.GRAB_R + 5 && !onTop) continue;
        this.attachStatic(p, i, b, { x: ex, y: ey }, 'ledge', now);
        return;
      }
    }
  }

  private attachStatic(p: P, i: ArmIdx, b: Matter.Body, hand: { x: number; y: number }, kind: 'ledge' | 'object', now: number) {
    const d = p.doll!;
    const ca = Math.cos(-b.angle);
    const sa = Math.sin(-b.angle);
    const rx = hand.x - b.position.x;
    const ry = hand.y - b.position.y;
    const c = Constraint.create({ bodyA: d.arms[i], pointA: { x: 0, y: K.ARM_L / 2 }, bodyB: b, pointB: { x: rx * ca - ry * sa, y: rx * sa + ry * ca }, length: 0, stiffness: 0.5, damping: 0.05 });
    Composite.add(this.engine.world, c);
    p.holds[i] = { c, kind, target: null, at: now };
    this.pushFx('grab', hand.x, hand.y, p.id);
  }

  /** Loslassen – beim Werfen bekommt der Gehaltene Schwung in Stick-Richtung */
  private release(p: P, now: number, throwIt: boolean, only?: ArmIdx) {
    const thrown = new Set<string>();
    for (const i of [0, 1] as const) {
      if (only !== undefined && i !== only) continue;
      const h = p.holds[i];
      if (!h) continue;
      p.holds[i] = null;
      Composite.remove(this.engine.world, h.c);
      if (h.kind !== 'player' || !h.target) continue;
      const o = this.players.get(h.target);
      if (!o) continue;
      if (!p.holds.some((x) => x && x.kind === 'player' && x.target === o.id)) o.heldBy = null;
      if (throwIt && o.alive && o.doll && !thrown.has(o.id)) {
        thrown.add(o.id);
        const len = Math.hypot(p.sx, p.sy);
        if (len > 0.3) {
          const dx = p.sx / len;
          const dy = p.sy / len;
          for (const b of o.doll.parts) Body.setVelocity(b, { x: b.velocity.x + dx * K.THROW, y: b.velocity.y + Math.min(dy, 0.2) * K.THROW - K.THROW_UP });
          o.stunUntil = Math.max(o.stunUntil, now + 550);
          o.lastHitBy = p.id;
          o.lastHitAt = now;
          this.pushFx('throw', o.doll.torso.position.x, o.doll.torso.position.y, o.id);
        }
      }
    }
  }

  private stun(o: P, now: number, ms: number, kick: { x: number; y: number }, by: string | null) {
    if (!o.doll) return;
    o.stunUntil = Math.max(o.stunUntil, now + ms);
    o.punch = null;
    o.jumpBuf = 0;
    if (o.holds[0] || o.holds[1]) this.release(o, now, false);
    for (const b of o.doll.parts) Body.setVelocity(b, { x: b.velocity.x * 0.4 + kick.x, y: b.velocity.y * 0.4 + kick.y });
    if (by) {
      o.lastHitBy = by;
      o.lastHitAt = now;
    }
  }

  /** Wer im Wasser (oder weit draußen) ist, ist raus */
  private water(now: number) {
    let deepest: P | null = null;
    for (const p of this.players.values()) {
      if (!p.alive || !p.doll) continue;
      const t = p.doll.torso.position;
      if (t.y > 290 || t.x < -50 || t.x > 530) this.fall(p, now);
      else if (t.y > this.sea + 3) {
        // Bei steigendem Wasser pro Schritt nur der Tiefste – so gibt es auch in der Flut eine Reihenfolge
        if (!this.sudden) this.fall(p, now);
        else if (!deepest || t.y > deepest.doll!.torso.position.y) deepest = p;
      }
    }
    if (deepest) this.fall(deepest, now);
  }

  private fall(p: P, now: number) {
    if (!p.alive) return;
    const d = p.doll;
    p.alive = false;
    p.diedAt = now;
    p.deadX = d ? clamp(d.torso.position.x, 8, 472) : 240;
    p.deadY = clamp(this.sea, 20, 250) + 4;
    this.deaths.push(p.id);
    this.release(p, now, false);
    // Wer diesen Spieler festhält, lässt los
    for (const o of this.players.values()) {
      for (const i of [0, 1] as const) if (o.holds[i]?.target === p.id) this.release(o, now, false, i);
    }
    p.heldBy = null;
    p.grabHeld = false;
    p.punch = null;
    if (d) {
      Composite.remove(this.engine.world, d.comp);
      p.doll = null;
    }
    if (p.lastHitBy && p.lastHitBy !== p.id && now - p.lastHitAt < K.CREDIT_MS) {
      const k = this.players.get(p.lastHitBy);
      if (k) k.outs += 1;
    }
    this.pushFx('platsch', p.deadX, p.deadY, p.id);
  }

  private pushFx(type: WackelFx['type'], x: number, y: number, id?: string) {
    this.fx.push({ seq: ++this.fxSeq, type, x: Math.round(x), y: Math.round(y), ...(id ? { id } : {}) });
    if (this.fx.length > 14) this.fx.shift();
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p) return;
    const pl = asRecord(payload);
    const num = (v: unknown) => clamp(Number(v) || 0, -1, 1);
    if (action === 'stick') {
      this.setStick(p, num(pl.x), num(pl.y));
    } else if (action === 'btn') {
      const b = pl.b;
      const down = pl.down !== false;
      if ('x' in pl || 'y' in pl) this.setStick(p, num(pl.x), num(pl.y));
      const now = Date.now();
      if (b === 'grab') {
        if (down) p.grabHeld = true;
        else {
          p.grabHeld = false;
          if (p.holds[0] || p.holds[1]) {
            this.release(p, now, true);
            p.grabCdUntil = now + 200;
          }
        }
      } else if (!down || this.sub !== 'play' || !p.alive || !p.doll) return;
      else if (b === 'jump') p.jumpBuf = now + 180;
      else if (b === 'punch') this.startPunch(p, now);
    }
  }

  private setStick(p: P, x: number, y: number) {
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    p.sx = x;
    p.sy = y;
    if (l > 0.25) {
      p.lx = x / Math.max(l, 1e-6);
      p.ly = y / Math.max(l, 1e-6);
    }
  }

  private startPunch(p: P, now: number) {
    if (now < p.stunUntil || now < p.punchReadyAt || p.punch) return;
    const len = Math.hypot(p.sx, p.sy);
    let dx = len > 0.25 ? p.sx / len : p.f;
    let dy = len > 0.25 ? p.sy / len : -0.15;
    // nicht senkrecht nach unten prügeln
    if (dy > 0.6) {
      dy = 0.6;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
    }
    if (Math.abs(dx) > 0.2) p.f = dx < 0 ? -1 : 1;
    // Arm auf der Schlagseite – wer gerade etwas hält, schlägt mit der freien Hand
    let arm: ArmIdx = dx < 0 ? 0 : 1;
    if (p.holds[arm]) arm = arm === 0 ? 1 : 0;
    if (p.holds[arm]) return;
    p.punch = { arm, dx, dy, t0: now, hit: false };
    p.punchArm = arm;
    p.punchSeq += 1;
    p.punchReadyAt = now + K.PUNCH_CD_MS;
    const t = p.doll!.torso;
    Body.setVelocity(t, { x: t.velocity.x + dx * 0.9, y: t.velocity.y - 0.2 });
    this.ctx.onChange();
  }

  playerDisconnected(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.sx = p.sy = 0;
    p.grabHeld = false;
    const now = Date.now();
    this.release(p, now, false);
    if (this.sub === 'play') this.fall(p, now);
  }

  // ---------------------------------------------------------------- Zustand

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const players: Record<string, WackelPlayer> = {};
    for (const [id, p] of this.players) {
      const d = p.doll;
      const parts: number[] = [];
      if (d) {
        for (const b of d.parts) parts.push(Math.round(b.position.x), Math.round(b.position.y), Math.round((b.angle * 180) / Math.PI));
      }
      players[id] = {
        parts,
        x: d ? Math.round(d.torso.position.x) : Math.round(p.deadX),
        y: d ? Math.round(d.torso.position.y) : Math.round(p.deadY),
        f: p.f,
        alive: p.alive,
        stun: now < p.stunUntil,
        held: !!p.heldBy,
        grab: p.holds.some((h) => h?.kind === 'player') ? 1 : p.holds.some((h) => !!h) ? 2 : 0,
        punch: p.punchSeq,
        arm: p.punchArm,
        cd: Math.max(0, p.punchReadyAt - now),
        hits: p.hits,
        wins: p.wins,
        outs: p.outs,
      };
    }
    return {
      kind: 'wackel',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - now),
        round: this.round,
        winRounds: K.WIN_ROUNDS,
        stage: this.stage.id,
        sea: Math.round(this.sea * 10) / 10,
        sudden: this.sudden,
        tilt: Math.round((wackelTilt(this.simT) * 1800) / Math.PI),
        hook: this.hook ? [Math.round(this.hook.position.x), Math.round(this.hook.position.y)] : null,
        wave: this.wave ? [Math.round(this.wave.x), this.wave.dir] : null,
        players,
        roundWinner: this.roundWinner,
        fx: this.fx,
      },
    };
  }

  dispose() {
    this.timers.clear();
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
  }
}
