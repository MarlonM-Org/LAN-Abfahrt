import type { MiniSnapshot, Team, VolleyPlayer, VolleyState } from '../shared/types';
import { TEAM_INFO, otherTeam } from '../shared/flunky';
import { VOLLEY as V, type VollBall, vollDir, vollSide, vollSpot, vollStepBall, vollWon } from '../shared/volley';
import { type MiniCtx, type MiniGame, Timers, asRecord, shuffle } from './minigame';

interface P extends VolleyPlayer {
  /** Gehaltene Richtung vom Handy */
  inDir: number;
  /** Zeitpunkt des letzten SPRUNG-Drucks (wird bis zur Landung gemerkt) */
  jumpAt: number;
  spikeUntil: number;
  readyAt: number;
  lastTouchAt: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Strand-Volleyball (à la Slime Volleyball): Seitenansicht, Netz in der Mitte,
 * Team Sonne (links) gegen Team Meer (rechts). Laufen, springen, schmettern –
 * der Ball prallt von den Spielern ab. Berührt er den Sand, punktet die andere Seite.
 * Pro Team stehen höchstens 3 (bzw. so viele wie das kleinere Team hat) im Feld,
 * nach jedem Punkt wird durchrotiert. Bis 7 mit 2 Vorsprung (max. 11) oder 4 Minuten.
 */
export class VolleyGame implements MiniGame {
  readonly kind = 'volley' as const;
  private players = new Map<string, P>();
  /** Rotations-Reihenfolge je Team: die ersten k stehen im Feld, [0] schlägt auf */
  private queue: Record<Team, string[]> = { A: [], B: [] };
  private ball: VollBall = { x: V.NET_X, y: 120, vx: 0, vy: 0 };
  private sub: VolleyState['sub'] = 'intro';
  private deadline = 0;
  private matchStart = 0;
  private score: Record<Team, number> = { A: 0, B: 0 };
  private serving: Team = Math.random() < 0.5 ? 'A' : 'B';
  private server: string | null = null;
  private golden = false;
  private hitSeq = 0;
  private lastHit: VolleyState['lastHit'] = null;
  private pointSeq = 0;
  private lastPoint: VolleyState['lastPoint'] = null;
  private winner: Team | null = null;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    shuffle(ids).forEach((id, i) => {
      const team: Team = i % 2 === 0 ? 'A' : 'B';
      this.queue[team].push(id);
      this.players.set(id, {
        team, court: false, x: vollSpot(team, 0), y: V.GROUND, vx: 0, vy: 0, air: false, spike: false, cd: 0, dir: 0, touches: 0, spikes: 0,
        inDir: 0, jumpAt: 0, spikeUntil: 0, readyAt: 0, lastTouchAt: 0,
      });
    });
    this.placeTeams();
    this.ball = { x: V.NET_X, y: 110, vx: 0, vy: 0 };
    this.deadline = Date.now() + V.INTRO_MS;
    let last = Date.now();
    this.timers.every(V.TICK_MS, () => {
      const now = Date.now();
      this.tick(now, Math.min(0.1, (now - last) / 1000));
      last = now;
    });
    this.timers.later(V.INTRO_MS, () => {
      this.matchStart = Date.now();
      this.startServe();
    });
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Ablauf

  private live(t: Team) {
    return this.queue[t].filter((id) => this.ctx.isConnected(id));
  }

  /** Feldspieler pro Seite: höchstens 3, nie mehr als das kleinere Team hat */
  private courtSize() {
    return Math.max(1, Math.min(V.COURT_MAX, this.live('A').length, this.live('B').length));
  }

  /** Feldspieler auf ihre Startplätze, Bank-Spieler raus */
  private placeTeams() {
    const k = this.courtSize();
    for (const t of ['A', 'B'] as Team[]) {
      const live = this.live(t);
      for (const id of this.queue[t]) {
        const p = this.players.get(id)!;
        const i = live.indexOf(id);
        p.court = i >= 0 && i < k;
        p.x = vollSpot(t, p.court ? i : 0);
        p.y = V.GROUND;
        p.vx = p.vy = 0;
        p.air = false;
        p.spike = false;
        p.spikeUntil = 0;
        p.jumpAt = 0;
      }
    }
  }

  private startServe() {
    if (this.sub === 'over') return;
    this.placeTeams();
    const live = this.live(this.serving);
    this.server = live[0] ?? null;
    const sx = this.server ? this.players.get(this.server)!.x : vollSpot(this.serving, 0);
    this.ball = { x: sx + vollDir(this.serving) * 3, y: V.GROUND - 82, vx: 0, vy: 0 };
    this.lastHit = null;
    this.sub = 'serve';
    this.deadline = Date.now() + V.SERVE_MS;
    this.ctx.onChange();
  }

  private clockLeft(now: number) {
    if (!this.matchStart) return V.MATCH_MS;
    return Math.max(0, V.MATCH_MS - (now - this.matchStart));
  }

  private scorePoint(team: Team, now: number) {
    this.score[team] += 1;
    this.pointSeq += 1;
    this.lastPoint = { team, x: r1(this.ball.x) };
    this.sub = 'point';
    this.deadline = now + V.POINT_MS;
    // Wer den Punkt verloren hat, schlägt auf
    this.serving = otherTeam(team);
    const timeUp = this.clockLeft(now) <= 0;
    const a = this.score.A;
    const b = this.score.B;
    let done = vollWon(a, b) || this.golden;
    if (!done && timeUp) {
      if (a !== b) done = true;
      else this.golden = true;
    }
    this.ctx.onChange();
    this.timers.later(V.POINT_MS, () => {
      if (done) return this.end(a > b ? 'A' : b > a ? 'B' : null);
      // Durchrotieren: wer gerade aufgeschlagen hat bzw. vorne stand, geht ans Ende
      for (const t of ['A', 'B'] as Team[]) {
        const q = this.queue[t];
        if (q.length > 1) q.push(q.shift()!);
      }
      this.startServe();
    });
  }

  private end(winner: Team | null) {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.winner = winner;
    this.timers.clear();
    for (const p of this.players.values()) p.spike = false;
    this.ctx.onChange();
    const groups = winner ? [this.queue[winner], this.queue[otherTeam(winner)]].filter((g) => g.length) : [this.ids];
    const a = this.score.A;
    const b = this.score.B;
    this.timers.later(V.END_MS, () =>
      this.ctx.finish({
        groups,
        details: Object.fromEntries(
          this.ids.map((id) => {
            const n = this.players.get(id)!.touches;
            return [id, `${n} ${n === 1 ? 'Ballkontakt' : 'Ballkontakte'}`];
          }),
        ),
        subtitle: winner ? `${TEAM_INFO[winner].name} gewinnt ${Math.max(a, b)}:${Math.min(a, b)}!` : 'Unentschieden – alle ab in den Schatten!',
      }),
    );
  }

  // ---------------------------------------------------------------- Physik

  private tick(now: number, dt: number) {
    if (this.sub === 'over') return;
    for (const p of this.players.values()) {
      p.cd = Math.max(0, p.readyAt - now);
      p.spike = now < p.spikeUntil;
    }
    if (this.sub === 'intro') return this.ctx.onChange();

    const court = [...this.players.entries()].filter(([, p]) => p.court);
    const h = dt / V.SUBSTEPS;
    for (let s = 0; s < V.SUBSTEPS; s++) {
      for (const [, p] of court) this.movePlayer(p, now, h);
      if (this.sub === 'serve') {
        // Ball schwebt – wer schon reinspringt, schlägt sofort auf
        for (const e of court) if (this.contact(e, now)) this.sub = 'rally';
        continue;
      }
      if (this.sub === 'rally') {
        vollStepBall(this.ball, h);
        for (const e of court) this.contact(e, now);
        this.limitBall();
        if (this.ball.y + V.BALL_R >= V.GROUND) {
          this.ball.y = V.GROUND - V.BALL_R;
          this.ball.vy = -Math.abs(this.ball.vy) * 0.35;
          this.ball.vx *= 0.5;
          this.scorePoint(this.ball.x < V.NET_X ? 'B' : 'A', now);
        }
      } else if (this.sub === 'point') {
        // Ball hüpft im Sand aus
        vollStepBall(this.ball, h);
        if (this.ball.y + V.BALL_R >= V.GROUND) {
          this.ball.y = V.GROUND - V.BALL_R;
          this.ball.vy = Math.abs(this.ball.vy) < 30 ? 0 : -Math.abs(this.ball.vy) * 0.35;
          this.ball.vx *= 0.6;
        }
      }
    }
    if (this.sub === 'serve' && now >= this.deadline) {
      this.sub = 'rally';
      this.ball.vy = -40;
    }
    this.ctx.onChange();
  }

  private movePlayer(p: P, now: number, dt: number) {
    p.vx = p.inDir * V.RUN;
    if (p.inDir) p.dir = p.inDir;
    if (!p.air && p.jumpAt && now - p.jumpAt <= V.JUMP_BUFFER_MS) {
      p.vy = -V.JUMP_V;
      p.air = true;
      p.jumpAt = 0;
    }
    if (p.air) p.vy += V.P_G * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.y >= V.GROUND) {
      p.y = V.GROUND;
      p.vy = 0;
      p.air = false;
    }
    const [lo, hi] = vollSide(p.team);
    p.x = clamp(p.x, lo, hi);
  }

  /** Ball gegen Spieler-Kreis; true bei Kontakt */
  private contact([id, p]: [string, P], now: number): boolean {
    const b = this.ball;
    const cx = p.x;
    const cy = p.y - V.P_BODY;
    const spiking = now < p.spikeUntil;
    const reach = V.P_R + V.BALL_R + (spiking ? V.SPIKE_REACH : 0);
    let dx = b.x - cx;
    let dy = b.y - cy;
    let d = Math.hypot(dx, dy);
    if (d >= reach) return false;
    if (d < 0.001) {
      dx = 0;
      dy = -1;
      d = 1;
    }
    const nx = dx / d;
    const ny = dy / d;
    b.x = cx + nx * reach;
    b.y = cy + ny * reach;
    // Nicht unter den Sand drücken
    if (b.y > V.GROUND - V.BALL_R) b.y = V.GROUND - V.BALL_R;

    const dir = vollDir(p.team);
    const ownSide = dir * (V.NET_X - b.x) > 0;
    let spiked = false;
    if (spiking && p.air && ownSide && b.y < V.NET_TOP - 2) {
      // Schmettern: steil runter ins gegnerische Feld, knapp über die Netzkante gezielt
      const dist = Math.max(8, Math.abs(V.NET_X - b.x));
      const slope = clamp((V.NET_TOP - 12 - b.y) / dist, 0.25, 1.2);
      const l = Math.hypot(1, slope);
      b.vx = (dir / l) * V.SPIKE_SPEED;
      b.vy = (slope / l) * V.SPIKE_SPEED;
      p.spikeUntil = 0;
      p.spike = false;
      p.spikes += 1;
      spiked = true;
    } else {
      const rvx = b.vx - p.vx;
      const rvy = b.vy - p.vy;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        b.vx = p.vx + rvx - (1 + V.HIT_E) * vn * nx;
        b.vy = p.vy + rvy - (1 + V.HIT_E) * vn * ny;
      }
      b.vx += nx * V.HIT_BOOST * (vn < 0 ? 1 : 0.2);
      b.vy += ny * V.HIT_BOOST * (vn < 0 ? 1 : 0.2);
      const out = b.vx * nx + b.vy * ny;
      if (out < V.HIT_MIN) {
        b.vx += nx * (V.HIT_MIN - out);
        b.vy += ny * (V.HIT_MIN - out);
      }
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > V.BALL_MAX) {
        b.vx *= V.BALL_MAX / sp;
        b.vy *= V.BALL_MAX / sp;
      }
      // Nicht zu steil nach oben – sonst verschwindet der Ball dauernd über dem Bildrand
      if (b.vy < -V.BALL_UP_MAX) b.vy = -V.BALL_UP_MAX;
    }
    if (spiked || now - p.lastTouchAt > V.TOUCH_GAP_MS) {
      p.touches += 1;
      this.hitSeq += 1;
      this.lastHit = { id, spike: spiked };
    }
    p.lastTouchAt = now;
    return true;
  }

  /** Normale Bälle nie schneller als BALL_MAX (Schmetterbälle dürfen kurz mehr) */
  private limitBall() {
    const b = this.ball;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > V.SPIKE_SPEED) {
      b.vx *= V.SPIKE_SPEED / sp;
      b.vy *= V.SPIKE_SPEED / sp;
    }
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p || this.sub === 'over') return;
    const now = Date.now();
    if (action === 'move') {
      const d = Number(asRecord(payload).dir) || 0;
      p.inDir = d > 0.3 ? 1 : d < -0.3 ? -1 : 0;
    } else if (action === 'jump') {
      if (p.court && this.sub !== 'intro') p.jumpAt = now;
    } else if (action === 'spike') {
      if (!p.court || this.sub === 'intro' || now < p.readyAt) return;
      const airborne = p.air || (p.jumpAt && now - p.jumpAt <= V.JUMP_BUFFER_MS);
      if (!airborne) return;
      p.spikeUntil = now + V.SPIKE_WINDOW_MS;
      p.readyAt = now + V.SPIKE_CD_MS;
      p.spike = true;
      this.ctx.onChange();
    }
  }

  playerDisconnected(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.inDir = 0;
    p.jumpAt = 0;
    if (this.sub === 'over') return;
    const t = p.team;
    if (!this.live(t).length) {
      // Ein Team ist komplett weg – die anderen gewinnen
      this.end(this.live(otherTeam(t)).length ? otherTeam(t) : null);
    }
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const b = this.ball;
    return {
      kind: 'volley',
      state: {
        sub: this.sub,
        t: now,
        endsIn: Math.max(0, this.deadline - now),
        clock: Math.round(this.clockLeft(now)),
        score: { ...this.score },
        target: V.TARGET,
        cap: V.CAP,
        serving: this.serving,
        server: this.server,
        golden: this.golden,
        ball: { x: r1(b.x), y: r1(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy) },
        players: Object.fromEntries(
          [...this.players.entries()].map(([id, p]) => [
            id,
            {
              team: p.team, court: p.court, x: r1(p.x), y: r1(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy), air: p.air,
              spike: p.spike, cd: Math.round(p.cd), dir: p.dir, touches: p.touches, spikes: p.spikes,
            },
          ]),
        ),
        hitSeq: this.hitSeq,
        lastHit: this.lastHit,
        pointSeq: this.pointSeq,
        lastPoint: this.lastPoint,
        winner: this.winner,
      },
    };
  }

  dispose() {
    this.timers.clear();
  }
}
