import type { ArenaPlayer, ArenaState, MiniSnapshot } from '../shared/types';
import { ARENA, type ArenaCell, type ArenaGeo, type ArenaItem, arenaGeo, arenaSize, blastCells } from '../shared/arena';
import { type MiniCtx, type MiniGame, OFFLINE_OUT_MS, Timers, asRecord, shuffle } from './minigame';
import { SPECTATOR } from '../shared/spectator';
import { BetBook } from './spectator';

type Axis = 'x' | 'y';

interface P extends ArenaPlayer {
  sx: number;
  sy: number;
  /** Achse des letzten Laufens (nicht des seitlichen Einrutschens) */
  lastAxis: Axis | null;
  /** Kachel, an der zuletzt abgebogen wurde – dort nicht gleich wieder zurück (sonst Zickzack auf der Stelle) */
  turnedAt: number;
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
/** Ab welchem Stick-Anteil eine Richtung zählt */
const DEAD = 0.3;
/** Ab hier zählt die Nebenachse des Sticks als Seiten-Hinweis/Ausweichrichtung */
const SIDE = 0.2;
/** Schräg gehalten (Nebenachse ≥ 75 % der Hauptachse, ab ≈ 37°): an der nächsten freien Kreuzung abbiegen */
const DIAG = 0.75;
/** Ecken-Hilfe: so weit rutscht man seitlich in einen freien Gang – ohne Seiten-Hinweis vom Stick … */
const ASSIST = 0.8;
/** … und entgegen der Seite, in die der Stick zeigt (nur kleine Korrekturen, kein Zurückrutschen) */
const ASSIST_BACK = 0.4;
/** Unter diesem Versatz gilt man als genau auf der Spur */
const EPS = 1e-3;

/** Eine gewünschte Laufrichtung: Achse + Vorzeichen */
interface Want {
  axis: Axis;
  d: number;
}

/** Schritt einer Bewegung: erst `align` quer zur Achse in die Spur, dann bis zu `run` entlang bis zur nächsten Kachelmitte */
interface Plan extends Want {
  align: number;
  run: number;
}

const other = (a: Axis): Axis => (a === 'x' ? 'y' : 'x');

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
  /** Feld passend zur Spielerzahl – steht für alle Runden fest */
  private geo: ArenaGeo;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const size = arenaSize(ids.length);
    this.geo = arenaGeo(size.cols, size.rows);
    for (const id of ids) {
      this.players.set(id, {
        x: 1, y: 1, alive: false, dir: 'd', moving: false,
        bombs: ARENA.START_BOMBS, range: ARENA.START_RANGE, speed: 0,
        wins: 0, kills: 0, sx: 0, sy: 0, lastAxis: null, turnedAt: -1, survival: 0,
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
    const geo = this.geo;
    const active = shuffle(this.ids.filter((id) => this.ctx.isConnected(id))).slice(0, geo.spawns.length);
    const spawns = geo.spawns.slice(0, Math.max(1, active.length));
    // Feld bauen: Rand + Säulen fest, Rest zufällig Kisten (außer um die Startplätze)
    const keep = new Set<number>();
    for (const [sx, sy] of spawns) for (const [x, y] of geo.clearing(sx, sy)) keep.add(geo.idx(x, y));
    this.grid = [];
    for (let y = 0; y < geo.rows; y++) {
      for (let x = 0; x < geo.cols; x++) {
        const edge = x === 0 || y === 0 || x === geo.cols - 1 || y === geo.rows - 1;
        if (edge) this.grid.push('#');
        else if (geo.solid(x, y)) this.grid.push('P');
        else if (keep.has(geo.idx(x, y))) this.grid.push('.');
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
      p.turnedAt = -1;
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
      const i = this.cellOf(p);
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
      const f = this.flames.get(this.cellOf(p));
      if (f) this.kill(id, f.owner);
    }

    // Sudden Death: die Flut kommt
    if (now >= this.floodAt) {
      const order = this.geo.flood;
      while (now >= this.nextFloodAt && this.flood < order.length) {
        const i = order[this.flood++];
        this.nextFloodAt += ARENA.FLOOD_STEP_MS;
        this.grid[i] = '~';
        this.items.delete(i);
        this.flames.delete(i);
        this.bombs = this.bombs.filter((b) => this.geo.idx(b.x, b.y) !== i);
        for (const [id, p] of this.players) if (p.alive && this.cellOf(p) === i) this.kill(id, null);
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
    x < 0 || y < 0 || x >= this.geo.cols || y >= this.geo.rows ? '#' : this.grid[this.geo.idx(x, y)];

  /** Kachel, auf der ein Spieler gerade steht */
  private cellOf(p: { x: number; y: number }) {
    return this.geo.idx(Math.round(p.x), Math.round(p.y));
  }

  private bombAt = (x: number, y: number) => this.bombs.some((b) => b.x === x && b.y === y);

  private explode(b: Bomb, now: number) {
    this.bombs = this.bombs.filter((o) => o !== b);
    const cells = blastCells(this.cellAt, this.bombAt, b.x, b.y, b.range);
    const chain: Bomb[] = [];
    for (const c of cells) {
      const i = this.geo.idx(c.x, c.y);
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
    const order = this.geo.flood;
    const edge = this.flood > 0 ? this.geo.ring(...this.geo.at(order[Math.min(this.flood, order.length - 1)])) : 0;
    return edge + 1;
  }

  /** Zielkreuz auf den erlaubten Randbereich schieben */
  private snapGhost(g: Ghost) {
    const { cols, rows } = this.geo;
    g.x = clamp(g.x, 1, cols - 2);
    g.y = clamp(g.y, 1, rows - 2);
    const max = this.ghostRing();
    if (this.geo.ring(g.x, g.y) <= max) return;
    const d = [g.x - 1, cols - 2 - g.x, g.y - 1, rows - 2 - g.y];
    const side = d.indexOf(Math.min(...d));
    if (side === 0) g.x = 1 + max;
    else if (side === 1) g.x = cols - 2 - max;
    else if (side === 2) g.y = 1 + max;
    else g.y = rows - 2 - max;
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
        if (x < 1 || y < 1 || x > this.geo.cols - 2 || y > this.geo.rows - 2 || this.geo.ring(x, y) > max) continue;
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
  //
  // Figuren laufen auf Spuren: mindestens eine Koordinate ist immer ganzzahlig (Kachelmitte). Abbiegen geht nur an
  // einer Kreuzung; wer knapp daneben steht, rutscht vorher seitlich hinein (Ecken-Hilfe). Pro Tick wird die Strecke
  // in Teilschritten bis zur jeweils nächsten Kachelmitte verbraucht – so geht an Kreuzungen kein Tempo verloren.

  /** Frei für Spieler p? Eigene Bombe unter den Füßen blockiert nicht (sonst steckt man fest). */
  private passable(x: number, y: number, p: P) {
    if (this.cellAt(x, y) !== '.') return false;
    if (Math.round(p.x) === x && Math.round(p.y) === y) return true;
    return !this.bombAt(x, y);
  }

  /**
   * Wie käme p in Richtung `w` voran? null = gar nicht (auch nicht mit Ecken-Hilfe).
   * `hint` = Seite (−1/0/+1 quer zu `w`), in die der Stick zusätzlich zeigt: dorthin rutscht die Ecken-Hilfe bis zur
   * nächsten Spur, dagegen nur ein kleines Stück – wer rechts-oben drückt, wird nie nach links zurückgezogen.
   */
  private plan(p: P, w: Want, hint: number): Plan | null {
    const along = w.axis === 'x' ? p.x : p.y;
    const perp = w.axis === 'x' ? p.y : p.x;
    const free = (a: number, b: number) => (w.axis === 'x' ? this.passable(a, b, p) : this.passable(b, a, p));
    const lane = Math.round(perp);
    if (Math.abs(perp - lane) < EPS) {
      // Auf der Spur: bis zur nächsten Kachelmitte in Laufrichtung, wenn die frei ist
      const next = w.d > 0 ? Math.floor(along + EPS) + 1 : Math.ceil(along - EPS) - 1;
      return free(next, lane) ? { ...w, align: lane - perp, run: Math.abs(next - along) } : null;
    }
    // Zwischen zwei Spuren (man läuft gerade quer dazu, steht also auf einer Kachelmitte der Laufachse)
    const at = Math.round(along);
    const lo = Math.floor(perp);
    const lanes = [lo, lo + 1].sort((a, b) => Math.abs(a - perp) - Math.abs(b - perp));
    for (const l of lanes) {
      const delta = l - perp;
      const max = !hint ? ASSIST : Math.sign(delta) === hint ? 1 : ASSIST_BACK;
      if (Math.abs(delta) > max + EPS) continue;
      if (!free(at, l) || !free(at + w.d, l)) continue;
      return { ...w, align: delta, run: Math.abs(at + w.d - along) };
    }
    return null;
  }

  /**
   * Welche Richtung jetzt? Hauptachse des Sticks zuerst, die Nebenachse als Ausweichrichtung, wenn es geradeaus nicht
   * weitergeht (so läuft man an Kreuzungen einfach durch). Deutlich schräg gehalten: an der nächsten freien Kreuzung
   * abbiegen, aber an derselben Kreuzung nicht gleich wieder zurück.
   */
  private choose(p: P): Plan | null {
    const ax = Math.abs(p.sx);
    const ay = Math.abs(p.sy);
    const mainAxis: Axis = ax >= ay ? 'x' : 'y';
    const main: Want = { axis: mainAxis, d: Math.sign(mainAxis === 'x' ? p.sx : p.sy) };
    const sideV = mainAxis === 'x' ? p.sy : p.sx;
    const side: Want | null = Math.abs(sideV) >= SIDE ? { axis: other(mainAxis), d: Math.sign(sideV) } : null;
    let order: Want[] = side ? [main, side] : [main];
    if (side && p.lastAxis && Math.abs(sideV) >= DIAG * Math.max(ax, ay)) {
      const turn = p.lastAxis === main.axis ? side : main;
      const keep = turn === side ? main : side;
      order = p.turnedAt === this.cellOf(p) ? [keep, turn] : [turn, keep];
    }
    for (const w of order) {
      const pl = this.plan(p, w, w === main ? (side?.d ?? 0) : main.d);
      if (pl) return pl;
    }
    return null;
  }

  private move(p: P, dt: number) {
    if (Math.max(Math.abs(p.sx), Math.abs(p.sy)) < DEAD) {
      p.moving = false;
      return;
    }
    // Sicherheitsnetz: liegt die Figur auf keiner Spur (sollte nie passieren), auf die nächste setzen
    const ox = Math.abs(p.x - Math.round(p.x));
    const oy = Math.abs(p.y - Math.round(p.y));
    if (ox >= EPS && oy >= EPS) {
      if (ox < oy) p.x = Math.round(p.x);
      else p.y = Math.round(p.y);
    }
    const face = (axis: Axis, d: number) => (axis === 'x' ? (d > 0 ? 'r' : 'l') : d > 0 ? 'd' : 'u');
    let budget = (ARENA.SPEED + p.speed * ARENA.SPEED_STEP) * dt;
    let moved = false;
    for (let k = 0; k < 6 && budget > 1e-6; k++) {
      const pl = this.choose(p);
      if (!pl) break;
      const pa = other(pl.axis);
      // 1) seitlich in die Spur rutschen
      const a = Math.min(budget, Math.abs(pl.align));
      if (Math.abs(pl.align) >= EPS) {
        p[pa] += Math.sign(pl.align) * a;
        budget -= a;
        moved = true;
        p.dir = face(pa, pl.align);
        if (a < Math.abs(pl.align)) break;
      }
      p[pa] = Math.round(p[pa]);
      // 2) entlang bis zur nächsten Kachelmitte
      const r = Math.min(budget, pl.run);
      if (r <= 0) break;
      if (p.lastAxis !== pl.axis) {
        p.turnedAt = this.cellOf(p);
        p.lastAxis = pl.axis;
      }
      p[pl.axis] += pl.d * r;
      if (r >= pl.run - EPS) p[pl.axis] = Math.round(p[pl.axis]);
      budget -= r;
      moved = true;
      p.dir = face(pl.axis, pl.d);
    }
    p.x = clamp(p.x, 1, this.geo.cols - 2);
    p.y = clamp(p.y, 1, this.geo.rows - 2);
    p.moving = moved;
    // Steht an der Wand: wenigstens in die gedrückte Richtung schauen
    if (!moved) p.dir = Math.abs(p.sx) >= Math.abs(p.sy) ? face('x', p.sx) : face('y', p.sy);
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
        cols: this.geo.cols,
        rows: this.geo.rows,
        grid: this.grid.join(''),
        flood: this.flood,
        floodActive: this.sub === 'play' && now >= this.floodAt,
        bombs: this.bombs.map((b) => ({ id: b.id, x: b.x, y: b.y, fuse: Math.max(0, b.at - now), owner: b.owner, range: b.range })),
        flames: [...this.flames.entries()].map(([i, f]) => ({ x: i % this.geo.cols, y: Math.floor(i / this.geo.cols), k: f.k })),
        items: [...this.items.entries()].map(([i, it]) => ({ x: i % this.geo.cols, y: Math.floor(i / this.geo.cols), t: it.t })),
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
