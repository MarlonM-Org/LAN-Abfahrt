import type { IgelAim, IgelFx, IgelHog, IgelObj, IgelOp, IgelProjType, IgelSquad, IgelState, IgelWeapon, MiniSnapshot, SkipInfo } from '../shared/types';
import { possessive } from '../shared/players';
import {
  AIRSTRIKE,
  BARREL,
  BAZOOKA,
  CLUSTER,
  CRATE,
  CRATE_LOOT,
  DYNAMITE,
  GRENADE,
  HOLY,
  IGEL,
  IGEL_SQUADS,
  IGEL_TAUNTS,
  MINE,
  PADDLE,
  PUNCH,
  SHOTGUN,
  SIMUL,
  WEAPONS,
  type Mask,
  applyOp,
  bodyHits,
  carve,
  genTerrain,
  igelMaxHp,
  igelSimul,
  igelSquadCount,
  igelSuddenMs,
  igelTurnMs,
  isSolid,
  launch,
  plankOps,
  speedScale,
  stepBallistic,
  supported,
  surfaceY,
  windFactor,
} from '../shared/igel';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const TICK_MS = 50;
const STEPS = Math.round(TICK_MS / 1000 / IGEL.DT);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

interface Hog extends IgelHog {
  vx: number;
  vy: number;
  walkAcc: number;
  walkDir: -1 | 0 | 1;
  /** Rest für das Herunterzählen der HP-Anzeige */
  shownAcc: number;
}

interface Proj {
  id: number;
  type: IgelProjType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  /** Zünder in s (0 = Aufschlagzünder) */
  fuse: number;
  /** Windanteil (Bazooka 1, Wurfwaffen 0) */
  wind: number;
  owner: string;
  hogId: number;
}

interface Obj extends IgelObj {
  vy: number;
  falling: boolean;
  armAt: number;
  fuseAt: number;
  /** Wem der Schaden gutgeschrieben wird (wer die Mine gelegt / die Kartusche angezündet hat) */
  owner: string | null;
  loot?: IgelWeapon | 'hp';
}

/** Ein Schuss, wie er vom Handy kommt (im Simultan-Modus erst gepuffert, dann alle zugleich) */
interface Shot {
  weapon: IgelWeapon;
  angle: number;
  power: number;
  tx: number;
  fuse: number;
}

type ShotResult = 'flight' | 'retreat' | 'long' | 'again' | null;

/**
 * Igel-Krieg – Worms auf einer zerstörbaren Urlaubsinsel.
 * - bis 4 Spieler: jeder für sich mit 2 Igeln; 5–12 Spieler: 2–4 Teams (Sonne/Meer/Sand/Palme), jeder steuert einen Igel.
 * - bis 6 Spieler Rundlauf (Teams ziehen reihum A1, B1, C1, A2 …), ab 7 „Alle gleichzeitig“:
 *   aimAll (alle zielen 15 s) → flightAll (alle Geschosse zugleich) → retreatAll (3 s Rückzug) → settle.
 * - 12 Waffen, Kisten am Sonnenschirm, Gaskartuschen und Seeigel-Minen auf der Insel.
 * Zugzeit, HP und Sudden Death skalieren mit der Spielerzahl, der Wind driftet, die Flut steigt pro voller Runde,
 * Schaden zählt am Zugende herunter. Das Terrain liegt hier als Bitmaske; übertragen werden nur Seed + Operationsliste.
 */
export class IgelGame implements MiniGame {
  readonly kind = 'igel' as const;
  private timers = new Timers();
  private seed = Math.floor(Math.random() * 2 ** 31);
  private mask: Mask;
  private ops: IgelOp[] = [];
  private water: number = IGEL.WATER_Y;
  private wind = 0;
  /** Spieler in Zugreihenfolge (Anzeige) */
  private teams: string[];
  private squads: IgelSquad[] | null = null;
  /** Seiten in Zugreihenfolge: Spieler-ID (jeder für sich) oder `#<Team>` */
  private sides: string[];
  private simul: boolean;
  private hogs: Hog[] = [];
  private objs: Obj[] = [];
  private objSeq = 0;
  private sub: IgelState['sub'] = 'countdown';
  private deadline = Date.now() + IGEL.COUNTDOWN_MS;
  private settleAt = 0;
  private turn = 0;
  private sidePtr = -1;
  private memberPtr: Record<string, number> = {};
  private hogPtr: Record<string, number> = {};
  private active: string | null = null;
  private activeHog: number | null = null;
  private weaponOf: Record<string, IgelWeapon> = {};
  private fuseOf: Record<string, number> = {};
  private ammo: Record<string, Record<IgelWeapon, number>> = {};
  private aim: IgelAim | null = null;
  private aims: Record<string, IgelAim> = {};
  private shots: Record<string, Shot> = {};
  private locked = new Set<string>();
  private doneSet = new Set<string>();
  private shotsLeft = 0;
  private projs: Proj[] = [];
  private projSeq = 0;
  private fx: IgelFx[] = [];
  private fxSeq = 0;
  private startedAt = Date.now();
  private suddenDeath = false;
  private damage: Record<string, number> = {};
  private out: string[] = [];
  /** Zyklus, in dem ein Spieler (bzw. sein Team) ausgeschieden ist */
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
    const n = ids.length;
    // Zum Testen mit wenigen Spielern: IGEL_SIMUL=1 npm run dev
    this.simul = process.env.IGEL_SIMUL === '1' || igelSimul(n);
    const order = shuffle(ids);
    const sq = igelSquadCount(n);
    if (sq) {
      this.squads = IGEL_SQUADS.slice(0, sq).map((s) => ({ name: s.name, color: s.color, members: [] as string[] }));
      order.forEach((id, i) => this.squads![i % sq].members.push(id));
      // Anzeige-Reihenfolge wie die Züge: A1, B1, C1, A2, B2 …
      this.teams = [];
      for (let k = 0; k < Math.max(...this.squads.map((s) => s.members.length)); k++) for (const s of this.squads) if (s.members[k]) this.teams.push(s.members[k]);
      this.sides = this.squads.map((_, i) => `#${i}`);
    } else {
      this.teams = order;
      this.sides = order;
    }
    this.turnMs = this.simul ? SIMUL.AIM_MS : igelTurnMs(n);
    // Simultan schießt jeder pro Runde – volle 100 HP, damit die Partie nicht nach 3 Runden vorbei ist
    this.maxHp = this.simul ? IGEL.HP : igelMaxHp(n);
    // Zum Testen kürzer: IGEL_SUDDEN_MS=20000 npm run dev
    this.suddenMs = Number(process.env.IGEL_SUDDEN_MS) || igelSuddenMs(n);
    // Startwind leicht, danach driftet er pro Zug
    this.wind = Math.round((Math.random() - 0.5) * 0.8 * 100) / 100;
    const perPlayer = n <= 4 ? 2 : 1;
    for (const id of ids) {
      this.damage[id] = 0;
      this.hogPtr[id] = 0;
      this.weaponOf[id] = 'bazooka';
      this.fuseOf[id] = GRENADE.FUSE_MS / 1000;
      this.ammo[id] = Object.fromEntries((Object.keys(WEAPONS) as IgelWeapon[]).map((w) => [w, WEAPONS[w].ammo])) as Record<IgelWeapon, number>;
    }
    for (const s of this.sides) (this.memberPtr[s] = 0), (this.hogPtr[s] = 0);
    // Spawnpunkte: abwechselnd nach Spieler, damit die Igel (und Teams) gemischt stehen
    const spots = this.spawnSpots(this.teams.length * perPlayer, [], 34);
    let k = 0;
    for (let i = 0; i < perPlayer; i++) {
      for (const owner of this.teams) {
        const s = spots[k++];
        this.hogs.push({ id: this.hogs.length, owner, x: s.x, y: s.y, hp: this.maxHp, shown: this.maxHp, dir: s.x < IGEL.W / 2 ? 1 : -1, state: 'ok', flying: true, walking: false, vx: 0, vy: 0, walkAcc: 0, walkDir: 0, shownAcc: 0 });
      }
    }
    // Umgebung: Gaskartuschen vom Grill und scharfe Seeigel-Minen – nicht direkt neben einem Igel
    const avoid = spots.slice(0, this.hogs.length);
    const nB = randInt(BARREL.MIN, BARREL.MAX);
    const nM = randInt(MINE.START_MIN, MINE.START_MAX);
    const objSpots = this.spawnSpots(nB + nM, avoid, 44, true);
    objSpots.forEach((s, i) => this.addObj(i < nB ? 'barrel' : 'mine', s.x, s.y, { armed: true }));
    this.timers.every(TICK_MS, () => this.tick());
    this.timers.later(IGEL.COUNTDOWN_MS, () => this.nextCycle());
  }

  /** Flache Stellen auf der Insel, möglichst weit auseinander (und weg von `avoid`) */
  private spawnSpots(n: number, avoid: { x: number }[], spread: number, strict = false) {
    const cands: { x: number; y: number }[] = [];
    for (let x = 10; x < IGEL.W - 10; x += 2) {
      const sy = surfaceY(this.mask, x);
      if (sy > this.water - 16 || sy < 30) continue;
      if (Math.abs(surfaceY(this.mask, x - 3) - surfaceY(this.mask, x + 3)) > 8) continue;
      if (avoid.some((a) => Math.abs(a.x - x) < 16)) continue;
      cands.push({ x, y: sy - 1 });
    }
    const pool = shuffle(cands);
    const out: { x: number; y: number }[] = [];
    for (const gap of strict ? [spread, spread * 0.7, spread * 0.5] : [spread, spread * 0.7, spread * 0.4, 6, 0]) {
      for (const c of pool) {
        if (out.length >= n) break;
        if (out.every((o) => Math.abs(o.x - c.x) >= gap) && !out.includes(c)) out.push(c);
      }
      if (out.length >= n) break;
    }
    if (!strict) while (out.length < n) out.push({ x: 60 + Math.random() * (IGEL.W - 120), y: 20 });
    return out;
  }

  private addObj(type: IgelObj['type'], x: number, y: number, o: Partial<Obj> = {}) {
    const obj: Obj = { id: ++this.objSeq, type, x: Math.round(x), y, vy: 0, falling: true, armAt: 0, fuseAt: 0, owner: null, ...o };
    this.objs.push(obj);
    return obj;
  }

  // ---------------------------------------------------------------- Seiten (Spieler oder Teams)

  private sideOf(id: string) {
    if (!this.squads) return id;
    return `#${this.squads.findIndex((s) => s.members.includes(id))}`;
  }

  private membersOf(side: string): string[] {
    return this.squads && side.startsWith('#') ? this.squads[Number(side.slice(1))].members : [side];
  }

  private sameSide(a: string, b: string) {
    return this.sideOf(a) === this.sideOf(b);
  }

  private aliveHogs(owner?: string) {
    return this.hogs.filter((h) => h.state === 'ok' && (owner === undefined || h.owner === owner));
  }

  private sideHogs(side: string) {
    const m = this.membersOf(side);
    return this.hogs.filter((h) => h.state === 'ok' && m.includes(h.owner));
  }

  private sideAlive(side: string) {
    return this.sideHogs(side).length > 0;
  }

  private nextSideFrom(ptr: number): number {
    for (let i = 1; i <= this.sides.length; i++) {
      const idx = (ptr + i) % this.sides.length;
      if (this.sideAlive(this.sides[idx])) return idx;
    }
    return -1;
  }

  /** Simultan-Modus: der eigene lebende Igel des Spielers */
  private ownHog(id: string) {
    return this.hogs.find((h) => h.owner === id && h.state === 'ok') ?? null;
  }

  /** Welchen Igel steuert dieser Spieler gerade? */
  private ctrlHog(id: string): Hog | null {
    if (this.simul) return this.ownHog(id);
    if (id !== this.active || this.activeHog === null) return null;
    const h = this.hogs[this.activeHog];
    return h.state === 'ok' ? h : null;
  }

  private canMove(id: string) {
    if (this.simul) return (this.sub === 'aimAll' && !this.locked.has(id)) || this.sub === 'retreatAll';
    return this.sub === 'aim' || this.sub === 'retreat';
  }

  private canAim(id: string) {
    return this.simul ? this.sub === 'aimAll' && !this.locked.has(id) : this.sub === 'aim';
  }

  // ---------------------------------------------------------------- Ablauf

  private nextCycle() {
    if (this.sub === 'over') return;
    if (this.simul) this.startRound();
    else this.startTurn();
  }

  /** Gemeinsamer Beginn eines Zugs bzw. einer Simultan-Runde */
  private beginCycle() {
    this.turn += 1;
    // Wind driftet nur leicht weiter – so lernt man aus dem Schuss des Vorgängers
    if (this.turn > 1) this.wind = Math.round(clamp(this.wind + (Math.random() - 0.5) * IGEL.WIND_DRIFT, -1, 1) * 100) / 100;
    for (const h of this.hogs) (h.shown = Math.max(0, h.hp)), (h.shownAcc = 0), (h.walkDir = 0);
    for (const id of this.ids) if (this.ammo[id][this.weaponOf[id]] === 0) this.weaponOf[id] = 'bazooka';
    this.aim = null;
    this.aims = {};
    this.shots = {};
    this.locked.clear();
    this.doneSet.clear();
    this.shotsLeft = 0;
    this.maybeDropCrate();
    this.dirty = true;
  }

  private startTurn() {
    const idx = this.nextSideFrom(this.sidePtr);
    if (idx < 0) return this.end();
    this.sidePtr = idx;
    const side = this.sides[idx];
    const members = this.membersOf(side);
    // Steuern darf reihum jedes Teammitglied – auch wer schon raus ist (dann mit dem Igel eines Mitspielers)
    let ctrl: string | null = null;
    for (let k = 0; k < members.length; k++) {
      const cand = members[(this.memberPtr[side] + k) % members.length];
      if (this.ctx.isConnected(cand)) {
        ctrl = cand;
        this.memberPtr[side] += k + 1;
        break;
      }
    }
    if (!ctrl) ctrl = members[this.memberPtr[side]++ % members.length];
    const own = this.aliveHogs(ctrl);
    const pool = own.length ? own : this.sideHogs(side);
    const key = own.length ? ctrl : side;
    const hog = pool[this.hogPtr[key]++ % pool.length];
    this.beginCycle();
    this.active = ctrl;
    this.activeHog = hog.id;
    this.sub = 'aim';
    // Kurz offline (App gewechselt)? 5 s Gnadenfrist statt sofort weiter
    this.deadline = Date.now() + (this.ctx.isConnected(ctrl) ? this.turnMs : IGEL.OFFLINE_TURN_MS);
  }

  private startRound() {
    if (!this.sides.some((s) => this.sideAlive(s))) return this.end();
    this.beginCycle();
    this.active = null;
    this.activeHog = null;
    this.sub = 'aimAll';
    this.deadline = Date.now() + SIMUL.AIM_MS;
  }

  /** Simultan: alle gepufferten Schüsse zugleich auslösen (in zufälliger Reihenfolge) */
  private startFlightAll() {
    for (const id of shuffle(Object.keys(this.shots))) {
      const h = this.ownHog(id);
      const shot = this.shots[id];
      if (!h || !shot) continue;
      const n = shot.weapon === 'shotgun' ? SHOTGUN.SHOTS : 1;
      let ok = false;
      for (let i = 0; i < n; i++) ok = this.execShot(h, id, shot) !== null || ok;
      if (ok) this.useAmmo(id, shot.weapon);
    }
    for (const h of this.hogs) h.walkDir = 0;
    this.aims = {};
    this.sub = 'flightAll';
    this.deadline = Date.now() + SIMUL.FLIGHT_MAX_MS;
    this.dirty = true;
  }

  private toSettle() {
    this.sub = 'settle';
    this.settleAt = Date.now() + IGEL.SETTLE_MIN_MS;
    for (const h of this.hogs) h.walkDir = 0;
    this.aim = null;
    this.aims = {};
    this.dirty = true;
  }

  private finishCycle() {
    const now = Date.now();
    for (const h of this.hogs) {
      if (h.state === 'ok' && h.hp <= 0) {
        h.state = 'dead';
        this.addFx({ type: 'ko', x: h.x, y: h.y - 10, text: 'K.O.' });
      }
    }
    for (const h of this.hogs) (h.shown = Math.max(0, h.hp)), (h.shownAcc = 0);
    // Volle Runde vorbei? (Simultan: immer; Rundlauf: der nächste Zug springt wieder nach vorn)
    const nextIdx = this.nextSideFrom(this.sidePtr);
    const roundDone = this.simul || (nextIdx >= 0 && nextIdx <= this.sidePtr);
    if (!this.suddenDeath && now - this.startedAt >= this.suddenMs) {
      this.suddenDeath = true;
      this.addFx({ type: 'water', x: IGEL.W / 2, y: 90, text: 'SUDDEN DEATH – Flut!' });
    } else if (this.suddenDeath && roundDone) {
      // Flut steigt pro voller Runde (fair: jeder war seitdem einmal dran) – bei vielen Seiten etwas mehr
      const alive = this.sides.filter((s) => this.sideAlive(s)).length;
      const rise = Math.round(IGEL.WATER_RISE * clamp((this.simul ? this.ids.length / 2 : alive) / 4, 1, 2));
      this.water = Math.max(60, this.water - rise);
      this.addFx({ type: 'water', x: IGEL.W / 2, y: 90, text: 'Die Flut steigt!' });
      for (const h of this.hogs) if (h.state !== 'drowned' && h.y - 3 > this.water) this.drown(h);
    }
    for (const side of this.sides) {
      if (this.sideAlive(side)) continue;
      for (const id of this.membersOf(side)) {
        if (this.out.includes(id)) continue;
        this.out.push(id);
        this.outTurn[id] = this.turn;
      }
    }
    const alive = this.sides.filter((s) => this.sideAlive(s));
    if (alive.length <= 1 || now - this.startedAt >= IGEL.HARD_CAP_MS) return this.end();
    this.nextCycle();
  }

  /** 30 % pro Zug/Runde: Kiste am Sonnenschirm (zufällige Waffe oder +25 HP) */
  private maybeDropCrate() {
    if (this.objs.filter((o) => o.type === 'crate').length >= CRATE.MAX || Math.random() >= CRATE.CHANCE) return;
    for (let tries = 0; tries < 30; tries++) {
      const x = 20 + Math.random() * (IGEL.W - 40);
      const sy = surfaceY(this.mask, x);
      if (sy > this.water - 12 || sy < 24) continue;
      const loot: Obj['loot'] = Math.random() < 0.3 ? 'hp' : CRATE_LOOT[Math.floor(Math.random() * CRATE_LOOT.length)];
      this.addObj('crate', x, -6, { chute: true, loot });
      return;
    }
  }

  // ---------------------------------------------------------------- Physik

  private tick() {
    const now = Date.now();
    this.tickNo++;
    const dt = TICK_MS / 1000;
    let moving = false;

    // Laufen (Rundlauf: der aktive Igel, simultan: jeder mit eigenem Igel)
    for (const h of this.hogs) {
      h.walking = false;
      if (!h.walkDir || h.state !== 'ok' || h.flying) continue;
      const ctrl = this.simul ? h.owner : this.active;
      if (!ctrl || this.ctrlHog(ctrl) !== h || !this.canMove(ctrl)) {
        h.walkDir = 0;
        continue;
      }
      h.dir = h.walkDir;
      h.walkAcc += IGEL.WALK * dt;
      while (h.walkAcc >= 1 && !h.flying) {
        h.walkAcc -= 1;
        if (!this.walkStep(h, h.walkDir)) {
          h.walkAcc = 0;
          break;
        }
        h.walking = true;
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
    // Minen, Kartuschen, Kisten
    if (this.stepObjs(now, dt)) moving = true;

    // Zustandswechsel
    const ah = this.activeHog !== null ? this.hogs[this.activeHog] : null;
    switch (this.sub) {
      case 'aim':
        if (now >= this.deadline || !ah || ah.state !== 'ok') this.toSettle();
        break;
      case 'flight':
        if (!this.projs.some((p) => p.type !== 'dynamite') || now >= this.deadline) {
          this.projs = this.projs.filter((p) => p.type === 'dynamite');
          this.sub = 'retreat';
          this.deadline = now + IGEL.RETREAT_MS;
          this.dirty = true;
        }
        break;
      case 'retreat':
        if (now >= this.deadline || !ah || ah.state !== 'ok') this.toSettle();
        break;
      case 'aimAll': {
        // Alle (verbundenen) Lebenden haben FEUER gedrückt? Dann sofort los.
        const need = this.ids.filter((id) => this.ownHog(id) && this.ctx.isConnected(id));
        if (now >= this.deadline || (need.length > 0 && need.every((id) => this.locked.has(id)))) this.startFlightAll();
        break;
      }
      case 'flightAll':
        // Böller ticken weiter, während alle schon weglaufen
        if (!this.projs.some((p) => p.type !== 'dynamite') || now >= this.deadline) {
          this.projs = this.projs.filter((p) => p.type === 'dynamite');
          this.sub = 'retreatAll';
          this.deadline = now + IGEL.RETREAT_MS;
          this.dirty = true;
        }
        break;
      case 'retreatAll': {
        const need = this.ids.filter((id) => this.ownHog(id) && this.ctx.isConnected(id));
        if (now >= this.deadline || (need.length > 0 && need.every((id) => this.doneSet.has(id)))) this.toSettle();
        break;
      }
      case 'settle': {
        const busy = this.projs.length > 0 || this.hogs.some((h) => h.state !== 'drowned' && h.flying) || this.objs.some((o) => o.lit || (o.falling && o.type !== 'crate'));
        // Erst wenn alles liegt: HP-Anzeige Punkt für Punkt herunterzählen
        const counting = !busy && this.countDownHp(dt);
        if (counting) moving = true;
        // Notbremse nach 8 s: falls ein Igel ewig zappelt, trotzdem weiter
        if ((!busy && !counting && now >= this.settleAt) || now - this.settleAt > 8000) {
          this.projs = [];
          this.finishCycle();
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
    h.walkDir = 0;
    h.y = this.water;
    h.x = clamp(h.x, 4, IGEL.W - 4);
    this.addFx({ type: 'splash', x: h.x, y: this.water, text: wasAlive ? 'PLATSCH!' : undefined });
    if (!this.simul && h.id === this.activeHog && this.sub === 'aim') this.toSettle();
    this.dirty = true;
  }

  private stepProjs() {
    const dt = IGEL.DT;
    for (const p of [...this.projs]) {
      p.age += dt;
      switch (p.type) {
        case 'bazooka':
        case 'cluster':
        case 'frag':
        case 'gull': {
          // Aufschlagzünder
          stepBallistic(p, dt, this.wind * p.wind);
          if (this.offWorld(p)) break;
          const armed = p.age * 1000 >= BAZOOKA.ARM_MS;
          const hit =
            isSolid(this.mask, p.x, p.y) ||
            this.hogs.some((h) => h.state === 'ok' && (armed || h.id !== p.hogId) && Math.hypot(h.x - p.x, h.y - 4 - p.y) < 5) ||
            this.objs.some((o) => o.type === 'barrel' && Math.hypot(o.x - p.x, o.y - 4 - p.y) < 5);
          if (hit) this.impact(p);
          break;
        }
        case 'dynamite': {
          // Liegt einfach da (fällt nur, wenn der Boden weg ist)
          if (!isSolid(this.mask, p.x, p.y + 1)) {
            p.vy = Math.min(300, p.vy + IGEL.GRAVITY * dt);
            const ny = p.y + p.vy * dt;
            if (isSolid(this.mask, p.x, ny + 1)) p.vy = 0;
            else p.y = ny;
          } else p.vy = 0;
          if (this.offWorld(p)) break;
          if (p.age >= p.fuse) this.impact(p);
          break;
        }
        default: {
          // Wasserbombe / Heilige Ananas: hüpfen, Zeitzünder
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
          if (this.offWorld(p)) break;
          if (p.age >= p.fuse) this.impact(p);
        }
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

  /** Geschoss explodiert (Radius/Schaden nach Typ); die Splitterbombe zerfällt dabei in 5 Stücke */
  private impact(p: Proj) {
    this.projs = this.projs.filter((q) => q !== p);
    const [r, dmg] =
      p.type === 'bazooka' ? [BAZOOKA.R, BAZOOKA.DMG]
      : p.type === 'grenade' ? [GRENADE.R, GRENADE.DMG]
      : p.type === 'cluster' ? [CLUSTER.R, CLUSTER.DMG]
      : p.type === 'frag' ? [CLUSTER.FRAG_R, CLUSTER.FRAG_DMG]
      : p.type === 'gull' ? [AIRSTRIKE.R, AIRSTRIKE.DMG]
      : p.type === 'dynamite' ? [DYNAMITE.R, DYNAMITE.DMG]
      : [HOLY.R, HOLY.DMG];
    this.explodeAt(p.x, p.y, r, dmg, p.owner);
    if (p.type === 'cluster') {
      for (let i = 0; i < CLUSTER.N; i++) {
        const a = -Math.PI / 2 + (i - (CLUSTER.N - 1) / 2) * 0.42 + (Math.random() - 0.5) * 0.15;
        const v = 120 + Math.random() * 45;
        this.projs.push({ id: ++this.projSeq, type: 'frag', x: p.x, y: p.y - 3, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, fuse: 0, wind: 0, owner: p.owner, hogId: -1 });
      }
    }
  }

  private explodeAt(x: number, y: number, r: number, maxDmg: number, owner: string | null) {
    carve(this.mask, x, y, r);
    this.ops.push([Math.round(x), Math.round(y), r, 'carve']);
    this.addFx({ type: 'boom', x, y, r });
    const now = Date.now();
    for (const h of this.hogs) {
      if (h.state === 'drowned') continue;
      const cx = h.x;
      const cy = h.y - 4;
      const d = Math.hypot(cx - x, cy - y);
      const reach = r + 10;
      if (d >= reach) continue;
      const f = 1 - d / reach;
      const nx = d < 1 ? 0 : (cx - x) / d;
      const ny = d < 1 ? -1 : (cy - y) / d;
      h.flying = true;
      h.walkDir = 0;
      h.vx = nx * 210 * f;
      h.vy = ny * 210 * f - 90 * f;
      if (h.state === 'ok') this.hurt(h, Math.round(maxDmg * Math.min(1, f * 1.3)), owner);
    }
    // Kettenreaktion: Kartuschen und Minen in Reichweite gehen gleich mit hoch, Kisten zerbrechen
    for (const o of [...this.objs]) {
      const d = Math.hypot(o.x - x, o.y - 3 - y);
      if (d >= r + 6) continue;
      if (o.type === 'crate') {
        this.objs = this.objs.filter((q) => q !== o);
        this.addFx({ type: 'pow', x: o.x, y: o.y - 6, text: 'KRACKS' });
      } else if (!o.lit) {
        o.lit = true;
        o.owner = owner ?? o.owner;
        o.fuseAt = now + (o.type === 'barrel' ? BARREL.CHAIN_MS : 150);
      }
      o.falling = true;
    }
    this.dirty = true;
  }

  /** Gegenstände: fallen, Minen scharf machen/auslösen, Kisten einsammeln. true = es bewegt sich etwas. */
  private stepObjs(now: number, dt: number): boolean {
    let moving = false;
    for (const o of [...this.objs]) {
      // Steckt im Boden (z. B. Brett drübergelegt)? Nach oben schieben
      for (let up = 0; up < 12 && isSolid(this.mask, o.x, o.y); up++) o.y -= 1;
      const ground = isSolid(this.mask, o.x, o.y + 1) || isSolid(this.mask, o.x - 2, o.y + 1) || isSolid(this.mask, o.x + 2, o.y + 1);
      if (!ground) {
        if (!o.falling) o.falling = true;
        const max = o.chute ? CRATE.FALL : 320;
        o.vy = Math.min(max, o.vy + IGEL.GRAVITY * dt);
        // Der Sonnenschirm treibt mit dem Wind
        if (o.chute) o.x = clamp(o.x + this.wind * 12 * dt, 6, IGEL.W - 6);
        const target = o.y + o.vy * dt;
        let y = o.y;
        while (y < target) {
          if (isSolid(this.mask, o.x, Math.floor(y) + 1)) break;
          y = Math.min(target, Math.floor(y) + 1);
        }
        o.y = y;
        moving = true;
      } else if (o.falling) {
        o.falling = false;
        o.vy = 0;
        o.y = Math.floor(o.y);
        if (o.chute) {
          o.chute = false;
          this.addFx({ type: 'land', x: o.x, y: o.y });
        }
        this.dirty = true;
      }
      if (o.y > this.water || o.y > IGEL.H + 10) {
        this.objs = this.objs.filter((q) => q !== o);
        this.addFx({ type: 'splash', x: o.x, y: this.water });
        continue;
      }
      if (o.type === 'crate') {
        // Einsammeln durch Drüberlaufen
        const h = this.hogs.find((h) => h.state === 'ok' && Math.abs(h.x - o.x) < CRATE.REACH && Math.abs(h.y - o.y) < 12);
        if (h) this.collect(o, h);
        continue;
      }
      if (o.type === 'mine') {
        if (!o.armed && now >= o.armAt) {
          o.armed = true;
          this.dirty = true;
        }
        if (o.armed && !o.lit && this.hogs.some((h) => h.state === 'ok' && Math.abs(h.x - o.x) < MINE.TRIGGER && Math.abs(h.y - o.y) < 14)) {
          o.lit = true;
          o.fuseAt = now + MINE.FUSE_MS;
          this.addFx({ type: 'beep', x: o.x, y: o.y - 6, text: 'PIEP!' });
        }
      }
      if (o.lit) {
        moving = true;
        if (now >= o.fuseAt) {
          this.objs = this.objs.filter((q) => q !== o);
          if (o.type === 'barrel') this.explodeAt(o.x, o.y - 4, BARREL.R, BARREL.DMG, o.owner);
          else this.explodeAt(o.x, o.y - 2, MINE.R, MINE.DMG, o.owner);
        }
      }
    }
    return moving;
  }

  private collect(o: Obj, h: Hog) {
    this.objs = this.objs.filter((q) => q !== o);
    // Wer gerade einen Team-Igel steuert, bekommt die Waffe
    const who = !this.simul && h.id === this.activeHog && this.active ? this.active : h.owner;
    if (o.loot === 'hp' || !o.loot) {
      const add = CRATE.HP;
      h.hp += add;
      h.shown = Math.max(h.shown, h.hp);
      this.addFx({ type: 'crate', x: o.x, y: o.y - 14, text: `+${add} HP` });
    } else {
      const a = this.ammo[who];
      if (a[o.loot] >= 0) a[o.loot] += 1;
      this.addFx({ type: 'crate', x: o.x, y: o.y - 14, text: `+1 ${WEAPONS[o.loot].short}` });
    }
    this.dirty = true;
  }

  private hurt(h: Hog, dmg: number, attacker: string | null) {
    if (dmg <= 0 || h.state !== 'ok') return;
    const real = Math.min(h.hp, dmg);
    h.hp -= real;
    this.addFx({ type: 'dmg', x: h.x, y: h.y - 12, text: `-${dmg}` });
    if (attacker && !this.sameSide(attacker, h.owner)) this.damage[attacker] = (this.damage[attacker] ?? 0) + real;
    if (attacker) this.ctx.log?.(attacker === h.owner ? 'selfhit' : this.sameSide(attacker, h.owner) ? 'teamhit' : 'igelhit', { p: attacker, o: h.owner });
    // Wer sich selbst verletzt (Fallschaden, Mine), dessen Zug ist vorbei (nur Rundlauf)
    if (!this.simul && h.id === this.activeHog && this.sub === 'aim') this.toSettle();
  }

  private addFx(f: Omit<IgelFx, 'seq'>) {
    const fx: IgelFx = { ...f, x: Math.round(f.x), y: Math.round(f.y), seq: ++this.fxSeq };
    if (f.x2 !== undefined) fx.x2 = Math.round(f.x2);
    if (f.y2 !== undefined) fx.y2 = Math.round(f.y2);
    this.fx.push(fx);
    if (this.fx.length > 40) this.fx.shift();
    this.dirty = true;
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    if (action === 'taunt') return this.taunt(id, asRecord(payload));
    const pl = asRecord(payload);
    if (action === 'fuse') {
      const s = Math.round(Number(pl.s));
      if (this.ammo[id] && Number.isFinite(s)) this.fuseOf[id] = clamp(s, GRENADE.FUSE_MIN, GRENADE.FUSE_MAX);
      this.dirty = true;
      return;
    }
    const h = this.ctrlHog(id);
    if (!h) return;
    const canMove = this.canMove(id);
    const canAim = this.canAim(id);
    switch (action) {
      case 'move': {
        const d = Number(pl.dir);
        h.walkDir = canMove ? (d > 0 ? 1 : d < 0 ? -1 : 0) : 0;
        if (h.walkDir) h.dir = h.walkDir;
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
        // Mitten in der Schrotflinte (erster Schuss raus) bleibt die Waffe
        if (canAim && w in WEAPONS && this.ammo[id][w] !== 0 && this.shotsLeft === 0) this.weaponOf[id] = w;
        break;
      }
      case 'aim': {
        if (!canAim) break;
        if (pl.angle === null && pl.tx === undefined) {
          if (this.simul) delete this.aims[id];
          else this.aim = null;
          break;
        }
        const a = this.readAim(pl);
        if (!a) break;
        if (this.simul) this.aims[id] = a;
        else this.aim = a;
        if (pl.tx === undefined && Math.abs(Math.cos(a.angle)) > 0.05) h.dir = Math.cos(a.angle) > 0 ? 1 : -1;
        break;
      }
      case 'fire': {
        if (!canAim) break;
        const shot = this.readShot(id, pl);
        if (!shot) break;
        if (this.simul) {
          // Schuss merken – geschossen wird, wenn alle so weit sind (oder die Zeit um ist)
          this.shots[id] = shot;
          this.locked.add(id);
          const a = this.readAim(pl);
          if (a) this.aims[id] = a;
          h.walkDir = 0;
        } else this.fireNow(h, id, shot);
        break;
      }
      case 'done':
        if (!this.simul && this.sub === 'retreat') this.deadline = Date.now();
        if (this.simul && this.sub === 'retreatAll') this.doneSet.add(id);
        break;
    }
    this.dirty = true;
  }

  private readAim(pl: Record<string, unknown>): IgelAim | null {
    if (pl.tx !== undefined && pl.tx !== null) {
      const tx = Number(pl.tx);
      return Number.isFinite(tx) ? { angle: 0, power: 0, tx: Math.round(clamp(tx, 0, IGEL.W)) } : null;
    }
    const angle = Number(pl.angle);
    const power = Number(pl.power);
    if (!Number.isFinite(angle) || !Number.isFinite(power)) return null;
    return { angle: r2(angle), power: r2(clamp(power, 0, 1)) };
  }

  private readShot(id: string, pl: Record<string, unknown>): Shot | null {
    const w = this.weaponOf[id];
    if (this.ammo[id][w] === 0) return null;
    const kind = WEAPONS[w].aim;
    const angle = Number(pl.angle);
    const power = Number(pl.power);
    const tx = Number(pl.tx);
    if (kind === 'map' && !Number.isFinite(tx)) return null;
    if ((kind === 'drag' || kind === 'dir') && (!Number.isFinite(angle) || !Number.isFinite(power))) return null;
    return { weapon: w, angle: Number.isFinite(angle) ? angle : 0, power: Number.isFinite(power) ? clamp(power, 0, 1) : 0, tx: Number.isFinite(tx) ? clamp(tx, 6, IGEL.W - 6) : 0, fuse: this.fuseOf[id] };
  }

  /** Rundlauf: Schuss sofort ausführen und in die passende Phase wechseln */
  private fireNow(h: Hog, owner: string, shot: Shot) {
    const res = this.execShot(h, owner, shot);
    if (res === null) return;
    if (res === 'again') {
      // Schrotflinte: erster Schuss raus, zweiter folgt im selben Zug
      if (this.shotsLeft === 0) this.shotsLeft = SHOTGUN.SHOTS - 1;
      else this.shotsLeft -= 1;
      if (this.shotsLeft > 0) {
        this.aim = null;
        this.dirty = true;
        return;
      }
    }
    this.useAmmo(owner, shot.weapon);
    this.shotsLeft = 0;
    const now = Date.now();
    if (res === 'flight') {
      this.sub = 'flight';
      this.deadline = now + 9000;
    } else {
      this.sub = 'retreat';
      // Böller: so lange weglaufen, bis er fast hochgeht
      this.deadline = now + (res === 'long' ? DYNAMITE.FUSE_MS - 400 : IGEL.RETREAT_MS);
    }
    h.walkDir = 0;
    this.aim = null;
    this.dirty = true;
  }

  private useAmmo(owner: string, w: IgelWeapon) {
    if (this.ammo[owner][w] > 0) this.ammo[owner][w] -= 1;
    if (this.ammo[owner][w] === 0) this.weaponOf[owner] = 'bazooka';
  }

  /** Führt eine Waffe aus. null = ungültig (z. B. Teleport-Ziel), sonst die Folgephase. */
  private execShot(h: Hog, owner: string, shot: Shot): ShotResult {
    const { weapon: w, angle, power } = shot;
    const cy = h.y - 4;
    if (WEAPONS[w].aim !== 'map' && WEAPONS[w].aim !== 'none' && Math.abs(Math.cos(angle)) > 0.05) h.dir = Math.cos(angle) > 0 ? 1 : -1;
    const proj = (type: IgelProjType, b: { x: number; y: number; vx: number; vy: number }, fuse = 0, hogId = h.id) =>
      this.projs.push({ id: ++this.projSeq, type, ...b, age: 0, fuse, wind: windFactor(w), owner, hogId });
    switch (w) {
      case 'bazooka':
      case 'cluster':
      case 'grenade':
      case 'holy': {
        const b = launch(h.x, cy, angle, power, speedScale(w));
        const fuse = w === 'grenade' ? clamp(shot.fuse, GRENADE.FUSE_MIN, GRENADE.FUSE_MAX) : w === 'holy' ? HOLY.FUSE_MS / 1000 : 0;
        proj(w, b, fuse);
        this.addFx({ type: w === 'holy' ? 'holy' : 'fire', x: h.x, y: cy, text: w === 'holy' ? 'HALLELUJA!' : undefined });
        return 'flight';
      }
      case 'shotgun': {
        // Sofortschuss: Strahl bis zum ersten Hindernis
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        let x = h.x + dx * 6;
        let y = cy + dy * 6;
        let hit = false;
        for (let d = 0; d < SHOTGUN.RANGE; d += 1) {
          x += dx;
          y += dy;
          if (x < 0 || x > IGEL.W || y < 0 || y > this.water) break;
          if (isSolid(this.mask, x, y) || this.hogs.some((o) => o !== h && o.state === 'ok' && Math.hypot(o.x - x, o.y - 4 - y) < 4) || this.objs.some((o) => o.type === 'barrel' && Math.hypot(o.x - x, o.y - 4 - y) < 4)) {
            hit = true;
            break;
          }
        }
        this.addFx({ type: 'shot', x: h.x + dx * 6, y: cy + dy * 6, x2: x, y2: y });
        if (hit) this.explodeAt(x, y, SHOTGUN.R, SHOTGUN.DMG, owner);
        else if (y > this.water) this.addFx({ type: 'splash', x, y: this.water });
        return 'again';
      }
      case 'airstrike': {
        const tx = clamp(shot.tx, 6, IGEL.W - 6);
        this.addFx({ type: 'gull', x: tx, y: 12, text: tx >= h.x ? 'r' : 'l' });
        for (let i = 0; i < AIRSTRIKE.N; i++) {
          const x = tx + (i - (AIRSTRIKE.N - 1) / 2) * AIRSTRIKE.SPREAD;
          proj('gull', { x, y: -10 - i * 14, vx: 0, vy: 30 }, 0, -1);
        }
        return 'flight';
      }
      case 'dynamite':
        proj('dynamite', { x: h.x + h.dir * 5, y: h.y - 1, vx: 0, vy: 0 }, DYNAMITE.FUSE_MS / 1000, -1);
        this.addFx({ type: 'pow', x: h.x + h.dir * 5, y: h.y - 14, text: 'Zisch ...' });
        return 'long';
      case 'mine':
        this.addObj('mine', clamp(h.x + h.dir * 8, 4, IGEL.W - 4), h.y - 2, { armed: false, armAt: Date.now() + MINE.ARM_MS, owner });
        return 'retreat';
      case 'bridge': {
        const ops = plankOps(h.x, h.y, angle);
        if (!ops.length) return null;
        for (const op of ops) {
          applyOp(this.mask, op);
          this.ops.push(op);
        }
        const last = ops[ops.length - 1];
        this.addFx({ type: 'pow', x: (ops[0][0] + last[0]) / 2, y: (ops[0][1] + last[1]) / 2 - 8, text: 'Surfbrett!' });
        return 'retreat';
      }
      case 'teleport': {
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
          if (sy > this.water - 6 || sy < 10) return null;
          ty = sy;
        } else ty = found;
        this.addFx({ type: 'tele', x: h.x, y: cy });
        h.x = tx;
        h.y = ty;
        h.vx = 0;
        h.vy = 0;
        h.flying = true;
        this.addFx({ type: 'tele', x: tx, y: ty - 4 });
        return 'retreat';
      }
      case 'punch':
      case 'paddle': {
        const dir = Math.cos(angle) >= 0 ? 1 : -1;
        h.dir = dir;
        const paddle = w === 'paddle';
        const reach = paddle ? PADDLE.REACH : PUNCH.REACH;
        this.addFx({ type: 'pow', x: h.x + dir * 9, y: cy - 2, text: paddle ? 'KLONK!' : 'POW!' });
        for (const o of this.hogs) {
          if (o === h || o.state !== 'ok') continue;
          const dx = (o.x - h.x) * dir;
          if (dx < -3 || dx > reach || Math.abs(o.y - h.y) > 12) continue;
          o.flying = true;
          o.walkDir = 0;
          if (paddle) {
            // Schlagrichtung zählt: weit in Zielrichtung, immer etwas nach oben
            const ux = Math.max(0.3, Math.abs(Math.cos(angle))) * dir;
            const uy = Math.min(-0.3, Math.sin(angle));
            const len = Math.hypot(ux, uy);
            o.vx = (ux / len) * PADDLE.SPEED;
            o.vy = (uy / len) * PADDLE.SPEED;
            this.hurt(o, PADDLE.DMG, owner);
          } else {
            o.vx = dir * PUNCH.VX;
            o.vy = PUNCH.VY;
            this.hurt(o, PUNCH.DMG, owner);
          }
        }
        return 'retreat';
      }
    }
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

  // ---------------------------------------------------------------- Ende

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.active = null;
    this.activeHog = null;
    this.timers.clear();
    this.ctx.onChange();
    const sideHp = (side: string) => this.sideHogs(side).reduce((s, h) => s + Math.max(0, h.hp), 0);
    const outSide = (side: string) => this.membersOf(side).every((id) => this.out.includes(id));
    // Team-Platzierung (Überlebende nach HP, Ausgeschiedene nach Runde, bei Gleichstand nach Team-Schaden),
    // innerhalb des Teams nach eigenem Schaden
    const sideDmg = (side: string) => Math.min(9999, this.membersOf(side).reduce((s, id) => s + (this.damage[id] ?? 0), 0));
    const rank = (side: string) =>
      outSide(side) ? Math.max(0, ...this.membersOf(side).map((id) => this.outTurn[id] ?? 0)) * 1e4 + sideDmg(side) : 1e7 + sideHp(side);
    const score = (id: string) => rank(this.sideOf(id)) * 1e5 + Math.min(99999, this.damage[id] ?? 0);
    const alive = this.sides.filter((s) => !outSide(s));
    const sideName = (side: string) => (this.squads ? `Team ${this.squads[Number(side.slice(1))].name}` : this.ctx.nameOf(side));
    const subtitle =
      alive.length === 1
        ? `${sideName(alive[0])} beherrscht die Insel!`
        : alive.length === 0
          ? 'Alle baden gegangen – Unentschieden!'
          : 'Zeit um – die meisten Lebenspunkte gewinnen!';
    this.timers.later(3200, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, score),
        details: Object.fromEntries(
          this.ids.map((id) => {
            const side = this.sideOf(id);
            const dmg = `${this.damage[id] ?? 0} Schaden`;
            const team = this.squads ? `${sideName(side)} · ` : '';
            return [id, outSide(side) ? `${team}ausgeschieden · ${dmg}` : `${team}${sideHp(side)} HP übrig · ${dmg}`];
          }),
        ),
        subtitle,
      }),
    );
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    let next: string | null = null;
    if (!this.simul && this.sub !== 'over') {
      const nextIdx = this.nextSideFrom(this.sidePtr);
      if (nextIdx >= 0) {
        const side = this.sides[nextIdx];
        const members = this.membersOf(side);
        next = members[(this.memberPtr[side] ?? 0) % members.length];
      }
    }
    const timed = this.sub === 'aim' || this.sub === 'retreat' || this.sub === 'aimAll' || this.sub === 'retreatAll' || this.sub === 'countdown';
    return {
      kind: 'igel',
      state: {
        sub: this.sub,
        simul: this.simul,
        endsIn: timed ? Math.max(0, this.deadline - now) : 0,
        seed: this.seed,
        ops: this.ops,
        water: this.water,
        wind: this.wind,
        teams: this.teams,
        squads: this.squads,
        hogs: this.hogs.map((h) => ({ id: h.id, owner: h.owner, x: r1(h.x), y: r1(h.y), hp: h.hp, shown: h.shown, dir: h.dir, state: h.state, flying: h.flying, walking: h.walking })),
        objs: this.objs.map((o) => {
          const v: IgelObj = { id: o.id, type: o.type, x: r1(o.x), y: r1(o.y) };
          if (o.type === 'mine') v.armed = !!o.armed;
          if (o.lit) v.lit = true;
          if (o.chute) v.chute = true;
          return v;
        }),
        turn: this.turn,
        active: this.active,
        activeHog: this.activeHog,
        next: next !== this.active ? next : null,
        weapon: this.active ? this.weaponOf[this.active] : 'bazooka',
        weapons: this.weaponOf,
        fuse: this.fuseOf,
        ammo: this.ammo,
        aim: this.aim,
        aims: this.aims,
        locked: [...this.locked],
        shotsLeft: this.shotsLeft,
        projs: this.projs.map((p) => ({ id: p.id, type: p.type, x: r1(p.x), y: r1(p.y), owner: p.owner })),
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

  /** VIP/Laptop: Zug des aktiven Spielers beenden (ohne Schuss) bzw. im Simultan-Modus sofort feuern lassen */
  skippable(): SkipInfo | null {
    if (this.sub === 'aimAll') return { label: 'Zielen beenden – alle feuern' };
    return this.sub === 'aim' && this.active ? { label: `${possessive(this.ctx.nameOf(this.active))} Zug überspringen` } : null;
  }

  skip() {
    if (this.sub === 'aimAll') this.startFlightAll();
    else if (this.sub === 'aim') this.toSettle();
    else return;
    this.ctx.onChange();
  }

  playerDisconnected(id: string) {
    if (!this.simul && id === this.active && this.sub === 'aim') {
      if (this.activeHog !== null) this.hogs[this.activeHog].walkDir = 0;
      this.deadline = Math.min(this.deadline, Date.now() + IGEL.OFFLINE_TURN_MS);
    }
    const h = this.ownHog(id);
    if (h && this.simul) h.walkDir = 0;
  }

  dispose() {
    this.timers.clear();
  }
}
