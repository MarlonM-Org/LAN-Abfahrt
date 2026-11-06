import type { MiniSnapshot } from '../shared/types';
import { SKI, type SkiJump, type SkiState, distPoints, hillDist, hillSlope, hillY } from '../shared/skisprung';
import { BalanceTurnGame } from './balance';
import { type MiniCtx, groupByScore, shuffle } from './minigame';

/**
 * Skispringen (à la Wii Fit): einer nach dem anderen auf dem Balance Board.
 *   Anlauf – Schwerpunkt ruhig in der Mitte = schneller
 *   Tisch  – im richtigen Moment hochdrücken (Gewichtsspitze am Board) = kräftiger Absprung
 *   Flug   – leicht nach vorn lehnen, nicht seitlich kippen = mehr Auftrieb, weniger Bremsen
 *   Landung – wer in der letzten halben Sekunde wackelt, stürzt
 * Wertung wie im Weltcup: 60 Punkte am K-Punkt, ±1,8 pro Meter, dazu Haltung (0–20).
 */

const G = 9.81;
const deg = Math.PI / 180;
/** Winkel des Schanzentischs (nach unten) */
const TABLE_ANGLE = 11 * deg;
/** Absprung-Impuls senkrecht zur Flugbahn bei perfektem Timing (m/s) */
const JUMP_V = 4.2;
const GATE = SKI.GATE_MS;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Haltung im Anlauf: Schwerpunkt mittig, nicht zu weit vor/zurück */
export const inrunQuality = (x: number, y: number) => clamp(1 - Math.hypot(x, y * 0.9) / 0.5, 0, 1);
/** Haltung in der Luft: leicht nach vorn, seitlich gerade */
export const flightQuality = (x: number, y: number) => clamp(1 - Math.hypot(x * 1.2, y - SKI.FLIGHT_Y) / 0.55, 0, 1);
/** Timing → Absprung-Güte 0…1 */
export const takeoffQuality = (t: number | null) => (t === null ? 0 : clamp(1 - Math.abs(t) / SKI.TAKEOFF_WINDOW_S, 0, 1));

/** Anlauf: Beschleunigung entlang des Hangs (m/s²) */
export function inrunAccel(v: number, slope: number, q: number) {
  const cd = 0.0026 + 0.0034 * (1 - q);
  return G * Math.sin(slope) - 0.035 * G * Math.cos(slope) - cd * v * v;
}

/** Flug: Beschleunigung (Schwerkraft, Auftrieb senkrecht zur Bahn, Luftwiderstand) */
export function flightAccel(vx: number, vy: number, q: number): [number, number] {
  const v = Math.hypot(vx, vy) || 1;
  const cl = 0.0011 + 0.0016 * q;
  const cd = 0.0010 + 0.0012 * (1 - q);
  // Auftrieb: Geschwindigkeit um 90° gedreht (nach oben), Widerstand gegen die Bahn
  const ax = (-vy / v) * cl * v * v - (vx / v) * cd * v * v;
  const ay = (vx / v) * cl * v * v - (vy / v) * cd * v * v - G;
  return [ax, ay];
}

/** Haltungsnote 0–20 (halbe Punkte) aus Flughaltung, Landung und Absprung */
export function styleNote(qFlight: number, qLand: number, tq: number, fall: boolean) {
  const raw = 20 * (0.5 * qFlight + 0.3 * qLand + 0.2 * tq);
  const s = fall ? Math.min(7, raw * 0.4) : 8 + raw * 0.6;
  return Math.round(clamp(s, 0, 20) * 2) / 2;
}

export class SkisprungGame extends BalanceTurnGame<SkiState> {
  readonly kind = 'skisprung' as const;
  protected state: SkiState;
  /** Fortschritt des aktuellen Sprungs */
  private v = 0;
  private qs = 0;
  private qFlightSum = 0;
  private qFlightN = 0;
  /** Haltung der letzten ~0,5 s vor der Landung (Ringpuffer) */
  private qRecent: number[] = [];
  private takeoffAt: number | null = null;
  private airTime = 0;
  private jumped = false;
  private runT = 0;

  constructor(ids: string[], ctx: MiniCtx) {
    super(ids, ctx, SKI.TICK_MS);
    const jumps: Record<string, SkiJump[]> = {};
    const points: Record<string, number> = {};
    for (const id of ids) {
      jumps[id] = [];
      points[id] = 0;
    }
    this.state = {
      sub: 'ready', round: 1, rounds: ids.length <= SKI.TWO_ROUNDS_MAX ? 2 : 1, t: Date.now(),
      order: [], active: null, board: false, bal: null, calib: 0, endsIn: 0,
      px: SKI.START_X, py: hillY(SKI.START_X), vx: 0, vy: 0, ang: 0, kmh: 0, q: 0, takeoff: null, dist: 0,
      jumps, points, last: null, best: null,
    };
    this.start();
    this.beginRound(shuffle(ids));
  }

  snapshot(): MiniSnapshot {
    this.state.t = Date.now();
    return { kind: 'skisprung', state: this.state };
  }

  protected dns(id: string) {
    const list = this.state.jumps[id];
    if (!list || list.length >= this.state.round) return;
    list.push({ dist: 0, style: 0, points: 0, fall: false, takeoff: null, kmh: 0, dns: true });
  }

  protected startRun() {
    const s = this.state;
    s.sub = 'countdown';
    this.deadline = Date.now() + GATE;
    this.resetJumper();
    this.timers.later(GATE, () => {
      if (s.sub !== 'countdown') return;
      this.deadline = 0;
      s.sub = 'inrun';
      this.ctx.onChange();
    });
  }

  private resetJumper() {
    const s = this.state;
    s.px = SKI.START_X;
    s.py = hillY(SKI.START_X);
    s.vx = s.vy = 0;
    s.ang = -hillSlope(SKI.START_X);
    s.kmh = 0;
    s.q = 0;
    s.takeoff = null;
    s.dist = 0;
    this.v = 0;
    this.qs = 0.5;
    this.qFlightSum = 0;
    this.qFlightN = 0;
    this.qRecent = [];
    this.takeoffAt = null;
    this.airTime = 0;
    this.jumped = false;
    this.runT = 0;
  }

  protected step(dt: number) {
    const s = this.state;
    const b = this.feed.sample ?? { w: 0, x: 0, y: 0 };
    if (s.sub === 'inrun') this.stepInrun(dt, b.x, b.y);
    else if (s.sub === 'flight') this.stepFlight(dt, b.x, b.y);
  }

  private stepInrun(dt: number, bx: number, by: number) {
    const s = this.state;
    this.runT += dt;
    this.qs += (inrunQuality(bx, by) - this.qs) * Math.min(1, dt * 3);
    s.q = Math.round(this.qs * 100) / 100;
    const slope = hillSlope(s.px);
    this.v = Math.max(0, this.v + inrunAccel(this.v, slope, this.qs) * dt);
    const dx = this.v * Math.cos(slope) * dt;
    const progress = (s.px - SKI.START_X) / -SKI.START_X;
    // Hochdrücken ab gut der Hälfte des Anlaufs zählt als Absprung (wer zu früh drückt, verschenkt ihn)
    if (progress >= SKI.ARM_AT && this.feed.spike() && this.takeoffAt === null) {
      const toEdge = (0 - s.px) / Math.max(1, this.v * Math.cos(slope));
      this.takeoffAt = -toEdge;
    } else if (progress < SKI.ARM_AT) this.feed.spike();
    s.px += dx;
    s.kmh = Math.round(this.v * 3.6 * 10) / 10;
    if (s.px >= 0) {
      s.px = 0;
      s.py = 0;
      s.vx = this.v * Math.cos(TABLE_ANGLE);
      s.vy = -this.v * Math.sin(TABLE_ANGLE);
      s.sub = 'flight';
      this.qs = Math.max(0.35, this.qs);
      if (this.takeoffAt !== null) this.applyTakeoff(this.takeoffAt);
      return;
    }
    s.py = hillY(s.px);
    s.ang = -slope;
  }

  private applyTakeoff(t: number) {
    const s = this.state;
    if (this.jumped) return;
    this.jumped = true;
    s.takeoff = Math.round(t * 100) / 100;
    const tq = takeoffQuality(t);
    const v = Math.hypot(s.vx, s.vy) || 1;
    // Impuls senkrecht zur Bahn (nach oben)
    const [vx, vy] = [s.vx, s.vy];
    s.vx = vx + (-vy / v) * JUMP_V * tq;
    s.vy = vy + (vx / v) * JUMP_V * tq;
  }

  private stepFlight(dt: number, bx: number, by: number) {
    const s = this.state;
    this.airTime += dt;
    // Zu spät gedrückt: zählt noch, solange das Fenster offen ist
    if (!this.jumped && this.airTime <= SKI.TAKEOFF_WINDOW_S && this.feed.spike()) this.applyTakeoff(this.airTime);
    const qf = flightQuality(bx, by);
    // Direkt nach dem Absprung reagiert die Haltung träger (man kommt erst in die Flugposition)
    this.qs += (qf - this.qs) * Math.min(1, dt * (this.airTime < 0.4 ? 1.5 : 3.5));
    s.q = Math.round(this.qs * 100) / 100;
    this.qFlightSum += this.qs;
    this.qFlightN++;
    this.qRecent.push(qf);
    if (this.qRecent.length > Math.round(0.5 / (SKI.TICK_MS / 1000))) this.qRecent.shift();
    // Ein paar kleine Unterschritte für eine ruhige Bahn
    const n = 3;
    for (let i = 0; i < n; i++) {
      const h = dt / n;
      const [ax, ay] = flightAccel(s.vx, s.vy, this.qs);
      s.vx += ax * h;
      s.vy += ay * h;
      s.px += s.vx * h;
      s.py += s.vy * h;
      if (s.px > 1 && s.py <= hillY(s.px)) return this.land();
    }
    s.ang = Math.atan2(s.vy, s.vx) * 0.6 + (this.qs - 0.5) * 0.3;
    s.kmh = Math.round(Math.hypot(s.vx, s.vy) * 3.6 * 10) / 10;
    s.dist = Math.round(hillDist(s.px) * 2) / 2;
    if (this.airTime > 10) this.land();
  }

  private land() {
    const s = this.state;
    const id = s.active!;
    s.py = hillY(s.px);
    const dist = Math.round(hillDist(s.px) * 2) / 2;
    const qLand = this.qRecent.length ? this.qRecent.reduce((a, b) => a + b, 0) / this.qRecent.length : 0;
    const qFlight = this.qFlightN ? this.qFlightSum / this.qFlightN : 0;
    const tq = takeoffQuality(s.takeoff);
    // Sturz: in der letzten halben Sekunde gewackelt – oder weit über die Hill Size hinaus und nicht sauber
    const fall = qLand < 0.2 || (dist > SKI.HS + 6 && qLand < 0.5);
    const style = styleNote(qFlight, qLand, tq, fall);
    const points = Math.round((distPoints(dist) + style) * 10) / 10;
    const jump: SkiJump = { dist, style, points, fall, takeoff: s.takeoff, kmh: Math.round(this.v * 3.6 * 10) / 10 };
    this.state.jumps[id].push(jump);
    s.points[id] = Math.round((s.points[id] + points) * 10) / 10;
    s.last = { ...jump, id };
    s.dist = dist;
    if (!fall && (!s.best || dist > s.best.dist)) s.best = { id, dist };
    s.sub = 'landed';
    s.vx = s.vy = 0;
    this.ctx.log?.('skisprung', { p: id, n: Math.round(dist) });
    this.endRun(SKI.LANDED_MS);
  }

  protected roundDone() {
    const s = this.state;
    if (s.round < s.rounds) {
      s.round += 1;
      // Zweiter Durchgang wie im Weltcup: die Schwächsten zuerst, der Führende springt zuletzt
      const order = [...this.ids].sort((a, b) => s.points[a] - s.points[b]);
      return this.beginRound(order);
    }
    s.sub = 'over';
    this.ctx.onChange();
    this.timers.later(1500, () => {
      const best = (id: string) => Math.max(0, ...s.jumps[id].map((j) => j.dist));
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => s.points[id]),
        details: Object.fromEntries(this.ids.map((id) => [id, `${s.points[id].toFixed(1)} P · ${best(id).toFixed(1)} m`])),
        subtitle: s.best ? `Schanzenrekord: ${this.ctx.nameOf(s.best.id)} mit ${s.best.dist.toFixed(1)} m` : 'Ski heil!',
      });
    });
  }
}
