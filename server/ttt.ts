import type {
  MiniSnapshot,
  PrivateState,
  TttAttack,
  TttBody,
  TttItemKind,
  TttPlayerPub,
  TttRole,
  TttRoundResult,
  TttShopItem,
  TttState,
  TttWeapon,
} from '../shared/types';
import { ROOMS, SHIRT_NAMES, TTT, TTT_ITEMS, TTT_ROLES, TTT_SHOP } from '../shared/games';
import { DOORS, lineFree, roomInner, walkable } from '../shared/house';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const TICK_MS = 50;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** "Ich hab was gesehen ..." – Ortsangabe pro Raum */
const WHERE = ['in der Küche', 'im Wohnzimmer', 'im Bad', 'im Schlafzimmer', 'am Pool', 'im Garten'];

interface P {
  id: string;
  x: number;
  y: number;
  /** Blickrichtung (Einheitsvektor) */
  fx: number;
  fy: number;
  sx: number;
  sy: number;
  dir: 1 | -1;
  moving: boolean;
  hp: number;
  alive: boolean;
  role: TttRole;
  weapon: TttWeapon | null;
  ammo: number;
  credits: number;
  nextAttack: number;
  stunUntil: number;
  cloakUntil: number;
  info: { seq: number; text: string } | null;
}

interface Item {
  id: number;
  kind: TttItemKind;
  x: number;
  y: number;
  ammo: number;
}

/**
 * Verräter im Ferienhaus – "Trouble in Terrorist Town" in kinderfreundlich:
 * Alle laufen per Joystick durchs Ferienhaus. Ein paar Verräter (geheim) wollen
 * alle mit Poolnudel, Wasserpistole und Kokosnuss ausknocken. Der Detektiv ist bekannt
 * und kann an Ausgeknockten Spuren finden. Mehrere Runden mit neuen Rollen, Punkte pro Runde.
 */
export class TttGame implements MiniGame {
  readonly kind = 'ttt' as const;
  private players = new Map<string, P>();
  private sub: TttState['sub'] = 'roles';
  private round = 0;
  private rounds: number;
  private deadline = 0;
  private timers = new Timers();
  private traitors: string[] = [];
  private detective: string | null = null;
  private items: Item[] = [];
  private bodies: TttBody[] = [];
  private koBy = new Map<string, string | null>();
  private tracked = new Set<string>();
  private traps: { owner: string; x: number; y: number }[] = [];
  private trapFx: TttState['traps'] = [];
  private attacks: TttAttack[] = [];
  private feed: TttState['feed'] = [];
  private scores: Record<string, number>;
  private roundPoints: Record<string, number> = {};
  private last: TttRoundResult | null = null;
  private seq = 0;
  private itemSeq = 0;
  private traitorRounds: Record<string, number>;
  private wins = { innocent: 0, traitor: 0 };

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.rounds = ids.length >= 6 ? 2 : 3;
    this.scores = Object.fromEntries(ids.map((id) => [id, 0]));
    this.traitorRounds = Object.fromEntries(ids.map((id) => [id, 0]));
    let last = Date.now();
    this.timers.every(TICK_MS, () => {
      const now = Date.now();
      this.tick(now, Math.min(0.2, (now - last) / 1000));
      last = now;
    });
    this.startRound();
  }

  // ---------------------------------------------------------------- Runden

  private startRound() {
    this.round += 1;
    const n = this.ids.length;
    // Zufällig, aber wer schon öfter Verräter war, kommt seltener wieder dran
    const order = shuffle(this.ids).sort((a, b) => this.traitorRounds[a] - this.traitorRounds[b]);
    const traitorCount = Math.max(1, Math.floor(n / 4));
    this.traitors = order.slice(0, traitorCount);
    this.detective = n >= 6 ? order[traitorCount] : null;
    for (const t of this.traitors) this.traitorRounds[t] += 1;

    const rooms = shuffle(ROOMS.map((_, i) => i));
    shuffle(this.ids).forEach((id, i) => {
      const pos = this.randomSpot(rooms[i % rooms.length]);
      const role: TttRole = this.traitors.includes(id) ? 'traitor' : id === this.detective ? 'detective' : 'innocent';
      const old = this.players.get(id);
      this.players.set(id, {
        id,
        ...pos,
        fx: 1,
        fy: 0,
        sx: old?.sx ?? 0,
        sy: old?.sy ?? 0,
        dir: 1,
        moving: false,
        hp: TTT.HP,
        alive: true,
        role,
        weapon: null,
        ammo: 0,
        credits: role === 'traitor' ? 1 : 0,
        nextAttack: 0,
        stunUntil: 0,
        cloakUntil: 0,
        info: null,
      });
    });

    this.items = [];
    const add = (kind: TttItemKind, count: number) => {
      for (let k = 0; k < count; k++) {
        const pos = this.randomSpot(Math.floor(Math.random() * ROOMS.length));
        this.items.push({ id: ++this.itemSeq, kind, ...pos, ammo: kind === 'pistol' ? TTT.PISTOL_AMMO : 1 });
      }
    };
    add('pistol', Math.ceil(n / 3));
    add('coconut', Math.ceil(n / 4));
    add('medkit', Math.ceil(n / 4));

    this.bodies = [];
    this.koBy.clear();
    this.tracked.clear();
    this.traps = [];
    this.trapFx = [];
    this.attacks = [];
    this.feed = [];
    this.roundPoints = Object.fromEntries(this.ids.map((id) => [id, 0]));
    this.last = null;
    this.sub = 'roles';
    this.setDeadline(TTT.ROLES_MS);
    const round = this.round;
    this.timers.later(TTT.ROLES_MS, () => {
      if (this.round !== round) return;
      this.sub = 'play';
      this.setDeadline(TTT.ROUND_MS);
      this.say(this.detective ? `Runde ${round}: Los! Detektiv ist ${this.ctx.nameOf(this.detective)}.` : `Runde ${round}: Los!`, 'info');
      this.ctx.onChange();
    });
    this.ctx.onChange();
  }

  private randomSpot(room: number) {
    const r = roomInner(room);
    for (let k = 0; k < 30; k++) {
      const x = r.x + 14 + Math.random() * (r.w - 28);
      const y = r.y + 22 + Math.random() * (r.h - 34);
      if (walkable(x, y, TTT.PLAYER_R + 2)) return { x: Math.round(x), y: Math.round(y) };
    }
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  private tick(now: number, dt: number) {
    if (this.sub !== 'play') return;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const len = Math.hypot(p.sx, p.sy);
      p.moving = len > 0.15 && now >= p.stunUntil;
      if (len > 0.3) {
        p.fx = p.sx / len;
        p.fy = p.sy / len;
        if (Math.abs(p.sx) > 0.2) p.dir = p.sx > 0 ? 1 : -1;
      }
      if (!p.moving) continue;
      const step = TTT.SPEED * dt * Math.min(1, len);
      const nx = p.x + (p.sx / len) * step;
      const ny = p.y + (p.sy / len) * step;
      if (walkable(nx, p.y, TTT.PLAYER_R)) p.x = nx;
      if (walkable(p.x, ny, TTT.PLAYER_R)) p.y = ny;
    }
    // Fallen
    this.traps = this.traps.filter((t) => {
      const victim = [...this.players.values()].find((p) => p.alive && p.role !== 'traitor' && Math.hypot(p.x - t.x, p.y - t.y) < TTT.TRAP_R);
      if (!victim) return true;
      victim.stunUntil = now + TTT.STUN_MS;
      this.trapFx = [...this.trapFx.slice(-4), { seq: ++this.seq, x: t.x, y: t.y }];
      this.tell(victim, 'Ausgerutscht! Eine Bananenschale ...');
      this.damage(victim, 1, t.owner);
      return false;
    });
    if (this.checkWin()) return;
    if (now >= this.deadline) {
      this.endRound('innocent', 'Zeit um – die Unschuldigen haben durchgehalten!');
      return;
    }
    this.ctx.onChange();
  }

  private checkWin(): boolean {
    if (this.sub !== 'play') return true;
    const alive = [...this.players.values()].filter((p) => p.alive);
    const t = alive.filter((p) => p.role === 'traitor').length;
    if (t === 0) {
      this.endRound('innocent', this.traitors.length > 1 ? 'Alle Verräter ausgeknockt!' : 'Der Verräter ist ausgeknockt!');
      return true;
    }
    if (alive.length === t) {
      this.endRound('traitor', 'Alle Unschuldigen ausgeknockt – die Verräter gewinnen!');
      return true;
    }
    return false;
  }

  private endRound(winner: 'innocent' | 'traitor', reason: string) {
    this.sub = 'roundEnd';
    this.wins[winner] += 1;
    for (const p of this.players.values()) p.moving = false;
    for (const p of this.players.values()) {
      const team = p.role === 'traitor' ? 'traitor' : 'innocent';
      if (team !== winner) continue;
      this.roundPoints[p.id] += TTT.WIN_POINTS + (p.alive ? TTT.SURVIVE_POINTS : 0);
    }
    for (const id of this.ids) this.scores[id] += this.roundPoints[id];
    for (const b of this.bodies) b.role ??= this.roleOf(b.id);
    this.last = { round: this.round, winner, reason, traitors: [...this.traitors], points: { ...this.roundPoints } };
    this.setDeadline(TTT.ROUND_END_MS);
    this.ctx.onChange();
    const round = this.round;
    this.timers.later(TTT.ROUND_END_MS, () => {
      if (this.round !== round) return;
      if (this.round < this.rounds) this.startRound();
      else this.finishAll();
    });
  }

  private finishAll() {
    this.sub = 'over';
    this.setDeadline(0);
    this.ctx.onChange();
    const { innocent, traitor } = this.wins;
    this.timers.later(5000, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => this.scores[id]),
        details: Object.fromEntries(
          this.ids.map((id) => [id, `${this.scores[id]} ${Math.abs(this.scores[id]) === 1 ? 'Punkt' : 'Punkte'} · ${this.traitorRounds[id]}× Verräter`]),
        ),
        subtitle: `${innocent}× gewannen die Unschuldigen, ${traitor}× die Verräter`,
      }),
    );
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p) return;
    const pl = asRecord(payload);
    if (action === 'stick') {
      p.sx = clamp(Number(pl.x) || 0, -1, 1);
      p.sy = clamp(Number(pl.y) || 0, -1, 1);
      return;
    }
    if (this.sub !== 'play' || !p.alive) return;
    if (action === 'attack') this.attack(p);
    else if (action === 'use') this.use(p);
    else if (action === 'buy') this.buy(p, String(pl.item) as TttShopItem, Number(pl.room));
    this.ctx.onChange();
  }

  private attack(p: P) {
    const now = Date.now();
    if (now < p.nextAttack || now < p.stunUntil) return;
    const by = now < p.cloakUntil ? null : p.id;
    let kind: TttAttack['kind'] = 'noodle';
    let hit: P | null = null;
    let end = { x: p.x + p.fx * TTT.NOODLE_RANGE, y: p.y + p.fy * TTT.NOODLE_RANGE };
    let dmg = 1;

    if (p.weapon === 'pistol' || p.weapon === 'coconut') {
      kind = p.weapon;
      const range = kind === 'pistol' ? TTT.PISTOL_RANGE : TTT.COCONUT_RANGE;
      dmg = kind === 'pistol' ? 1 : TTT.COCONUT_DAMAGE;
      hit = this.aimTarget(p, range);
      end = hit ? { x: hit.x, y: hit.y } : this.traceWall(p, range);
      if (kind === 'pistol') {
        p.ammo -= 1;
        p.nextAttack = now + TTT.PISTOL_COOLDOWN;
        if (p.ammo <= 0) {
          p.weapon = null;
          this.tell(p, 'Wasserpistole leer!');
        }
      } else {
        p.weapon = null;
        p.ammo = 0;
        p.nextAttack = now + TTT.NOODLE_COOLDOWN;
      }
    } else {
      p.nextAttack = now + TTT.NOODLE_COOLDOWN;
      let best = Infinity;
      for (const q of this.players.values()) {
        if (q === p || !q.alive) continue;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > TTT.NOODLE_RANGE) continue;
        const dot = d < 10 ? 1 : (dx * p.fx + dy * p.fy) / d;
        if (dot < 0.2 || d >= best || !lineFree(p.x, p.y, q.x, q.y)) continue;
        best = d;
        hit = q;
      }
      if (hit) end = { x: hit.x, y: hit.y };
    }
    const ko = hit ? this.damage(hit, dmg, p.id) : false;
    this.attacks = [
      ...this.attacks.slice(-9),
      { seq: ++this.seq, by, kind, x1: Math.round(p.x), y1: Math.round(p.y), x2: Math.round(end.x), y2: Math.round(end.y), target: hit?.id ?? null, ko },
    ];
  }

  /** Fernkampf mit etwas Zielhilfe: nächster Spieler im Kegel vor einem */
  private aimTarget(p: P, range: number): P | null {
    let best: P | null = null;
    let bestT = Infinity;
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const t = dx * p.fx + dy * p.fy;
      if (t <= 0 || t > range) continue;
      const perp = Math.abs(dx * p.fy - dy * p.fx);
      if (perp > Math.max(7, t * 0.3) || t >= bestT || !lineFree(p.x, p.y, q.x, q.y)) continue;
      bestT = t;
      best = q;
    }
    return best;
  }

  private traceWall(p: P, range: number) {
    let x = p.x;
    let y = p.y;
    for (let d = 0; d < range; d += 2) {
      const nx = p.x + p.fx * d;
      const ny = p.y + p.fy * d;
      if (!walkable(nx, ny, 0)) break;
      x = nx;
      y = ny;
    }
    return { x, y };
  }

  /** Schaden austeilen; true = ausgeknockt */
  private damage(q: P, dmg: number, by: string | null): boolean {
    if (!q.alive) return false;
    q.hp = Math.max(0, q.hp - dmg);
    if (q.hp > 0) {
      this.tell(q, `Autsch! Noch ${q.hp} ${q.hp === 1 ? 'Herz' : 'Herzen'}.`);
      return false;
    }
    q.alive = false;
    q.sx = q.sy = 0;
    this.bodies.push({ id: q.id, x: Math.round(q.x), y: Math.round(q.y), role: null, inspectedBy: null });
    this.koBy.set(q.id, by);
    if (q.weapon) {
      this.items.push({ id: ++this.itemSeq, kind: q.weapon, x: Math.round(q.x + 6), y: Math.round(q.y), ammo: q.weapon === 'pistol' ? q.ammo : 1 });
      q.weapon = null;
    }
    this.tell(q, 'Ausgeknockt!');
    const killer = by ? this.players.get(by) : undefined;
    if (killer && killer !== q) {
      const sameTeam = (killer.role === 'traitor') === (q.role === 'traitor');
      this.roundPoints[killer.id] += sameTeam ? TTT.TEAM_KO : TTT.GOOD_KO;
      if (killer.role === 'traitor' && !sameTeam) {
        killer.credits += 1;
        this.tell(killer, 'Erwischt! +1 Credit für den Shop.');
      }
    }
    return true;
  }

  /** Was kann man gerade benutzen? */
  private nearThing(p: P): { body?: TttBody; item?: Item; label: string } | null {
    let best: { body?: TttBody; item?: Item; label: string } | null = null;
    let bestD: number = TTT.USE_RANGE;
    for (const b of this.bodies) {
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d > bestD) continue;
      const canTrack = p.role === 'detective' && !this.tracked.has(b.id);
      if (b.role && !canTrack) continue;
      bestD = d;
      best = { body: b, label: b.role ? 'Spur suchen' : `${this.ctx.nameOf(b.id)} untersuchen` };
    }
    for (const it of this.items) {
      const d = Math.hypot(it.x - p.x, it.y - p.y);
      if (d > bestD) continue;
      bestD = d;
      best = { item: it, label: `${TTT_ITEMS[it.kind]} ${it.kind === 'medkit' ? 'benutzen' : 'aufheben'}` };
    }
    return best;
  }

  private use(p: P) {
    const near = this.nearThing(p);
    if (!near) return;
    if (near.item) {
      const it = near.item;
      if (it.kind === 'medkit') {
        if (p.hp >= TTT.HP) return this.tell(p, 'Du bist schon topfit!');
        p.hp = TTT.HP;
        this.tell(p, 'Verarztet – wieder volle Herzen!');
      } else {
        if (p.weapon) {
          this.items.push({ id: ++this.itemSeq, kind: p.weapon, x: Math.round(p.x - p.fx * 8), y: Math.round(p.y - p.fy * 8), ammo: p.ammo });
        }
        p.weapon = it.kind;
        p.ammo = it.ammo;
        this.tell(p, it.kind === 'pistol' ? `Wasserpistole! ${p.ammo} Schuss.` : 'Kokosnuss! Einmal werfen, 2 Schaden.');
      }
      this.items = this.items.filter((i) => i !== it);
      return;
    }
    const b = near.body!;
    if (!b.role) {
      b.role = this.roleOf(b.id);
      b.inspectedBy = p.id;
      const name = this.ctx.nameOf(b.id);
      this.say(`${this.ctx.nameOf(p.id)} untersucht ${name}: ${TTT_ROLES[b.role].name}!`, b.role === 'traitor' ? 'alert' : 'info');
    }
    if (p.role === 'detective' && !this.tracked.has(b.id)) {
      this.tracked.add(b.id);
      this.tell(p, 'Spurensucher läuft ... gleich auf dem Fernseher!');
      this.say(`Der Detektiv sucht Spuren an ${this.ctx.nameOf(b.id)} ...`, 'clue');
      const round = this.round;
      this.timers.later(TTT.TRACKER_MS, () => {
        if (this.round !== round || this.sub !== 'play') return;
        const by = this.koBy.get(b.id);
        const look = by ? this.ctx.lookOf?.(by) : undefined;
        this.say(
          look ? `Spur an ${this.ctx.nameOf(b.id)}: Der Täter trug ein ${SHIRT_NAMES[look.shirt] ?? 'buntes'} Shirt!` : `Spur an ${this.ctx.nameOf(b.id)}: keine verwertbare Spur ...`,
          'clue',
        );
        this.ctx.onChange();
      });
    }
  }

  private buy(p: P, item: TttShopItem, room: number) {
    const def = TTT_SHOP[item];
    if (p.role !== 'traitor' || !def || p.credits < def.cost) return;
    const now = Date.now();
    if (item === 'trap') {
      const door = this.doorNear(p);
      if (!door) return this.tell(p, 'Stell dich dafür in eine Tür!');
      this.traps.push({ owner: p.id, x: door.cx, y: door.cy });
      this.tell(p, 'Bananenschale liegt. Psst!');
    } else if (item === 'cloak') {
      p.cloakUntil = now + TTT.CLOAK_MS;
      this.tell(p, 'Du bist unsichtbar!');
    } else if (item === 'radio') {
      if (!Number.isInteger(room) || room < 0 || room >= ROOMS.length) return;
      const others = [...this.players.values()].filter((q) => q.alive && q.role !== 'traitor');
      const fake = others[Math.floor(Math.random() * others.length)];
      this.say(`Funk von ${fake ? this.ctx.nameOf(fake.id) : 'Unbekannt'}: „Ich hab was gesehen ${WHERE[room]}!“`, 'radio');
      this.tell(p, 'Fake-Funkspruch gesendet.');
    } else {
      return;
    }
    p.credits -= def.cost;
  }

  private doorNear(p: P) {
    return DOORS.find((d) => Math.hypot(d.cx - p.x, d.cy - p.y) < 16) ?? null;
  }

  // ---------------------------------------------------------------- Helfer

  private roleOf(id: string): TttRole {
    return this.players.get(id)?.role ?? 'innocent';
  }

  private say(text: string, tone: TttState['feed'][number]['tone']) {
    this.feed = [...this.feed.slice(-3), { seq: ++this.seq, text, tone }];
  }

  private tell(p: P, text: string) {
    p.info = { seq: ++this.seq, text };
  }

  private setDeadline(ms: number) {
    this.deadline = Date.now() + ms;
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const players: Record<string, TttPlayerPub> = {};
    for (const p of this.players.values()) {
      // Unsichtbare (Tarnumhang) und Ausgeknockte erscheinen nicht – Letztere liegen als Körper herum
      if (!p.alive || now < p.cloakUntil) continue;
      players[p.id] = { x: Math.round(p.x), y: Math.round(p.y), dir: p.dir, moving: p.moving, hp: p.hp, weapon: p.weapon, stunned: now < p.stunUntil };
    }
    const reveal = this.sub === 'roundEnd' || this.sub === 'over';
    return {
      kind: 'ttt',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - now),
        round: this.round,
        rounds: this.rounds,
        players,
        alive: Object.fromEntries([...this.players.values()].map((p) => [p.id, p.alive])),
        detective: this.detective,
        traitorCount: this.traitors.length,
        bodies: this.bodies,
        items: this.items.map(({ id, kind, x, y }) => ({ id, kind, x, y })),
        attacks: this.attacks,
        feed: this.feed,
        traps: this.trapFx,
        scores: this.scores,
        last: this.last,
        roles: reveal ? Object.fromEntries([...this.players.values()].map((p) => [p.id, p.role])) : null,
      },
    };
  }

  privateFor(id: string): PrivateState {
    const p = this.players.get(id);
    if (!p) return null;
    const now = Date.now();
    return {
      kind: 'ttt',
      state: {
        role: p.role,
        x: Math.round(p.x),
        y: Math.round(p.y),
        partners: p.role === 'traitor' ? this.traitors.filter((t) => t !== id) : [],
        alive: p.alive,
        hp: p.hp,
        weapon: p.weapon,
        ammo: p.ammo,
        credits: p.credits,
        near: this.sub === 'play' && p.alive ? (this.nearThing(p)?.label ?? null) : null,
        cloakLeft: Math.max(0, p.cloakUntil - now),
        attackReady: now >= p.nextAttack && now >= p.stunUntil,
        inDoor: !!this.doorNear(p),
        info: p.info,
      },
    };
  }

  playerDisconnected(id: string) {
    const p = this.players.get(id);
    if (p) p.sx = p.sy = 0;
  }

  dispose() {
    this.timers.clear();
  }
}
