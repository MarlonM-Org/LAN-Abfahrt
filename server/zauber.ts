import type { MiniSnapshot, ZauberFx, ZauberPlayer, ZauberState } from '../shared/types';
import { ZAUBER, ZAUBER_CX, ZAUBER_CY, type ZauberArena, zauberArena, zauberSolidAt, zauberSpawns } from '../shared/zauber';
import { type MiniCtx, type MiniGame, PRACTICE_RESPAWN_MS, Timers, asRecord, groupByScore, shuffle } from './minigame';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const deg = (x: number, y: number) => Math.round((Math.atan2(y, x) * 180) / Math.PI);

interface P extends ZauberPlayer {
  id: string;
  vx: number;
  vy: number;
  /** Joystick */
  sx: number;
  sy: number;
  /** Zielrichtung (Einheitsvektor) = letzte Laufrichtung */
  lx: number;
  ly: number;
  hpExact: number;
  boltReadyAt: number;
  sprintReadyAt: number;
  sprintUntil: number;
  stunUntil: number;
  lastHitBy: string | null;
  lastHitAt: number;
  diedAt: number;
  /** Während der Treffer-Sperre gedrückter Zauber – wird direkt danach ausgelöst */
  queued: { action: 'cast' | 'sprint'; dir: { x: number; y: number } | null; until: number } | null;
}

interface Bolt {
  id: number;
  x: number;
  y: number;
  /** Flugrichtung (Einheitsvektor) */
  dx: number;
  dy: number;
  owner: string;
  born: number;
}

/**
 * Zauber-Arena (à la Spellsworn, sehr simpel): Zauberer auf einer Steinplattform im Lavasee,
 * die nach und nach vom Rand her zerbröckelt. Zwei Zauber: ANGRIFF (Zielsuch-Feuerball mit
 * kräftigem Rückstoß) und EILE (kurzer Sprint). Lava frisst schnell Lebenspunkte – bei 0 LP
 * verpufft man. Wer zuletzt steht, gewinnt die Runde; wer zuerst 3 Runden gewinnt (max. 5),
 * ist Erzmagier.
 */
export class ZauberGame implements MiniGame {
  readonly kind = 'zauber' as const;
  private players = new Map<string, P>();
  private bolts: Bolt[] = [];
  private nextBoltId = 1;
  private fx: (ZauberFx & { at: number })[] = [];
  private fxSeq = 0;
  private sub: ZauberState['sub'] = 'countdown';
  private round = 0;
  private seed = 1;
  private n = 2;
  private arena: ZauberArena = zauberArena(1, 2);
  /** Startzeitpunkte der Risse (gleiche Reihenfolge wie arena.order) */
  private crackAt: number[] = [];
  private cracked = 0;
  private fallen = 0;
  private sudden = false;
  private deadline = 0;
  private playStart = 0;
  private endAt = 0;
  private roundWinner: string | null = null;
  private deaths: string[] = [];
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    for (const id of ids) {
      this.players.set(id, {
        id, x: ZAUBER_CX, y: ZAUBER_CY, a: 0, hp: ZAUBER.HP, alive: false, sprint: false, stun: false, lava: false,
        cdA: 0, cdB: 0, hits: 0, wins: 0, kills: 0, dmg: 0,
        vx: 0, vy: 0, sx: 0, sy: 0, lx: 1, ly: 0, hpExact: ZAUBER.HP, boltReadyAt: 0, sprintReadyAt: 0, sprintUntil: 0,
        stunUntil: 0, lastHitBy: null, lastHitAt: 0, diedAt: 0, queued: null,
      });
    }
    let last = Date.now();
    this.timers.every(ZAUBER.TICK_MS, () => {
      const now = Date.now();
      this.tick(now, Math.min(0.1, (now - last) / 1000));
      last = now;
    });
    this.startRound();
  }

  // ---------------------------------------------------------------- Runden

  private startRound() {
    this.round += 1;
    this.endAt = 0;
    this.roundWinner = null;
    this.deaths = [];
    this.sudden = false;
    this.bolts = [];
    this.cracked = this.fallen = 0;
    const active = shuffle(this.ids.filter((id) => this.ctx.isConnected(id)));
    this.n = Math.max(2, active.length);
    this.seed = 1 + Math.floor(Math.random() * 1e6);
    this.arena = zauberArena(this.seed, this.n);
    this.crackAt = [];
    const spawns = zauberSpawns(Math.max(1, active.length));
    for (const [id, p] of this.players) {
      const i = active.indexOf(id);
      p.alive = i >= 0;
      if (i >= 0) {
        p.x = spawns[i].x;
        p.y = spawns[i].y;
        const l = Math.hypot(ZAUBER_CX - p.x, ZAUBER_CY - p.y) || 1;
        p.lx = (ZAUBER_CX - p.x) / l;
        p.ly = (ZAUBER_CY - p.y) / l;
      }
      p.a = deg(p.lx, p.ly);
      p.hp = p.hpExact = ZAUBER.HP;
      p.vx = p.vy = 0;
      p.boltReadyAt = p.sprintReadyAt = p.sprintUntil = p.stunUntil = 0;
      p.sprint = p.stun = p.lava = false;
      p.cdA = p.cdB = 0;
      p.lastHitBy = null;
      p.lastHitAt = 0;
      p.queued = null;
    }
    this.sub = 'countdown';
    this.deadline = Date.now() + ZAUBER.COUNTDOWN_MS;
    this.timers.later(ZAUBER.COUNTDOWN_MS, () => {
      this.sub = 'play';
      this.playStart = Date.now();
      // Aufwärmrunde: kein Zeitlimit, die Plattform bröckelt nicht
      this.deadline = this.ctx.practice ? 0 : this.playStart + ZAUBER.ROUND_MS;
      if (!this.ctx.practice) this.schedule(this.playStart);
      this.ctx.onChange();
    });
    this.ctx.onChange();
  }

  /** Zeitplan der Risse: der Rand bröckelt immer schneller, die letzte Insel erst beim Einsturz */
  private schedule(start: number) {
    const m = this.arena.order.length;
    const outer = Math.max(0, m - ZAUBER.CORE_TILES);
    let t = start + ZAUBER.GRACE_MS;
    for (let k = 0; k < outer; k++) {
      this.crackAt.push(t);
      // Mittelwert = SHRINK_MS / outer, am Anfang langsamer, am Ende schneller
      t += (ZAUBER.SHRINK_MS / Math.max(1, outer)) * (1.5 - k / Math.max(1, outer));
    }
    for (let k = outer; k < m; k++) this.crackAt.push(start + ZAUBER.ROUND_MS + (k - outer) * ZAUBER.SUDDEN_STEP_MS);
  }

  private endRound(now: number) {
    const alive = this.alive();
    if (alive.length === 1) this.roundWinner = alive[0].id;
    else if (alive.length === 0 && this.deaths.length >= 1) {
      // Alle verpufft: wer klar als Letzte(r) übrig war, gewinnt trotzdem
      const lastId = this.deaths[this.deaths.length - 1];
      const prevId = this.deaths[this.deaths.length - 2];
      const lastAt = this.players.get(lastId)!.diedAt;
      const prevAt = prevId ? this.players.get(prevId)!.diedAt : 0;
      this.roundWinner = lastAt - prevAt >= 400 ? lastId : null;
    } else if (alive.length > 1) {
      // Zeit um (Sicherheitsnetz): wer die meisten Lebenspunkte hat
      const best = Math.max(...alive.map((p) => p.hpExact));
      const top = alive.filter((p) => p.hpExact >= best - 0.5);
      this.roundWinner = top.length === 1 ? top[0].id : null;
    } else this.roundWinner = null;
    if (this.roundWinner) this.players.get(this.roundWinner)!.wins += 1;
    if (process.env.ZAUBER_DEBUG) console.log(`[zauber] Runde ${this.round}: ${((now - this.playStart) / 1000).toFixed(1)} s, ${this.fallen}/${this.arena.order.length} Kacheln weg, Sieger ${this.roundWinner ? this.ctx.nameOf(this.roundWinner) : '–'}`);
    this.bolts = [];
    this.sub = 'roundOver';
    this.deadline = now + ZAUBER.ROUND_OVER_MS;
    this.ctx.onChange();
    const best = Math.max(...[...this.players.values()].map((p) => p.wins));
    const done = best >= ZAUBER.WIN_ROUNDS || this.round >= ZAUBER.MAX_ROUNDS || this.ids.filter((id) => this.ctx.isConnected(id)).length < 2;
    this.timers.later(ZAUBER.ROUND_OVER_MS, () => (done ? this.end() : this.startRound()));
  }

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.timers.clear();
    this.ctx.onChange();
    const score = (id: string) => {
      const p = this.players.get(id)!;
      return p.wins * 1e6 + p.kills * 1e3 + Math.min(999, p.dmg);
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
            return [id, `${p.wins} ${p.wins === 1 ? 'Sieg' : 'Siege'} · ${p.kills} K.O. · ${p.dmg} Schaden`];
          }),
        ),
        subtitle: champ ? `${champ} ist Erzmagier der Zauber-Arena!` : 'Unentschieden in der Zauber-Arena!',
      }),
    );
  }

  private alive() {
    return [...this.players.values()].filter((p) => p.alive);
  }

  // ---------------------------------------------------------------- Hauptschleife

  private tick(now: number, dt: number) {
    for (const p of this.players.values()) {
      p.sprint = now < p.sprintUntil;
      p.stun = now < p.stunUntil;
      p.cdA = Math.max(0, p.boltReadyAt - now);
      p.cdB = Math.max(0, p.sprintReadyAt - now);
    }
    this.fx = this.fx.filter((f) => now - f.at < 1500);
    if (this.sub !== 'play') {
      if (this.sub === 'countdown' || this.sub === 'roundOver') this.ctx.onChange();
      return;
    }

    // Plattform bröckelt
    while (this.cracked < this.crackAt.length && now >= this.crackAt[this.cracked]) this.cracked++;
    while (this.fallen < this.cracked && now >= this.crackAt[this.fallen] + ZAUBER.CRACK_MS) this.fallen++;
    if (!this.sudden && !this.ctx.practice && now >= this.playStart + ZAUBER.ROUND_MS) this.sudden = true;

    const live = this.alive();
    for (const p of live) {
      // Gepufferter Zauber aus der Treffer-Sperre
      const q = p.queued;
      if (q && now >= p.stunUntil) {
        p.queued = null;
        if (now <= q.until) (q.action === 'cast' ? this.cast(p, now, q.dir) : this.sprint(p, now, q.dir));
      }
      this.move(p, now, dt);
    }
    // Zauberer schieben sich sanft auseinander
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) this.separate(live[i], live[j]);
    }
    for (const p of live) {
      p.x = clamp(p.x, 4, 476);
      p.y = clamp(p.y, 36, 268);
      p.lava = !zauberSolidAt(this.arena, this.fallen, p.x, p.y);
      if (p.lava) {
        p.hpExact -= ZAUBER.LAVA_DPS * dt;
        if (p.hpExact <= 0) this.die(p, now);
      }
      p.hp = Math.max(0, Math.ceil(p.hpExact));
    }
    this.updateBolts(now, dt);

    if (!this.ctx.practice) {
      if (!this.endAt && this.alive().length <= 1) this.endAt = now + ZAUBER.END_DELAY_MS;
      if ((this.endAt && now >= this.endAt) || now >= this.playStart + ZAUBER.HARD_CAP_MS) return this.endRound(now);
    }
    this.ctx.onChange();
  }

  private move(p: P, now: number, dt: number) {
    const stunned = now < p.stunUntil;
    const sprinting = now < p.sprintUntil;
    const acc = ZAUBER.ACCEL * (sprinting ? ZAUBER.SPRINT_MULT : 1);
    if (!stunned) {
      p.vx += p.sx * acc * dt;
      p.vy += p.sy * acc * dt;
    }
    const k = Math.exp(-(stunned ? ZAUBER.FRICTION_HIT : ZAUBER.FRICTION) * dt);
    p.vx *= k;
    p.vy *= k;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  private separate(a: P, b: P) {
    const R2 = ZAUBER.RADIUS * 2;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let d = Math.hypot(dx, dy);
    if (d >= R2) return;
    if (d < 0.001) {
      dx = Math.random() - 0.5;
      dy = Math.random() - 0.5;
      d = Math.hypot(dx, dy);
    }
    const push = (R2 - d) / 2;
    a.x -= (dx / d) * push;
    a.y -= (dy / d) * push;
    b.x += (dx / d) * push;
    b.y += (dy / d) * push;
  }

  // ---------------------------------------------------------------- Feuerbälle

  private updateBolts(now: number, dt: number) {
    const live = this.alive();
    const dead = new Set<Bolt>();
    for (const b of this.bolts) {
      if (now - b.born > ZAUBER.BOLT_LIFE_MS || b.x < -10 || b.x > 490 || b.y < 20 || b.y > 280) {
        dead.add(b);
        this.addFx({ type: 'fizzle', x: b.x, y: b.y, by: b.owner }, now);
        continue;
      }
      // Zielsuche: nächster anderer Zauberer im Kegel vor dem Feuerball
      if (now - b.born >= ZAUBER.BOLT_HOMING_DELAY_MS) {
        let best: P | null = null;
        let bd = ZAUBER.BOLT_RANGE;
        for (const p of live) {
          if (p.id === b.owner) continue;
          const tx = p.x - b.x;
          const ty = p.y - 5 - b.y;
          const d = Math.hypot(tx, ty);
          if (d > bd || d < 0.01) continue;
          if ((tx * b.dx + ty * b.dy) / d < ZAUBER.BOLT_CONE_COS) continue;
          best = p;
          bd = d;
        }
        if (best) {
          const want = Math.atan2(best.y - 5 - b.y, best.x - b.x);
          const cur = Math.atan2(b.dy, b.dx);
          let diff = want - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const step = clamp(diff, -ZAUBER.BOLT_TURN * dt, ZAUBER.BOLT_TURN * dt);
          b.dx = Math.cos(cur + step);
          b.dy = Math.sin(cur + step);
        }
      }
      // Fortbewegung in zwei Teilschritten (kein Durchtunneln)
      for (let s = 0; s < 2 && !dead.has(b); s++) {
        b.x += b.dx * ZAUBER.BOLT_SPEED * dt * 0.5;
        b.y += b.dy * ZAUBER.BOLT_SPEED * dt * 0.5;
        for (const p of live) {
          if (p.id === b.owner || !p.alive) continue;
          // Trefferkreis um den Oberkörper (Füße − 5)
          if (Math.hypot(p.x - b.x, p.y - 5 - b.y) <= ZAUBER.RADIUS + ZAUBER.BOLT_R) {
            dead.add(b);
            this.hit(p, b, now);
            break;
          }
        }
      }
    }
    // Feuerbälle verschiedener Zauberer löschen sich aus
    const flying = this.bolts.filter((b) => !dead.has(b));
    for (let i = 0; i < flying.length; i++) {
      for (let j = i + 1; j < flying.length; j++) {
        const a = flying[i];
        const c = flying[j];
        if (a.owner === c.owner || dead.has(a) || dead.has(c)) continue;
        if (Math.hypot(a.x - c.x, a.y - c.y) <= ZAUBER.CLASH_R) {
          dead.add(a);
          dead.add(c);
          this.addFx({ type: 'clash', x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }, now);
        }
      }
    }
    if (dead.size) this.bolts = this.bolts.filter((b) => !dead.has(b));
  }

  private hit(p: P, b: Bolt, now: number) {
    const k = ZAUBER.KNOCK * (1 + ZAUBER.KNOCK_LOW_HP * (1 - clamp(p.hpExact / ZAUBER.HP, 0, 1)));
    p.vx = p.vx * 0.2 + b.dx * k;
    p.vy = p.vy * 0.2 + b.dy * k;
    p.stunUntil = now + ZAUBER.STUN_MS;
    p.sprintUntil = 0;
    p.hits += 1;
    p.lastHitBy = b.owner;
    p.lastHitAt = now;
    const dmg = Math.min(ZAUBER.BOLT_DMG, Math.max(0, Math.ceil(p.hpExact)));
    p.hpExact -= ZAUBER.BOLT_DMG;
    const owner = this.players.get(b.owner);
    if (owner) owner.dmg += dmg;
    this.addFx({ type: 'hit', x: b.x, y: b.y, id: p.id, by: b.owner }, now);
    if (p.hpExact <= 0) this.die(p, now);
    p.hp = Math.max(0, Math.ceil(p.hpExact));
  }

  private die(p: P, now: number) {
    if (!p.alive) return;
    p.alive = false;
    p.hpExact = 0;
    p.hp = 0;
    p.vx = p.vy = 0;
    p.sx = p.sy = 0;
    p.sprintUntil = 0;
    p.diedAt = now;
    this.deaths.push(p.id);
    let by: string | undefined;
    if (p.lastHitBy && p.lastHitBy !== p.id && now - p.lastHitAt < ZAUBER.CREDIT_MS) {
      const k = this.players.get(p.lastHitBy);
      if (k) {
        k.kills += 1;
        by = k.id;
      }
    }
    this.addFx({ type: 'puff', x: p.x, y: p.y, id: p.id, by }, now);
    if (this.ctx.practice) this.timers.later(PRACTICE_RESPAWN_MS, () => this.respawn(p));
  }

  /** Aufwärmrunde: wieder rein – mit vollen Lebenspunkten auf dem Startplatz, der am weitesten von den anderen weg ist */
  private respawn(p: P) {
    if (p.alive || this.sub !== 'play' || this.ctx.isGone?.(p.id)) return;
    if (!this.ctx.isConnected(p.id)) return void this.timers.later(1000, () => this.respawn(p));
    const others = this.alive();
    const gap = (sp: { x: number; y: number }) => Math.min(999, ...others.map((o) => Math.hypot(o.x - sp.x, o.y - sp.y)));
    const sp = zauberSpawns(Math.max(2, this.ids.length)).reduce((a, b) => (gap(b) > gap(a) ? b : a));
    Object.assign(p, { x: sp.x, y: sp.y, alive: true, hp: ZAUBER.HP, hpExact: ZAUBER.HP, vx: 0, vy: 0, lava: false, stunUntil: 0, sprintUntil: 0, lastHitBy: null, lastHitAt: 0, queued: null });
    const l = Math.hypot(ZAUBER_CX - p.x, ZAUBER_CY - p.y) || 1;
    p.lx = (ZAUBER_CX - p.x) / l;
    p.ly = (ZAUBER_CY - p.y) / l;
    this.ctx.onChange();
  }

  private addFx(f: Omit<ZauberFx, 'seq'>, now: number) {
    this.fx.push({ ...f, x: r1(f.x), y: r1(f.y), seq: ++this.fxSeq, at: now });
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p) return;
    const pl = asRecord(payload);
    /** Optionale Richtung im Payload (Stick beim Drücken) */
    const dirOf = (): { x: number; y: number } | null => {
      if (!('x' in pl) && !('y' in pl)) return null;
      const x = clamp(Number(pl.x) || 0, -1, 1);
      const y = clamp(Number(pl.y) || 0, -1, 1);
      const l = Math.hypot(x, y);
      return l > 0.2 ? { x: x / l, y: y / l } : null;
    };
    if (action === 'stick') {
      let x = clamp(Number(pl.x) || 0, -1, 1);
      let y = clamp(Number(pl.y) || 0, -1, 1);
      const l = Math.hypot(x, y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
      p.sx = p.alive ? x : 0;
      p.sy = p.alive ? y : 0;
      if (l > 0.2) {
        p.lx = x / l;
        p.ly = y / l;
        p.a = deg(p.lx, p.ly);
      }
      return;
    }
    const now = Date.now();
    if (this.sub !== 'play' || !p.alive) return;
    if (action !== 'cast' && action !== 'sprint') return;
    const dir = dirOf();
    const readyAt = action === 'cast' ? p.boltReadyAt : p.sprintReadyAt;
    if (now < readyAt) return;
    // Gerade getroffen: nicht verschlucken, sondern direkt nach der Sperre auslösen
    if (now < p.stunUntil) {
      p.queued = { action, dir, until: p.stunUntil + 250 };
      return;
    }
    if (action === 'cast') this.cast(p, now, dir);
    else this.sprint(p, now, dir);
  }

  /** ANGRIFF: Feuerball grob in Zielrichtung, sucht sich danach selbst den nächsten Gegner */
  private cast(p: P, now: number, d: { x: number; y: number } | null) {
    if (!p.alive || now < p.boltReadyAt) return;
    if (d) {
      p.lx = d.x;
      p.ly = d.y;
      p.a = deg(d.x, d.y);
    }
    p.boltReadyAt = now + ZAUBER.BOLT_CD_MS;
    p.cdA = ZAUBER.BOLT_CD_MS;
    this.bolts.push({ id: this.nextBoltId++, x: p.x + p.lx * 8, y: p.y - 5 + p.ly * 8, dx: p.lx, dy: p.ly, owner: p.id, born: now });
    this.ctx.onChange();
  }

  /** EILE: kurzer Schub + schnelleres Laufen (Richtung: Stick, sonst Zielrichtung) */
  private sprint(p: P, now: number, d: { x: number; y: number } | null) {
    if (!p.alive || now < p.sprintReadyAt) return;
    const sl = Math.hypot(p.sx, p.sy);
    const dx = d ? d.x : sl > 0.2 ? p.sx / sl : p.lx;
    const dy = d ? d.y : sl > 0.2 ? p.sy / sl : p.ly;
    p.sprintReadyAt = now + ZAUBER.SPRINT_CD_MS;
    p.sprintUntil = now + ZAUBER.SPRINT_MS;
    p.cdB = ZAUBER.SPRINT_CD_MS;
    p.vx = dx * ZAUBER.SPRINT_BURST + p.vx * 0.3;
    p.vy = dy * ZAUBER.SPRINT_BURST + p.vy * 0.3;
    p.sprint = true;
    this.ctx.onChange();
  }

  playerDisconnected(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.sx = p.sy = 0;
    if (this.sub === 'play' && p.alive) {
      p.lastHitBy = null;
      this.die(p, Date.now());
    }
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    return {
      kind: 'zauber',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - now),
        round: this.round,
        winRounds: ZAUBER.WIN_ROUNDS,
        maxRounds: ZAUBER.MAX_ROUNDS,
        seed: this.seed,
        n: this.n,
        cracked: this.cracked,
        fallen: this.fallen,
        sudden: this.sudden,
        players: Object.fromEntries(
          [...this.players.values()].map((p) => [
            p.id,
            {
              x: r1(p.x), y: r1(p.y), a: p.a, hp: p.hp, alive: p.alive, sprint: p.sprint, stun: p.stun, lava: p.lava,
              cdA: Math.round(p.cdA), cdB: Math.round(p.cdB), hits: p.hits, wins: p.wins, kills: p.kills, dmg: p.dmg,
            } satisfies ZauberPlayer,
          ]),
        ),
        bolts: this.bolts.map((b) => ({ id: b.id, x: r1(b.x), y: r1(b.y), a: deg(b.dx, b.dy), o: b.owner })),
        fx: this.fx.map(({ at: _at, ...f }) => f),
        roundWinner: this.roundWinner,
      },
    };
  }

  dispose() {
    this.timers.clear();
  }
}
