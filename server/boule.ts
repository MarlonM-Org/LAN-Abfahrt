import type { BouleBall, BouleSide, BouleState, BouleTrack, MiniSnapshot, Point, SkipInfo, Team } from '../shared/types';
import { possessive } from '../shared/players';
import { BOULE, bouleDist, bouleDistance, bouleSetup } from '../shared/boule';
import { TEAM_INFO } from '../shared/flunky';
import { SHIRTS } from '../shared/avatar';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, groupByScore, phaseTimer, shuffle } from './minigame';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const num = (v: unknown, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const hexNum = (h: string) => parseInt(h.slice(1), 16);
/** Ersatzfarben, falls zwei Spieler dieselbe Shirt-Farbe haben */
const FFA_FALLBACK = ['#e0503f', '#3f8fe0', '#46b04a', '#9b5fc0', '#f0973a', '#2fb5a5', '#f07aa8'];

// ================================================================== Physik

/** Normierte Wurf-Eingabe vom Handy */
export interface BouleThrow {
  /** Kraft 0 … 1 → Weite */
  speed: number;
  /** −1 (links/oben) … 1 (rechts/unten) */
  angle: number;
  /** −1 … 1: Kurve nach der Landung */
  spin: number;
  /** Schießen statt Legen */
  shoot: boolean;
}

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
  mu: number;
  /** seitliche Beschleunigung durch Effet (bis zum ersten Stoß) */
  ax: number;
  ay: number;
}

const SIM_DT = 1 / 240;
const SIM_MAX_S = 7;

/**
 * Simuliert einen Wurf deterministisch: Flug im Bogen (ohne Kontakt), Landung, dann Rollen im Sand
 * mit Stößen zwischen Kugeln/Schweinchen und Abprallen an der Holzbande.
 */
export function simulateBoule(t: BouleThrow, jack: Point, balls: Point[]): { track: BouleTrack; jack: Point; balls: Point[] } {
  const D = bouleDistance(t.speed);
  const theta = clamp(t.angle, -1, 1) * BOULE.ANGLE_MAX;
  const dir = { x: Math.cos(theta), y: Math.sin(theta) };
  const rollD = D * (t.shoot ? BOULE.ROLL_SCHIESSEN : BOULE.ROLL_LEGEN);
  const mu = t.shoot ? BOULE.FRICTION_SHOT : BOULE.FRICTION;
  const v0 = Math.sqrt(2 * mu * rollD);
  const landD = D - rollD;
  const land = { x: BOULE.CIRCLE.x + dir.x * landD, y: BOULE.CIRCLE.y + dir.y * landD };
  land.x = clamp(land.x, BOULE.X0 + BOULE.BALL_R, BOULE.X1 - BOULE.BALL_R);
  land.y = clamp(land.y, BOULE.Y0 + BOULE.BALL_R, BOULE.Y1 - BOULE.BALL_R);
  const spin = clamp(t.spin, -1, 1) * BOULE.SPIN_ACC * (t.shoot ? 0.3 : 1);

  const bodies: Body[] = [
    { x: jack.x, y: jack.y, vx: 0, vy: 0, r: BOULE.JACK_R, m: 0.15, mu: BOULE.FRICTION, ax: 0, ay: 0 },
    ...balls.map((b) => ({ x: b.x, y: b.y, vx: 0, vy: 0, r: BOULE.BALL_R, m: 1, mu: BOULE.FRICTION, ax: 0, ay: 0 })),
    // Effet wirkt quer zur Wurfrichtung (positiv = nach rechts/unten aus Sicht des Werfers)
    { x: land.x, y: land.y, vx: dir.x * v0, vy: dir.y * v0, r: BOULE.BALL_R, m: 1, mu, ax: -dir.y * spin, ay: dir.x * spin },
  ];
  const thrown = bodies[bodies.length - 1];

  const rec: number[][] = bodies.map(() => []);
  const hits: number[] = [];
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const record = () => bodies.forEach((b, i) => rec[i].push(r1(b.x), r1(b.y)));

  const every = Math.round(BOULE.TRACK_DT / SIM_DT);
  let k = 0;
  record();
  k++;
  let hitThisFrame = false;
  for (let s = 1; s <= Math.round(SIM_MAX_S / SIM_DT); s++) {
    for (const b of bodies) {
      const v = Math.hypot(b.vx, b.vy);
      if (v <= 0) continue;
      b.vx += b.ax * SIM_DT;
      b.vy += b.ay * SIM_DT;
      const v2 = Math.hypot(b.vx, b.vy);
      const nv = Math.max(0, v2 - b.mu * SIM_DT);
      b.vx *= nv / v2;
      b.vy *= nv / v2;
      if (nv === 0) b.ax = b.ay = 0;
      b.x += b.vx * SIM_DT;
      b.y += b.vy * SIM_DT;
      // Holzbande
      if (b.x < BOULE.X0 + b.r) (b.x = BOULE.X0 + b.r), (b.vx = Math.abs(b.vx) * 0.4);
      if (b.x > BOULE.X1 - b.r) (b.x = BOULE.X1 - b.r), (b.vx = -Math.abs(b.vx) * 0.4);
      if (b.y < BOULE.Y0 + b.r) (b.y = BOULE.Y0 + b.r), (b.vy = Math.abs(b.vy) * 0.4);
      if (b.y > BOULE.Y1 - b.r) (b.y = BOULE.Y1 - b.r), (b.vy = -Math.abs(b.vy) * 0.4);
    }
    for (let a = 0; a < bodies.length; a++) {
      for (let b = a + 1; b < bodies.length; b++) if (collide(bodies[a], bodies[b])) hitThisFrame = true;
    }
    if (s % every === 0) {
      record();
      if (hitThisFrame) hits.push(k);
      hitThisFrame = false;
      k++;
      if (bodies.every((b) => b.vx === 0 && b.vy === 0)) break;
    }
  }
  void thrown;

  const track: BouleTrack = {
    flightMs: Math.round(t.shoot ? 380 + landD * 0.6 : 700 + landD * 1.4),
    arc: t.shoot ? 6 + landD * 0.03 : 22 + landD * 0.12,
    from: { ...BOULE.CIRCLE },
    land: { x: r1(land.x), y: r1(land.y) },
    dt: BOULE.TRACK_DT,
    frames: k,
    paths: rec.map((arr) => (arr.every((v, j) => v === arr[j % 2]) ? arr.slice(0, 2) : arr)),
    hits,
  };
  return {
    track,
    jack: { x: r1(bodies[0].x), y: r1(bodies[0].y) },
    balls: bodies.slice(1).map((b) => ({ x: r1(b.x), y: r1(b.y) })),
  };
}

function collide(a: Body, b: Body): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const min = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2) || 0.001;
  const nx = dx / d;
  const ny = dy / d;
  const overlap = min - d;
  const ma = a.m;
  const mb = b.m;
  a.x -= nx * overlap * (mb / (ma + mb));
  a.y -= ny * overlap * (mb / (ma + mb));
  b.x += nx * overlap * (ma / (ma + mb));
  b.y += ny * overlap * (ma / (ma + mb));
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel >= 0) return false;
  const e = 0.75;
  const j = (-(1 + e) * rel) / (1 / ma + 1 / mb);
  a.vx -= (j / ma) * nx;
  a.vy -= (j / ma) * ny;
  b.vx += (j / mb) * nx;
  b.vy += (j / mb) * ny;
  // Nach dem Stoß: Effet weg, beide rollen mit normaler Sandreibung weiter
  a.ax = a.ay = b.ax = b.ay = 0;
  a.mu = b.mu = BOULE.FRICTION;
  return -rel > 8;
}

// ================================================================== Spiel

/**
 * Boule am Strand: bis 4 Spieler jeder gegen jeden, ab 5 zwei Teams. Das Schweinchen wird zu Beginn jeder
 * Aufnahme automatisch geworfen (zufällige Stelle). Es wirft immer die Seite, die NICHT am nächsten liegt.
 */
export class BouleGame implements MiniGame {
  readonly kind = 'boule' as const;
  private sides: BouleSide[] = [];
  private sideOf: Record<string, string> = {};
  private ballsPer: Record<string, number> = {};
  private left: Record<string, number> = {};
  private lastThrew: Record<string, number> = {};
  private teams: boolean;
  private maxEnds: number;
  private end = 0;
  private starter = 0;
  private sub: BouleState['sub'] = 'intro';
  private deadline = Date.now() + BOULE.INTRO_MS;
  private turn: string | null = null;
  private aimSeq = 0;
  private aimShoot = false;
  private jack: Point | null = null;
  private balls: BouleBall[] = [];
  private last: BouleState['last'] = null;
  private endResult: BouleState['endResult'] = null;
  private history: BouleState['history'] = [];
  private seq = 0;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.teams = ids.length >= 5;
    const order = shuffle(ids);
    if (this.teams) {
      const t: Record<Team, string[]> = { A: [], B: [] };
      order.forEach((id, i) => t[i % 2 === 0 ? 'A' : 'B'].push(id));
      this.sides = (['A', 'B'] as Team[]).map((k) => ({ id: k, name: TEAM_INFO[k].name, color: TEAM_INFO[k].colorNum, members: t[k], score: 0 }));
    } else {
      const used = new Set<string>();
      this.sides = order.map((id, i) => {
        let col = SHIRTS[ctx.lookOf?.(id)?.shirt ?? -1] ?? FFA_FALLBACK[i];
        // helle/dunkle Shirts (weiß, fast schwarz) heben sich schlecht ab, doppelte Farben auch
        if (used.has(col) || col === '#f4efe2' || col === '#3b3b4f') col = FFA_FALLBACK.find((c) => !used.has(c)) ?? col;
        used.add(col);
        return { id, name: ctx.nameOf(id), color: hexNum(col), members: [id], score: 0 };
      });
    }
    const setup = bouleSetup(this.sides.map((s) => s.members.length));
    this.maxEnds = setup.maxEnds;
    this.sides.forEach((s, si) =>
      s.members.forEach((id, mi) => {
        this.sideOf[id] = s.id;
        this.ballsPer[id] = setup.balls[si][mi];
        this.lastThrew[id] = 0;
      }),
    );
    this.starter = Math.floor(Math.random() * this.sides.length);
    this.timers.later(BOULE.INTRO_MS, () => this.startEnd());
  }

  // ---------------------------------------------------------------- Ablauf

  private startEnd() {
    this.end += 1;
    this.balls = [];
    this.endResult = null;
    this.last = null;
    this.turn = null;
    for (const id of this.ids) this.left[id] = this.ballsPer[id];
    // Schweinchen wird automatisch geworfen (zufällige Weite und Richtung)
    const d = BOULE.JACK_DMIN + Math.random() * (BOULE.JACK_DMAX - BOULE.JACK_DMIN);
    const lat = (Math.random() * 2 - 1) * BOULE.JACK_LAT;
    this.jack = { x: Math.round((BOULE.CIRCLE.x + Math.sqrt(d * d - lat * lat)) * 10) / 10, y: Math.round((BOULE.CIRCLE.y + lat) * 10) / 10 };
    this.sub = 'place';
    this.deadline = Date.now() + BOULE.PLACE_MS;
    this.ctx.onChange();
    this.timers.later(BOULE.PLACE_MS, () => this.nextTurn());
  }

  private sideBalls(sideId: string) {
    return this.balls.filter((b) => b.side === sideId);
  }

  private best(sideId: string) {
    const jack = this.jack!;
    return Math.min(Infinity, ...this.sideBalls(sideId).map((b) => bouleDist(b, jack)));
  }

  private sideLeft(s: BouleSide) {
    return s.members.reduce((a, id) => a + (this.left[id] ?? 0), 0);
  }

  /** Seite, die am nächsten liegt (null = noch keine Kugel bzw. Gleichstand) */
  private leaderSide(): string | null {
    if (!this.jack || !this.balls.length) return null;
    const ranked = this.sides.map((s) => ({ id: s.id, d: this.best(s.id) })).sort((a, b) => a.d - b.d);
    if (ranked.length > 1 && ranked[0].d === ranked[1].d) return null;
    return ranked[0].d < Infinity ? ranked[0].id : null;
  }

  private nextTurn() {
    const withBalls = this.sides.filter((s) => this.sideLeft(s) > 0);
    if (!withBalls.length) return this.measure();
    const n = this.sides.length;
    const rot = (s: BouleSide) => (this.sides.indexOf(s) - this.starter + n) % n;
    let side: BouleSide;
    if (!this.balls.length) {
      side = [...withBalls].sort((a, b) => rot(a) - rot(b))[0];
    } else {
      const lead = this.leaderSide();
      const cand = withBalls.filter((s) => s.id !== lead);
      if (!cand.length) side = withBalls[0];
      else {
        // wer am weitesten weg liegt (oder noch gar nicht geworfen hat), ist dran
        side = [...cand].sort((a, b) => this.best(b.id) - this.best(a.id) || this.sideLeft(b) - this.sideLeft(a) || rot(a) - rot(b))[0];
      }
    }
    const member = side.members
      .filter((id) => this.left[id] > 0)
      .sort((a, b) => this.left[b] - this.left[a] || this.lastThrew[a] - this.lastThrew[b])[0];
    this.turn = member;
    this.sub = 'aim';
    this.aimSeq += 1;
    this.aimShoot = false;
    const seq = this.aimSeq;
    // Spieler weg (oder – falls gesetzt – Zeit abgelaufen) → automatischer, eher ungenauer Wurf
    this.deadline = phaseTimer(this.timers, this.ctx.isConnected(member) ? BOULE.AIM_MS : BOULE.OFFLINE_AIM_MS, () => {
      if (this.sub === 'aim' && this.aimSeq === seq) this.throwBall(this.autoThrow());
    });
    this.ctx.onChange();
  }

  /** VIP/Laptop: Erklärung überspringen bzw. für den Spieler, der dran ist, automatisch (ungenau) werfen */
  skippable(): SkipInfo | null {
    if (this.sub === 'intro') return { label: 'Los geht’s', info: true };
    if (this.sub === 'aim' && this.turn) return { label: `${possessive(this.ctx.nameOf(this.turn))} Wurf überspringen` };
    return null;
  }

  skip() {
    if (this.sub === 'intro') {
      this.timers.clear();
      this.startEnd();
    } else if (this.sub === 'aim') {
      this.timers.clear();
      this.throwBall(this.autoThrow());
    }
  }

  private autoThrow(): BouleThrow {
    return { speed: 0.35 + Math.random() * 0.4, angle: Math.random() * 0.8 - 0.4, spin: 0, shoot: false };
  }

  input(id: string, action: string, payload: unknown) {
    if (this.sub !== 'aim' || id !== this.turn) return;
    const p = asRecord(payload);
    if (action === 'style') {
      this.aimShoot = !!p.shoot;
      this.ctx.onChange();
    } else if (action === 'throw') {
      if (p.seq !== undefined && num(p.seq) !== this.aimSeq) return;
      this.throwBall({
        speed: clamp(num(p.speed, 0.5), 0, 1),
        angle: clamp(num(p.angle), -1, 1),
        spin: clamp(num(p.spin), -1, 1),
        shoot: !!p.shoot,
      });
    }
  }

  private throwBall(t: BouleThrow) {
    const id = this.turn;
    if (!id || !this.jack) return;
    const side = this.sideOf[id];
    const res = simulateBoule(t, this.jack, this.balls);
    this.jack = res.jack;
    this.balls = [...this.balls.map((b, i) => ({ ...b, ...res.balls[i] })), { owner: id, side, ...res.balls[res.balls.length - 1] }];
    this.left[id] -= 1;
    this.lastThrew[id] = ++this.seq;
    this.last = { seq: this.seq, playerId: id, shoot: t.shoot, track: res.track };
    this.sub = 'roll';
    const playMs = res.track.flightMs + res.track.frames * res.track.dt * 1000;
    this.deadline = Date.now() + playMs + BOULE.RESULT_MS;
    this.ctx.onChange();
    this.timers.later(this.deadline - Date.now(), () => this.nextTurn());
  }

  private measure() {
    const jack = this.jack!;
    const lead = this.leaderSide();
    let points = 0;
    let counting: number[] = [];
    let radius = 0;
    if (lead) {
      radius = Math.min(...this.sides.filter((s) => s.id !== lead).map((s) => this.best(s.id)));
      counting = this.balls
        .map((b, i) => ({ b, i, d: bouleDist(b, jack) }))
        .filter((x) => x.b.side === lead && x.d < radius)
        .sort((a, b) => a.d - b.d)
        .map((x) => x.i);
      points = counting.length;
      const side = this.sides.find((s) => s.id === lead)!;
      side.score += points;
      this.starter = this.sides.indexOf(side);
    }
    this.endResult = { side: lead, points, counting, radius: Math.round(radius * 10) / 10 };
    this.history.push({ side: lead, points });
    this.turn = null;
    this.sub = 'measure';
    const ms = BOULE.MEASURE_MS + points * BOULE.MEASURE_STEP_MS;
    this.deadline = Date.now() + ms;
    this.ctx.onChange();
    this.timers.later(ms, () => {
      if (this.sides.some((s) => s.score >= BOULE.TARGET) || this.end >= this.maxEnds) this.over();
      else this.startEnd();
    });
  }

  private scoreOf(id: string) {
    return this.sides.find((s) => s.id === this.sideOf[id])?.score ?? 0;
  }

  private over() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.deadline = Date.now() + BOULE.OVER_MS;
    this.ctx.onChange();
    const ranked = [...this.sides].sort((a, b) => b.score - a.score);
    const tie = ranked.length > 1 && ranked[0].score === ranked[1].score;
    const pts = (n: number) => `${n} ${n === 1 ? 'Punkt' : 'Punkte'}`;
    this.timers.later(BOULE.OVER_MS, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => this.scoreOf(id)),
        details: Object.fromEntries(
          this.ids.map((id) => [id, this.teams ? `${TEAM_INFO[this.sideOf[id] as Team].name}: ${pts(this.scoreOf(id))}` : pts(this.scoreOf(id))]),
        ),
        subtitle: tie
          ? `Unentschieden nach ${this.end} Aufnahmen!`
          : `${ranked[0].name} gewinnt mit ${ranked[0].score}:${ranked[1]?.score ?? 0} am Schweinchen!`,
      }),
    );
  }

  snapshot(): MiniSnapshot {
    return {
      kind: 'boule',
      state: {
        sub: this.sub,
        endsIn: endsIn(this.deadline),
        teams: this.teams,
        sides: this.sides,
        ballsPer: this.ballsPer,
        left: this.left,
        end: this.end,
        maxEnds: this.maxEnds,
        target: BOULE.TARGET,
        turn: this.turn,
        aimSeq: this.aimSeq,
        aimShoot: this.aimShoot,
        jack: this.jack,
        balls: this.balls,
        leader: this.leaderSide(),
        last: this.last && this.sub !== 'roll' ? { ...this.last, track: null } : this.last,
        endResult: this.endResult,
        history: this.history,
      },
    };
  }

  playerDisconnected(id: string) {
    if (this.sub === 'aim' && id === this.turn) {
      const seq = this.aimSeq;
      this.timers.later(1500, () => {
        if (this.sub === 'aim' && this.aimSeq === seq && !this.ctx.isConnected(id)) this.throwBall(this.autoThrow());
      });
    }
  }

  dispose() {
    this.timers.clear();
  }
}
