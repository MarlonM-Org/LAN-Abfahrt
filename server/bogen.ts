import type { BogenArrow, BogenFx, BogenPlayer, BogenState, MiniSnapshot } from '../shared/types';
import {
  BOGEN,
  BOGEN_DIRS,
  BOGEN_STAGES,
  type BogenPower,
  bogenDx,
  bogenDy,
  bogenRectSolid,
  bogenSnap,
  bogenSolidAt,
  bogenTile,
  bogenWrapX,
  bogenWrapY,
} from '../shared/bogen';
import { type MiniCtx, type MiniGame, Timers, asRecord, shuffle } from './minigame';
import { BetBook } from './spectator';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const approach = (v: number, target: number, step: number) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
const T = BOGEN.TILE;
const HW = BOGEN.W / 2;

interface P extends BogenPlayer {
  id: string;
  /** Joystick */
  sx: number;
  sy: number;
  downSince: number;
  jumpHeld: boolean;
  jumpBuf: number;
  shootBuf: { until: number; dir: number } | null;
  dashBuf: { until: number; dir: number } | null;
  lastGround: number;
  dropUntil: number;
  dashUntil: number;
  readyAt: number;
  shotReadyAt: number;
  invUntil: number;
  diedAt: number;
}

interface Arrow extends BogenArrow {
  owner: string;
  born: number;
  /** Seit wann der Pfeil herunterfällt (Sicherheitsnetz gegen Endlos-Fallen) */
  looseAt: number;
}

/**
 * Bogen-Arena (à la TowerFall): kleine Plattform-Arena mit Wrap an allen Rändern.
 * Jeder startet mit 3 Saugnapfpfeilen, ein Treffer (oder ein Sprung auf den Kopf) und man
 * ist für die Runde raus. Pfeile bleiben stecken und müssen eingesammelt werden; wer im
 * richtigen Moment ausweicht, fängt einen Pfeil. Wer zuletzt steht, gewinnt die Runde –
 * wer zuerst 3 Runden gewinnt (max. 6), ist Meisterschütze.
 */
export class BogenGame implements MiniGame {
  readonly kind = 'bogen' as const;
  private players = new Map<string, P>();
  private arrows: Arrow[] = [];
  private fx: (BogenFx & { at: number })[] = [];
  private fxSeq = 0;
  private nextArrowId = 1;
  private sub: BogenState['sub'] = 'countdown';
  private round = 0;
  private stageIdx = Math.floor(Math.random() * BOGEN_STAGES.length);
  private firstStage = this.stageIdx;
  private deadline = 0;
  private playStart = 0;
  private endAt = 0;
  private roundWinner: string | null = null;
  private chest: { x: number; y: number } | null = null;
  private nextChestAt = 0;
  private timers = new Timers();
  /** Zuschauer: Wetten der Ausgeschiedenen auf den Rundensieger */
  private bets = new BetBook();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    for (const id of ids) {
      this.players.set(id, {
        id, x: 0, y: 0, vx: 0, vy: 0, f: 1, aim: -1, alive: false, ground: true, wall: 0, dash: false, cd: 0,
        arrows: 0, bombs: 0, double: 0, shield: false, inv: false, shots: 0, wins: 0, kills: 0,
        sx: 0, sy: 0, downSince: 0, jumpHeld: false, jumpBuf: 0, shootBuf: null, dashBuf: null, lastGround: 0,
        dropUntil: 0, dashUntil: 0, readyAt: 0, shotReadyAt: 0, invUntil: 0, diedAt: 0,
      });
    }
    let last = Date.now();
    this.timers.every(BOGEN.TICK_MS, () => {
      const now = Date.now();
      this.tick(now, Math.min(0.1, (now - last) / 1000));
      last = now;
    });
    this.startRound();
  }

  private get stage() {
    return BOGEN_STAGES[this.stageIdx];
  }

  // ---------------------------------------------------------------- Runden

  private startRound() {
    this.round += 1;
    this.stageIdx = (this.firstStage + this.round - 1) % BOGEN_STAGES.length;
    this.endAt = 0;
    this.roundWinner = null;
    this.bets.newRound(this.round);
    this.arrows = [];
    this.chest = null;
    const active = shuffle(this.ids.filter((id) => this.ctx.isConnected(id)));
    const spawns = shuffle(this.stage.spawns);
    for (const [id, p] of this.players) {
      const i = active.indexOf(id);
      p.alive = i >= 0;
      const sp = spawns[Math.max(0, i) % spawns.length];
      p.x = sp.x;
      p.y = sp.y;
      p.f = p.x < BOGEN.AW / 2 ? 1 : -1;
      p.vx = p.vy = 0;
      p.aim = -1;
      p.ground = true;
      p.wall = 0;
      p.arrows = BOGEN.START_ARROWS;
      p.bombs = p.double = 0;
      p.shield = false;
      p.jumpBuf = 0;
      p.shootBuf = p.dashBuf = null;
      p.dashUntil = p.readyAt = p.shotReadyAt = p.invUntil = p.dropUntil = 0;
      p.lastGround = 0;
    }
    this.sub = 'countdown';
    this.deadline = Date.now() + BOGEN.COUNTDOWN_MS;
    this.timers.later(BOGEN.COUNTDOWN_MS, () => {
      this.sub = 'play';
      this.playStart = Date.now();
      this.deadline = this.playStart + BOGEN.ROUND_MS;
      this.nextChestAt = this.playStart + BOGEN.CHEST_MIN_MS + Math.random() * (BOGEN.CHEST_MAX_MS - BOGEN.CHEST_MIN_MS);
      this.ctx.onChange();
    });
    this.ctx.onChange();
  }

  private endRound(now: number) {
    const alive = this.alive();
    this.roundWinner = alive.length === 1 ? alive[0].id : null;
    if (this.roundWinner) this.players.get(this.roundWinner)!.wins += 1;
    this.bets.resolve(this.roundWinner);
    this.sub = 'roundOver';
    this.deadline = now + BOGEN.ROUND_OVER_MS;
    this.ctx.onChange();
    const best = Math.max(...[...this.players.values()].map((p) => p.wins));
    const done = best >= BOGEN.WIN_ROUNDS || this.round >= BOGEN.MAX_ROUNDS || this.ids.filter((id) => this.ctx.isConnected(id)).length < 2;
    this.timers.later(BOGEN.ROUND_OVER_MS, () => (done ? this.end() : this.startRound()));
  }

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.timers.clear();
    this.ctx.onChange();
    const score = (id: string) => {
      const p = this.players.get(id)!;
      return p.wins * 1000 + p.kills;
    };
    const groups = this.bets.rank(this.ids, score);
    const top = groups[0] ?? [];
    const champ = top.length === 1 ? this.ctx.nameOf(top[0]) : null;
    this.timers.later(1500, () =>
      this.ctx.finish({
        groups,
        details: Object.fromEntries(
          this.ids.map((id) => {
            const p = this.players.get(id)!;
            return [id, `${p.wins} ${p.wins === 1 ? 'Sieg' : 'Siege'} · ${p.kills} ${p.kills === 1 ? 'Treffer' : 'Treffer'}${this.bets.detail(id)}`];
          }),
        ),
        subtitle: champ ? `${champ} ist Meisterschütze der Bogen-Arena!` : 'Unentschieden in der Bogen-Arena!',
      }),
    );
  }

  private alive() {
    return [...this.players.values()].filter((p) => p.alive);
  }

  // ---------------------------------------------------------------- Hauptschleife

  private tick(now: number, dt: number) {
    for (const p of this.players.values()) {
      p.dash = now < p.dashUntil;
      p.cd = Math.max(0, p.readyAt - now);
      p.inv = now < p.invUntil;
    }
    this.fx = this.fx.filter((f) => now - f.at < 1500);
    if (this.sub !== 'play') {
      if (this.sub === 'countdown' || this.sub === 'roundOver') this.ctx.onChange();
      return;
    }

    const live = this.alive();
    for (const p of live) this.control(p, now);
    const steps = BOGEN.SUBSTEPS;
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      const prevY = new Map<P, number>();
      for (const p of live) {
        if (!p.alive) continue;
        prevY.set(p, p.y);
        this.physics(p, sdt, now);
      }
      this.stomps(live, prevY, now);
      this.updateArrows(sdt, now);
    }
    for (const p of live) {
      if (!p.alive) continue;
      if (p.dash && now + BOGEN.TICK_MS >= p.dashUntil) {
        // Ausweichen endet: Schwung abbauen
        p.vx *= 0.55;
        p.vy *= 0.3;
      }
      this.pickups(p);
    }
    this.updateChest(now);

    if (!this.endAt && this.alive().length <= 1) this.endAt = now + BOGEN.END_DELAY_MS;
    if ((this.endAt && now >= this.endAt) || now >= this.deadline) return this.endRound(now);
    this.ctx.onChange();
  }

  /** Eingaben: Laufen, Springen (inkl. Wandsprung), Ausweichen, Schießen */
  private control(p: P, now: number) {
    const dashing = now < p.dashUntil;
    // Durch Plattformen fallen: ▼ kurz halten
    if (p.ground && !dashing && p.sy > 0.7 && Math.abs(p.sx) < 0.5 && now - p.downSince > 150 && this.standingOn(p) === '=') {
      p.dropUntil = now + 260;
      p.ground = false;
      p.y += 1;
      p.vy = 40;
    }
    if (p.jumpBuf > now && !dashing) {
      if (p.ground || now - p.lastGround < BOGEN.COYOTE_MS) {
        p.vy = -BOGEN.JUMP_V;
        p.ground = false;
        p.lastGround = 0;
        p.jumpBuf = 0;
      } else {
        const side = this.wallSide(p);
        if (side) {
          p.vy = -BOGEN.JUMP_V * 0.92;
          p.vx = -side * BOGEN.WALL_JUMP_VX;
          p.f = side > 0 ? -1 : 1;
          p.jumpBuf = 0;
        }
      }
    }
    if (p.dashBuf && p.dashBuf.until > now && now >= p.readyAt) {
      const dir = p.dashBuf.dir >= 0 ? p.dashBuf.dir : p.f > 0 ? 0 : 4;
      const d = BOGEN_DIRS[dir];
      p.dashUntil = now + BOGEN.DASH_MS;
      p.readyAt = now + BOGEN.DASH_CD_MS;
      p.vx = d.x * BOGEN.DASH_V;
      p.vy = d.y * BOGEN.DASH_V;
      if (d.x) p.f = d.x > 0 ? 1 : -1;
      p.ground = false;
      p.dashBuf = null;
      p.dash = true;
    } else if (p.dashBuf && p.dashBuf.until <= now) p.dashBuf = null;
    if (p.shootBuf && p.shootBuf.until > now && now >= p.shotReadyAt) {
      this.shoot(p, p.shootBuf.dir, now);
      p.shootBuf = null;
    } else if (p.shootBuf && p.shootBuf.until <= now) p.shootBuf = null;
  }

  private standingOn(p: P): string {
    const r = Math.round(p.y / T);
    const a = bogenTile(this.stage.tiles, Math.floor((p.x - HW + 1) / T), r);
    const b = bogenTile(this.stage.tiles, Math.floor((p.x + HW - 1) / T), r);
    if (a === '#' || b === '#') return '#';
    if (a === '=' || b === '=') return '=';
    return '.';
  }

  /** Wand direkt neben der Figur (für Wandsprung/Rutschen): −1 links, 1 rechts, 0 keine */
  private wallSide(p: P): 0 | 1 | -1 {
    const tiles = this.stage.tiles;
    const y0 = p.y - BOGEN.H + 4;
    const y1 = p.y - 4;
    if (bogenRectSolid(tiles, p.x + HW, y0, p.x + HW + 2, y1)) return 1;
    if (bogenRectSolid(tiles, p.x - HW - 2, y0, p.x - HW, y1)) return -1;
    return 0;
  }

  private physics(p: P, dt: number, now: number) {
    const tiles = this.stage.tiles;
    const dashing = now < p.dashUntil;
    const H = BOGEN.H;
    if (!dashing) {
      const target = Math.abs(p.sx) > 0.2 ? Math.sign(p.sx) * BOGEN.RUN * Math.min(1, Math.abs(p.sx) * 1.4) : 0;
      const acc = p.ground ? BOGEN.GROUND_ACCEL : BOGEN.AIR_ACCEL;
      p.vx = approach(p.vx, target, acc * dt);
      if (Math.abs(p.sx) > 0.2) p.f = p.sx > 0 ? 1 : -1;
      p.vy += BOGEN.GRAVITY * dt;
      const side = p.ground ? 0 : this.wallSide(p);
      p.wall = side && Math.sign(p.sx) === side && p.vy > 0 ? side : 0;
      const maxFall = p.wall ? BOGEN.WALL_SLIDE : p.sy > 0.7 ? BOGEN.MAX_FALL * 1.25 : BOGEN.MAX_FALL;
      if (p.vy > maxFall) p.vy = Math.max(maxFall, p.vy - 1400 * dt);
    } else p.wall = 0;

    // --- waagerecht
    let nx = p.x + p.vx * dt;
    if (bogenRectSolid(tiles, nx - HW, p.y - H, nx + HW, p.y)) {
      if (p.vx > 0) nx = Math.floor((nx + HW) / T) * T - HW - 0.01;
      else if (p.vx < 0) nx = (Math.floor((nx - HW) / T) + 1) * T + HW + 0.01;
      if (bogenRectSolid(tiles, nx - HW, p.y - H, nx + HW, p.y)) nx = p.x;
      p.vx = 0;
    }
    p.x = nx;

    // --- senkrecht
    let ny = p.y + p.vy * dt;
    if (p.vy > 0) {
      const r = Math.floor(ny / T);
      if (r * T >= p.y - 0.01) {
        const c0 = Math.floor((p.x - HW + 1) / T);
        const c1 = Math.floor((p.x + HW - 1) / T);
        let land = false;
        for (let c = c0; c <= c1; c++) {
          const t = bogenTile(tiles, c, r);
          if (t === '#' || (t === '=' && now >= p.dropUntil)) land = true;
        }
        if (land) {
          ny = r * T;
          p.vy = 0;
          if (!p.ground && dashing) p.dashUntil = Math.min(p.dashUntil, now + 40);
          p.ground = true;
        }
      }
    } else if (p.vy < 0) {
      if (bogenRectSolid(tiles, p.x - HW + 1, ny - H, p.x + HW - 1, ny - H + 1)) {
        ny = (Math.floor((ny - H) / T) + 1) * T + H;
        p.vy = 0;
      }
    }
    p.y = ny;

    // Boden noch da?
    if (p.ground) {
      const r = Math.round(p.y / T);
      const t = this.standingOn(p);
      if (Math.abs(p.y - r * T) > 0.6 || t === '.' || (t === '=' && now < p.dropUntil)) {
        p.ground = false;
        p.lastGround = now;
      } else p.lastGround = now;
    }
    p.x = bogenWrapX(p.x);
    p.y = bogenWrapY(p.y);
  }

  /** Kopfsprung: wer von oben auf jemanden springt, schaltet ihn aus */
  private stomps(live: P[], prevY: Map<P, number>, now: number) {
    const H = BOGEN.H;
    for (const a of live) {
      if (!a.alive || a.vy <= 30 || a.ground) continue;
      for (const b of live) {
        if (a === b || !b.alive || now < b.dashUntil) continue;
        const dx = bogenDx(b.x, a.x);
        if (Math.abs(dx) >= BOGEN.W - 1) continue;
        const head = b.y - H;
        const dy = bogenDy(head, a.y);
        const pdy = bogenDy(head, prevY.get(a) ?? a.y);
        if (dy >= -2 && dy <= 8 && pdy <= 3) {
          a.vy = -BOGEN.STOMP_BOUNCE;
          if (this.kill(b, a.id, 'stomp', now)) this.addFx({ type: 'stomp', x: b.x, y: head, id: b.id, by: a.id }, now);
        }
      }
    }
  }

  // ---------------------------------------------------------------- Pfeile

  private shoot(p: P, dir: number, now: number) {
    if (p.arrows <= 0) return;
    const d = dir >= 0 ? dir : p.f > 0 ? 0 : 4;
    const v = BOGEN_DIRS[d];
    if (v.x) p.f = v.x > 0 ? 1 : -1;
    p.arrows -= 1;
    p.aim = dir;
    p.shots += 1;
    p.shotReadyAt = now + BOGEN.SHOT_CD_MS;
    const bomb = p.bombs > 0;
    if (bomb) p.bombs -= 1;
    const cx = p.x;
    const cy = p.y - BOGEN.H / 2 - 1;
    const spawn = (vx: number, vy: number) => {
      const l = Math.hypot(vx, vy) || 1;
      const a: Arrow = {
        id: this.nextArrowId++,
        x: cx + (vx / l) * 7,
        y: cy + (vy / l) * 7,
        vx: (vx / l) * BOGEN.ARROW_V,
        vy: (vy / l) * BOGEN.ARROW_V,
        s: 0,
        a: Math.round((Math.atan2(vy, vx) * 180) / Math.PI),
        bomb,
        owner: p.id,
        born: now,
        looseAt: 0,
      };
      this.arrows.push(a);
      // Direkt vor der Wand abgeschossen → steckt sofort
      if (bogenSolidAt(this.stage.tiles, a.x, a.y)) this.stick(a, now);
    };
    spawn(v.x, v.y);
    if (p.double > 0) {
      p.double -= 1;
      // Zweiter Pfeil leicht nach oben gedreht
      const ang = Math.atan2(v.y, v.x) - (v.x !== 0 ? Math.sign(v.x) : 1) * 0.22;
      spawn(Math.cos(ang), Math.sin(ang));
    }
  }

  private stick(a: Arrow, now: number) {
    if (a.bomb) return this.explode(a, now);
    a.s = 1;
    a.a = Math.round((Math.atan2(a.vy, a.vx) * 180) / Math.PI);
    a.vx = a.vy = 0;
  }

  private loosen(a: Arrow, now: number) {
    a.s = 2;
    a.vx *= 0.12;
    a.vy = -90;
    a.looseAt = now;
  }

  private updateArrows(dt: number, now: number) {
    const tiles = this.stage.tiles;
    for (const a of [...this.arrows]) {
      if (a.s === 0) {
        a.vy += BOGEN.ARROW_G * dt;
        a.x = bogenWrapX(a.x + a.vx * dt);
        a.y = bogenWrapY(a.y + a.vy * dt);
        if (bogenSolidAt(tiles, a.x, a.y)) {
          this.stick(a, now);
          continue;
        }
        const hit = this.arrowHit(a, now);
        if (hit) {
          if (now < hit.dashUntil) {
            // Gefangen!
            this.arrows = this.arrows.filter((x) => x !== a);
            if (a.bomb) hit.bombs += 1;
            hit.arrows = Math.min(BOGEN.MAX_ARROWS, hit.arrows + 1);
            this.addFx({ type: 'catch', x: hit.x, y: hit.y - BOGEN.H / 2, id: hit.id, by: a.owner }, now);
            continue;
          }
          if (a.bomb) {
            this.explode(a, now);
            continue;
          }
          if (this.kill(hit, a.owner, 'hit', now)) this.addFx({ type: 'hit', x: hit.x, y: hit.y - BOGEN.H / 2, id: hit.id, by: a.owner }, now);
          this.loosen(a, now);
          continue;
        }
        if (now - a.born > BOGEN.ARROW_FLY_MS) this.loosen(a, now);
      } else if (a.s === 2 && (a.vx || a.vy)) {
        // Herunterfallender Pfeil: landet auf Boden oder Plattform
        a.vy = Math.min(300, a.vy + BOGEN.LOOSE_G * dt);
        const ny = a.y + a.vy * dt;
        a.x = bogenWrapX(a.x + a.vx * dt);
        if (a.vy > 0) {
          const r = Math.floor((ny + 1) / T);
          const t = bogenTile(tiles, Math.floor(a.x / T), r);
          if ((t === '#' || t === '=') && r * T >= a.y + 1 - 0.01) {
            a.y = bogenWrapY(r * T - 1);
            a.a = a.vx < 0 ? 180 : 0;
            a.vx = a.vy = 0;
            continue;
          }
        }
        a.y = bogenWrapY(ny);
        if (bogenSolidAt(tiles, a.x, a.y)) {
          a.vx = 0;
          a.vy = Math.max(0, a.vy);
        }
        if (now - a.looseAt > 8000) this.arrows = this.arrows.filter((x) => x !== a);
      }
    }
  }

  private arrowHit(a: Arrow, now: number): P | null {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.id === a.owner && now - a.born < BOGEN.OWN_SAFE_MS) continue;
      const dx = bogenDx(p.x, a.x);
      const dy = bogenDy(p.y - BOGEN.H / 2, a.y);
      if (Math.abs(dx) <= HW + 1.5 && Math.abs(dy) <= BOGEN.H / 2 + 1) return p;
    }
    return null;
  }

  private explode(a: Arrow, now: number) {
    this.arrows = this.arrows.filter((x) => x !== a);
    this.addFx({ type: 'boom', x: a.x, y: a.y, by: a.owner }, now);
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(bogenDx(p.x, a.x), bogenDy(p.y - BOGEN.H / 2, a.y));
      if (d <= BOGEN.BOMB_R) {
        if (this.kill(p, a.owner, 'boom', now)) this.addFx({ type: 'hit', x: p.x, y: p.y - BOGEN.H / 2, id: p.id, by: a.owner }, now);
      }
    }
  }

  /** Spieler ausschalten (Schild fängt einen Treffer ab). true = ausgeschieden */
  private kill(p: P, by: string | null, _how: 'hit' | 'stomp' | 'boom', now: number): boolean {
    if (!p.alive || now < p.invUntil) return false;
    if (p.shield) {
      p.shield = false;
      p.invUntil = now + BOGEN.SHIELD_INV_MS;
      this.addFx({ type: 'shield', x: p.x, y: p.y - BOGEN.H / 2, id: p.id, by: by ?? undefined }, now);
      return false;
    }
    p.alive = false;
    p.diedAt = now;
    p.sx = p.sy = 0;
    if (by && by !== p.id) {
      const k = this.players.get(by);
      if (k) k.kills += 1;
    }
    // Die eigenen Pfeile fliegen heraus und können eingesammelt werden
    for (let i = 0; i < p.arrows; i++) {
      this.arrows.push({
        id: this.nextArrowId++,
        x: p.x,
        y: p.y - BOGEN.H / 2,
        vx: (i - (p.arrows - 1) / 2) * 40,
        vy: -150 - i * 20,
        s: 2,
        a: 0,
        bomb: false,
        owner: p.id,
        born: now,
        looseAt: now,
      });
    }
    p.arrows = 0;
    return true;
  }

  private pickups(p: P) {
    if (p.arrows >= BOGEN.MAX_ARROWS) return;
    for (const a of [...this.arrows]) {
      if (a.s === 0 || (a.s === 2 && (a.vx || a.vy) && a.vy < 0)) continue;
      const dx = bogenDx(p.x, a.x);
      const dy = bogenDy(p.y - BOGEN.H / 2, a.y);
      if (Math.abs(dx) <= HW + 5 && Math.abs(dy) <= BOGEN.H / 2 + 5) {
        this.arrows = this.arrows.filter((x) => x !== a);
        p.arrows += 1;
        this.addFx({ type: 'pickup', x: a.x, y: a.y, id: p.id }, Date.now());
        if (p.arrows >= BOGEN.MAX_ARROWS) return;
      }
    }
  }

  // ---------------------------------------------------------------- Schatztruhe

  private updateChest(now: number) {
    if (!this.chest) {
      if (now < this.nextChestAt) return;
      const spots = shuffle(this.stage.chests).filter((s) => this.alive().every((p) => Math.hypot(bogenDx(p.x, s.x), bogenDy(p.y, s.y)) > 40));
      if (!spots.length) {
        this.nextChestAt = now + 1000;
        return;
      }
      this.chest = { ...spots[0] };
      this.nextChestAt = Infinity;
      return;
    }
    const c = this.chest;
    for (const p of this.alive()) {
      if (Math.abs(bogenDx(p.x, c.x)) < 11 && Math.abs(bogenDy(p.y - BOGEN.H / 2, c.y - 6)) < 16) {
        const options: BogenPower[] = p.shield ? ['doppel', 'bombe'] : ['doppel', 'schild', 'bombe'];
        const power = options[Math.floor(Math.random() * options.length)];
        if (power === 'doppel') p.double = BOGEN.CHEST_DOUBLE;
        else if (power === 'bombe') p.bombs = BOGEN.CHEST_BOMBS;
        else p.shield = true;
        // Truhen enthalten auch immer einen Pfeil
        p.arrows = Math.min(BOGEN.MAX_ARROWS, p.arrows + 1);
        this.addFx({ type: 'chest', x: c.x, y: c.y, id: p.id, power }, now);
        this.chest = null;
        this.nextChestAt = now + 12_000 + Math.random() * 6000;
        return;
      }
    }
  }

  private addFx(f: Omit<BogenFx, 'seq'>, now: number) {
    this.fx.push({ ...f, x: r1(f.x), y: r1(f.y), seq: ++this.fxSeq, at: now });
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p) return;
    const pl = asRecord(payload);
    if (action === 'bet') {
      const open = this.sub === 'play' && !this.endAt;
      if (this.bets.place(id, payload, this.ids, this.alive().map((a) => a.id), open)) this.ctx.onChange();
      return;
    }
    const num = (v: unknown) => clamp(Number(v) || 0, -1, 1);
    const setStick = (x: number, y: number) => {
      if (y > 0.7 && p.sy <= 0.7) p.downSince = Date.now();
      p.sx = x;
      p.sy = y;
      const d = bogenSnap(x, y);
      if (p.alive) p.aim = d;
    };
    if (action === 'stick') setStick(num(pl.x), num(pl.y));
    else if (action === 'btn') {
      if ('x' in pl || 'y' in pl) setStick(num(pl.x), num(pl.y));
      const down = pl.down !== false;
      const now = Date.now();
      if (pl.b === 'jump') {
        p.jumpHeld = down;
        if (down && this.sub === 'play') p.jumpBuf = now + BOGEN.JUMP_BUFFER_MS;
        // Früh losgelassen → kleiner Hüpfer
        if (!down && p.vy < -120 && now >= p.dashUntil) p.vy *= BOGEN.JUMP_CUT;
      } else if (!down || this.sub !== 'play' || !p.alive) return;
      else if (pl.b === 'shoot') p.shootBuf = { until: now + 160, dir: bogenSnap(p.sx, p.sy) };
      else if (pl.b === 'dash') p.dashBuf = { until: now + 140, dir: bogenSnap(p.sx, p.sy) };
    }
  }

  playerDisconnected(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.sx = p.sy = 0;
    p.jumpHeld = false;
    if (this.sub === 'play' && p.alive) {
      p.shield = false;
      p.invUntil = 0;
      this.kill(p, null, 'hit', Date.now());
    }
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    return {
      kind: 'bogen',
      state: {
        sub: this.sub,
        t: now,
        endsIn: Math.max(0, this.deadline - now),
        round: this.round,
        winRounds: BOGEN.WIN_ROUNDS,
        maxRounds: BOGEN.MAX_ROUNDS,
        stage: this.stageIdx,
        players: Object.fromEntries(
          [...this.players.values()].map((p) => [
            p.id,
            {
              x: r1(p.x), y: r1(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy), f: p.f, aim: p.aim, alive: p.alive, ground: p.ground, wall: p.wall,
              dash: p.dash, cd: Math.round(p.cd), arrows: p.arrows, bombs: p.bombs, double: p.double, shield: p.shield, inv: p.inv,
              shots: p.shots, wins: p.wins, kills: p.kills,
            } satisfies BogenPlayer,
          ]),
        ),
        arrows: this.arrows.map((a) => ({ id: a.id, x: r1(a.x), y: r1(a.y), vx: Math.round(a.vx), vy: Math.round(a.vy), s: a.s, a: a.a, bomb: a.bomb })),
        chest: this.chest,
        fx: this.fx.map(({ at: _at, ...f }) => f),
        roundWinner: this.roundWinner,
        spectator: this.bets.info(
          this.alive().map((a) => a.id),
          this.round,
          this.sub === 'play' && !this.endAt,
          this.sub === 'play' || this.sub === 'countdown' ? undefined : this.roundWinner,
        ),
      },
    };
  }

  dispose() {
    this.timers.clear();
  }
}
