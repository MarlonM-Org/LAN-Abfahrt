import type { MiniSnapshot, Team } from '../shared/types';
import { AFB, AFB_CX, AFB_CY, type AfbCar, type AfbGoal, type AfbState, afbCollideWalls, afbGoalHalf, afbKickoff } from '../shared/autoball';
import { KART, type KartInput, type KartPhys, stepKart } from '../shared/kart';
import { TEAM_INFO } from '../shared/flunky';
import { teamHandicap } from '../shared/games';
import { type MiniCtx, type MiniGame, Timers, asRecord, splitTeams } from './minigame';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const other = (t: Team): Team => (t === 'A' ? 'B' : 'A');
/** Zum Testen kürzer: AFB_MATCH_MS=40000 npm run dev */
const MATCH_MS = Number(process.env.AFB_MATCH_MS) || AFB.MATCH_MS;

interface Inp {
  steer: number;
  gas: boolean;
  brake: boolean;
  boost: boolean;
}

interface Car extends KartPhys {
  id: string;
  team: Team;
  /** Platz in der Anstoß-Aufstellung */
  slot: number;
  inp: Inp;
  tank: number;
  boosting: boolean;
  hopUntil: number;
  hopReadyAt: number;
  goals: number;
  touches: number;
  /** Ballkontakt im letzten / aktuellen Teilschritt (Kontakte zählen nur beim Anfang einer Berührung) */
  contactPrev: boolean;
  contactNow: boolean;
  lastTouchAt: number;
}

/**
 * Auto-Fußball (à la Rocket League, aber von oben): kleine Karts schieben einen großen Wasserball
 * ins gegnerische Tor. Fahrphysik = Kart-Rennen (`stepKart` ohne Strecke), dazu BOOST (Tank lädt
 * sich auf) und HÜPFER (kurz über andere Autos springen, Ball härter treffen). BREMSE in voller
 * Fahrt + lenken = Drift (mit Mini-Turbo wie im Kart). Ball- und Bandenphysik laufen hier.
 * 3 Minuten, bei Gleichstand Golden Goal (max. 1 Minute), danach Unentschieden.
 */
export class AutoballGame implements MiniGame {
  readonly kind = 'autoball' as const;
  private cars = new Map<string, Car>();
  private ball = { x: AFB_CX, y: AFB_CY, vx: 0, vy: 0 };
  private score: Record<Team, number> = { A: 0, B: 0 };
  private sub: AfbState['sub'] = 'countdown';
  private deadline = Date.now() + AFB.INTRO_MS;
  private clock = MATCH_MS;
  private overtime = false;
  private first = true;
  private round = 0;
  private goalHalf: number;
  private lastGoal: AfbGoal | null = null;
  private winner: Team | null = null;
  private seq = 0;
  private lastTouch: { id: string; at: number } | null = null;
  private teamTouch: Record<Team, { id: string; at: number } | null> = { A: null, B: null };
  private fill: Record<Team, number> = { A: 1, B: 1 };
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const perTeam: Record<Team, number> = { A: 0, B: 0 };
    // Vom Spielbrett vorgegebene Teams (2 gegen 2, 1 gegen 3) oder zufällig geteilt
    const split = splitTeams(ids, ctx.teams);
    const teamOf = new Map<string, Team>([...split.A.map((id) => [id, 'A'] as const), ...split.B.map((id) => [id, 'B'] as const)]);
    // Handicap bei ungleichen Brett-Teams: Vorsprung in Toren (dazu lädt der Boost des kleineren Teams schneller, s. u.)
    if (ctx.teams) this.score = teamHandicap(split.A.length, split.B.length);
    ids.forEach((id) => {
      const team: Team = teamOf.get(id) ?? 'A';
      const slot = perTeam[team]++;
      const k = afbKickoff(team, slot);
      this.cars.set(id, {
        id,
        team,
        slot,
        x: k.x,
        y: k.y,
        angle: k.a,
        vx: 0,
        vy: 0,
        driftDir: 0,
        driftCharge: 0,
        boostMs: 0,
        spinMs: 0,
        offroad: false,
        inp: { steer: 0, gas: false, brake: false, boost: false },
        tank: AFB.BOOST_KICKOFF,
        boosting: false,
        hopUntil: 0,
        hopReadyAt: 0,
        goals: 0,
        touches: 0,
        contactPrev: false,
        contactNow: false,
        lastTouchAt: 0,
      });
    });
    this.goalHalf = afbGoalHalf(Math.max(perTeam.A, perTeam.B));
    if (perTeam.A < perTeam.B) this.fill.A = AFB.BOOST_UNDERDOG;
    if (perTeam.B < perTeam.A) this.fill.B = AFB.BOOST_UNDERDOG;
    let last = Date.now();
    this.timers.every(AFB.TICK_MS, () => {
      const now = Date.now();
      this.tick(now, Math.min(0.1, (now - last) / 1000));
      last = now;
    });
  }

  // ---------------------------------------------------------------- Ablauf

  private kickoff(ms: number) {
    this.sub = 'countdown';
    this.deadline = Date.now() + ms;
    this.round++;
    this.ball = { x: AFB_CX, y: AFB_CY, vx: 0, vy: 0 };
    this.lastTouch = null;
    this.teamTouch = { A: null, B: null };
    for (const c of this.cars.values()) {
      const k = afbKickoff(c.team, c.slot);
      Object.assign(c, { x: k.x, y: k.y, angle: k.a, vx: 0, vy: 0, driftDir: 0, driftCharge: 0, boostMs: 0, hopUntil: 0, boosting: false });
      c.tank = Math.max(c.tank, AFB.BOOST_KICKOFF);
    }
  }

  private tick(now: number, dt: number) {
    if (this.sub === 'over') return;
    if (this.sub === 'countdown') {
      if (now >= this.deadline) {
        this.sub = 'play';
        this.first = false;
      }
    } else if (this.sub === 'goal') {
      this.physics(now, dt);
      if (now >= this.deadline) this.afterGoal();
    } else {
      this.clock = Math.max(0, this.clock - dt * 1000);
      this.physics(now, dt);
      if (this.sub === 'play' && this.clock <= 0) this.timeUp();
    }
    this.ctx.onChange();
  }

  private afterGoal() {
    // Golden Goal entschieden oder Zeit schon um → Ende
    if (this.overtime) return this.end(this.lastGoal?.team ?? null);
    if (this.clock <= 0) return this.timeUp();
    this.kickoff(AFB.COUNTDOWN_MS);
  }

  private timeUp() {
    if (this.score.A !== this.score.B) return this.end(this.score.A > this.score.B ? 'A' : 'B');
    if (this.overtime) return this.end(null);
    this.overtime = true;
    this.clock = AFB.OVERTIME_MS;
    this.kickoff(AFB.COUNTDOWN_MS + 1000);
  }

  private checkGoal(now: number) {
    const b = this.ball;
    let team: Team | null = null;
    if (b.x < AFB.X0 - AFB.BALL_R) team = 'B';
    else if (b.x > AFB.X1 + AFB.BALL_R) team = 'A';
    if (!team) return;
    this.score[team]++;
    // Torschütze: letzter Kontakt – war das jemand vom anderen Team, zählt ein eigener Kontakt der letzten Sekunden, sonst Eigentor
    let scorer: string | null = null;
    let own = false;
    const last = this.lastTouch;
    if (last && this.cars.get(last.id)?.team === team) scorer = last.id;
    else {
      const t = this.teamTouch[team];
      if (t && now - t.at < AFB.SCORER_MS) scorer = t.id;
      else if (last) {
        scorer = last.id;
        own = true;
      }
    }
    if (scorer && !own) this.cars.get(scorer)!.goals++;
    if (scorer) this.ctx.log?.(own ? 'owngoal' : 'goal', { p: scorer });
    this.lastGoal = { seq: ++this.seq, team, scorer, own };
    this.sub = 'goal';
    this.deadline = now + AFB.GOAL_MS;
  }

  // ---------------------------------------------------------------- Physik

  private physics(now: number, dt: number) {
    const live = this.sub === 'play' || this.sub === 'goal';
    const list = [...this.cars.values()];
    const kin = new Map<string, KartInput>();
    for (const c of list) {
      const inp = c.inp;
      const connected = this.ctx.isConnected(c.id);
      // BOOST: solange gedrückt und Tank nicht leer
      c.boosting = live && connected && inp.boost && c.tank > 0;
      if (c.boosting) {
        c.tank = Math.max(0, c.tank - AFB.BOOST_DRAIN * dt);
        c.boostMs = Math.max(c.boostMs, AFB.TICK_MS + 40);
      } else {
        c.tank = Math.min(AFB.BOOST_MAX, c.tank + AFB.BOOST_FILL * this.fill[c.team] * dt);
      }
      // BREMSE in voller Fahrt + lenken = Drift (wie DRIFT im Kart), sonst bremsen bzw. rückwärts
      const vf = c.vx * Math.cos(c.angle) + c.vy * Math.sin(c.angle);
      const drift = inp.brake && (c.driftDir !== 0 || (vf > KART.DRIFT_MIN_SPEED && Math.abs(inp.steer) > 0.35));
      kin.set(c.id, { steer: inp.steer, gas: inp.gas, brake: inp.brake && !drift, drift });
    }
    const N = AFB.SUBSTEPS;
    const h = dt / N;
    const b = this.ball;
    for (let s = 0; s < N; s++) {
      for (const c of list) {
        c.contactPrev = c.contactNow;
        c.contactNow = false;
        stepKart(c, kin.get(c.id)!, h, null, { frozen: !this.ctx.isConnected(c.id) });
        afbCollideWalls(c, AFB.CAR_R, this.goalHalf, AFB.CAR_WALL_E);
      }
      // Autos schubsen sich (wer hüpft, fliegt drüber)
      const R2 = AFB.CAR_R * 2;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const p = list[i];
          const q = list[j];
          if (p.hopUntil > now || q.hopUntil > now) continue;
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d >= R2 || d === 0) continue;
          const nx = dx / d;
          const ny = dy / d;
          const push = (R2 - d) / 2;
          p.x -= nx * push;
          p.y -= ny * push;
          q.x += nx * push;
          q.y += ny * push;
          const va = p.vx * nx + p.vy * ny;
          const vb = q.vx * nx + q.vy * ny;
          if (va - vb > 0) {
            const ex = (va - vb) * 0.9;
            p.vx -= nx * ex;
            p.vy -= ny * ex;
            q.vx += nx * ex;
            q.vy += ny * ex;
          }
        }
      }
      // Ball rollen lassen
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) {
        const nsp = Math.max(0, sp * Math.exp(-AFB.BALL_DRAG * h) - AFB.BALL_ROLL * h);
        b.vx *= nsp / sp;
        b.vy *= nsp / sp;
      }
      b.x += b.vx * h;
      b.y += b.vy * h;
      // Ball gegen Autos
      for (const c of list) this.hitBall(c, now);
      afbCollideWalls(b, AFB.BALL_R, this.goalHalf, AFB.BALL_WALL_E);
      const v = Math.hypot(b.vx, b.vy);
      if (v > AFB.BALL_MAX) {
        b.vx *= AFB.BALL_MAX / v;
        b.vy *= AFB.BALL_MAX / v;
      }
      // Tor? (in jedem Teilschritt, damit ein Abpraller von der Rückwand nicht verloren geht)
      if (this.sub === 'play') this.checkGoal(now);
    }
  }

  private hitBall(c: Car, now: number) {
    const b = this.ball;
    const fx = Math.cos(c.angle);
    const fy = Math.sin(c.angle);
    const cx = c.x + fx * AFB.CAR_NOSE;
    const cy = c.y + fy * AFB.CAR_NOSE;
    const dx = b.x - cx;
    const dy = b.y - cy;
    const d = Math.hypot(dx, dy);
    const min = AFB.CAR_R + AFB.BALL_R;
    if (d >= min || d === 0) return;
    const fresh = !c.contactPrev;
    c.contactNow = true;
    const nx = dx / d;
    const ny = dy / d;
    const wb = 1 / AFB.BALL_MASS;
    const wc = 1 / AFB.CAR_MASS;
    const ws = wb + wc;
    const over = min - d;
    b.x += nx * over * (wb / ws);
    b.y += ny * over * (wb / ws);
    c.x -= nx * over * (wc / ws);
    c.y -= ny * over * (wc / ws);
    const rel = (b.vx - c.vx) * nx + (b.vy - c.vy) * ny;
    if (rel >= 0) return;
    const j = (-(1 + AFB.BALL_CAR_E) * rel) / ws;
    b.vx += nx * j * wb;
    b.vy += ny * j * wb;
    c.vx -= nx * j * wc;
    c.vy -= ny * j * wc;
    // Schuss: Fahrt in Richtung Ball gibt extra Wumms (beim Hüpfer mehr)
    const push = c.vx * nx + c.vy * ny;
    if (push > 15) {
      const k = c.hopUntil > now ? AFB.HOP_KICK : AFB.KICK;
      b.vx += nx * push * k;
      b.vy += ny * push * k;
    }
    if (this.sub !== 'play') return;
    // Ballkontakt zählen: neue Berührung, nicht öfter als alle 300 ms (Dauerschieben = 1 Kontakt)
    if (fresh && now - c.lastTouchAt > 300) c.touches++;
    c.lastTouchAt = now;
    this.lastTouch = { id: c.id, at: now };
    this.teamTouch[c.team] = { id: c.id, at: now };
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const c = this.cars.get(id);
    if (!c) return;
    const pl = asRecord(payload);
    if (action === 'steer') {
      // { x: Lenkung, gas, brake, boost } – fehlende Felder bleiben, wie sie sind
      c.inp.steer = clamp(Number(pl.x) || 0, -1, 1);
      if (typeof pl.gas === 'boolean') c.inp.gas = pl.gas;
      if (typeof pl.brake === 'boolean') c.inp.brake = pl.brake;
      if (typeof pl.boost === 'boolean') c.inp.boost = pl.boost;
    } else if (action === 'hop') {
      const now = Date.now();
      if ((this.sub !== 'play' && this.sub !== 'goal') || now < c.hopReadyAt) return;
      c.hopUntil = now + AFB.HOP_MS;
      c.hopReadyAt = now + AFB.HOP_COOLDOWN_MS;
    }
  }

  // ---------------------------------------------------------------- Ende

  private end(winner: Team | null) {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.winner = winner;
    this.deadline = Date.now() + AFB.END_MS;
    for (const c of this.cars.values()) c.inp = { steer: 0, gas: false, brake: false, boost: false };
    this.ctx.onChange();
    const ids = this.ids.filter((id) => this.cars.has(id));
    const teamOf = (id: string) => this.cars.get(id)!.team;
    const details: Record<string, string> = {};
    for (const c of this.cars.values()) {
      // Ergebnis-Zeile am TV zeigt max. 16 Zeichen
      const full = `${c.goals} ${c.goals === 1 ? 'Tor' : 'Tore'} · ${c.touches} Kont.`;
      details[c.id] = full.length <= 16 ? full : `${c.goals} Tore·${c.touches} Kont.`;
    }
    const sA = this.score.A;
    const sB = this.score.B;
    const golden = this.overtime && winner !== null;
    const result = winner
      ? {
          groups: [ids.filter((id) => teamOf(id) === winner), ids.filter((id) => teamOf(id) !== winner)].filter((g) => g.length),
          details,
          subtitle: `${TEAM_INFO[winner].name} gewinnt ${this.score[winner]}:${this.score[other(winner)]}${golden ? ' per Golden Goal' : ''}!`,
          coins: [10, 3],
        }
      : { groups: [ids], details, subtitle: `Unentschieden ${sA}:${sB} – auch nach der Verlängerung!`, coins: [6] };
    this.timers.later(AFB.END_MS, () => {
      this.timers.clear();
      this.ctx.finish(result);
    });
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const cars: Record<string, AfbCar> = {};
    for (const c of this.cars.values()) {
      cars[c.id] = {
        x: r1(c.x),
        y: r1(c.y),
        a: Math.round(c.angle * 100) / 100,
        t: c.team,
        b: Math.round(c.tank),
        bo: c.boostMs > 0,
        d: c.driftDir,
        ch: c.driftDir !== 0 && c.driftCharge >= KART.DRIFT_CHARGE_S,
        hop: Math.max(0, c.hopUntil - now),
        hc: Math.max(0, c.hopReadyAt - now),
        g: c.goals,
        k: c.touches,
      };
    }
    const b = this.ball;
    return {
      kind: 'autoball',
      state: {
        sub: this.sub,
        endsIn: this.sub === 'play' ? Math.round(this.clock) : Math.max(0, this.deadline - now),
        round: this.round,
        clock: Math.round(this.clock),
        overtime: this.overtime,
        first: this.first,
        goalHalf: this.goalHalf,
        score: { ...this.score },
        ball: { x: r1(b.x), y: r1(b.y), vx: r1(b.vx), vy: r1(b.vy) },
        cars,
        lastGoal: this.lastGoal,
        winner: this.winner,
      },
    };
  }

  playerDisconnected(id: string) {
    const c = this.cars.get(id);
    if (c) c.inp = { steer: 0, gas: false, brake: false, boost: false };
  }

  dispose() {
    this.timers.clear();
  }
}
