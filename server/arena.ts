import type { ArenaPlayer, ArenaState, MiniSnapshot } from '../shared/types';
import { ARENA, ARENA_SPAWNS, type ArenaCell, type ArenaItem, FLOOD_ORDER, blastCells, cellIdx, isSolidTile, spawnClearing } from '../shared/arena';
import { type MiniCtx, type MiniGame, OFFLINE_OUT_MS, Timers, asRecord, shuffle } from './minigame';
import { SPECTATOR } from '../shared/spectator';
import { BetBook } from './spectator';

type Axis = 'x' | 'y';

interface P extends ArenaPlayer {
  sx: number;
  sy: number;
  lastAxis: Axis | null;
  /** Punkte fürs Überleben (wie viele vor einem ausgeschieden sind), über alle Runden */
  survival: number;
}

interface Bomb {
  id: number;
  x: number;
  y: number;
  at: number;
  owner: string;
  range: number;
}

interface Flame {
  k: 'c' | 'h' | 'v';
  until: number;
  owner: string;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Ab wie viel Versatz die Ecken-Hilfe seitlich in einen Gang schiebt */
const ASSIST = 0.12;
/** Ab welchem Stick-Anteil eine Richtung zählt */
const DEAD = 0.3;

/** Geister-Kachelring: 0 = äußerster begehbarer Ring, steigt nach innen */
const ringOf = (x: number, y: number) => Math.min(x - 1, y - 1, ARENA.COLS - 2 - x, ARENA.ROWS - 2 - y);

interface Ghost {
  x: number;
  y: number;
  sx: number;
  sy: number;
  readyAt: number;
}

/**
 * Bomben-Arena (Bomberman am Strand): Kokosnüsse/Wasserbomben legen, Sandburgen &
 * Liegestühle sprengen, Power-ups sammeln. Wer getroffen wird, ist nass und für die
 * Runde raus. Nach 60 s kommt die Flut. Wer zuerst 2 Runden gewinnt, ist Champion.
 */
export class ArenaGame implements MiniGame {
  readonly kind = 'arena' as const;
  private players = new Map<string, P>();
  private grid: ArenaCell[] = [];
  private bombs: Bomb[] = [];
  private flames = new Map<number, Flame>();
  private items = new Map<number, { t: ArenaItem; safeUntil: number }>();
  private sub: ArenaState['sub'] = 'countdown';
  private round = 0;
  private deadline = 0;
  private floodAt = 0;
  private flood = 0;
  private nextFloodAt = 0;
  private endAt = 0;
  private roundWinner: string | null = null;
  /** Reihenfolge der Ausgeschiedenen in dieser Runde */
  private deaths: string[] = [];
  private seq = 0;
  private timers = new Timers();
  /** Zuschauer: Wetten der Ausgeschiedenen + Geister mit Wasserbomben */
  private bets = new BetBook();
  private ghosts = new Map<string, Ghost>();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    for (const id of ids) {
      this.players.set(id, {
        x: 1, y: 1, alive: false, dir: 'd', moving: false,
        bombs: ARENA.START_BOMBS, range: ARENA.START_RANGE, speed: 0,
        wins: 0, kills: 0, sx: 0, sy: 0, lastAxis: null, survival: 0,
      });
    }
    let last = Date.now();
    this.timers.every(ARENA.TICK_MS, () => {
      const now = Date.now();
      this.tick(now, Math.min(0.1, (now - last) / 1000));
      last = now;
    });
    this.startRound();
  }

  // ---------------------------------------------------------------- Runden

  private startRound() {
    this.round += 1;
    this.bombs = [];
    this.flames.clear();
    this.items.clear();
    this.flood = 0;
    this.endAt = 0;
    this.roundWinner = null;
    this.deaths = [];
    this.ghosts.clear();
    this.bets.newRound(this.round);
    const active = shuffle(this.ids.filter((id) => this.ctx.isConnected(id)));
    const spawns = ARENA_SPAWNS.slice(0, Math.max(1, active.length));
    // Feld bauen: Rand + Säulen fest, Rest zufällig Kisten (außer um die Startplätze)
    const keep = new Set<number>();
    for (const [sx, sy] of spawns) for (const [x, y] of spawnClearing(sx, sy)) keep.add(cellIdx(x, y));
    this.grid = [];
    for (let y = 0; y < ARENA.ROWS; y++) {
      for (let x = 0; x < ARENA.COLS; x++) {
        const edge = x === 0 || y === 0 || x === ARENA.COLS - 1 || y === ARENA.ROWS - 1;
        if (edge) this.grid.push('#');
        else if (isSolidTile(x, y)) this.grid.push('P');
        else if (keep.has(cellIdx(x, y))) this.grid.push('.');
        else this.grid.push(Math.random() < ARENA.BOX_DENSITY ? 'b' : '.');
      }
    }
    for (const [id, p] of this.players) {
      const i = active.indexOf(id);
      p.alive = i >= 0;
      p.away = false;
      if (i >= 0) {
        p.x = spawns[i][0];
        p.y = spawns[i][1];
      }
      p.bombs = ARENA.START_BOMBS;
      p.range = ARENA.START_RANGE;
      p.speed = 0;
      p.moving = false;
      p.lastAxis = null;
      p.dir = 'd';
    }
    this.sub = 'countdown';
    this.deadline = Date.now() + ARENA.COUNTDOWN_MS;
    this.timers.later(ARENA.COUNTDOWN_MS, () => {
      this.sub = 'play';
      this.floodAt = Date.now() + ARENA.ROUND_MS;
      this.nextFloodAt = this.floodAt;
      this.deadline = this.floodAt;
      this.ctx.onChange();
    });
    this.ctx.onChange();
  }

  private endRound(now: number) {
    const alive = this.alive();
    this.roundWinner = alive.length === 1 ? alive[0] : null;
    // Überlebens-Punkte: Anzahl der Spieler, die vor einem ausgeschieden sind
    const n = this.deaths.length + alive.length;
    this.deaths.forEach((id, i) => (this.players.get(id)!.survival += i));
    for (const id of alive) this.players.get(id)!.survival += n - 1;
    if (this.roundWinner) this.players.get(this.roundWinner)!.wins += 1;
    this.bets.resolve(this.roundWinner);
    this.sub = 'roundOver';
    this.deadline = now + ARENA.ROUND_OVER_MS;
    this.ctx.onChange();
    const best = Math.max(...[...this.players.values()].map((p) => p.wins));
    const done = best >= ARENA.WIN_ROUNDS || this.round >= ARENA.MAX_ROUNDS || this.ids.filter((id) => this.ctx.isConnected(id)).length < 2;
    this.timers.later(ARENA.ROUND_OVER_MS, () => (done ? this.end() : this.startRound()));
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
    const groups = this.bets.rank(this.ids, score);
    const top = groups[0] ?? [];
    const champ = top.length === 1 ? this.ctx.nameOf(top[0]) : null;
    this.timers.later(1500, () =>
      this.ctx.finish({
        groups,
        details: Object.fromEntries(
          this.ids.map((id) => {
            const p = this.players.get(id)!;
            return [id, `${p.wins} ${p.wins === 1 ? 'Sieg' : 'Siege'} · ${p.kills} Treffer${this.bets.detail(id)}`];
          }),
        ),
        subtitle: champ ? `${champ} bleibt am längsten trocken!` : 'Alle gleich nass – Unentschieden!',
      }),
    );
  }

  // ---------------------------------------------------------------- Spiellogik

  private tick(now: number, dt: number) {
    if (this.sub !== 'play') {
      if (this.sub === 'countdown' || this.sub === 'roundOver') this.ctx.onChange();
      return;
    }
    // Verbindung weg (nach der 3-s-Gnadenfrist): Figur eingefroren + unverwundbar, nach 15 s raus
    for (const [id, p] of this.players) {
      p.away = p.alive && !this.ctx.isConnected(id);
      if (p.away && (this.ctx.offlineMs?.(id) ?? 0) >= OFFLINE_OUT_MS) this.kill(id, null);
    }
    for (const p of this.players.values()) if (p.alive && !p.away) this.move(p, dt);
    for (const g of this.ghosts.values()) this.moveGhost(g, dt);

    // Power-ups einsammeln
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const i = cellIdx(Math.round(p.x), Math.round(p.y));
      const it = this.items.get(i);
      if (!it) continue;
      this.items.delete(i);
      if (it.t === 'bomb') p.bombs = Math.min(ARENA.MAX_BOMBS, p.bombs + 1);
      else if (it.t === 'range') p.range = Math.min(ARENA.MAX_RANGE, p.range + 1);
      else p.speed = Math.min(ARENA.MAX_SPEED_UPS, p.speed + 1);
    }

    // Bomben zünden (Kettenreaktionen passieren in explode())
    for (const b of [...this.bombs]) if (now >= b.at && this.bombs.includes(b)) this.explode(b, now);
    for (const [i, f] of this.flames) if (now >= f.until) this.flames.delete(i);

    // Wer in einer Explosion steht, ist nass
    for (const [id, p] of this.players) {
      if (!p.alive || p.away) continue;
      const f = this.flames.get(cellIdx(Math.round(p.x), Math.round(p.y)));
      if (f) this.kill(id, f.owner);
    }

    // Sudden Death: die Flut kommt
    if (now >= this.floodAt) {
      while (now >= this.nextFloodAt && this.flood < FLOOD_ORDER.length) {
        const i = FLOOD_ORDER[this.flood++];
        this.nextFloodAt += ARENA.FLOOD_STEP_MS;
        this.grid[i] = '~';
        this.items.delete(i);
        this.flames.delete(i);
        this.bombs = this.bombs.filter((b) => cellIdx(b.x, b.y) !== i);
        for (const [id, p] of this.players) if (p.alive && cellIdx(Math.round(p.x), Math.round(p.y)) === i) this.kill(id, null);
      }
    }

    if (!this.endAt && this.alive().length <= 1) this.endAt = now + ARENA.END_DELAY_MS;
    if (this.endAt && now >= this.endAt) return this.endRound(now);
    this.ctx.onChange();
  }

  private alive() {
    return [...this.players.entries()].filter(([, p]) => p.alive).map(([id]) => id);
  }

  private kill(id: string, by: string | null) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    p.alive = false;
    p.moving = false;
    p.away = false;
    this.deaths.push(id);
    // Ab jetzt Geist: Zielkreuz startet am Rand nahe der Stelle, an der man nass wurde
    const g: Ghost = { x: p.x, y: p.y, sx: 0, sy: 0, readyAt: Date.now() + 3000 };
    this.snapGhost(g);
    this.ghosts.set(id, g);
    if (by && by !== id) {
      const k = this.players.get(by);
      if (k) k.kills += 1;
      this.ctx.log?.('hit', { p: by, o: id });
    }
  }

  private cellAt = (x: number, y: number): ArenaCell =>
    x < 0 || y < 0 || x >= ARENA.COLS || y >= ARENA.ROWS ? '#' : this.grid[cellIdx(x, y)];

  private bombAt = (x: number, y: number) => this.bombs.some((b) => b.x === x && b.y === y);

  private explode(b: Bomb, now: number) {
    this.bombs = this.bombs.filter((o) => o !== b);
    const cells = blastCells(this.cellAt, this.bombAt, b.x, b.y, b.range);
    const chain: Bomb[] = [];
    for (const c of cells) {
      const i = cellIdx(c.x, c.y);
      const old = this.flames.get(i);
      const k = old && old.k !== c.k ? 'c' : c.k;
      this.flames.set(i, { k, until: now + ARENA.FLAME_MS, owner: b.owner });
      if (this.grid[i] === 'b') {
        this.grid[i] = '.';
        if (Math.random() < ARENA.DROP_CHANCE) {
          const r = Math.random();
          this.items.set(i, { t: r < 0.4 ? 'bomb' : r < 0.78 ? 'range' : 'speed', safeUntil: now + ARENA.FLAME_MS + 60 });
        }
      } else {
        const it = this.items.get(i);
        if (it && now > it.safeUntil) this.items.delete(i);
      }
      const other = this.bombs.find((o) => o.x === c.x && o.y === c.y);
      if (other) chain.push(other);
    }
    for (const o of chain) if (this.bombs.includes(o)) this.explode(o, now);
  }

  // ---------------------------------------------------------------- Geister

  /** Äußerster Ring, den Geister treffen dürfen: der Rand plus ein Ring – mit der Flut wandert das nach innen */
  private ghostRing() {
    const next = FLOOD_ORDER[Math.min(this.flood, FLOOD_ORDER.length - 1)];
    const edge = this.flood > 0 ? ringOf(next % ARENA.COLS, Math.floor(next / ARENA.COLS)) : 0;
    return edge + 1;
  }

  /** Zielkreuz auf den erlaubten Randbereich schieben */
  private snapGhost(g: Ghost) {
    g.x = clamp(g.x, 1, ARENA.COLS - 2);
    g.y = clamp(g.y, 1, ARENA.ROWS - 2);
    const max = this.ghostRing();
    if (ringOf(g.x, g.y) <= max) return;
    const d = [g.x - 1, ARENA.COLS - 2 - g.x, g.y - 1, ARENA.ROWS - 2 - g.y];
    const side = d.indexOf(Math.min(...d));
    if (side === 0) g.x = 1 + max;
    else if (side === 1) g.x = ARENA.COLS - 2 - max;
    else if (side === 2) g.y = 1 + max;
    else g.y = ARENA.ROWS - 2 - max;
  }

  private moveGhost(g: Ghost, dt: number) {
    if (Math.hypot(g.sx, g.sy) < DEAD) return;
    g.x += g.sx * SPECTATOR.ARENA_GHOST_SPEED * dt;
    g.y += g.sy * SPECTATOR.ARENA_GHOST_SPEED * dt;
    this.snapGhost(g);
  }

  /** Geist wirft eine Wasserbombe auf die nächste freie Randkachel am Zielkreuz */
  private ghostThrow(id: string, g: Ghost) {
    const now = Date.now();
    if (this.sub !== 'play' || now < g.readyAt) return;
    const max = this.ghostRing();
    const gx = Math.round(g.x);
    const gy = Math.round(g.y);
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = gx + dx;
        const y = gy + dy;
        if (x < 1 || y < 1 || x > ARENA.COLS - 2 || y > ARENA.ROWS - 2 || ringOf(x, y) > max) continue;
        if (this.cellAt(x, y) !== '.' || this.bombAt(x, y)) continue;
        const d = Math.hypot(x - g.x, y - g.y);
        if (d < bestD) {
          bestD = d;
          best = [x, y];
        }
      }
    }
    if (!best) return;
    g.readyAt = now + SPECTATOR.ARENA_GHOST_MS;
    this.bombs.push({ id: ++this.seq, x: best[0], y: best[1], at: now + ARENA.FUSE_MS, owner: id, range: SPECTATOR.ARENA_GHOST_RANGE });
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Bewegung

  /** Frei für Spieler p? Eigene Bombe unter den Füßen blockiert nicht (sonst steckt man fest). */
  private passable(x: number, y: number, p: P) {
    if (this.cellAt(x, y) !== '.') return false;
    if (Math.round(p.x) === x && Math.round(p.y) === y) return true;
    return !this.bombAt(x, y);
  }

  /**
   * Bewegung entlang einer Achse, an Kachelmitten ausgerichtet.
   * Quer zur Laufrichtung wird automatisch auf die Reihe/Spalte gezogen (Ecken-Hilfe),
   * damit man mit dem Touch-Joystick bequem in Gänge abbiegen kann.
   */
  private tryMove(p: P, axis: Axis, d: number, step: number, dry = false): boolean {
    const along = axis === 'x' ? p.x : p.y;
    const perp = axis === 'x' ? p.y : p.x;
    const c = Math.round(along);
    const pc = Math.round(perp);
    const free = (a: number, b: number) => (axis === 'x' ? this.passable(a, b, p) : this.passable(b, a, p));
    const off = perp - pc;
    const aheadFree = free(c + d, pc);
    const beforeCenter = (c - along) * d > 0.001;
    let nAlong = along;
    let nPerp = perp;
    if (aheadFree || beforeCenter) {
      if (dry) return true;
      const snap = Math.min(Math.abs(off), step);
      nPerp = perp - Math.sign(off) * snap;
      nAlong = along + d * Math.max(step - snap * 0.5, 0);
      if (!aheadFree) nAlong = d > 0 ? Math.min(nAlong, c) : Math.max(nAlong, c);
    } else if (Math.abs(off) > ASSIST) {
      // Ecken-Hilfe: Man steht halb neben dem Gang → seitlich hineinrutschen
      const other = pc + Math.sign(off);
      if (!free(c + d, other) || !free(c, other)) return false;
      if (dry) return true;
      nPerp = perp + Math.sign(off) * Math.min(step, Math.abs(other - perp));
    } else {
      return false;
    }
    if (axis === 'x') {
      p.x = nAlong;
      p.y = nPerp;
    } else {
      p.y = nAlong;
      p.x = nPerp;
    }
    return true;
  }

  private move(p: P, dt: number) {
    const ax = Math.abs(p.sx);
    const ay = Math.abs(p.sy);
    if (Math.max(ax, ay) < DEAD) {
      p.moving = false;
      return;
    }
    const step = (ARENA.SPEED + p.speed * ARENA.SPEED_STEP) * dt;
    const want: [Axis, number, number][] = [];
    if (ax >= DEAD) want.push(['x', Math.sign(p.sx), ax]);
    if (ay >= DEAD) want.push(['y', Math.sign(p.sy), ay]);
    want.sort((a, b) => b[2] - a[2]);
    // Schräg gedrückt: Abbiegen hat Vorrang, sobald der Gang quer zur bisherigen Laufrichtung frei ist
    if (want.length === 2 && p.lastAxis) {
      const turn = want.find((w) => w[0] !== p.lastAxis)!;
      if (turn[2] > 0.38 && this.tryMove(p, turn[0], turn[1], step, true)) want.splice(0, 2, turn, want.find((w) => w !== turn)!);
    }
    for (const [axis, d] of want) {
      if (this.tryMove(p, axis, d, step)) {
        p.moving = true;
        p.lastAxis = axis;
        p.dir = axis === 'x' ? (d > 0 ? 'r' : 'l') : d > 0 ? 'd' : 'u';
        p.x = clamp(p.x, 1, ARENA.COLS - 2);
        p.y = clamp(p.y, 1, ARENA.ROWS - 2);
        return;
      }
    }
    p.moving = false;
    const [axis, d] = want[0];
    p.dir = axis === 'x' ? (d > 0 ? 'r' : 'l') : d > 0 ? 'd' : 'u';
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p) return;
    if (action === 'bet') {
      const open = this.sub === 'play' && !this.endAt;
      if (this.bets.place(id, payload, this.ids, this.alive(), open)) this.ctx.onChange();
      return;
    }
    const ghost = !p.alive ? this.ghosts.get(id) : undefined;
    if (ghost && (action === 'stick' || action === 'ghost')) {
      const pl = asRecord(payload);
      ghost.sx = clamp(Number(pl.x) || 0, -1, 1);
      ghost.sy = clamp(Number(pl.y) || 0, -1, 1);
      return;
    }
    if (ghost && (action === 'bomb' || action === 'throw')) return this.ghostThrow(id, ghost);
    if (action === 'stick') {
      const pl = asRecord(payload);
      p.sx = clamp(Number(pl.x) || 0, -1, 1);
      p.sy = clamp(Number(pl.y) || 0, -1, 1);
    } else if (action === 'bomb') {
      if (this.sub !== 'play' || !p.alive) return;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (this.cellAt(x, y) !== '.' || this.bombAt(x, y)) return;
      if (this.bombs.filter((b) => b.owner === id).length >= p.bombs) return;
      this.bombs.push({ id: ++this.seq, x, y, at: Date.now() + ARENA.FUSE_MS, owner: id, range: p.range });
      this.ctx.onChange();
    }
  }

  playerDisconnected(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.sx = p.sy = 0;
    p.moving = false;
    // Nur wer entfernt wurde, ist sofort raus – sonst eingefroren (siehe tick), bis er zurück ist oder 15 s um sind
    if (this.sub === 'play' && this.ctx.isGone?.(id)) this.kill(id, null);
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return {
      kind: 'arena',
      state: {
        sub: this.sub,
        t: now,
        endsIn: Math.max(0, this.deadline - now),
        round: this.round,
        winRounds: ARENA.WIN_ROUNDS,
        grid: this.grid.join(''),
        flood: this.flood,
        floodActive: this.sub === 'play' && now >= this.floodAt,
        bombs: this.bombs.map((b) => ({ id: b.id, x: b.x, y: b.y, fuse: Math.max(0, b.at - now), owner: b.owner, range: b.range })),
        flames: [...this.flames.entries()].map(([i, f]) => ({ x: i % ARENA.COLS, y: Math.floor(i / ARENA.COLS), k: f.k })),
        items: [...this.items.entries()].map(([i, it]) => ({ x: i % ARENA.COLS, y: Math.floor(i / ARENA.COLS), t: it.t })),
        players: Object.fromEntries(
          [...this.players.entries()].map(([id, p]) => [
            id,
            { x: r2(p.x), y: r2(p.y), alive: p.alive, dir: p.dir, moving: p.moving, bombs: p.bombs, range: p.range, speed: p.speed, wins: p.wins, kills: p.kills, ...(p.away ? { away: true } : {}) },
          ]),
        ),
        roundWinner: this.roundWinner,
        spectator: this.bets.info(this.alive(), this.round, this.sub === 'play' && !this.endAt, this.sub === 'play' || this.sub === 'countdown' ? undefined : this.roundWinner),
        ghosts: Object.fromEntries(
          [...this.ghosts.entries()].map(([id, g]) => [id, { x: r2(g.x), y: r2(g.y), cd: Math.max(0, g.readyAt - now) }]),
        ),
      },
    };
  }

  dispose() {
    this.timers.clear();
  }
}
