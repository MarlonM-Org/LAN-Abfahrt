import type { IgelFx, IgelHog, IgelState, IgelWeapon, MiniSnapshot, SkipInfo } from '../shared/types';
import { possessive } from '../shared/players';
import {
  BAZOOKA,
  GRENADE,
  IGEL,
  IGEL_TAUNTS,
  PUNCH,
  WEAPONS,
  type Mask,
  bodyHits,
  carve,
  genTerrain,
  igelMaxHp,
  igelSuddenMs,
  igelTurnMs,
  isSolid,
  launch,
  stepBallistic,
  supported,
  surfaceY,
} from '../shared/igel';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const TICK_MS = 50;
const STEPS = Math.round(TICK_MS / 1000 / IGEL.DT);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

interface Hog extends IgelHog {
  vx: number;
  vy: number;
  walkAcc: number;
  /** Rest für das Herunterzählen der HP-Anzeige */
  shownAcc: number;
}

interface Proj {
  id: number;
  type: 'bazooka' | 'grenade';
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  owner: string;
  hogId: number;
}

/**
 * Igel-Krieg – rundenbasiert wie Worms auf einer zerstörbaren Urlaubsinsel.
 * Jeder Spieler ist ein Team (bis 4 Spieler: 2 Igel pro Team, sonst 1).
 * Zugzeit, HP und Sudden Death skalieren mit der Spielerzahl (`igelTurnMs` usw.), der Wind driftet,
 * die Flut steigt pro voller Runde, Schaden zählt am Zugende herunter.
 * Das Terrain liegt hier als Bitmaske; übertragen werden nur Seed + Kraterliste.
 */
export class IgelGame implements MiniGame {
  readonly kind = 'igel' as const;
  private timers = new Timers();
  private seed = Math.floor(Math.random() * 2 ** 31);
  private mask: Mask;
  private craters: [number, number, number][] = [];
  private water: number = IGEL.WATER_Y;
  private wind = 0;
  private teams: string[];
  private hogs: Hog[] = [];
  private sub: IgelState['sub'] = 'countdown';
  private deadline = Date.now() + IGEL.COUNTDOWN_MS;
  private settleAt = 0;
  private turn = 0;
  private teamPtr = -1;
  private hogPtr: Record<string, number> = {};
  private active: string | null = null;
  private activeHog: number | null = null;
  private weaponOf: Record<string, IgelWeapon> = {};
  private ammo: Record<string, Record<IgelWeapon, number>> = {};
  private aim: IgelState['aim'] = null;
  private projs: Proj[] = [];
  private projSeq = 0;
  private fx: IgelFx[] = [];
  private fxSeq = 0;
  private walkDir: -1 | 0 | 1 = 0;
  private startedAt = Date.now();
  private suddenDeath = false;
  private damage: Record<string, number> = {};
  private out: string[] = [];
  /** Zug, in dem ein Team ausgeschieden ist (für gleichzeitiges Ausscheiden) */
  private outTurn: Record<string, number> = {};
  private tickNo = 0;
  private dirty = true;
  /** Nach Spielerzahl: Zugzeit, Start-HP, Sudden-Death-Beginn */
  private turnMs: number;
  private maxHp: number;
  private suddenMs: number;
  /** Zuschauer-Sprüche: wann darf der Spieler wieder? */
  private tauntReady: Record<string, number> = {};

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.mask = genTerrain(this.seed);
    this.teams = shuffle(ids);
    this.turnMs = igelTurnMs(ids.length);
    this.maxHp = igelMaxHp(ids.length);
    // Zum Testen kürzer: IGEL_SUDDEN_MS=20000 npm run dev
    this.suddenMs = Number(process.env.IGEL_SUDDEN_MS) || igelSuddenMs(ids.length);
    // Startwind leicht, danach driftet er pro Zug
    this.wind = Math.round((Math.random() - 0.5) * 0.8 * 100) / 100;
    const perTeam = ids.length <= 4 ? 2 : 1;
    for (const id of ids) {
      this.damage[id] = 0;
      this.hogPtr[id] = 0;
      this.weaponOf[id] = 'bazooka';
      this.ammo[id] = Object.fromEntries((Object.keys(WEAPONS) as IgelWeapon[]).map((w) => [w, WEAPONS[w].ammo])) as Record<IgelWeapon, number>;
    }
    // Spawnpunkte: abwechselnd nach Team, damit die Igel gemischt stehen
    const spots = this.spawnSpots(this.teams.length * perTeam);
    let k = 0;
    for (let n = 0; n < perTeam; n++) {
      for (const owner of this.teams) {
        const s = spots[k++];
        this.hogs.push({ id: this.hogs.length, owner, x: s.x, y: s.y, hp: this.maxHp, shown: this.maxHp, dir: s.x < IGEL.W / 2 ? 1 : -1, state: 'ok', flying: true, walking: false, vx: 0, vy: 0, walkAcc: 0, shownAcc: 0 });
      }
    }
    this.timers.every(TICK_MS, () => this.tick());
    this.timers.later(IGEL.COUNTDOWN_MS, () => this.startTurn());
  }

  private spawnSpots(n: number) {
    const cands: { x: number; y: number }[] = [];
    for (let x = 10; x < IGEL.W - 10; x += 2) {
      const sy = surfaceY(this.mask, x);
      if (sy > this.water - 16 || sy < 30) continue;
      if (Math.abs(surfaceY(this.mask, x - 3) - surfaceY(this.mask, x + 3)) > 8) continue;
      cands.push({ x, y: sy - 1 });
    }
    const pool = shuffle(cands);
    const out: { x: number; y: number }[] = [];
    for (const gap of [34, 24, 14, 6, 0]) {
      for (const c of pool) {
        if (out.length >= n) break;
        if (out.every((o) => Math.abs(o.x - c.x) >= gap) && !out.includes(c)) out.push(c);
      }
      if (out.length >= n) break;
    }
    while (out.length < n) out.push({ x: 60 + Math.random() * (IGEL.W - 120), y: 20 });
    return out;
  }

  // ---------------------------------------------------------------- Ablauf

  private aliveHogs(owner?: string) {
    return this.hogs.filter((h) => h.state === 'ok' && (owner === undefined || h.owner === owner));
  }

  private teamAlive(id: string) {
    return this.aliveHogs(id).length > 0;
  }

  private nextTeamFrom(ptr: number): number {
    for (let i = 1; i <= this.teams.length; i++) {
      const idx = (ptr + i) % this.teams.length;
      if (this.teamAlive(this.teams[idx])) return idx;
    }
    return -1;
  }

  private startTurn() {
    if (this.sub === 'over') return;
    const idx = this.nextTeamFrom(this.teamPtr);
    if (idx < 0) return this.end();
    this.teamPtr = idx;
    const owner = this.teams[idx];
    const mine = this.aliveHogs(owner);
    const hog = mine[this.hogPtr[owner] % mine.length];
    this.hogPtr[owner] += 1;
    this.turn += 1;
    this.active = owner;
    this.activeHog = hog.id;
    // Wind driftet nur leicht weiter – so lernt man aus dem Schuss des Vorgängers
    if (this.turn > 1) this.wind = Math.round(clamp(this.wind + (Math.random() - 0.5) * IGEL.WIND_DRIFT, -1, 1) * 100) / 100;
    for (const h of this.hogs) (h.shown = Math.max(0, h.hp)), (h.shownAcc = 0);
    if (this.ammo[owner][this.weaponOf[owner]] === 0) this.weaponOf[owner] = 'bazooka';
    this.aim = null;
    this.walkDir = 0;
    this.sub = 'aim';
    // Kurz offline (App gewechselt)? 5 s Gnadenfrist statt sofort weiter
    this.deadline = Date.now() + (this.ctx.isConnected(owner) ? this.turnMs : IGEL.OFFLINE_TURN_MS);
    this.dirty = true;
  }

  private toSettle() {
    this.sub = 'settle';
    this.settleAt = Date.now() + IGEL.SETTLE_MIN_MS;
    this.walkDir = 0;
    this.aim = null;
    this.dirty = true;
  }

  private finishTurn() {
    const now = Date.now();
    for (const h of this.hogs) {
      if (h.state === 'ok' && h.hp <= 0) {
        h.state = 'dead';
        this.addFx({ type: 'ko', x: h.x, y: h.y - 10, text: 'K.O.' });
      }
    }
    for (const h of this.hogs) (h.shown = Math.max(0, h.hp)), (h.shownAcc = 0);
    // Volle Runde vorbei? (Der nächste Zug springt in der Reihenfolge wieder nach vorn.)
    const nextIdx = this.nextTeamFrom(this.teamPtr);
    const roundDone = nextIdx >= 0 && nextIdx <= this.teamPtr;
    if (!this.suddenDeath && now - this.startedAt >= this.suddenMs) {
      this.suddenDeath = true;
      this.addFx({ type: 'water', x: IGEL.W / 2, y: 90, text: 'SUDDEN DEATH – Flut!' });
    } else if (this.suddenDeath && roundDone) {
      // Flut steigt pro voller Runde (fair: jeder war seitdem einmal dran) – bei vielen Teams etwas mehr
      const alive = this.teams.filter((id) => this.teamAlive(id)).length;
      const rise = Math.round(IGEL.WATER_RISE * clamp(alive / 4, 1, 2));
      this.water = Math.max(60, this.water - rise);
      this.addFx({ type: 'water', x: IGEL.W / 2, y: 90, text: 'Die Flut steigt!' });
      for (const h of this.hogs) if (h.state !== 'drowned' && h.y - 3 > this.water) this.drown(h);
    }
    for (const id of this.teams) {
      if (!this.out.includes(id) && !this.teamAlive(id)) {
        this.out.push(id);
        this.outTurn[id] = this.turn;
      }
    }
    const alive = this.teams.filter((id) => this.teamAlive(id));
    if (alive.length <= 1 || now - this.startedAt >= IGEL.HARD_CAP_MS) return this.end();
    this.startTurn();
  }

  // ---------------------------------------------------------------- Physik

  private tick() {
    const now = Date.now();
    this.tickNo++;
    const dt = TICK_MS / 1000;
    let moving = false;

    // Laufen des aktiven Igels
    const ah = this.activeHog !== null ? this.hogs[this.activeHog] : null;
    for (const h of this.hogs) h.walking = false;
    if (ah && ah.state === 'ok' && !ah.flying && this.walkDir !== 0 && (this.sub === 'aim' || this.sub === 'retreat')) {
      ah.dir = this.walkDir;
      ah.walkAcc += IGEL.WALK * dt;
      while (ah.walkAcc >= 1 && !ah.flying) {
        ah.walkAcc -= 1;
        if (!this.walkStep(ah, this.walkDir)) {
          ah.walkAcc = 0;
          break;
        }
        ah.walking = true;
      }
      moving = true;
    }

    // Igel-Physik
    for (const h of this.hogs) {
      if (h.state === 'drowned') continue;
      if (!h.flying) {
        if (bodyHits(this.mask, h.x, h.y)) this.unstick(h);
        if (!supported(this.mask, h.x, h.y)) {
          h.flying = true;
          h.vx = 0;
          h.vy = 0;
        }
      }
      if (h.flying) {
        moving = true;
        this.flyHog(h);
      }
      if (h.y - 3 > this.water || h.y > IGEL.H + 20) this.drown(h);
    }

    // Geschosse
    if (this.projs.length) {
      moving = true;
      for (let s = 0; s < STEPS; s++) this.stepProjs();
    }

    // Zustandswechsel
    switch (this.sub) {
      case 'aim':
        if (now >= this.deadline || !ah || ah.state !== 'ok') this.toSettle();
        break;
      case 'flight':
        if (!this.projs.length || now >= this.deadline) {
          this.projs = [];
          this.sub = 'retreat';
          this.deadline = now + IGEL.RETREAT_MS;
          this.dirty = true;
        }
        break;
      case 'retreat':
        if (now >= this.deadline || !ah || ah.state !== 'ok') this.toSettle();
        break;
      case 'settle': {
        const busy = this.projs.length > 0 || this.hogs.some((h) => h.state !== 'drowned' && h.flying);
        // Erst wenn alles liegt: HP-Anzeige Punkt für Punkt herunterzählen
        const counting = !busy && this.countDownHp(dt);
        if (counting) moving = true;
        // Notbremse nach 8 s: falls ein Igel ewig zappelt, trotzdem weiter
        if ((!busy && !counting && now >= this.settleAt) || now - this.settleAt > 8000) {
          this.projs = [];
          this.finishTurn();
        }
        break;
      }
    }
    if (this.sub === 'over') return;
    if (moving || this.dirty || this.tickNo % 4 === 0) {
      this.dirty = false;
      this.ctx.onChange();
    }
  }

  /** Zählt die angezeigten HP Richtung echter HP herunter; true, solange noch etwas läuft */
  private countDownHp(dt: number): boolean {
    const behind = this.hogs.filter((h) => h.state !== 'drowned' && h.shown > Math.max(0, h.hp));
    if (!behind.length) return false;
    const maxGap = Math.max(...behind.map((h) => h.shown - Math.max(0, h.hp)));
    const rate = Math.max(IGEL.HP_TICK_PER_S, maxGap / (IGEL.HP_TICK_MAX_MS / 1000));
    for (const h of behind) {
      h.shownAcc += rate * dt;
      const step = Math.floor(h.shownAcc);
      if (step < 1) continue;
      h.shownAcc -= step;
      h.shown = Math.max(Math.max(0, h.hp), h.shown - step);
    }
    this.dirty = true;
    return true;
  }

  private walkStep(h: Hog, dir: -1 | 1): boolean {
    const nx = Math.round(h.x) + dir;
    if (nx < 3 || nx > IGEL.W - 3) return false;
    const y0 = Math.round(h.y);
    let ny: number | null = null;
    for (let up = 0; up <= 3; up++) {
      if (!bodyHits(this.mask, nx, y0 - up)) {
        ny = y0 - up;
        break;
      }
    }
    if (ny === null) return false;
    h.x = nx;
    h.y = ny;
    for (let d = 0; d < 3 && !supported(this.mask, h.x, h.y); d++) {
      if (bodyHits(this.mask, h.x, h.y + 1)) break;
      h.y += 1;
    }
    if (!supported(this.mask, h.x, h.y)) {
      h.flying = true;
      h.vx = dir * 20;
      h.vy = 0;
    }
    return true;
  }

  private unstick(h: Hog) {
    for (let up = 1; up <= 14; up++) {
      if (!bodyHits(this.mask, h.x, h.y - up)) {
        h.y -= up;
        return;
      }
    }
  }

  private flyHog(h: Hog) {
    const dt = IGEL.DT;
    for (let s = 0; s < STEPS; s++) {
      h.vy = Math.min(420, h.vy + IGEL.GRAVITY * dt);
      const nx = h.x + h.vx * dt;
      if (bodyHits(this.mask, nx, h.y)) h.vx = -h.vx * 0.35;
      else h.x = clamp(nx, -40, IGEL.W + 40);
      const ny = h.y + h.vy * dt;
      if (bodyHits(this.mask, h.x, ny)) {
        if (h.vy > 0) {
          this.land(h);
          return;
        }
        h.vy = 0;
      } else h.y = ny;
    }
  }

  private land(h: Hog) {
    const impact = h.vy;
    h.flying = false;
    h.vx = 0;
    h.vy = 0;
    h.y = Math.floor(h.y);
    for (let d = 0; d < 3 && !supported(this.mask, h.x, h.y); d++) h.y += 1;
    if (!supported(this.mask, h.x, h.y)) {
      // Kante erwischt – weiter fallen
      h.flying = true;
      return;
    }
    if (impact > IGEL.FALL_SAFE && h.state === 'ok') this.hurt(h, Math.round((impact - IGEL.FALL_SAFE) * IGEL.FALL_DMG), null);
  }

  private drown(h: Hog) {
    if (h.state === 'drowned') return;
    const wasAlive = h.state === 'ok';
    h.state = 'drowned';
    h.hp = 0;
    h.shown = 0;
    h.flying = false;
    h.y = this.water;
    h.x = clamp(h.x, 4, IGEL.W - 4);
    this.addFx({ type: 'splash', x: h.x, y: this.water, text: wasAlive ? 'PLATSCH!' : undefined });
    if (h.id === this.activeHog && this.sub === 'aim') this.toSettle();
    this.dirty = true;
  }

  private stepProjs() {
    const dt = IGEL.DT;
    for (const p of [...this.projs]) {
      p.age += dt;
      if (p.type === 'bazooka') {
        stepBallistic(p, dt, this.wind);
        if (this.offWorld(p)) continue;
        if (isSolid(this.mask, p.x, p.y)) {
          this.explode(p, BAZOOKA.R, BAZOOKA.DMG);
          continue;
        }
        const hit = this.hogs.find((h) => h.state === 'ok' && !(h.id === p.hogId && p.age * 1000 < BAZOOKA.ARM_MS) && Math.hypot(h.x - p.x, h.y - 4 - p.y) < 5);
        if (hit) this.explode(p, BAZOOKA.R, BAZOOKA.DMG);
      } else {
        p.vy += IGEL.GRAVITY * dt;
        const nx = p.x + p.vx * dt;
        if (isSolid(this.mask, nx, p.y)) {
          p.vx = -p.vx * 0.45;
          p.vy *= 0.85;
        } else p.x = nx;
        const ny = p.y + p.vy * dt;
        if (isSolid(this.mask, p.x, ny)) {
          p.vy = -p.vy * 0.4;
          p.vx *= 0.75;
          if (Math.abs(p.vy) < 12) p.vy = 0;
        } else p.y = ny;
        if (this.offWorld(p)) continue;
        if (p.age * 1000 >= GRENADE.FUSE_MS) this.explode(p, GRENADE.R, GRENADE.DMG);
      }
    }
  }

  private offWorld(p: Proj) {
    if (p.y > this.water || p.x < -60 || p.x > IGEL.W + 60 || p.y > IGEL.H) {
      this.projs = this.projs.filter((q) => q !== p);
      if (p.x > -10 && p.x < IGEL.W + 10) this.addFx({ type: 'splash', x: p.x, y: this.water });
      return true;
    }
    return false;
  }

  private explode(p: Proj, r: number, maxDmg: number) {
    this.projs = this.projs.filter((q) => q !== p);
    carve(this.mask, p.x, p.y, r);
    this.craters.push([Math.round(p.x), Math.round(p.y), r]);
    this.addFx({ type: 'boom', x: p.x, y: p.y, r });
    for (const h of this.hogs) {
      if (h.state === 'drowned') continue;
      const cx = h.x;
      const cy = h.y - 4;
      const d = Math.hypot(cx - p.x, cy - p.y);
      const reach = r + 10;
      if (d >= reach) continue;
      const f = 1 - d / reach;
      const nx = d < 1 ? 0 : (cx - p.x) / d;
      const ny = d < 1 ? -1 : (cy - p.y) / d;
      h.flying = true;
      h.vx = nx * 210 * f;
      h.vy = ny * 210 * f - 90 * f;
      if (h.state === 'ok') this.hurt(h, Math.round(maxDmg * Math.min(1, f * 1.3)), p.owner);
    }
    this.dirty = true;
  }

  private hurt(h: Hog, dmg: number, attacker: string | null) {
    if (dmg <= 0 || h.state !== 'ok') return;
    const real = Math.min(h.hp, dmg);
    h.hp -= real;
    this.addFx({ type: 'dmg', x: h.x, y: h.y - 12, text: `-${dmg}` });
    if (attacker && attacker !== h.owner) this.damage[attacker] = (this.damage[attacker] ?? 0) + real;
    // Wer sich selbst verletzt (Fallschaden), dessen Zug ist vorbei
    if (h.id === this.activeHog && this.sub === 'aim') this.toSettle();
  }

  private addFx(f: Omit<IgelFx, 'seq'>) {
    this.fx.push({ ...f, x: Math.round(f.x), y: Math.round(f.y), seq: ++this.fxSeq });
    if (this.fx.length > 20) this.fx.shift();
    this.dirty = true;
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    if (action === 'taunt') return this.taunt(id, asRecord(payload));
    if (id !== this.active || this.activeHog === null) return;
    const h = this.hogs[this.activeHog];
    if (h.state !== 'ok') return;
    const pl = asRecord(payload);
    const canMove = this.sub === 'aim' || this.sub === 'retreat';
    switch (action) {
      case 'move': {
        const d = Number(pl.dir);
        this.walkDir = canMove ? (d > 0 ? 1 : d < 0 ? -1 : 0) : 0;
        if (this.walkDir) h.dir = this.walkDir;
        break;
      }
      case 'jump':
        if (canMove && !h.flying && supported(this.mask, h.x, h.y)) {
          h.flying = true;
          h.vx = h.dir * IGEL.JUMP_VX;
          h.vy = IGEL.JUMP_VY;
        }
        break;
      case 'weapon': {
        const w = String(pl.weapon) as IgelWeapon;
        if (this.sub === 'aim' && w in WEAPONS && this.ammo[id][w] !== 0) this.weaponOf[id] = w;
        break;
      }
      case 'aim': {
        if (this.sub !== 'aim') break;
        if (pl.angle === null) {
          this.aim = null;
          break;
        }
        const angle = Number(pl.angle);
        const power = Number(pl.power);
        if (!Number.isFinite(angle) || !Number.isFinite(power)) break;
        this.aim = { angle: Math.round(angle * 100) / 100, power: Math.round(clamp(power, 0, 1) * 100) / 100 };
        if (Math.abs(Math.cos(angle)) > 0.05) h.dir = Math.cos(angle) > 0 ? 1 : -1;
        break;
      }
      case 'fire':
        this.fire(h, Number(pl.angle), Number(pl.power));
        break;
      case 'done':
        if (this.sub === 'retreat') this.deadline = Date.now();
        break;
    }
    this.dirty = true;
  }

  /** Zuschauer-Spruch: Sprechblase über dem eigenen Igel (nicht, wer gerade dran ist) */
  private taunt(id: string, pl: Record<string, unknown>) {
    const i = Number(pl.i);
    if (!Number.isInteger(i) || i < 0 || i >= IGEL_TAUNTS.length) return;
    if (this.sub === 'over' || id === this.active || !this.teams.includes(id)) return;
    const now = Date.now();
    if (now < (this.tauntReady[id] ?? 0)) return;
    // Lebender Igel bevorzugt, sonst der Grabstein; wer ertrunken ist, ruft vom Schwimmring
    const mine = this.hogs.filter((h) => h.owner === id);
    const hog = mine.find((h) => h.state === 'ok') ?? mine.find((h) => h.state === 'dead') ?? mine[0];
    if (!hog) return;
    this.tauntReady[id] = now + IGEL.TAUNT_COOLDOWN_MS;
    this.addFx({ type: 'taunt', x: hog.x, y: hog.state === 'drowned' ? this.water : hog.y, text: IGEL_TAUNTS[i], hog: hog.id });
  }

  private fire(h: Hog, angle: number, power: number) {
    if (this.sub !== 'aim' || !Number.isFinite(angle) || !Number.isFinite(power)) return;
    power = clamp(power, 0, 1);
    const owner = h.owner;
    const w = this.weaponOf[owner];
    if (this.ammo[owner][w] === 0) return;
    if (Math.abs(Math.cos(angle)) > 0.05) h.dir = Math.cos(angle) > 0 ? 1 : -1;
    const cy = h.y - 4;
    if (w === 'bazooka' || w === 'grenade') {
      const b = launch(h.x, cy, angle, power, w === 'grenade' ? GRENADE.SPEED : 1);
      this.projs.push({ id: ++this.projSeq, type: w, ...b, age: 0, owner, hogId: h.id });
      this.sub = 'flight';
      this.deadline = Date.now() + 9000;
    } else if (w === 'teleport') {
      const tx = Math.round(clamp(h.x + Math.cos(angle) * power * IGEL.TELE_RANGE, 6, IGEL.W - 6));
      let ty = Math.round(clamp(cy + Math.sin(angle) * power * IGEL.TELE_RANGE, 14, this.water - 10));
      let found: number | null = null;
      for (let dy = 0; dy < 140; dy++) {
        if (ty - dy < 10) break;
        if (!bodyHits(this.mask, tx, ty - dy)) {
          found = ty - dy;
          break;
        }
      }
      if (found === null) {
        const sy = surfaceY(this.mask, tx) - 1;
        if (sy > this.water - 6 || sy < 10) return;
        ty = sy;
      } else ty = found;
      this.addFx({ type: 'tele', x: h.x, y: cy });
      h.x = tx;
      h.y = ty;
      h.vx = 0;
      h.vy = 0;
      h.flying = true;
      this.addFx({ type: 'tele', x: tx, y: ty - 4 });
      this.sub = 'retreat';
      this.deadline = Date.now() + IGEL.RETREAT_MS;
    } else {
      const dir = Math.cos(angle) >= 0 ? 1 : -1;
      h.dir = dir;
      this.addFx({ type: 'pow', x: h.x + dir * 9, y: cy - 2, text: 'POW!' });
      for (const o of this.hogs) {
        if (o === h || o.state !== 'ok') continue;
        const dx = (o.x - h.x) * dir;
        if (dx < -3 || dx > PUNCH.REACH || Math.abs(o.y - h.y) > 12) continue;
        o.flying = true;
        o.vx = dir * PUNCH.VX;
        o.vy = PUNCH.VY;
        this.hurt(o, PUNCH.DMG, owner);
      }
      this.sub = 'retreat';
      this.deadline = Date.now() + IGEL.RETREAT_MS;
    }
    if (this.ammo[owner][w] > 0) this.ammo[owner][w] -= 1;
    if (this.ammo[owner][w] === 0) this.weaponOf[owner] = 'bazooka';
    this.aim = null;
    this.walkDir = 0;
    this.dirty = true;
  }

  // ---------------------------------------------------------------- Ende

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.active = null;
    this.activeHog = null;
    this.timers.clear();
    this.ctx.onChange();
    const hpOf = (id: string) => this.aliveHogs(id).reduce((s, h) => s + Math.max(0, h.hp), 0);
    const score = (id: string) => (this.out.includes(id) ? (this.outTurn[id] ?? 0) * 1e6 : 1e9 + hpOf(id) * 1e3) + (this.damage[id] ?? 0);
    const alive = this.teams.filter((id) => !this.out.includes(id));
    const subtitle =
      alive.length === 1
        ? `${this.ctx.nameOf(alive[0])} beherrscht die Insel!`
        : alive.length === 0
          ? 'Alle baden gegangen – Unentschieden!'
          : 'Zeit um – die meisten Lebenspunkte gewinnen!';
    this.timers.later(3200, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, score),
        details: Object.fromEntries(
          this.ids.map((id) => {
            const dmg = `${this.damage[id] ?? 0} Schaden`;
            return [id, this.out.includes(id) ? `ausgeschieden · ${dmg}` : `${hpOf(id)} HP übrig · ${dmg}`];
          }),
        ),
        subtitle,
      }),
    );
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const nextIdx = this.sub === 'over' ? -1 : this.nextTeamFrom(this.teamPtr);
    const next = nextIdx >= 0 ? this.teams[nextIdx] : null;
    return {
      kind: 'igel',
      state: {
        sub: this.sub,
        endsIn: this.sub === 'settle' || this.sub === 'flight' || this.sub === 'over' ? 0 : Math.max(0, this.deadline - now),
        seed: this.seed,
        craters: this.craters,
        water: this.water,
        wind: this.wind,
        teams: this.teams,
        hogs: this.hogs.map((h) => ({ id: h.id, owner: h.owner, x: r1(h.x), y: r1(h.y), hp: h.hp, shown: h.shown, dir: h.dir, state: h.state, flying: h.flying, walking: h.walking })),
        turn: this.turn,
        active: this.active,
        activeHog: this.activeHog,
        next: next !== this.active ? next : null,
        weapon: this.active ? this.weaponOf[this.active] : 'bazooka',
        ammo: this.ammo,
        aim: this.aim,
        projs: this.projs.map((p) => ({ id: p.id, type: p.type, x: r1(p.x), y: r1(p.y) })),
        fx: this.fx,
        suddenDeath: this.suddenDeath,
        suddenIn: Math.max(0, this.startedAt + this.suddenMs - now),
        maxHp: this.maxHp,
        turnMs: this.turnMs,
        damage: this.damage,
        out: this.out,
      },
    };
  }

  /** VIP/Laptop: Zug des aktiven Spielers beenden (ohne Schuss) */
  skippable(): SkipInfo | null {
    return this.sub === 'aim' && this.active ? { label: `${possessive(this.ctx.nameOf(this.active))} Zug überspringen` } : null;
  }

  skip() {
    if (this.sub !== 'aim') return;
    this.toSettle();
    this.ctx.onChange();
  }

  playerDisconnected(id: string) {
    if (id === this.active && this.sub === 'aim') {
      this.walkDir = 0;
      this.deadline = Math.min(this.deadline, Date.now() + IGEL.OFFLINE_TURN_MS);
    }
  }

  dispose() {
    this.timers.clear();
  }
}
