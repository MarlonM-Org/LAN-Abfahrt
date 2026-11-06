import type { MiniSnapshot } from '../shared/types';
import { BIRD_R, TEP, type TepCourse, type TepRun, type TepState, birdX, birdY, tepCourse } from '../shared/teppich';
import { BalanceTurnGame } from './balance';
import { type MiniCtx, groupByScore, shuffle } from './minigame';

/**
 * Teppich-Parcours: einer nach dem anderen fliegt auf dem Balance Board durch dieselbe Strecke.
 * Vorne/hinten lehnen = sinken/steigen, rechts/links = schneller/langsamer. Treffer bremsen (benommen),
 * Juwelen ziehen je 1 s von der Zeit ab. Bestzeit gewinnt.
 */
const GATE = TEP.GATE_MS;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class TeppichGame extends BalanceTurnGame<TepState> {
  readonly kind = 'teppich' as const;
  protected state: TepState;
  private course: TepCourse;

  constructor(ids: string[], ctx: MiniCtx) {
    super(ids, ctx, TEP.TICK_MS);
    const seed = Math.floor(Math.random() * 1e9);
    this.course = tepCourse(seed);
    const points: Record<string, number> = {};
    for (const id of ids) points[id] = 0;
    this.state = {
      sub: 'ready', t: Date.now(), seed,
      order: [], active: null, board: false, bal: null, calib: 0, endsIn: 0,
      x: TEP.START_X, y: TEP.START_Y, vy: 0, speed: 0, ft: 0, stunMs: 0, safeMs: 0, got: [], hits: 0,
      runs: {}, points, last: null,
    };
    this.start();
    this.beginRound(shuffle(ids));
  }

  snapshot(): MiniSnapshot {
    this.state.t = Date.now();
    return { kind: 'teppich', state: this.state };
  }

  protected dns(id: string) {
    if (this.state.runs[id]) return;
    this.state.runs[id] = { time: TEP.MAX_S, gems: 0, hits: 0, score: TEP.MAX_S + 30, finished: false, dns: true };
    this.updatePoints();
  }

  protected startRun() {
    const s = this.state;
    s.sub = 'countdown';
    this.deadline = Date.now() + GATE;
    s.x = TEP.START_X;
    s.y = TEP.START_Y;
    s.vy = 0;
    s.speed = 0;
    s.ft = 0;
    s.stunMs = s.safeMs = 0;
    s.got = [];
    s.hits = 0;
    this.timers.later(GATE, () => {
      if (s.sub !== 'countdown') return;
      this.deadline = 0;
      s.sub = 'fly';
      s.speed = TEP.SPEED * 0.6;
      this.ctx.onChange();
    });
  }

  protected step(dt: number) {
    const s = this.state;
    if (s.sub !== 'fly') return;
    const b = this.feed.sample ?? { w: 0, x: 0, y: 0 };
    s.ft += dt;
    const ms = s.ft * 1000;
    const stunned = ms < s.stunMs;
    // Kleine Totzone, damit ruhiges Stehen auch ruhig fliegt
    const dz = (v: number) => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
    const lx = dz(b.x);
    const ly = dz(b.y);
    const targetVy = stunned ? 30 : ly * TEP.CLIMB;
    s.vy += (targetVy - s.vy) * Math.min(1, dt * 5);
    const targetSpeed = stunned ? 30 : TEP.SPEED + lx * TEP.SPEED_LEAN;
    s.speed += (targetSpeed - s.speed) * Math.min(1, dt * (stunned ? 8 : 2.2));
    s.x += s.speed * dt;
    s.y = clamp(s.y + s.vy * dt, TEP.CEIL_Y + TEP.HH, TEP.GROUND_Y - TEP.HH);
    // Über den Sand schleifen bremst
    if (s.y >= TEP.GROUND_Y - TEP.HH - 0.5) s.speed *= 1 - dt * 1.5;
    s.x = Math.round(s.x * 10) / 10;
    s.y = Math.round(s.y * 10) / 10;

    // Juwelen
    this.course.gems.forEach((g, i) => {
      if (s.got.includes(i)) return;
      if (Math.abs(g.x - s.x) < TEP.HW + TEP.GEM_R * 0.6 && Math.abs(g.y - s.y) < TEP.HH + TEP.GEM_R) s.got.push(i);
    });
    // Hindernisse
    if (ms >= s.safeMs && this.hitsObstacle(s.x, s.y, s.ft)) {
      s.hits += 1;
      s.stunMs = ms + TEP.STUN_MS;
      s.safeMs = ms + TEP.SAFE_MS;
      s.speed = 25;
      s.vy = 0;
    }
    if (s.x >= TEP.LEN) return this.finishRun(true);
    if (s.ft >= TEP.MAX_S) this.finishRun(false);
  }

  private hitsObstacle(x: number, y: number, t: number) {
    const l = x - TEP.HW;
    const r = x + TEP.HW;
    const top = y - TEP.HH;
    const bot = y + TEP.HH;
    for (const o of this.course.obstacles) {
      if (o.k === 'bird') {
        const bx = birdX(o, t);
        const by = birdY(o, t);
        const cx = clamp(bx, l, r);
        const cy = clamp(by, top, bot);
        if (Math.hypot(bx - cx, by - cy) < BIRD_R) return true;
        continue;
      }
      if (r < o.x || l > o.x + o.w) continue;
      if (o.k === 'tower' && bot > o.top) return true;
      if (o.k === 'cloud' && top < o.bottom) return true;
    }
    return false;
  }

  private finishRun(finished: boolean) {
    const s = this.state;
    const id = s.active!;
    // Nicht angekommen: Strafzeit nach Reststrecke
    const time = finished ? s.ft : TEP.MAX_S + ((TEP.LEN - s.x) / TEP.SPEED) * 1.5;
    const run: TepRun = {
      time: Math.round(time * 100) / 100,
      gems: s.got.length,
      hits: s.hits,
      score: Math.round((time - s.got.length * TEP.GEM_BONUS) * 100) / 100,
      finished,
    };
    s.runs[id] = run;
    s.last = { ...run, id };
    s.sub = 'done';
    this.updatePoints();
    this.ctx.log?.('teppich', { p: id, n: s.got.length });
    this.endRun(TEP.DONE_MS);
  }

  /** Zuschauer-Leiste: Platz-Punkte (Bester = meiste Punkte) */
  private updatePoints() {
    const s = this.state;
    const done = Object.keys(s.runs).sort((a, b) => s.runs[a].score - s.runs[b].score);
    for (const id of this.ids) s.points[id] = 0;
    done.forEach((id, i) => (s.points[id] = done.length - i));
  }

  protected roundDone() {
    const s = this.state;
    s.sub = 'over';
    this.ctx.onChange();
    this.timers.later(1500, () => {
      const score = (id: string) => -(s.runs[id]?.score ?? 999);
      this.ctx.finish({
        groups: groupByScore(this.ids, score),
        details: Object.fromEntries(
          this.ids.map((id) => {
            const r = s.runs[id];
            return [id, !r || r.dns ? 'nicht geflogen' : `${r.score.toFixed(2)} s · ${r.gems} 💎${r.finished ? '' : ' · nicht im Ziel'}`];
          }),
        ),
        subtitle: 'Wer die Juwelen holt und die Geier meidet, landet vorn.',
      });
    });
  }
}
