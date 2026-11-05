import type { BowlingMark, BowlingRoll, BowlingState, BowlingTrack, MiniSnapshot, SkipInfo } from '../shared/types';
import { possessive } from '../shared/players';
import { BOWL, PIN_POS, bowlingFrames, framePosition, pinsReset, scoreFrames } from '../shared/bowling';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, groupByScore, phaseTimer } from './minigame';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const num = (v: unknown, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);

// ================================================================== Physik

/** Normierte Wurf-Eingabe vom Handy: alles −1 … 1 bzw. 0 … 1 */
export interface ThrowInput {
  /** Startposition −1 (links) … 1 (rechts) */
  start: number;
  /** 0 … 1 */
  speed: number;
  /** Richtung −1 (nach links) … 1 (nach rechts) */
  angle: number;
  /** Effet −1 (Haken nach links) … 1 (Haken nach rechts) */
  spin: number;
}

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
  down: boolean;
  gone: boolean;
}

const SIM_DT = 1 / 400;
const SIM_MAX_S = 7;
/** Ab dieser Aufprallgeschwindigkeit (cm/s) fällt ein Pin um */
const PIN_KNOCK_V = 55;
/** … oder wenn er so weit (cm) verschoben wurde */
const PIN_KNOCK_D = 3.5;
const PIN_FRICTION = 260; // cm/s² Gleitreibung auf dem Pindeck
const WALL_X = BOWL.LANE_HALF + BOWL.GUTTER + 6;

/**
 * Simuliert einen Wurf (deterministisch) von oben in 2D: Kugel + stehende Pins als Kreise,
 * inkl. Pin-Pin-Stößen, Seitenwänden am Pindeck und Rinne.
 */
export function simulateThrow(input: ThrowInput, standing: boolean[]): { track: BowlingTrack; down: boolean[] } {
  const speed = BOWL.SPEED_MIN + clamp(input.speed, 0, 1) * (BOWL.SPEED_MAX - BOWL.SPEED_MIN);
  const angle = clamp(input.angle, -1, 1) * BOWL.ANGLE_MAX;
  const hook = clamp(input.spin, -1, 1) * BOWL.HOOK_MAX;
  const ball: Body = {
    x: clamp(input.start, -1, 1) * BOWL.START_X,
    y: 0,
    vx: Math.sin(angle) * speed,
    vy: Math.cos(angle) * speed,
    r: BOWL.BALL_R,
    m: 7,
    down: false,
    gone: false,
  };
  const pins: (Body | null)[] = PIN_POS.map((p, i) =>
    standing[i] ? { x: p.x, y: p.y, vx: 0, vy: 0, r: BOWL.PIN_R, m: 1.5, down: false, gone: false } : null,
  );
  let gutter = false;
  let gutterAt = -1;

  const rec = { ball: [] as number[], pins: pins.map(() => [] as number[]), downAt: pins.map(() => -1) };
  const record = (k: number) => {
    rec.ball.push(Math.round(ball.x), Math.round(ball.y));
    pins.forEach((p, i) => {
      if (!p) return;
      rec.pins[i].push(Math.round(p.x), Math.round(p.y));
      if (p.down && rec.downAt[i] < 0) rec.downAt[i] = k;
    });
  };

  const steps = Math.round(SIM_MAX_S / SIM_DT);
  const every = Math.round(BOWL.TRACK_DT / SIM_DT);
  let k = 0;
  record(k++);
  let quietSince = -1;
  for (let s = 1; s <= steps; s++) {
    // --- Kugel
    if (!ball.gone) {
      if (!gutter) {
        // Haken: erst rutscht die Kugel, ab der Bahnmitte greift das Effet immer stärker
        const t = clamp((ball.y - 600) / 900, 0, 1);
        ball.vx += hook * t * SIM_DT;
        if (Math.abs(ball.x) > BOWL.LANE_HALF && ball.y < BOWL.PIN_Y - 20) {
          gutter = true;
          gutterAt = k;
          ball.x = Math.sign(ball.x) * (BOWL.LANE_HALF + BOWL.GUTTER / 2);
          ball.vx = 0;
        }
      }
      ball.x += ball.vx * SIM_DT;
      ball.y += ball.vy * SIM_DT;
      if (Math.abs(ball.x) > WALL_X - ball.r) {
        ball.x = Math.sign(ball.x) * (WALL_X - ball.r);
        ball.vx *= -0.3;
      }
      if (ball.y > BOWL.PIT_END) ball.gone = true;
    }
    // --- Pins
    for (const p of pins) {
      if (!p || p.gone) continue;
      const v = Math.hypot(p.vx, p.vy);
      if (v > 0) {
        const nv = Math.max(0, v - PIN_FRICTION * (p.down ? 1.4 : 1) * SIM_DT);
        p.vx *= nv / v;
        p.vy *= nv / v;
      }
      p.x += p.vx * SIM_DT;
      p.y += p.vy * SIM_DT;
      if (Math.abs(p.x) > WALL_X - p.r) {
        p.x = Math.sign(p.x) * (WALL_X - p.r);
        p.vx *= -0.55;
        p.down = true;
      }
      if (p.y > BOWL.DECK_END) {
        p.down = true;
        if (p.y > BOWL.PIT_END) p.gone = true;
      }
      if (p.y < BOWL.PIN_Y - 90) p.vy = Math.abs(p.vy) * 0.3; // Pins rollen nicht zurück auf die Bahn
      const home = PIN_POS[pins.indexOf(p)];
      if (!p.down && Math.hypot(p.x - home.x, p.y - home.y) > PIN_KNOCK_D) p.down = true;
      if (p.down) p.r = BOWL.PIN_DOWN_R;
    }
    // --- Stöße (Kugel in der Rinne trifft nichts)
    const bodies: Body[] = [];
    if (!ball.gone && !gutter) bodies.push(ball);
    for (const p of pins) if (p && !p.gone) bodies.push(p);
    for (let a = 0; a < bodies.length; a++) {
      for (let b = a + 1; b < bodies.length; b++) collide(bodies[a], bodies[b]);
    }

    if (s % every === 0) {
      record(k++);
      const moving = pins.some((p) => p && !p.gone && Math.hypot(p.vx, p.vy) > 5);
      const ballDone = ball.gone || (gutter && ball.y > BOWL.PIN_Y + 120);
      if (ballDone && !moving) {
        if (quietSince < 0) quietSince = k;
        if (k - quietSince >= 4) break;
      } else quietSince = -1;
    }
  }

  const track: BowlingTrack = {
    dt: BOWL.TRACK_DT,
    frames: k,
    ball: rec.ball,
    pins: rec.pins.map((arr, i) => {
      if (!pins[i]) return null;
      // Pins, die sich nie bewegt haben, nur einmal speichern
      const still = arr.every((v, j) => v === arr[j % 2]);
      return still ? arr.slice(0, 2) : arr;
    }),
    downAt: rec.downAt,
    gutterAt,
  };
  return { track, down: pins.map((p) => !!p?.down) };
}

function collide(a: Body, b: Body) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const min = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return;
  const d = Math.sqrt(d2) || 0.001;
  const nx = dx / d;
  const ny = dy / d;
  // auseinanderschieben (nach Masse)
  const overlap = min - d;
  const ma = a.m;
  const mb = b.m;
  a.x -= nx * overlap * (mb / (ma + mb));
  a.y -= ny * overlap * (mb / (ma + mb));
  b.x += nx * overlap * (ma / (ma + mb));
  b.y += ny * overlap * (ma / (ma + mb));
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel >= 0) return;
  const e = 0.72;
  const j = (-(1 + e) * rel) / (1 / ma + 1 / mb);
  a.vx -= (j / ma) * nx;
  a.vy -= (j / ma) * ny;
  b.vx += (j / mb) * nx;
  b.vy += (j / mb) * ny;
  // Ein Pin, der hart getroffen wird, kippt
  const impact = -rel;
  if (impact > PIN_KNOCK_V) {
    if (a.m < 5) a.down = true;
    if (b.m < 5) b.down = true;
  }
}

// ================================================================== Spiel

/**
 * Strand-Bowling: reihum werfen alle am Handy (Schwung mit dem Bewegungssensor oder Wischen),
 * der Server simuliert Kugel und Pins, der TV spielt die Aufzeichnung ab.
 */
export class BowlingGame implements MiniGame {
  readonly kind = 'bowling' as const;
  private order: string[];
  private frames: number;
  private rolls: Record<string, number[]> = {};
  private streak: Record<string, number> = {};
  private turnIdx = 0;
  private sub: BowlingState['sub'] = 'intro';
  private deadline = Date.now() + BOWL.INTRO_MS;
  private aimSeq = 0;
  private aimX = 0;
  private rack: boolean[] = Array(10).fill(true);
  private last: BowlingRoll | null = null;
  private seq = 0;
  private timers = new Timers();

  constructor(
    ids: string[],
    private ctx: MiniCtx,
  ) {
    this.order = [...ids];
    this.frames = bowlingFrames(ids.length);
    for (const id of ids) {
      this.rolls[id] = [];
      this.streak[id] = 0;
    }
    this.timers.later(BOWL.INTRO_MS, () => this.beginAim());
  }

  private get turn() {
    return this.order[this.turnIdx];
  }

  private beginAim() {
    const id = this.turn;
    const pos = framePosition(this.rolls[id], this.frames);
    this.rack = pinsReset(pos.frameRolls) ? Array(10).fill(true) : this.rack;
    this.sub = 'aim';
    this.aimSeq += 1;
    this.aimX = 0;
    const seq = this.aimSeq;
    // Spieler weg (oder – falls gesetzt – Zeit abgelaufen) → automatischer, eher schwacher Wurf
    this.deadline = phaseTimer(this.timers, this.ctx.isConnected(id) ? BOWL.AIM_MS : BOWL.OFFLINE_AIM_MS, () => {
      if (this.sub === 'aim' && this.aimSeq === seq) this.autoThrow();
    });
    this.ctx.onChange();
  }

  private autoThrow() {
    this.throwBall({ start: Math.random() * 0.6 - 0.3, speed: 0.3, angle: Math.random() * 0.6 - 0.3, spin: 0 });
  }

  /** VIP/Laptop: Erklärung überspringen bzw. für den Spieler, der dran ist, einen (schwachen) Wurf machen */
  skippable(): SkipInfo | null {
    if (this.sub === 'intro') return { label: 'Los geht’s', info: true };
    if (this.sub === 'aim') return { label: `${possessive(this.ctx.nameOf(this.turn))} Wurf überspringen` };
    return null;
  }

  skip() {
    if (this.sub === 'intro') {
      this.timers.clear();
      this.beginAim();
    } else if (this.sub === 'aim') {
      this.timers.clear();
      this.autoThrow();
    }
  }

  input(id: string, action: string, payload: unknown) {
    if (this.sub !== 'aim' || id !== this.turn) return;
    const p = asRecord(payload);
    if (action === 'aim') {
      this.aimX = clamp(num(p.start), -1, 1);
      this.ctx.onChange();
    } else if (action === 'throw') {
      if (p.seq !== undefined && num(p.seq) !== this.aimSeq) return;
      this.throwBall({
        start: clamp(num(p.start), -1, 1),
        speed: clamp(num(p.speed, 0.5), 0, 1),
        angle: clamp(num(p.angle), -1, 1),
        spin: clamp(num(p.spin), -1, 1),
      });
    }
  }

  private throwBall(input: ThrowInput) {
    const id = this.turn;
    const before = this.rack.filter(Boolean).length;
    const { track, down } = simulateThrow(input, this.rack);
    this.rack = this.rack.map((st, i) => st && !down[i]);
    const knocked = before - this.rack.filter(Boolean).length;
    const posBefore = framePosition(this.rolls[id], this.frames);
    this.rolls[id].push(knocked);

    const fresh = before === 10;
    let mark: BowlingMark = 'pins';
    if (fresh && knocked === 10) mark = 'strike';
    else if (!fresh && knocked === before) mark = 'spare';
    else if (track.gutterAt >= 0 && knocked === 0) mark = 'gutter';
    else if (knocked === 0) mark = 'miss';
    this.streak[id] = mark === 'strike' ? this.streak[id] + 1 : 0;

    this.last = { seq: ++this.seq, playerId: id, track, knocked, mark, streak: this.streak[id] };
    this.sub = 'roll';
    const playMs = track.frames * track.dt * 1000;
    this.deadline = Date.now() + playMs + BOWL.RESULT_MS;
    this.ctx.onChange();

    const posAfter = framePosition(this.rolls[id], this.frames);
    const frameOver = posAfter.done || posAfter.frame !== posBefore.frame;
    this.timers.later(this.deadline - Date.now(), () => this.next(frameOver));
  }

  private next(frameOver: boolean) {
    if (frameOver) {
      this.rack = Array(10).fill(true);
      this.turnIdx = (this.turnIdx + 1) % this.order.length;
      if (this.order.every((id) => framePosition(this.rolls[id], this.frames).done)) return this.end();
      // Spieler, die schon fertig sind (kann bei Abbruch nicht passieren, aber sicher ist sicher), überspringen
      let guard = 0;
      while (framePosition(this.rolls[this.turn], this.frames).done && guard++ < this.order.length) {
        this.turnIdx = (this.turnIdx + 1) % this.order.length;
      }
    }
    this.beginAim();
  }

  private total(id: string) {
    return scoreFrames(this.rolls[id], this.frames).total;
  }

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.deadline = Date.now() + BOWL.OVER_MS;
    this.ctx.onChange();
    const strikes = (id: string) => this.rolls[id].filter((v, i, arr) => v === 10 && framePosition(arr.slice(0, i), this.frames).ball === 0).length;
    const best = [...this.order].sort((a, b) => this.total(b) - this.total(a))[0];
    this.timers.later(BOWL.OVER_MS, () =>
      this.ctx.finish({
        groups: groupByScore(this.order, (id) => this.total(id)),
        details: Object.fromEntries(
          this.order.map((id) => {
            const n = strikes(id);
            return [id, `${this.total(id)} Pins${n ? ` · ${n}× Strike` : ''}`];
          }),
        ),
        subtitle: `${this.ctx.nameOf(best)} ist König der Strandbahn! (${this.frames} Frames)`,
      }),
    );
  }

  snapshot(): MiniSnapshot {
    const pos = framePosition(this.rolls[this.turn] ?? [], this.frames);
    return {
      kind: 'bowling',
      state: {
        sub: this.sub,
        endsIn: endsIn(this.deadline),
        frames: this.frames,
        order: this.order,
        turn: this.turn,
        frame: pos.frame,
        ball: pos.ball,
        aimSeq: this.aimSeq,
        aimX: this.aimX,
        rack: this.rack,
        rolls: this.rolls,
        last: this.last && this.sub !== 'roll' ? { ...this.last, track: null } : this.last,
      },
    };
  }

  playerDisconnected(id: string) {
    // Wer weg ist, wirft automatisch (siehe beginAim) – läuft gerade sein Zielen, sofort werfen
    if (this.sub === 'aim' && id === this.turn) {
      const seq = this.aimSeq;
      this.timers.later(1500, () => {
        if (this.sub === 'aim' && this.aimSeq === seq && !this.ctx.isConnected(id)) {
          this.throwBall({ start: 0, speed: 0.3, angle: Math.random() * 0.6 - 0.3, spin: 0 });
        }
      });
    }
  }

  dispose() {
    this.timers.clear();
  }
}
