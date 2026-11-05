import type { MiniSnapshot, SmashAnim, SmashFx, SmashProjectile, SmashState } from '../shared/types';
import {
  ATTACKS,
  type AttackId,
  BOMB_RADIUS,
  type HitData,
  ITEM_HITS,
  ITEM_INFO,
  type ItemKind,
  SMASH,
  SMASH_STAGES,
  SPECIALS,
  SPECIAL_HITS,
  SPECIAL_IDS,
  type SpecialId,
  knockback,
  mainPlatform,
  platformPos,
} from '../shared/smash';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';
import { BetBook } from './spectator';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const approach = (v: number, target: number, step: number) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

interface MoveDef {
  startup: number;
  active: number;
  end: number;
  box: { x: number; y: number; w: number; h: number };
  hit: HitData;
}

type MoveKind = AttackId | 'schirm' | 'cocktail' | 'wasser' | 'slam';

interface Attack {
  kind: MoveKind;
  def: MoveDef;
  t0: number;
  hit: Set<string>;
}

interface Fighter {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  face: 1 | -1;
  /** Index der Plattform, auf der man steht (−1 = in der Luft) */
  ground: number;
  jumps: number;
  sx: number;
  sy: number;
  downSince: number;
  shieldHeld: boolean;
  shieldOn: boolean;
  shield: number;
  attack: Attack | null;
  /** Bis dahin keine neuen Aktionen (Angriff + Nachlauf) */
  busyUntil: number;
  hitstunUntil: number;
  stunUntil: number;
  dizzy: boolean;
  dropUntil: number;
  floatUntil: number;
  throwUntil: number;
  schirmUsed: boolean;
  matratze: { phase: 'up' | 'slam'; at: number } | null;
  pct: number;
  stocks: number;
  special: SpecialId;
  cdUntil: number;
  hold: ItemKind | null;
  invUntil: number;
  state: 'fight' | 'respawn' | 'out';
  respawnAt: number;
  lastHitBy: string | null;
  lastHitAt: number;
  kos: number;
  place: number | null;
  atkSeq: number;
  /** Gepufferte Knopfdrücke (kommen evtl. kurz vor dem Ende eines Angriffs) */
  buf: { b: 'a' | 'b' | 'jump'; until: number; x: number; y: number }[];
}

interface Item {
  id: number;
  type: ItemKind;
  x: number;
  y: number;
  vy: number;
  ground: number;
  born: number;
}

interface Projectile extends SmashProjectile {
  owner: string;
  grav: number;
  dieAt: number;
}

const ATTACK_MOVES: Record<AttackId, MoveDef> = Object.fromEntries(
  (Object.keys(ATTACKS) as AttackId[]).map((k) => {
    const { startup, active, end, box, ...hit } = ATTACKS[k];
    return [k, { startup, active, end, box, hit }];
  }),
) as Record<AttackId, MoveDef>;

const SPECIAL_MOVES = {
  schirm: { startup: 0, active: 260, end: 0, box: { x: -16, y: -46, w: 32, h: 44 }, hit: SPECIAL_HITS.schirm },
  cocktail: { startup: 80, active: 170, end: 170, box: { x: 6, y: -31, w: 34, h: 20 }, hit: SPECIAL_HITS.cocktail },
  wasser: { startup: 100, active: 300, end: 150, box: { x: 8, y: -28, w: 94, h: 13 }, hit: SPECIAL_HITS.wasser },
  slam: { startup: 0, active: 2000, end: 0, box: { x: -12, y: -22, w: 24, h: 24 }, hit: SPECIAL_HITS.matratzeSlam },
} satisfies Record<string, MoveDef>;

/**
 * Smash-Arena: 2D-Plattform-Prügelei mit Prozent-System.
 * Treffer erhöhen die Prozente, je höher, desto weiter fliegt man.
 * Wer über die Bildschirmränder fliegt, verliert ein Leben.
 */
export class SmashGame implements MiniGame {
  readonly kind = 'smash' as const;
  private stage = SMASH_STAGES[Math.floor(Math.random() * SMASH_STAGES.length)];
  private fighters = new Map<string, Fighter>();
  private items: Item[] = [];
  private projectiles: Projectile[] = [];
  private fx: SmashFx[] = [];
  private fxSeq = 0;
  private nextId = 1;
  private sub: SmashState['sub'] = 'countdown';
  private deadline = Date.now() + SMASH.COUNTDOWN_MS;
  private fightStart = 0;
  private nextItem = 0;
  private outOrder: string[] = [];
  private winner: string | null = null;
  /** Zuschauer: Wer raus ist, tippt auf den Sieger des Kampfs (eine „Runde“) */
  private bets = new BetBook();
  private timers = new Timers();
  private last = Date.now();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const stocks = ids.length >= SMASH.FEW_STOCKS_FROM ? 2 : 3;
    // Spezialmoves möglichst gleichmäßig verteilen
    let pool: SpecialId[] = [];
    const main = mainPlatform(this.stage);
    const order = shuffle(ids);
    order.forEach((id, i) => {
      if (!pool.length) pool = shuffle(SPECIAL_IDS);
      const n = order.length;
      const x = n === 1 ? main.x + main.w / 2 : main.x + 26 + (i * (main.w - 52)) / (n - 1);
      this.fighters.set(id, {
        id,
        x,
        y: main.y,
        vx: 0,
        vy: 0,
        face: x < main.x + main.w / 2 ? 1 : -1,
        ground: this.stage.platforms.indexOf(main),
        jumps: SMASH.AIR_JUMPS,
        sx: 0,
        sy: 0,
        downSince: 0,
        shieldHeld: false,
        shieldOn: false,
        shield: SMASH.SHIELD_MAX,
        attack: null,
        busyUntil: 0,
        hitstunUntil: 0,
        stunUntil: 0,
        dizzy: false,
        dropUntil: 0,
        floatUntil: 0,
        throwUntil: 0,
        schirmUsed: false,
        matratze: null,
        pct: 0,
        stocks,
        special: pool.pop()!,
        cdUntil: 0,
        hold: null,
        invUntil: 0,
        state: 'fight',
        respawnAt: 0,
        lastHitBy: null,
        lastHitAt: 0,
        kos: 0,
        place: null,
        atkSeq: 0,
        buf: [],
      });
    });
    this.timers.later(SMASH.COUNTDOWN_MS, () => this.start());
  }

  private start() {
    this.sub = 'fight';
    this.fightStart = Date.now();
    this.deadline = this.fightStart + SMASH.TIME_MS;
    this.nextItem = this.fightStart + 5000 + Math.random() * 4000;
    this.last = Date.now();
    this.timers.every(SMASH.TICK_MS, () => {
      const now = Date.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.tick(now, dt);
    });
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const f = this.fighters.get(id);
    if (!f) return;
    if (action === 'bet') {
      if (this.bets.place(id, payload, this.ids, this.aliveIds(), this.sub === 'fight')) this.ctx.onChange();
      return;
    }
    const pl = asRecord(payload);
    const num = (v: unknown) => clamp(Number(v) || 0, -1, 1);
    if (action === 'stick') {
      this.setStick(f, num(pl.x), num(pl.y));
    } else if (action === 'btn') {
      const b = pl.b;
      const down = pl.down !== false;
      if ('x' in pl || 'y' in pl) this.setStick(f, num(pl.x), num(pl.y));
      if (b === 'shield') f.shieldHeld = down;
      else if ((b === 'a' || b === 'b' || b === 'jump') && down && this.sub === 'fight') {
        f.buf = f.buf.filter((x) => x.b !== b);
        f.buf.push({ b, until: Date.now() + 160, x: f.sx, y: f.sy });
      }
    }
  }

  private setStick(f: Fighter, x: number, y: number) {
    if (y > 0.6 && f.sy <= 0.6) f.downSince = Date.now();
    f.sx = x;
    f.sy = y;
  }

  playerDisconnected(id: string) {
    const f = this.fighters.get(id);
    if (!f) return;
    f.sx = f.sy = 0;
    f.shieldHeld = false;
  }

  // ---------------------------------------------------------------- Hauptschleife

  private tick(now: number, dt: number) {
    if (this.sub !== 'fight') return;
    const t = now - this.fightStart;
    const live = [...this.fighters.values()].filter((f) => f.state === 'fight');

    for (const f of this.fighters.values()) {
      if (f.state === 'respawn' && now >= f.respawnAt) this.respawn(f, now);
    }
    for (const f of live) this.control(f, now, dt);

    // Physik in Teilschritten, damit niemand durch dünne Plattformen fällt
    const steps = SMASH.SUBSTEPS;
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      const ts = t - dt * 1000 + ((i + 1) * dt * 1000) / steps;
      for (const f of live) if (f.state === 'fight') this.physics(f, sdt, now, ts);
    }
    this.separate(live, dt);

    for (const f of live) if (f.state === 'fight') this.checkAttack(f, now);
    this.updateProjectiles(now, dt, t);
    this.updateItems(now, dt, t);
    for (const f of live) if (f.state === 'fight') this.checkBlast(f, now);

    const alive = [...this.fighters.values()].filter((f) => f.state !== 'out');
    if ((this.fighters.size > 1 && alive.length <= 1) || alive.length === 0 || now >= this.deadline) this.end();
    else this.ctx.onChange();
  }

  /** Eingaben in Bewegung, Angriffe und Spezialmoves übersetzen */
  private control(f: Fighter, now: number, dt: number) {
    f.buf = f.buf.filter((b) => b.until >= now);
    const helpless = now < f.hitstunUntil || now < f.stunUntil;
    if (f.dizzy && now >= f.stunUntil) f.dizzy = false;
    const busy = now < f.busyUntil;
    if (f.attack && now >= f.busyUntil && f.attack.kind !== 'slam') f.attack = null;

    // Luftmatratze: erst hoch, dann runter klatschen
    if (f.matratze) {
      if (f.matratze.phase === 'up' && now - f.matratze.at > 240) {
        f.matratze = { phase: 'slam', at: now };
        f.vy = 640;
        f.vx *= 0.3;
        this.startMove(f, 'slam', SPECIAL_MOVES.slam, now, 0);
      } else if (f.matratze.phase === 'slam' && now - f.matratze.at > 1600) {
        f.matratze = null;
        f.attack = null;
        f.busyUntil = now;
      }
    }

    // Schild
    const grounded = f.ground >= 0;
    f.shieldOn = f.shieldHeld && grounded && !helpless && !busy && f.shield > 0;
    if (f.shieldOn) {
      f.shield -= SMASH.SHIELD_DRAIN * dt;
      if (f.shield <= 0) this.breakShield(f, now);
    } else f.shield = Math.min(SMASH.SHIELD_MAX, f.shield + SMASH.SHIELD_REGEN * dt);

    if (helpless) return;

    // Durch weiche Plattformen fallen: "runter" kurz gedrückt halten
    if (grounded && !busy && !f.shieldOn && f.sy > 0.6 && Math.abs(f.sx) < 0.6 && now - f.downSince > 170 && !this.stage.platforms[f.ground].solid) {
      f.dropUntil = now + 280;
      f.ground = -1;
      f.y += 1;
      f.vy = 40;
    }

    for (const b of [...f.buf]) {
      if (b.b === 'jump') {
        if (busy && !(f.attack && f.attack.kind !== 'slam' && now > f.attack.t0 + f.attack.def.startup + f.attack.def.active)) continue;
        if (f.matratze) continue;
        if (f.ground >= 0) {
          f.vy = -SMASH.JUMP_V;
          f.ground = -1;
        } else if (f.jumps > 0) {
          f.jumps -= 1;
          f.vy = -SMASH.AIR_JUMP_V;
          if (Math.abs(b.x) > 0.2) f.vx = b.x * SMASH.AIR_SPEED;
        } else continue;
        f.floatUntil = 0;
        f.attack = null;
        f.busyUntil = now;
        this.consume(f, b);
      } else if (busy || f.shieldOn) {
        // Angriffe während des Schilds: erst loslassen
        if (f.shieldOn) this.consume(f, b);
      } else if (b.b === 'a') {
        this.consume(f, b);
        this.pressA(f, b.x, b.y, now);
      } else if (b.b === 'b') {
        this.consume(f, b);
        this.pressB(f, b.x, b.y, now);
      }
    }
  }

  private consume(f: Fighter, b: Fighter['buf'][number]) {
    f.buf = f.buf.filter((x) => x !== b);
  }

  private startMove(f: Fighter, kind: MoveKind, def: MoveDef, now: number, extraBusy = 0) {
    f.attack = { kind, def, t0: now, hit: new Set() };
    f.busyUntil = now + def.startup + def.active + def.end + extraBusy;
    f.atkSeq += 1;
  }

  private pressA(f: Fighter, x: number, y: number, now: number) {
    if (f.hold) return this.throwItem(f, x, y, now);
    // Gegenstand aufheben
    const item = this.items.find((it) => it.type !== 'ananas' && Math.abs(it.x - f.x) < 16 && Math.abs(it.y - (f.y - 4)) < 22);
    if (item) {
      this.items = this.items.filter((it) => it !== item);
      f.hold = item.type;
      f.throwUntil = now + 150;
      f.busyUntil = now + 150;
      return;
    }
    const air = f.ground < 0;
    let kind: AttackId;
    if (y < -0.5 && -y >= Math.abs(x)) kind = 'up';
    else if (y > 0.5 && y >= Math.abs(x)) kind = air ? 'dair' : 'down';
    else if (Math.abs(x) > 0.35) {
      kind = 'side';
      f.face = x > 0 ? 1 : -1;
    } else kind = air ? 'nair' : 'jab';
    this.startMove(f, kind, ATTACK_MOVES[kind], now);
  }

  private pressB(f: Fighter, x: number, _y: number, now: number) {
    if (now < f.cdUntil) return;
    if (Math.abs(x) > 0.35) f.face = x > 0 ? 1 : -1;
    const sp = f.special;
    if (sp === 'schirm' && f.schirmUsed) return;
    f.cdUntil = now + SPECIALS[sp].cooldown;
    switch (sp) {
      case 'flipflop':
        this.projectiles.push({ id: this.nextId++, type: 'flipflop', x: f.x + f.face * 10, y: f.y - 24, vx: f.face * 310, vy: -20, owner: f.id, grav: 60, dieAt: now + 850 });
        f.busyUntil = now + 260;
        f.throwUntil = now + 260;
        f.atkSeq += 1;
        break;
      case 'schirm':
        f.schirmUsed = true;
        f.ground = -1;
        f.vy = -520;
        f.vx *= 0.3;
        f.floatUntil = now + 1500;
        this.startMove(f, 'schirm', SPECIAL_MOVES.schirm, now, 60);
        break;
      case 'cocktail':
        this.startMove(f, 'cocktail', SPECIAL_MOVES.cocktail, now);
        break;
      case 'wasser':
        this.startMove(f, 'wasser', SPECIAL_MOVES.wasser, now);
        break;
      case 'matratze':
        f.ground = -1;
        f.vy = -360;
        f.matratze = { phase: 'up', at: now };
        f.busyUntil = now + 2000;
        f.atkSeq += 1;
        break;
    }
  }

  private throwItem(f: Fighter, x: number, y: number, now: number) {
    const type = f.hold as 'kokos' | 'bombe';
    f.hold = null;
    if (Math.abs(x) > 0.35) f.face = x > 0 ? 1 : -1;
    let vx = f.face * 330;
    let vy = -90;
    if (y < -0.5 && -y > Math.abs(x)) {
      vx = f.face * 40;
      vy = -420;
    } else if (y > 0.5 && y > Math.abs(x) && f.ground < 0) {
      vx = 0;
      vy = 380;
    }
    this.projectiles.push({ id: this.nextId++, type, x: f.x + f.face * 8, y: f.y - 26, vx, vy, owner: f.id, grav: type === 'kokos' ? 520 : 600, dieAt: now + 3000 });
    f.throwUntil = now + 220;
    f.busyUntil = now + 220;
    f.atkSeq += 1;
  }

  // ---------------------------------------------------------------- Physik

  private physics(f: Fighter, dt: number, now: number, t: number) {
    const stunned = now < f.hitstunUntil;
    const helpless = stunned || now < f.stunUntil;
    const grounded = f.ground >= 0;
    const groundBusy = grounded && now < f.busyUntil && !!f.attack;
    const crouch = grounded && f.sy > 0.6 && Math.abs(f.sx) < 0.6;

    if (grounded) {
      let target = 0;
      if (!helpless && !f.shieldOn && !groundBusy && !crouch && Math.abs(f.sx) > 0.2) {
        target = f.sx * SMASH.RUN;
        if (now >= f.busyUntil) f.face = f.sx > 0 ? 1 : -1;
      }
      f.vx = approach(f.vx, target, SMASH.GROUND_ACCEL * dt);
    } else if (stunned) {
      f.vx *= Math.pow(SMASH.KB_DECAY, dt);
    } else {
      const target = helpless ? 0 : Math.abs(f.sx) > 0.2 ? f.sx * SMASH.AIR_SPEED : 0;
      // Schwung aus Treffern baut sich langsamer ab als normale Luftsteuerung
      const fast = Math.abs(f.vx) > SMASH.AIR_SPEED && Math.sign(target - f.vx) !== Math.sign(f.vx) ? 0.45 : 1;
      f.vx = approach(f.vx, target, SMASH.AIR_ACCEL * fast * dt);
    }

    if (!grounded) {
      f.vy += SMASH.GRAVITY * (stunned ? SMASH.HITSTUN_GRAVITY : 1) * dt;
      let maxFall = SMASH.MAX_FALL;
      if (f.matratze?.phase === 'slam') maxFall = 660;
      else if (now < f.floatUntil && f.sy < 0.6 && !stunned) maxFall = 95;
      else if (!helpless && f.sy > 0.6 && f.vy > 0) maxFall = SMASH.FAST_FALL;
      if (f.vy > maxFall) f.vy = stunned ? Math.max(maxFall, f.vy - 1200 * dt) : maxFall;
    }

    const prevY = f.y;
    const prevHead = f.y - SMASH.H;
    f.x += f.vx * dt;
    f.y += f.vy * dt;

    const plats = this.stage.platforms;
    // Mitfahren auf beweglichen Plattformen
    if (f.ground >= 0) {
      const p = plats[f.ground];
      if (p.move) {
        const a = platformPos(p, t - dt * 1000);
        const b = platformPos(p, t);
        f.x += b.x - a.x;
      }
      const pos = platformPos(p, t);
      f.y = pos.y;
      f.vy = 0;
      if (f.x + 5 <= pos.x || f.x - 5 >= pos.x + p.w) {
        f.ground = -1;
      }
      return;
    }

    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      const pos = platformPos(p, t);
      const prevPos = platformPos(p, t - dt * 1000);
      const overlapX = f.x + 5 > pos.x && f.x - 5 < pos.x + p.w;
      // Landen
      if (f.vy >= 0 && overlapX && prevY <= prevPos.y + 1 && f.y >= pos.y && (p.solid || now >= f.dropUntil)) {
        if (stunned && f.vy > 330) {
          // Abprallen beim harten Aufschlag im Taumel
          f.y = pos.y - 0.5;
          f.vy = -f.vy * 0.38;
          continue;
        }
        this.land(f, i, pos.y, now);
        return;
      }
      if (!p.solid) continue;
      // Kante greifen (großzügig, damit das Zurückkommen am Handy klappt)
      if (!stunned && f.vy > -160 && f.y >= pos.y - 1 && f.y <= pos.y + 22) {
        const nearLeft = f.x >= pos.x - SMASH.W / 2 - 10 && f.x <= pos.x + 2 && f.sx > -0.3;
        const nearRight = f.x <= pos.x + p.w + SMASH.W / 2 + 10 && f.x >= pos.x + p.w - 2 && f.sx < 0.3;
        if (nearLeft || nearRight) {
          f.x = nearLeft ? pos.x + 5 : pos.x + p.w - 5;
          this.land(f, i, pos.y, now);
          return;
        }
      }
      // Feste Plattform: von der Seite / von unten
      const inX = f.x + SMASH.W / 2 > pos.x && f.x - SMASH.W / 2 < pos.x + p.w;
      if (inX && f.y > pos.y + 0.5 && f.y - SMASH.H < pos.y + p.h) {
        if (prevHead >= pos.y + p.h - 1) {
          f.y = pos.y + p.h + SMASH.H;
          f.vy = Math.max(f.vy, 0);
        } else {
          f.x = f.x < pos.x + p.w / 2 ? pos.x - SMASH.W / 2 : pos.x + p.w + SMASH.W / 2;
          f.vx = stunned ? -f.vx * 0.4 : 0;
        }
      }
    }
  }

  private land(f: Fighter, i: number, y: number, now: number) {
    f.ground = i;
    f.y = y;
    f.vy = 0;
    f.jumps = SMASH.AIR_JUMPS;
    f.schirmUsed = false;
    f.floatUntil = 0;
    if (f.attack && (f.attack.kind === 'nair' || f.attack.kind === 'dair' || f.attack.kind === 'side' || f.attack.kind === 'up') && now < f.busyUntil) {
      // kurze Landeverzögerung statt kompletter Nachlauf
      f.attack = null;
      f.busyUntil = Math.min(f.busyUntil, now + 90);
    }
    if (f.matratze?.phase === 'slam') {
      f.matratze = null;
      f.attack = null;
      f.busyUntil = now + 200;
      this.pushFx('wave', f.x, f.y, 0.7, f.id);
      for (const o of this.fighters.values()) {
        if (o === f || o.state !== 'fight') continue;
        if (Math.abs(o.x - f.x) < 46 && Math.abs(o.y - f.y) < 26) this.hit(o, f, SPECIAL_HITS.matratzeWave, Math.sign(o.x - f.x) || f.face, now);
      }
    }
  }

  /** Leichtes Auseinanderschieben, damit 8 Figuren nicht auf einem Pixel stehen */
  private separate(list: Fighter[], dt: number) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.state !== 'fight' || b.state !== 'fight') continue;
        const dx = b.x - a.x;
        if (Math.abs(dx) < 11 && Math.abs(a.y - b.y) < 20) {
          const s = (dx >= 0 ? 1 : -1) * 40 * dt;
          if (a.ground >= 0) a.x -= s;
          if (b.ground >= 0) b.x += s;
        }
      }
    }
  }

  // ---------------------------------------------------------------- Treffer

  private hurtbox(f: Fighter) {
    const crouch = f.ground >= 0 && f.sy > 0.6 && !f.attack;
    const h = crouch ? SMASH.H * 0.68 : SMASH.H;
    return { x: f.x - SMASH.W / 2, y: f.y - h, w: SMASH.W, h };
  }

  private checkAttack(f: Fighter, now: number) {
    const a = f.attack;
    if (!a) return;
    const { def } = a;
    if (now < a.t0 + def.startup || now > a.t0 + def.startup + def.active) return;
    const bx = f.face > 0 ? f.x + def.box.x : f.x - def.box.x - def.box.w;
    const by = f.y + def.box.y;
    const centered = def.box.x < 0;
    for (const o of this.fighters.values()) {
      if (o === f || o.state !== 'fight' || a.hit.has(o.id)) continue;
      const hb = this.hurtbox(o);
      if (bx < hb.x + hb.w && bx + def.box.w > hb.x && by < hb.y + hb.h && by + def.box.h > hb.y) {
        a.hit.add(o.id);
        const dir = centered ? Math.sign(o.x - f.x) || f.face : f.face;
        this.hit(o, f, def.hit, dir, now);
      }
    }
  }

  private hit(o: Fighter, by: Fighter | null, h: HitData, dir: number, now: number) {
    // Ohne Verbindung (nach der 3-s-Gnadenfrist) unverwundbar – TV zeigt den Kämpfer halbtransparent
    if (now < o.invUntil || o.state !== 'fight' || !this.ctx.isConnected(o.id)) return;
    const cx = o.x;
    const cy = o.y - SMASH.H / 2;
    if (o.shieldOn) {
      o.shield -= h.dmg * 2.4 + 4;
      o.vx = dir * 110;
      this.pushFx('shield', cx, cy, Math.min(1, h.dmg / 12), o.id);
      if (o.shield <= 0) this.breakShield(o, now);
      return;
    }
    o.pct = Math.min(999, o.pct + h.dmg);
    if (by) {
      o.lastHitBy = by.id;
      o.lastHitAt = now;
    }
    o.attack = null;
    o.matratze = null;
    o.floatUntil = 0;
    o.busyUntil = 0;
    o.buf = [];
    if (o.hold) {
      this.items.push({ id: this.nextId++, type: o.hold, x: o.x, y: o.y - 10, vy: -120, ground: -1, born: now });
      o.hold = null;
    }
    if (h.stun) {
      o.stunUntil = now + h.stun;
      o.vx = dir * h.base;
      this.pushFx('stun', cx, cy - 10, 0.4, o.id);
      return;
    }
    const crouch = o.ground >= 0 && o.sy > 0.6;
    const kb = knockback(h, o.pct) * (crouch ? 0.85 : 1);
    const ang = (h.angle * Math.PI) / 180;
    o.vx = Math.cos(ang) * kb * dir;
    o.vy = -Math.sin(ang) * kb;
    if (o.ground >= 0 && o.vy > 0) o.vy = -Math.min(220, o.vy * 0.45);
    if (o.vy < -30) o.ground = -1;
    else if (o.ground >= 0) o.vy = 0;
    o.hitstunUntil = now + Math.min(1300, kb * SMASH.HITSTUN_PER_KB);
    o.stunUntil = 0;
    o.dizzy = false;
    this.pushFx('hit', cx, cy, Math.min(1, kb / 520), o.id);
  }

  private breakShield(f: Fighter, now: number) {
    f.shield = 0;
    f.shieldOn = false;
    f.shieldHeld = false;
    f.dizzy = true;
    f.stunUntil = now + SMASH.SHIELD_BREAK_MS;
    f.vy = -260;
    f.ground = -1;
    this.pushFx('break', f.x, f.y - SMASH.H / 2, 1, f.id);
    // Nach dem Platzen startet das Schild halb voll
    this.timers.later(SMASH.SHIELD_BREAK_MS, () => (f.shield = Math.max(f.shield, 40)));
  }

  private checkBlast(f: Fighter, now: number) {
    const B = SMASH.BLAST;
    if (f.x > B.left && f.x < B.right && f.y > B.top && f.y < B.bottom) return;
    f.stocks -= 1;
    this.pushFx('ko', clamp(f.x, 0, 480), clamp(f.y - SMASH.H / 2, 0, 270), 1, f.id);
    if (f.lastHitBy && now - f.lastHitAt < 8000) {
      const k = this.fighters.get(f.lastHitBy);
      if (k && k !== f) {
        k.kos += 1;
        this.ctx.log?.('ko', { p: k.id, o: f.id });
      }
    } else this.ctx.log?.('selfout', { p: f.id });
    f.lastHitBy = null;
    f.attack = null;
    f.matratze = null;
    f.hold = null;
    f.vx = f.vy = 0;
    if (f.stocks <= 0) {
      f.state = 'out';
      this.outOrder.push(f.id);
    } else {
      f.state = 'respawn';
      f.respawnAt = now + SMASH.RESPAWN_MS;
    }
  }

  private respawn(f: Fighter, now: number) {
    const main = mainPlatform(this.stage);
    const others = [...this.fighters.values()].filter((o) => o.state === 'fight');
    // Möglichst weit weg von den anderen wieder einsteigen
    const spots = [0.5, 0.3, 0.7, 0.2, 0.8].map((k) => main.x + main.w * k);
    const x = spots.sort((a, b) => Math.min(...others.map((o) => Math.abs(o.x - b)), 999) - Math.min(...others.map((o) => Math.abs(o.x - a)), 999))[0];
    Object.assign(f, {
      state: 'fight',
      x,
      y: 40,
      vx: 0,
      vy: 0,
      ground: -1,
      pct: 0,
      jumps: SMASH.AIR_JUMPS,
      shield: SMASH.SHIELD_MAX,
      invUntil: now + SMASH.INVINCIBLE_MS,
      floatUntil: now + 1300,
      hitstunUntil: 0,
      stunUntil: 0,
      dizzy: false,
      busyUntil: 0,
      schirmUsed: false,
      buf: [],
    });
    this.pushFx('spawn', x, 40, 0.5, f.id);
  }

  // ---------------------------------------------------------------- Wurfgeschosse & Items

  private updateProjectiles(now: number, dt: number, t: number) {
    const B = SMASH.BLAST;
    const keep: Projectile[] = [];
    for (const pr of this.projectiles) {
      const prevY = pr.y;
      pr.vy += pr.grav * dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      let gone = now > pr.dieAt || pr.x < B.left || pr.x > B.right || pr.y > B.bottom || pr.y < B.top - 100;
      // Fighter treffen
      if (!gone) {
        for (const o of this.fighters.values()) {
          if (o.id === pr.owner || o.state !== 'fight') continue;
          const hb = this.hurtbox(o);
          if (pr.x + 5 > hb.x && pr.x - 5 < hb.x + hb.w && pr.y + 5 > hb.y && pr.y - 5 < hb.y + hb.h) {
            if (pr.type === 'bombe') this.explode(pr, now);
            else {
              const owner = this.fighters.get(pr.owner) ?? null;
              this.hit(o, owner, pr.type === 'kokos' ? ITEM_HITS.kokos : SPECIAL_HITS.flipflop, Math.sign(pr.vx) || 1, now);
            }
            gone = true;
            break;
          }
        }
      }
      // Boden
      if (!gone && pr.type !== 'flipflop' && pr.vy > 0) {
        for (const p of this.stage.platforms) {
          const pos = platformPos(p, t);
          if (pr.x > pos.x && pr.x < pos.x + p.w && prevY <= pos.y && pr.y >= pos.y) {
            if (pr.type === 'bombe') this.explode(pr, now);
            else this.pushFx('hit', pr.x, pos.y - 4, 0.1);
            gone = true;
            break;
          }
        }
      }
      if (!gone && pr.type === 'flipflop') {
        const main = mainPlatform(this.stage);
        if (pr.x > main.x && pr.x < main.x + main.w && pr.y > main.y && pr.y < main.y + main.h) gone = true;
      }
      if (!gone) keep.push(pr);
    }
    this.projectiles = keep.slice(-30);
  }

  private explode(pr: Projectile, now: number) {
    this.pushFx('boom', pr.x, pr.y, 1);
    const owner = this.fighters.get(pr.owner) ?? null;
    for (const o of this.fighters.values()) {
      if (o.id === pr.owner || o.state !== 'fight') continue;
      if (Math.hypot(o.x - pr.x, o.y - SMASH.H / 2 - pr.y) < BOMB_RADIUS) this.hit(o, owner, ITEM_HITS.bombe, Math.sign(o.x - pr.x) || 1, now);
    }
  }

  private updateItems(now: number, dt: number, t: number) {
    if (now >= this.nextItem) {
      this.nextItem = now + SMASH.ITEM_MIN_MS + Math.random() * (SMASH.ITEM_MAX_MS - SMASH.ITEM_MIN_MS);
      if (this.items.length < SMASH.ITEM_MAX) {
        const kinds = Object.keys(ITEM_INFO) as ItemKind[];
        const total = kinds.reduce((s, k) => s + ITEM_INFO[k].weight, 0);
        let r = Math.random() * total;
        const type = kinds.find((k) => (r -= ITEM_INFO[k].weight) < 0) ?? 'kokos';
        const main = mainPlatform(this.stage);
        this.items.push({ id: this.nextId++, type, x: main.x + 20 + Math.random() * (main.w - 40), y: -10, vy: 0, ground: -1, born: now });
      }
    }
    const plats = this.stage.platforms;
    this.items = this.items.filter((it) => {
      if (now - it.born > SMASH.ITEM_LIFE_MS || it.y > SMASH.BLAST.bottom) return false;
      if (it.ground >= 0) {
        const p = plats[it.ground];
        const a = platformPos(p, t - dt * 1000);
        const b = platformPos(p, t);
        it.x += b.x - a.x;
        it.y = b.y;
      } else {
        const prevY = it.y;
        it.vy = Math.min(300, it.vy + 700 * dt);
        it.y += it.vy * dt;
        for (let i = 0; i < plats.length; i++) {
          const pos = platformPos(plats[i], t);
          if (it.x > pos.x && it.x < pos.x + plats[i].w && prevY <= pos.y + 1 && it.y >= pos.y) {
            it.y = pos.y;
            it.vy = 0;
            it.ground = i;
            break;
          }
        }
      }
      // Ananas wird beim Berühren sofort gegessen
      if (it.type === 'ananas') {
        for (const f of this.fighters.values()) {
          if (f.state === 'fight' && Math.abs(f.x - it.x) < 13 && it.y > f.y - SMASH.H - 4 && it.y < f.y + 6) {
            f.pct = Math.max(0, f.pct - SMASH.ANANAS_HEAL);
            this.pushFx('heal', f.x, f.y - SMASH.H, 1, f.id);
            return false;
          }
        }
      }
      return true;
    });
  }

  private pushFx(type: SmashFx['type'], x: number, y: number, p: number, id?: string) {
    this.fx.push({ seq: ++this.fxSeq, type, x: r1(x), y: r1(y), p: Math.round(p * 100) / 100, ...(id ? { id } : {}) });
    if (this.fx.length > 16) this.fx.shift();
  }

  // ---------------------------------------------------------------- Ende

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.timers.clear();
    const all = [...this.fighters.values()];
    const score = (id: string) => {
      const f = this.fighters.get(id)!;
      if (f.state === 'out') return this.outOrder.indexOf(id);
      return 1e6 + f.stocks * 1000 - Math.min(999, f.pct);
    };
    // Wetten auflösen: Sieger nach dem reinen Kampfstand, danach zählt der Bonus (nie über Platz 1)
    const plain = groupByScore(this.ids, score);
    this.bets.resolve(plain[0]?.length === 1 ? plain[0][0] : null);
    const groups = this.bets.rank(this.ids, score);
    groups.forEach((g, gi) =>
      g.forEach((id) => {
        const f = this.fighters.get(id);
        if (f) f.place = gi + 1;
      }),
    );
    this.winner = groups[0]?.length === 1 ? groups[0][0] : null;
    this.ctx.onChange();
    const timeUp = all.filter((f) => f.state !== 'out').length > 1;
    const ko = (n: number) => (n === 1 ? '1 K.O.' : `${n} K.O.s`);
    this.timers.later(SMASH.END_MS, () =>
      this.ctx.finish({
        groups,
        details: Object.fromEntries(
          all.map((f) => [f.id, (f.state === 'out' ? `raus · ${ko(f.kos)}` : `${f.stocks} Leben, ${Math.round(f.pct)}% · ${ko(f.kos)}`) + this.bets.detail(f.id)]),
        ),
        subtitle: this.winner
          ? `${this.ctx.nameOf(this.winner)} beherrscht die ${this.stage.name}!`
          : timeUp
            ? 'Zeit um! Die meisten Leben gewinnen.'
            : 'Unentschieden!',
      }),
    );
  }

  // ---------------------------------------------------------------- Zustand

  private aliveIds() {
    return [...this.fighters.values()].filter((f) => f.state !== 'out').map((f) => f.id);
  }

  private anim(f: Fighter, now: number): SmashAnim {
    if (f.dizzy && now < f.stunUntil) return 'dizzy';
    if (now < f.stunUntil) return 'stun';
    if (now < f.hitstunUntil) return 'hurt';
    if (now < f.throwUntil) return f.hold ? 'idle' : 'throw';
    if (f.matratze) return 'spec';
    if (f.attack && now < f.busyUntil) {
      const k = f.attack.kind;
      return k === 'schirm' || k === 'cocktail' || k === 'wasser' || k === 'slam' ? 'spec' : k;
    }
    if (f.shieldOn) return 'shield';
    if (f.ground < 0) return 'air';
    if (f.sy > 0.6 && Math.abs(f.sx) < 0.6) return 'crouch';
    return Math.abs(f.vx) > 20 ? 'run' : 'idle';
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const beams: SmashState['beams'] = [];
    for (const f of this.fighters.values()) {
      const a = f.attack;
      if (f.state !== 'fight' || !a || (a.kind !== 'wasser' && a.kind !== 'cocktail')) continue;
      if (now < a.t0 + a.def.startup || now > a.t0 + a.def.startup + a.def.active) continue;
      beams.push({ id: f.id, type: a.kind, x: r1(f.x + f.face * a.def.box.x), y: r1(f.y + a.def.box.y + a.def.box.h / 2), w: a.def.box.w, face: f.face });
    }
    return {
      kind: 'smash',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - now),
        stage: this.stage.id,
        t: this.sub === 'fight' ? now - this.fightStart : this.sub === 'over' ? this.last - this.fightStart : 0,
        fighters: Object.fromEntries(
          [...this.fighters.values()].map((f) => [
            f.id,
            {
              x: r1(f.x),
              y: r1(f.y),
              vx: Math.round(f.vx),
              vy: Math.round(f.vy),
              face: f.face,
              anim: this.anim(f, now),
              atkSeq: f.atkSeq,
              pct: Math.round(f.pct),
              stocks: Math.max(0, f.stocks),
              shield: Math.round(f.shield),
              jumps: f.jumps,
              ground: f.ground >= 0,
              special: f.special,
              cd: Math.max(0, f.cdUntil - now),
              hold: f.hold,
              inv: now < f.invUntil,
              ...(f.state === 'fight' && !this.ctx.isConnected(f.id) ? { away: true } : {}),
              state: f.state,
              kos: f.kos,
              place: f.place,
            },
          ]),
        ),
        beams,
        projectiles: this.projectiles.map(({ id, type, x, y, vx, vy }) => ({ id, type, x: r1(x), y: r1(y), vx: Math.round(vx), vy: Math.round(vy) })),
        items: this.items.map(({ id, type, x, y }) => ({ id, type, x: r1(x), y: r1(y) })),
        fx: this.fx,
        winner: this.winner,
        spectator: this.bets.info(this.aliveIds(), 1, this.sub === 'fight', this.sub === 'over' ? this.winner : undefined),
      },
    };
  }

  dispose() {
    this.timers.clear();
  }
}
