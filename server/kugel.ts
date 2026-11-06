import type { MiniSnapshot } from '../shared/types';
import { KUG, type KugelCourse, type KugelRun, type KugelState, cellX, cellY, distToPath, kugelAccel, kugelCourse, kugelHeading, routeHeading, routePoint } from '../shared/kugel';
import { BalanceTurnGame } from './balance';
import { type MiniCtx, groupByScore, shuffle } from './minigame';

/**
 * Tempel-Kugel: einer nach dem anderen balanciert eine Kugel über einen schmalen Steinpfad über dem Abgrund.
 * Gelehnt wird wie auf einem Kipp-Labyrinth; wer vom Pfad rollt, fällt und startet am letzten Kontrollpunkt neu.
 */
const GATE = KUG.GATE_MS;

export class KugelGame extends BalanceTurnGame<KugelState> {
  readonly kind = 'kugel' as const;
  protected state: KugelState;
  private course: KugelCourse;
  /** Dauer der laufenden Fall-Animation (ms), 0 = keine */
  private fallMs = 0;
  /** Weiteste erreichte Stelle auf dem Lösungsweg */
  private progIdx = 0;

  constructor(ids: string[], ctx: MiniCtx) {
    super(ids, ctx, KUG.TICK_MS);
    const seed = Math.floor(Math.random() * 1e9);
    this.course = kugelCourse(seed);
    const points: Record<string, number> = {};
    for (const id of ids) points[id] = 0;
    this.state = {
      sub: 'ready', t: Date.now(), seed,
      order: [], active: null, board: false, bal: null, calib: 0, endsIn: 0,
      x: cellX(this.course.start.c), y: cellY(this.course.start.r), vx: 0, vy: 0, ang: routeHeading(this.course, 0), ft: 0, fall: 0, falls: 0, cp: 0,
      runs: {}, points, last: null,
    };
    this.start();
    this.beginRound(shuffle(ids));
  }

  snapshot(): MiniSnapshot {
    this.state.t = Date.now();
    return { kind: 'kugel', state: this.state };
  }

  protected dns(id: string) {
    if (this.state.runs[id]) return;
    this.state.runs[id] = { time: KUG.MAX_S, falls: 0, score: KUG.MAX_S + 60, prog: 0, finished: false, dns: true };
    this.updatePoints();
  }

  protected startRun() {
    const s = this.state;
    s.sub = 'countdown';
    this.deadline = Date.now() + GATE;
    this.respawn(0);
    s.ft = 0;
    s.falls = 0;
    s.cp = 0;
    this.fallMs = 0;
    this.progIdx = 0;
    this.timers.later(GATE, () => {
      if (s.sub !== 'countdown') return;
      this.deadline = 0;
      s.sub = 'roll';
      this.ctx.onChange();
    });
  }

  private respawn(cp: number) {
    const s = this.state;
    const p = cp === 0 ? { x: cellX(this.course.start.c), y: cellY(this.course.start.r) } : routePoint(this.course, this.course.checkpoints[cp - 1]);
    s.x = p.x;
    s.y = p.y;
    s.vx = s.vy = 0;
    s.ang = routeHeading(this.course, cp === 0 ? 0 : this.course.checkpoints[cp - 1]);
    s.fall = 0;
    this.fallMs = 0;
  }

  protected step(dt: number) {
    const s = this.state;
    if (s.sub !== 'roll') return;
    s.ft += dt;
    const b = this.feed.sample ?? { w: 0, x: 0, y: 0 };

    if (this.fallMs > 0) {
      // Die Kugel trudelt noch ein Stück weiter in den Abgrund
      this.fallMs += dt * 1000;
      s.vx *= 1 - dt * 2;
      s.vy *= 1 - dt * 2;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.fall = Math.min(1, this.fallMs / KUG.FALL_MS);
      if (this.fallMs >= KUG.FALL_MS) this.respawn(s.cp);
      this.round();
      return;
    }

    const [ax, ay] = kugelAccel(b.x, b.y, s.ang);
    s.vx = (s.vx + ax * dt) * Math.exp(-KUG.DAMP * dt);
    s.vy = (s.vy + ay * dt) * Math.exp(-KUG.DAMP * dt);
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > KUG.VMAX) {
      s.vx *= KUG.VMAX / sp;
      s.vy *= KUG.VMAX / sp;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.ang = kugelHeading(s.ang, s.vx, s.vy, dt);

    if (distToPath(this.course, s.x, s.y) > KUG.R) {
      s.falls += 1;
      this.fallMs = 1;
      s.fall = 0.01;
      this.ctx.log?.('kugel', { p: s.active!, n: 1 });
      this.round();
      return;
    }
    // Kontrollpunkte (der Reihe nach) und Fortschritt
    const cps = this.course.checkpoints;
    if (s.cp < cps.length) {
      const p = routePoint(this.course, cps[s.cp]);
      if (Math.hypot(p.x - s.x, p.y - s.y) < KUG.CP_R) s.cp += 1;
    }
    this.course.route.forEach((cell, i) => {
      if (i > this.progIdx && Math.hypot(cellX(cell.c) - s.x, cellY(cell.r) - s.y) < KUG.CP_R) this.progIdx = i;
    });
    const g = this.course.goal;
    if (Math.hypot(cellX(g.c) - s.x, cellY(g.r) - s.y) < KUG.GOAL_R) return this.finishRun(true);
    if (s.ft >= KUG.MAX_S) this.finishRun(false);
    this.round();
  }

  private round() {
    const s = this.state;
    s.x = Math.round(s.x * 10) / 10;
    s.y = Math.round(s.y * 10) / 10;
    s.vx = Math.round(s.vx * 10) / 10;
    s.vy = Math.round(s.vy * 10) / 10;
    s.fall = Math.round(s.fall * 100) / 100;
    s.ang = Math.round(s.ang * 1000) / 1000;
  }

  private finishRun(finished: boolean) {
    const s = this.state;
    const id = s.active!;
    const prog = finished ? 1 : this.progIdx / Math.max(1, this.course.route.length - 1);
    const pen = s.falls * KUG.FALL_PEN_S;
    const time = finished ? s.ft : KUG.MAX_S;
    const run: KugelRun = {
      time: Math.round(time * 100) / 100,
      falls: s.falls,
      prog: Math.round(prog * 100) / 100,
      score: Math.round((time + pen + (finished ? 0 : (1 - prog) * 40)) * 100) / 100,
      finished,
    };
    s.runs[id] = run;
    s.last = { ...run, id };
    s.sub = 'done';
    s.fall = 0;
    this.fallMs = 0;
    this.updatePoints();
    this.endRun(KUG.DONE_MS);
  }

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
            if (!r || r.dns) return [id, 'nicht gerollt'];
            return [id, `${r.score.toFixed(1)} s${r.falls ? ` · ${r.falls}× abgestürzt` : ''}${r.finished ? '' : ' · nicht im Ziel'}`];
          }),
        ),
        subtitle: 'Ruhig bleiben – der Abgrund wartet nicht.',
      });
    });
  }
}
