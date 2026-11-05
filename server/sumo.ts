import type { MiniSnapshot, SumoPlayer, SumoState } from '../shared/types';
import { SUMO, SUMO_CX, SUMO_CY, type SumoTile, sumoIdx, sumoRadii, sumoShape, sumoSolidAt, sumoSpawns } from '../shared/sumo';
import { type MiniCtx, type MiniGame, OFFLINE_OUT_MS, Timers, asRecord, groupByScore, shuffle } from './minigame';

interface P extends SumoPlayer {
  vx: number;
  vy: number;
  /** Joystick */
  sx: number;
  sy: number;
  /** Letzte Laufrichtung (für Rempler ohne Joystick) */
  lx: number;
  ly: number;
  dashUntil: number;
  readyAt: number;
  stunUntil: number;
  /** Rempler während Betäubung/Abklingzeit gedrückt → wird bis hierhin nachgeholt (Eingabepuffer) */
  dashQueuedUntil: number;
  lastHitBy: string | null;
  lastHitAt: number;
  diedAt: number;
  /** Überlebenspunkte über alle Runden */
  survival: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Sumo-Steg: Alle stehen auf einem Holzsteg im Meer, der nach und nach wegbricht.
 * Joystick zum Laufen, „REMPELN“ für einen kurzen Sprint – wer getroffen wird, fliegt
 * (beim Frontal-Rempler doppelt weit). Wer zuletzt auf dem Steg steht, gewinnt die Runde;
 * wer zuerst 2 Runden gewinnt (max. 3), ist Steg-Champion.
 */
export class SumoGame implements MiniGame {
  readonly kind = 'sumo' as const;
  private players = new Map<string, P>();
  private tiles: SumoTile[] = [];
  /** Bruch-Reihenfolge (Planken-Indizes) */
  private order: number[] = [];
  private broken = 0;
  private nextBreakAt = 0;
  /** Planken, die gerade knacken → Zeitpunkt des Wegbrechens */
  private cracking = new Map<number, number>();
  private sub: SumoState['sub'] = 'countdown';
  private round = 0;
  private deadline = 0;
  private playStart = 0;
  private sudden = false;
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
        x: SUMO_CX, y: SUMO_CY, f: 1, alive: false, dash: false, cd: 0, stun: false, hits: 0, wins: 0, pushes: 0,
        vx: 0, vy: 0, sx: 0, sy: 0, lx: 1, ly: 0, dashUntil: 0, readyAt: 0, stunUntil: 0, dashQueuedUntil: 0,
        lastHitBy: null, lastHitAt: 0, diedAt: 0, survival: 0,
      });
    }
    let last = Date.now();
    this.timers.every(SUMO.TICK_MS, () => {
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
    this.cracking.clear();
    const active = shuffle(this.ids.filter((id) => this.ctx.isConnected(id)));
    const n = Math.max(2, active.length);
    this.tiles = [...sumoShape(n)] as SumoTile[];
    this.buildOrder(n);
    const spawns = sumoSpawns(Math.max(1, active.length));
    for (const [id, p] of this.players) {
      const i = active.indexOf(id);
      p.alive = i >= 0;
      p.away = false;
      if (i >= 0) {
        p.x = spawns[i].x;
        p.y = spawns[i].y;
        // zur Mitte schauen
        p.lx = SUMO_CX - p.x;
        p.ly = SUMO_CY - p.y;
        const l = Math.hypot(p.lx, p.ly) || 1;
        p.lx /= l;
        p.ly /= l;
        p.f = p.lx < 0 ? -1 : 1;
      }
      p.vx = p.vy = 0;
      p.dashUntil = p.readyAt = p.stunUntil = p.dashQueuedUntil = 0;
      p.dash = p.stun = false;
      p.cd = 0;
      p.lastHitBy = null;
      p.lastHitAt = 0;
    }
    this.sub = 'countdown';
    this.deadline = Date.now() + SUMO.COUNTDOWN_MS;
    this.timers.later(SUMO.COUNTDOWN_MS, () => {
      this.sub = 'play';
      this.playStart = Date.now();
      this.nextBreakAt = this.playStart + SUMO.GRACE_MS;
      this.deadline = this.playStart + SUMO.ROUND_MS;
      this.ctx.onChange();
    });
    this.ctx.onChange();
  }

  /** Außen zuerst (mit etwas Zufall, damit Löcher entstehen) – die innersten Planken bleiben als letzte Insel */
  private buildOrder(n: number) {
    const [rx, ry] = sumoRadii(n);
    const mc = (SUMO.COLS - 1) / 2;
    const mr = (SUMO.ROWS - 1) / 2;
    const solid: { i: number; d: number }[] = [];
    this.tiles.forEach((t, i) => {
      if (t !== '#') return;
      const c = i % SUMO.COLS;
      const r = Math.floor(i / SUMO.COLS);
      solid.push({ i, d: Math.hypot((c - mc) / rx, (r - mr) / ry) });
    });
    solid.sort((a, b) => a.d - b.d);
    // Die innersten CORE_TILES bleiben bis zum Sudden Death stehen
    const rest = solid.slice(SUMO.CORE_TILES).map((s) => ({ i: s.i, k: s.d + Math.random() * 0.45 }));
    rest.sort((a, b) => b.k - a.k);
    this.order = rest.map((s) => s.i);
    this.broken = 0;
  }

  private endRound(now: number) {
    const alive = this.alive();
    if (alive.length === 1) this.roundWinner = alive[0];
    else if (alive.length === 0 && this.deaths.length >= 1) {
      // Alle im Wasser: wer klar als Letzte(r) gefallen ist, gewinnt trotzdem
      const lastId = this.deaths[this.deaths.length - 1];
      const prevId = this.deaths[this.deaths.length - 2];
      const lastAt = this.players.get(lastId)!.diedAt;
      const prevAt = prevId ? this.players.get(prevId)!.diedAt : 0;
      this.roundWinner = lastAt - prevAt >= 400 ? lastId : null;
    } else this.roundWinner = null;
    const n = this.deaths.length + alive.length;
    this.deaths.forEach((id, i) => (this.players.get(id)!.survival += i));
    for (const id of alive) this.players.get(id)!.survival += n - 1;
    if (this.roundWinner) this.players.get(this.roundWinner)!.wins += 1;
    this.sub = 'roundOver';
    this.deadline = now + SUMO.ROUND_OVER_MS;
    this.ctx.onChange();
    const best = Math.max(...[...this.players.values()].map((p) => p.wins));
    const done = best >= SUMO.WIN_ROUNDS || this.round >= SUMO.MAX_ROUNDS || this.ids.filter((id) => this.ctx.isConnected(id)).length < 2;
    this.timers.later(SUMO.ROUND_OVER_MS, () => (done ? this.end() : this.startRound()));
  }

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.timers.clear();
    this.ctx.onChange();
    const score = (id: string) => {
      const p = this.players.get(id)!;
      return p.wins * 1000 + p.survival;
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
            return [id, `${p.wins} ${p.wins === 1 ? 'Sieg' : 'Siege'} · ${p.pushes}× geschubst`];
          }),
        ),
        subtitle: champ ? `${champ} beherrscht den Steg!` : 'Alle baden gegangen – Unentschieden!',
      }),
    );
  }

  // ---------------------------------------------------------------- Spiellogik

  private alive() {
    return [...this.players.entries()].filter(([, p]) => p.alive).map(([id]) => id);
  }

  private tick(now: number, dt: number) {
    for (const p of this.players.values()) {
      if (p.dashQueuedUntil && this.sub === 'play' && p.alive && now >= p.stunUntil && now >= p.readyAt) {
        if (now <= p.dashQueuedUntil) this.dash(p, now);
        else p.dashQueuedUntil = 0;
      }
      p.dash = now < p.dashUntil;
      p.stun = now < p.stunUntil;
      p.cd = Math.max(0, p.readyAt - now);
    }
    if (this.sub !== 'play') {
      if (this.sub === 'countdown' || this.sub === 'roundOver') this.ctx.onChange();
      return;
    }

    this.shrink(now);

    // Verbindung weg (nach der 3-s-Gnadenfrist): eingefroren, keine Rempler, fällt nicht – nach 15 s raus
    for (const [id, p] of this.players) {
      p.away = p.alive && !this.ctx.isConnected(id);
      if (p.away && (this.ctx.offlineMs?.(id) ?? 0) >= OFFLINE_OUT_MS) this.fall(id, now);
    }
    const live = [...this.players.entries()].filter(([, p]) => p.alive && !p.away);
    for (const [, p] of live) this.move(p, now, dt);
    // Zusammenstöße (zweimal auflösen, damit Knäuel nicht ineinander stecken)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) this.collide(live[i], live[j], now, pass === 0);
      }
    }
    // Wer über dem Wasser steht, fällt rein
    const tiles = this.tiles.join('');
    for (const [id, p] of live) {
      p.x = clamp(p.x, 4, 476);
      p.y = clamp(p.y, 36, 266);
      if (!sumoSolidAt(tiles, p.x, p.y)) this.fall(id, now);
    }

    if (!this.endAt && this.alive().length <= 1) this.endAt = now + SUMO.END_DELAY_MS;
    if (this.endAt && now >= this.endAt) return this.endRound(now);
    this.ctx.onChange();
  }

  private shrink(now: number) {
    for (const [i, at] of this.cracking) {
      if (now >= at) {
        this.tiles[i] = '.';
        this.cracking.delete(i);
      }
    }
    const m = this.order.length;
    while (this.broken < m && now >= this.nextBreakAt) {
      const i = this.order[this.broken++];
      if (this.tiles[i] === '#') {
        this.tiles[i] = '!';
        this.cracking.set(i, now + SUMO.CRACK_MS);
      }
      // Wird mit der Zeit schneller (Mittelwert = SHRINK_MS / m)
      const progress = this.broken / m;
      this.nextBreakAt += (SUMO.SHRINK_MS / Math.max(1, m)) * (1.5 - progress);
    }
    // Sudden Death: auch die letzte Insel bricht
    if (!this.sudden && now >= this.playStart + SUMO.ROUND_MS) {
      this.sudden = true;
      this.tiles.forEach((t, i) => {
        if (t === '#') {
          this.tiles[i] = '!';
          this.cracking.set(i, now + SUMO.CRACK_MS + Math.random() * 2500);
        }
      });
    }
  }

  private move(p: P, now: number, dt: number) {
    const stunned = now < p.stunUntil;
    const dashing = now < p.dashUntil;
    let ax = 0;
    let ay = 0;
    if (!stunned && !dashing) {
      ax = p.sx * SUMO.ACCEL;
      ay = p.sy * SUMO.ACCEL;
    }
    p.vx += ax * dt;
    p.vy += ay * dt;
    const fr = dashing ? 1.2 : stunned ? SUMO.FRICTION_HIT : SUMO.FRICTION;
    const k = Math.exp(-fr * dt);
    p.vx *= k;
    p.vy *= k;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (Math.abs(p.sx) > 0.15 && !stunned) p.f = p.sx < 0 ? -1 : 1;
  }

  /** Kreis-Kreis-Stoß mit Masse; Rempler geben dem Getroffenen einen kräftigen Schubs */
  private collide([ida, a]: [string, P], [idb, b]: [string, P], now: number, effects: boolean) {
    const R2 = SUMO.RADIUS * 2;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let d = Math.hypot(dx, dy);
    if (d >= R2) return;
    if (d < 0.001) {
      dx = Math.random() - 0.5;
      dy = Math.random() - 0.5;
      d = Math.hypot(dx, dy);
    }
    const nx = dx / d;
    const ny = dy / d;
    const aDash = now < a.dashUntil;
    const bDash = now < b.dashUntil;
    const ma = aDash ? 1.7 : 1;
    const mb = bDash ? 1.7 : 1;
    // auseinanderschieben
    const overlap = R2 - d;
    const wa = mb / (ma + mb);
    a.x -= nx * overlap * wa;
    a.y -= ny * overlap * wa;
    b.x += nx * overlap * (1 - wa);
    b.y += ny * overlap * (1 - wa);
    const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (vn <= 0 || !effects) return;
    const hit = (victim: P, from: string, sx: number, sy: number, force: number) => {
      // Getroffene fliegen in Stoßrichtung – eigene Geschwindigkeit zählt nur noch wenig
      victim.vx = victim.vx * 0.25 + sx * force;
      victim.vy = victim.vy * 0.25 + sy * force;
      victim.stunUntil = now + SUMO.STUN_MS;
      victim.dashUntil = 0;
      victim.lastHitBy = from;
      victim.lastHitAt = now;
      victim.hits += 1;
    };
    if (aDash || bDash) {
      // Frontal-Rempler: beide fliegen weit
      if (aDash) hit(b, ida, nx, ny, SUMO.KNOCK * (bDash ? SUMO.KNOCK_DASHING : 1));
      if (bDash) hit(a, idb, -nx, -ny, SUMO.KNOCK * (aDash ? SUMO.KNOCK_DASHING : 1));
      // Der Rempler selbst wird abgebremst
      if (aDash && !bDash) {
        a.dashUntil = now;
        a.vx *= 0.3;
        a.vy *= 0.3;
      }
      if (bDash && !aDash) {
        b.dashUntil = now;
        b.vx *= 0.3;
        b.vy *= 0.3;
      }
      return;
    }
    // Normales Anrempeln: weicher Stoß mit Masse plus kleiner Abpraller
    const j = (1.2 * vn) / (1 / ma + 1 / mb);
    a.vx -= (j / ma) * nx;
    a.vy -= (j / ma) * ny;
    b.vx += (j / mb) * nx;
    b.vy += (j / mb) * ny;
    if (vn > 25) {
      a.vx -= nx * SUMO.BUMP;
      a.vy -= ny * SUMO.BUMP;
      b.vx += nx * SUMO.BUMP;
      b.vy += ny * SUMO.BUMP;
      a.lastHitBy = idb;
      a.lastHitAt = now;
      b.lastHitBy = ida;
      b.lastHitAt = now;
    }
  }

  private fall(id: string, now: number) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    p.alive = false;
    p.away = false;
    p.vx = p.vy = 0;
    p.sx = p.sy = 0;
    p.dashUntil = 0;
    p.diedAt = now;
    this.deaths.push(id);
    if (p.lastHitBy && p.lastHitBy !== id && now - p.lastHitAt < SUMO.CREDIT_MS) {
      const k = this.players.get(p.lastHitBy);
      if (k) k.pushes += 1;
    }
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p) return;
    if (action === 'stick') {
      const pl = asRecord(payload);
      let x = clamp(Number(pl.x) || 0, -1, 1);
      let y = clamp(Number(pl.y) || 0, -1, 1);
      const l = Math.hypot(x, y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
      p.sx = x;
      p.sy = y;
      if (l > 0.2) {
        p.lx = x / l;
        p.ly = y / l;
      }
    } else if (action === 'dash') {
      const now = Date.now();
      if (this.sub !== 'play' || !p.alive) return;
      if (now < p.readyAt || now < p.stunUntil) {
        // Kurz vor Ende von Betäubung/Abklingzeit gedrückt: merken statt verschlucken (Rettungs-Rempler am Rand)
        const ready = Math.max(p.readyAt, p.stunUntil);
        if (ready - now < 300) p.dashQueuedUntil = ready + 250;
        return;
      }
      this.dash(p, now);
    }
  }

  private dash(p: P, now: number) {
    p.dashQueuedUntil = 0;
    p.dashUntil = now + SUMO.DASH_MS;
    p.readyAt = now + SUMO.DASH_COOLDOWN_MS;
    p.vx = p.lx * SUMO.DASH_SPEED + p.vx * 0.25;
    p.vy = p.ly * SUMO.DASH_SPEED + p.vy * 0.25;
    p.f = p.lx < 0 ? -1 : 1;
    this.ctx.onChange();
  }

  playerDisconnected(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.sx = p.sy = 0;
    p.vx = p.vy = 0;
    // Nur wer entfernt wurde, fällt sofort – sonst eingefroren (siehe tick), bis er zurück ist oder 15 s um sind
    if (this.sub === 'play' && this.ctx.isGone?.(id)) this.fall(id, Date.now());
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      kind: 'sumo',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - now),
        round: this.round,
        winRounds: SUMO.WIN_ROUNDS,
        tiles: this.tiles.join(''),
        sudden: this.sudden,
        players: Object.fromEntries(
          [...this.players.entries()].map(([id, p]) => [
            id,
            { x: r1(p.x), y: r1(p.y), f: p.f, alive: p.alive, dash: p.dash, cd: Math.round(p.cd), stun: p.stun, hits: p.hits, wins: p.wins, pushes: p.pushes, ...(p.away ? { away: true } : {}) },
          ]),
        ),
        roundWinner: this.roundWinner,
      },
    };
  }

  dispose() {
    this.timers.clear();
  }
}
