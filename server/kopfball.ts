import type { MiniSnapshot, Team } from '../shared/types';
import {
  KB,
  type KbBall,
  type KbField,
  type KbGoal,
  type KbKind,
  type KbMode,
  type KbPlayer,
  type KbState,
  type KbTouch,
  kbCircleRect,
  kbDir,
  kbField,
  kbHoldSpot,
  kbMode,
  kbSpot,
  kbStepBall,
  kbThrowVelocity,
  kbXRange,
} from '../shared/kopfball';
import { TEAM_INFO } from '../shared/flunky';
import { teamHandicap } from '../shared/games';
import { type MiniCtx, type MiniGame, OFFLINE_OUT_MS, Timers, asRecord, splitTeams } from './minigame';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const other = (t: Team): Team => (t === 'A' ? 'B' : 'A');
/** Zum Testen kürzer: KB_MATCH_MS=40000 npm run dev */
const MATCH_MS = Number(process.env.KB_MATCH_MS) || KB.MATCH_MS;

/** Eingaben als Zustand: Stick (−1…1) und gehaltene Knöpfe */
interface Inp {
  x: number;
  y: number;
  jump: boolean;
  kick: boolean;
}
const NO_INP = (): Inp => ({ x: 0, y: 0, jump: false, kick: false });

interface P extends KbPlayer {
  id: string;
  slot: number;
  inp: Inp;
  /** Zeitpunkt des letzten Sprung-Drucks (wird bis kurz vor der Landung gemerkt) */
  jumpAt: number;
  kickAt: number;
  readyAt: number;
  /** Dieser Schuss hat den Ball schon getroffen */
  kicked: boolean;
  /** Kontakt im letzten Teilschritt (Kontakte zählen nur am Anfang einer Berührung) */
  touching: boolean;
  lastTouchAt: number;
}

/**
 * Kopfball-Duell (à la Head Soccer) und Kopf-Korb (à la Head Basketball) – eine Engine, zwei Spiele.
 * Seitenansicht, Figuren mit Riesenköpfen. Team Sonne (links) gegen Team Meer (rechts), alle gleichzeitig im Feld.
 * Laufen (Stick), springen (SPRUNG oder Stick hoch), SCHUSS: Fuß raus (Fußball) bzw. Wurf im Bogen zum Korb.
 * Anstoß bzw. Einwurf: am Anfang per Los, nach jedem Tor/Korb das Team, das kassiert hat – der Ball schwebt in
 * seiner Hälfte, bis ihn jemand berührt, die Gegner bleiben so lange drüben.
 * 2 Minuten oder bis 5 Tore / 15 Punkte; bei Gleichstand Golden Goal (max. 1 Minute), danach Unentschieden.
 * Aufwärmrunde (`ctx.practice`): keine Uhr, kein Spielende – Tore zählen nur zum Spaß.
 */
export class KopfballGame implements MiniGame {
  readonly kind: KbKind;
  private readonly mode: KbMode;
  private readonly field: KbField;
  private players = new Map<string, P>();
  private ball: KbBall;
  private score: Record<Team, number> = { A: 0, B: 0 };
  private sub: KbState['sub'];
  private deadline: number;
  private clock = MATCH_MS;
  private overtime = false;
  private first = true;
  private kick: Team = Math.random() < 0.5 ? 'A' : 'B';
  private hold = false;
  private holdUntil = 0;
  private round = 0;
  private boost: Record<Team, { run: number; jump: number; kick: number }> = { A: { run: 1, jump: 1, kick: 1 }, B: { run: 1, jump: 1, kick: 1 } };
  private goalSeq = 0;
  private lastGoal: KbGoal | null = null;
  private touchSeq = 0;
  private lastTouchFx: KbTouch | null = null;
  private clankSeq = 0;
  private clank: KbState['clank'] = null;
  private lastClankAt = 0;
  /** Letzter Kontakt (Torschütze, Dreier) und letzter Kontakt je Team */
  private lastTouch: { id: string; team: Team; x: number; at: number; how: KbTouch['how']; air: boolean } | null = null;
  private teamTouch: Record<Team, { id: string; at: number } | null> = { A: null, B: null };
  private winner: Team | null = null;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
    kind: KbKind = 'kopfball',
  ) {
    this.kind = kind;
    this.mode = kbMode(kind);
    // Vom Spielbrett vorgegebene Teams (2 gegen 2, 1 gegen 3), sonst die Aufteilung der Aufwärmrunde bzw. zufällig
    const split = splitTeams(ids, ctx.teams ?? ctx.warmTeams);
    this.field = kbField(this.mode, Math.max(split.A.length, split.B.length));
    for (const team of ['A', 'B'] as Team[]) {
      split[team].forEach((id, slot) => {
        this.players.set(id, {
          id, t: team, slot, x: 0, y: KB.GROUND, vx: 0, vy: 0, air: false, ks: 0, cd: 0, g: 0, h: 0,
          inp: NO_INP(), jumpAt: 0, kickAt: 0, readyAt: 0, kicked: true, touching: false, lastTouchAt: 0,
        });
      });
    }
    // Ungleiche Teams: das kleinere ist etwas flinker; auf dem Brett startet es außerdem mit Vorsprung
    if (split.A.length < split.B.length) this.boost.A = { ...KB.UNDERDOG };
    if (split.B.length < split.A.length) this.boost.B = { ...KB.UNDERDOG };
    if (ctx.teams) this.score = teamHandicap(split.A.length, split.B.length);
    this.ball = { ...kbHoldSpot(this.field, this.kick), vx: 0, vy: 0 };
    this.place();
    // Aufwärmrunde: ohne 3-2-1 gleich mit dem schwebenden Ball los
    if (ctx.practice) {
      this.sub = 'kickoff';
      this.deadline = Date.now() + 600;
    } else {
      this.sub = 'countdown';
      this.deadline = Date.now() + KB.COUNTDOWN_MS;
    }
    let last = Date.now();
    this.timers.every(KB.TICK_MS, () => {
      const now = Date.now();
      this.tick(now, Math.min(0.1, (now - last) / 1000));
      last = now;
    });
  }

  // ---------------------------------------------------------------- Ablauf

  /** Alle auf ihre Anstoß-Plätze, Ball schwebt in der Hälfte des Teams mit Anstoß */
  private place() {
    const slots: Record<Team, number> = { A: 0, B: 0 };
    for (const p of this.players.values()) {
      if (p.out) continue;
      p.x = kbSpot(this.field, p.t, slots[p.t]++, p.t === this.kick);
      p.y = KB.GROUND;
      p.vx = p.vy = 0;
      p.air = false;
      p.jumpAt = 0;
      p.kicked = true;
      p.touching = false;
    }
    this.ball = { ...kbHoldSpot(this.field, this.kick), vx: 0, vy: 0 };
    this.lastTouch = null;
    this.teamTouch = { A: null, B: null };
  }

  private kickoff(now: number) {
    this.round++;
    this.place();
    this.sub = 'kickoff';
    this.deadline = now + KB.KICKOFF_MS;
  }

  private startPlay(now: number) {
    this.sub = 'play';
    this.first = false;
    this.hold = true;
    this.holdUntil = now + KB.HOLD_MS;
  }

  private tick(now: number, dt: number) {
    if (this.sub === 'over') return;
    // presence() kann das Spiel beenden (ein Team ganz weg)
    if (this.presence(now)) return;
    if (this.sub === 'countdown' || this.sub === 'kickoff') {
      if (now >= this.deadline) this.startPlay(now);
    } else if (this.sub === 'goal') {
      this.physics(now, dt);
      if (now >= this.deadline) this.afterGoal(now);
    } else {
      if (!this.ctx.practice) this.clock = Math.max(0, this.clock - dt * 1000);
      this.physics(now, dt);
      if (this.sub === 'play' && !this.ctx.practice && this.clock <= 0) this.timeUp(now);
    }
    for (const p of this.players.values()) p.cd = Math.max(0, p.readyAt - now);
    this.ctx.onChange();
  }

  /**
   * Verbindung weg (nach der 3-s-Gnadenfrist des Raums): Figur eingefroren, nach 15 s bzw. sofort, wenn der
   * VIP sie entfernt, raus aus dem Feld. Kommt jemand zurück, steht er wieder vor dem eigenen Tor.
   * Ist ein ganzes Team weg, gewinnt das andere (nicht in der Aufwärmrunde).
   */
  private presence(now: number): boolean {
    for (const p of this.players.values()) {
      const on = this.ctx.isConnected(p.id);
      p.off = !on;
      if (!on) p.inp = NO_INP();
      const gone = !!this.ctx.isGone?.(p.id) || (!on && (this.ctx.offlineMs?.(p.id) ?? 0) >= OFFLINE_OUT_MS);
      if (gone && !p.out) p.out = true;
      else if (p.out && on && !this.ctx.isGone?.(p.id)) {
        p.out = false;
        p.x = kbSpot(this.field, p.t, 1, false);
        p.y = KB.GROUND;
        p.vx = p.vy = 0;
        p.air = false;
      }
    }
    if (this.ctx.practice || this.sub === 'over') return false;
    for (const t of ['A', 'B'] as Team[]) {
      const team = [...this.players.values()].filter((p) => p.t === t);
      if (team.length && team.every((p) => p.out)) {
        const rest = [...this.players.values()].some((p) => p.t !== t && !p.out);
        this.end(rest ? other(t) : null, now);
        return true;
      }
    }
    return false;
  }

  private afterGoal(now: number) {
    const g = this.lastGoal;
    if (!this.ctx.practice) {
      // Golden Goal entschieden, Ziel erreicht oder Zeit schon um → Ende
      if (this.overtime && g) return this.end(g.team, now);
      if (Math.max(this.score.A, this.score.B) >= KB.TARGET[this.mode]) return this.end(this.score.A > this.score.B ? 'A' : 'B', now);
      if (this.clock <= 0) return this.timeUp(now);
    }
    this.kickoff(now);
  }

  private timeUp(now: number) {
    if (this.score.A !== this.score.B) return this.end(this.score.A > this.score.B ? 'A' : 'B', now);
    if (this.overtime) return this.end(null, now);
    this.overtime = true;
    this.clock = KB.OVERTIME_MS;
    // Golden Goal: Anstoß wieder per Los
    this.kick = Math.random() < 0.5 ? 'A' : 'B';
    this.kickoff(now);
    this.deadline = now + KB.KICKOFF_MS + 900;
  }

  private scoreFor(team: Team, now: number, how: { x: number; y: number; hoop?: boolean }) {
    let pts = 1;
    let dunk = false;
    const last = this.lastTouch;
    // Torschütze: letzter Kontakt – war das jemand vom anderen Team, zählt ein eigener Kontakt der letzten Sekunden, sonst Eigentor
    let scorer: string | null = null;
    let own = false;
    if (last && last.team === team) scorer = last.id;
    else {
      const t = this.teamTouch[team];
      if (t && now - t.at < KB.SCORER_MS) scorer = t.id;
      else if (last) {
        scorer = last.id;
        own = true;
      }
    }
    if (this.mode === 'korb') {
      pts = 2;
      // Dreier: geworfen bzw. geköpft von hinter der Mittellinie (aus der eigenen Hälfte)
      const hoop = this.field.hoops[other(team)];
      const hx = (hoop.xb + hoop.xf) / 2;
      if (last && last.team === team && !own && Math.abs(last.x - hx) > this.field.w / 2) pts = 3;
      dunk = !!last && last.team === team && last.how === 'kopf' && last.air && Math.abs(last.x - hx) < 46;
    }
    this.score[team] += pts;
    if (scorer && !own) this.players.get(scorer)!.g += pts;
    if (this.mode === 'fuss' && scorer) this.ctx.log?.(own ? 'owngoal' : 'goal', { p: scorer });
    this.lastGoal = { seq: ++this.goalSeq, team, scorer, own, pts, dunk, x: r1(how.x), y: r1(how.y) };
    // Wer kassiert hat, hat den nächsten Anstoß bzw. Einwurf
    this.kick = other(team);
    this.sub = 'goal';
    this.hold = false;
    this.deadline = now + KB.GOAL_MS;
  }

  // ---------------------------------------------------------------- Physik

  private active(): P[] {
    return [...this.players.values()].filter((p) => !p.out);
  }

  private physics(now: number, dt: number) {
    const N = KB.SUBSTEPS;
    const h = dt / N;
    const list = this.active();
    const b = this.ball;
    for (let s = 0; s < N; s++) {
      for (const p of list) this.movePlayer(p, now, h);
      this.separate(list);
      const prevY = b.y;
      if (!this.hold) {
        const info = kbStepBall(b, this.field, h);
        if (info.clank && now - this.lastClankAt > 120) {
          this.lastClankAt = now;
          this.clank = { seq: ++this.clankSeq, x: r1(info.clank.x), y: r1(info.clank.y) };
        }
      }
      let touched = false;
      for (const p of list) if (this.contact(p, now)) touched = true;
      for (const p of list) if (this.kickCheck(p, now)) touched = true;
      if (this.hold) {
        if (touched || now >= this.holdUntil) this.hold = false;
        else {
          const spot = kbHoldSpot(this.field, this.kick);
          b.x = spot.x;
          b.y = spot.y;
          b.vx = b.vy = 0;
        }
      }
      this.unpin(list);
      if (this.sub === 'play') this.checkScore(prevY, now);
      if (this.sub !== 'play' && this.sub !== 'goal') break;
    }
  }

  private movePlayer(p: P, now: number, dt: number) {
    const f = this.field;
    const bo = this.boost[p.t];
    const inp = p.inp;
    const want = clamp(inp.x, -1, 1) * KB.RUN * bo.run;
    const acc = (p.air ? KB.AIR_ACC : KB.ACC) * dt;
    p.vx += clamp(want - p.vx, -acc, acc);
    const held = inp.jump || inp.y < -KB.STICK_JUMP;
    if (!p.air && (held || (p.jumpAt && now - p.jumpAt <= KB.JUMP_BUFFER_MS))) {
      p.vy = -KB.JUMP_V * bo.jump;
      p.air = true;
      p.jumpAt = 0;
    }
    p.vy += KB.P_G * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    let support = false;
    if (p.y >= KB.GROUND) {
      p.y = KB.GROUND;
      p.vy = 0;
      support = true;
    }
    const [lo, hi] = kbXRange(f);
    let xl = lo;
    let xh = hi;
    // Anstoß (Fußball): die Gegner bleiben in ihrer Hälfte, bis der Ball berührt wurde. Beim Einwurf (Korb) nicht –
    // sonst wäre der erste Wurf aus der eigenen Hälfte ein ungestörter Dreier.
    if (this.hold && p.t !== this.kick && this.mode === 'fuss') {
      if (p.t === 'A') xh = Math.min(xh, f.mid - KB.HEAD_R - 2);
      else xl = Math.max(xl, f.mid + KB.HEAD_R + 2);
    }
    if (p.x < xl) {
      p.x = xl;
      p.vx = Math.max(0, p.vx);
    } else if (p.x > xh) {
      p.x = xh;
      p.vx = Math.min(0, p.vx);
    }
    // Latten bzw. Bretter: Kopf und Körper prallen ab, oben drauf kann man stehen
    for (const s of f.solids) {
      for (const [r, oy] of [[KB.HEAD_R, KB.HEAD_Y], [KB.BODY_R, KB.BODY_Y]] as const) {
        const c = { x: p.x, y: p.y - oy, vx: 0, vy: 0 };
        const n = kbCircleRect(c, r, s, 0, false);
        if (!n) continue;
        p.x = c.x;
        p.y = c.y + oy;
        if (n.ny < -0.6 && p.vy >= 0) {
          p.vy = 0;
          support = true;
        } else if (n.ny > 0.6 && p.vy < 0) p.vy = 0;
        else if (Math.abs(n.nx) > 0.6) p.vx = 0;
      }
    }
    // Decke (nur für den Fall, dass jemand von der Latte springt)
    const top = f.ceil + 2;
    if (p.y - KB.HEAD_Y - KB.HEAD_R < top) {
      p.y = top + KB.HEAD_Y + KB.HEAD_R;
      p.vy = Math.max(0, p.vy);
    }
    p.air = !support;
  }

  /** Gegner schieben sich auseinander (Teamkameraden laufen durcheinander durch) */
  private separate(list: P[]) {
    const min = KB.HEAD_R * 2 - 4;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i];
        const q = list[j];
        if (p.t === q.t) continue;
        if (Math.abs(p.y - q.y) > KB.HEAD_Y + KB.HEAD_R) continue;
        const dx = q.x - p.x;
        const d = Math.abs(dx);
        if (d >= min) continue;
        // Ganz übereinander: das Team bestimmt die Seite (Sonne nach links)
        const s = d > 0.01 ? Math.sign(dx) : p.t === 'A' ? 1 : -1;
        const push = (min - d) / 2;
        p.x -= s * push;
        q.x += s * push;
        const [lo, hi] = kbXRange(this.field);
        p.x = clamp(p.x, lo, hi);
        q.x = clamp(q.x, lo, hi);
      }
    }
  }

  /** Ball gegen Kopf und Körper einer Figur; true bei neuem Kontakt */
  private contact(p: P, now: number): boolean {
    const b = this.ball;
    let hit: 'kopf' | 'koerper' | null = null;
    for (const [r, oy, e, minOut, how] of [
      [KB.HEAD_R, KB.HEAD_Y, KB.HEAD_E, KB.HEAD_MIN, 'kopf'],
      [KB.BODY_R, KB.BODY_Y, KB.BODY_E, KB.BODY_MIN, 'koerper'],
    ] as const) {
      const cx = p.x;
      const cy = p.y - oy;
      let dx = b.x - cx;
      let dy = b.y - cy;
      const min = r + KB.BALL_R;
      let d = Math.hypot(dx, dy);
      if (d >= min) continue;
      if (d < 0.001) {
        dx = 0;
        dy = -1;
        d = 1;
      }
      const nx = dx / d;
      const ny = dy / d;
      b.x = cx + nx * min;
      b.y = cy + ny * min;
      // Relativ zur Figur abprallen, ein Teil ihres Tempos geht mit
      const k = KB.CARRY;
      let rvx = b.vx - p.vx * k;
      let rvy = b.vy - p.vy * k;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        rvx -= (1 + e) * vn * nx;
        rvy -= (1 + e) * vn * ny;
      }
      b.vx = rvx + p.vx * k;
      b.vy = rvy + p.vy * k;
      const out = (b.vx - p.vx) * nx + (b.vy - p.vy) * ny;
      if (out < minOut) {
        b.vx += nx * (minOut - out);
        b.vy += ny * (minOut - out);
      }
      if (how === 'kopf' && !p.touching) b.vx += kbDir(p.t) * KB.HEADER_PUSH;
      hit = hit ?? how;
    }
    const fresh = !!hit && !p.touching;
    p.touching = !!hit;
    if (!hit) return false;
    this.noteTouch(p, now, hit, fresh);
    return fresh;
  }

  /** SCHUSS: Fuß raus (Fußball) bzw. Wurf zum gegnerischen Korb – trifft einmal pro Druck im Trefferfenster */
  private kickCheck(p: P, now: number): boolean {
    if (p.kicked || now - p.kickAt > KB.KICK_HIT_MS) return false;
    const b = this.ball;
    const d = kbDir(p.t);
    const bo = this.boost[p.t];
    if (this.mode === 'fuss') {
      const fwd = (b.x - p.x) * d;
      const up = p.y - b.y;
      if (fwd < KB.KICK_FWD[0] || fwd > KB.KICK_FWD[1] + KB.BALL_R || up < KB.KICK_UP[0] || up > KB.KICK_UP[1]) return false;
      // Flacher Ball: steil hoch; Ball auf Hüfthöhe: flach; in der Luft: Direktabnahme nach unten
      let deg = 38 - up * 0.95;
      if (p.air) deg -= 16;
      deg = clamp(deg, -14, 38);
      const th = (deg * Math.PI) / 180;
      const v = KB.KICK_V * bo.kick + Math.max(0, p.vx * d) * 0.3;
      b.vx = d * Math.cos(th) * v;
      b.vy = -Math.sin(th) * v;
      // Ball vor den Fuß, damit er nicht gleich wieder am eigenen Kopf hängt
      if (fwd < KB.BODY_R + KB.BALL_R) b.x = p.x + d * (KB.BODY_R + KB.BALL_R + 1);
    } else {
      const cx = p.x;
      const cy = p.y - 18;
      if (Math.hypot(b.x - cx, b.y - cy) > KB.THROW_REACH) return false;
      const hoop = this.field.hoops[other(p.t)];
      const hx = (hoop.xb + hoop.xf) / 2;
      // Ball beim Wurf über den Kopf heben (sonst bleibt er am eigenen Kopf hängen)
      b.x = p.x + d * 4;
      b.y = Math.min(b.y, p.y - KB.HEAD_Y - KB.HEAD_R - KB.BALL_R - 1);
      const v = kbThrowVelocity(b.x, b.y, hoop);
      // Streuung: je weiter weg, desto ungenauer; im Laufen ungenauer, im Sprung etwas genauer
      const dist = Math.abs(hx - b.x) / this.field.w;
      let sigma = 0.03 + 0.5 * dist * dist + (Math.abs(p.vx) > 40 ? 0.03 : 0);
      if (p.air) sigma *= 0.8;
      // Zu lange Würfe fallen übers Brett oft noch rein, zu kurze nie – deshalb geht die Streuung eher zu kurz
      // (aus der Ferne fehlt eben Kraft): so trifft man nah fast immer, Dreier etwa jeden zweiten
      const err = 1 + (gauss() - 0.35) * sigma;
      b.vx = v.vx * err;
      b.vy = v.vy * (1 + gauss() * sigma * 0.5);
    }
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > KB.BALL_MAX) {
      b.vx *= KB.BALL_MAX / sp;
      b.vy *= KB.BALL_MAX / sp;
    }
    p.kicked = true;
    this.noteTouch(p, now, 'schuss', true);
    return true;
  }

  private noteTouch(p: P, now: number, how: KbTouch['how'], fresh: boolean) {
    this.lastTouch = { id: p.id, team: p.t, x: p.x, at: now, how, air: p.air };
    this.teamTouch[p.t] = { id: p.id, at: now };
    if (!fresh) return;
    if (now - p.lastTouchAt > KB.TOUCH_GAP_MS || how === 'schuss') {
      p.h++;
      this.lastTouchFx = { seq: ++this.touchSeq, id: p.id, how, power: Math.round(Math.hypot(this.ball.vx, this.ball.vy)), x: r1(this.ball.x), y: r1(this.ball.y) };
    }
    p.lastTouchAt = now;
  }

  /**
   * Ball zwischen Figur und Bande/Boden eingeklemmt: die Figur weicht, nicht der Ball (sonst zittert er in der
   * Bande oder rutscht durch den Kopf).
   */
  private unpin(list: P[]) {
    const b = this.ball;
    const f = this.field;
    const r = KB.BALL_R;
    b.x = clamp(b.x, f.x0 + r, f.x1 - r);
    if (b.y > KB.GROUND - r) b.y = KB.GROUND - r;
    for (const p of list) {
      for (const [R, oy] of [[KB.HEAD_R, KB.HEAD_Y], [KB.BODY_R, KB.BODY_Y]] as const) {
        const dx = b.x - p.x;
        const dy = b.y - (p.y - oy);
        const min = R + r - 0.5;
        if (dx * dx + dy * dy >= min * min) continue;
        // Nur seitlich ausweichen (genau so weit, dass der Kreis den Ball nicht mehr überdeckt)
        const need = Math.sqrt(Math.max(0, min * min - dy * dy));
        const s = dx >= 0 ? -1 : 1;
        const [lo, hi] = kbXRange(f);
        p.x = clamp(b.x + s * need, lo, hi);
      }
    }
  }

  private checkScore(prevY: number, now: number) {
    const b = this.ball;
    const f = this.field;
    const r = KB.BALL_R;
    if (this.mode === 'fuss') {
      // Ganz über der Linie und unter der Latte
      const under = b.y > KB.GROUND - KB.GOAL_H;
      if (under && b.x + r < f.goalLine.A) this.scoreFor('B', now, { x: b.x, y: b.y });
      else if (under && b.x - r > f.goalLine.B) this.scoreFor('A', now, { x: b.x, y: b.y });
      return;
    }
    // Korb: Ballmitte fällt zwischen Brett und Ringkante durch die Ringhöhe
    for (const t of ['A', 'B'] as Team[]) {
      const h = f.hoops[t];
      const lo = Math.min(h.xb, h.xf) + 1;
      const hi = Math.max(h.xb, h.xf) - 1;
      if (b.vy > 0 && prevY < h.y && b.y >= h.y && b.x > lo && b.x < hi) {
        // Netz bremst
        b.vx *= 0.3;
        b.vy *= 0.6;
        this.scoreFor(other(t), now, { x: (h.xb + h.xf) / 2, y: h.y });
        return;
      }
    }
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p || this.sub === 'over' || action !== 'pad') return;
    if (!this.ctx.isConnected(id)) return;
    const pl = asRecord(payload);
    const now = Date.now();
    const x = clamp(Number(pl.x) || 0, -1, 1);
    const y = clamp(Number(pl.y) || 0, -1, 1);
    const jump = pl.jump === true;
    const kick = pl.kick === true;
    const wasJump = p.inp.jump || p.inp.y < -KB.STICK_JUMP;
    const isJump = jump || y < -KB.STICK_JUMP;
    const live = this.sub === 'play' || this.sub === 'goal';
    if (isJump && !wasJump && live) p.jumpAt = now;
    if (kick && !p.inp.kick && live && now >= p.readyAt) {
      p.kickAt = now;
      p.readyAt = now + KB.KICK_CD_MS;
      p.kicked = false;
      p.ks++;
    }
    // Gilt auch im Countdown bzw. in der Anstoß-Pause (die Figuren stehen dann still) – danach sofort
    p.inp = { x, y, jump, kick };
  }

  playerDisconnected(id: string) {
    const p = this.players.get(id);
    if (p) p.inp = NO_INP();
  }

  // ---------------------------------------------------------------- Ende

  private end(winner: Team | null, now: number) {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.winner = winner;
    this.hold = false;
    this.deadline = now + KB.END_MS;
    for (const p of this.players.values()) p.inp = NO_INP();
    this.ctx.onChange();
    const ids = this.ids.filter((id) => this.players.has(id));
    const teamOf = (id: string) => this.players.get(id)!.t;
    const details: Record<string, string> = {};
    for (const p of this.players.values()) {
      // Ergebnis-Zeile am TV zeigt max. 16 Zeichen
      const a = this.mode === 'fuss' ? `${p.g} ${p.g === 1 ? 'Tor' : 'Tore'}` : `${p.g} Pkt.`;
      const full = `${a} · ${p.h} Kont.`;
      details[p.id] = full.length <= 16 ? full : `${a}·${p.h} K.`;
    }
    const golden = this.overtime && winner !== null;
    const extra = golden ? (this.mode === 'fuss' ? ' per Golden Goal' : ' per Golden Basket') : '';
    const result = winner
      ? {
          groups: [ids.filter((id) => teamOf(id) === winner), ids.filter((id) => teamOf(id) !== winner)].filter((g) => g.length),
          details,
          subtitle: `${TEAM_INFO[winner].name} gewinnt ${this.score[winner]}:${this.score[other(winner)]}${extra}!`,
          coins: [10, 3],
        }
      : { groups: [ids], details, subtitle: `Unentschieden ${this.score.A}:${this.score.B} – auch nach der Verlängerung!`, coins: [6] };
    this.timers.later(KB.END_MS, () => {
      this.timers.clear();
      this.ctx.finish(result);
    });
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const players: Record<string, KbPlayer> = {};
    for (const p of this.players.values()) {
      players[p.id] = {
        t: p.t, x: r1(p.x), y: r1(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy), air: p.air, ks: p.ks, cd: Math.round(p.cd), g: p.g, h: p.h,
        ...(p.off ? { off: true } : {}),
        ...(p.out ? { out: true } : {}),
      };
    }
    const b = this.ball;
    const state: KbState = {
      mode: this.mode,
      sub: this.sub,
      t: now,
      endsIn: this.sub === 'play' ? (this.ctx.practice ? 0 : Math.round(this.clock)) : Math.max(0, this.deadline - now),
      clock: Math.round(this.clock),
      overtime: this.overtime,
      ...(this.ctx.practice ? { practice: true } : {}),
      size: this.field.size,
      score: { ...this.score },
      target: KB.TARGET[this.mode],
      kick: this.kick,
      first: this.first,
      hold: this.hold,
      round: this.round,
      ball: { x: r1(b.x), y: r1(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy) },
      players,
      lastGoal: this.lastGoal,
      touch: this.lastTouchFx,
      clank: this.clank,
      winner: this.winner,
    };
    return this.kind === 'kopfkorb' ? { kind: 'kopfkorb', state } : { kind: 'kopfball', state };
  }

  dispose() {
    this.timers.clear();
  }

  /** Nur für `scripts/test-kopfball.ts`: Spiel ohne Timer steuern (Uhr und Ticks von außen) */
  testApi() {
    const g = this;
    let t = Date.now();
    return {
      field: g.field,
      /** Timer weg, Spiel läuft sofort (ohne schwebenden Ball) */
      begin() {
        g.timers.clear();
        g.sub = 'play';
        g.first = false;
        g.hold = false;
      },
      get now() {
        return t;
      },
      get sub() {
        return g.sub;
      },
      get hold() {
        return g.hold;
      },
      get kick() {
        return g.kick;
      },
      get score() {
        return { ...g.score };
      },
      get winner() {
        return g.winner;
      },
      get clock() {
        return g.clock;
      },
      player: (id: string) => g.players.get(id)!,
      get ball() {
        return g.ball;
      },
      setBall(x: number, y: number, vx = 0, vy = 0) {
        Object.assign(g.ball, { x, y, vx, vy });
      },
      setPlayer(id: string, x: number, y: number = KB.GROUND) {
        const p = g.players.get(id)!;
        Object.assign(p, { x, y, vx: 0, vy: 0, air: y < KB.GROUND, touching: false });
      },
      pad(id: string, pad: Partial<Inp>) {
        const p = g.players.get(id)!;
        const realNow = Date.now;
        Date.now = () => t;
        try {
          g.input(id, 'pad', { ...p.inp, ...pad });
        } finally {
          Date.now = realNow;
        }
      },
      /** n Ticks à TICK_MS (eigene Uhr: Timer laufen nicht, `deadline` wird über die Uhr geprüft) */
      step(n = 1) {
        for (let k = 0; k < n; k++) {
          t += KB.TICK_MS;
          g.tick(t, KB.TICK_MS / 1000);
        }
      },
      snapshot: () => g.snapshot().state as KbState,
    };
  }
}

/** Normalverteilte Zufallszahl (Box-Muller) */
function gauss() {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
