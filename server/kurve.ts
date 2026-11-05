import type { KurveHead, KurvePower, KurveState, MiniSnapshot } from '../shared/types';
import { KURVE } from '../shared/games';
import { type MiniCtx, type MiniGame, Timers, asRecord, shuffle } from './minigame';
import { BetBook } from './spectator';

const TICK_MS = 50;
/** Kollisionsraster: 1 Zelle = 1 Welt-Pixel (480 × 270) */
const GW = 480;
const GH = 270;
const A = KURVE.ARENA;
const POWERS: KurvePower[] = ['turbo', 'slow', 'wrap'];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const r1 = (v: number) => Math.round(v * 10) / 10;

interface Racer {
  id: string;
  /** 1-basiert, 0 = leere Zelle im Raster */
  idx: number;
  color: number;
  x: number;
  y: number;
  a: number;
  turn: -1 | 0 | 1;
  alive: boolean;
  score: number;
  /** Spurpunkte dieser Runde, flach [x, y, pen, …] */
  pts: number[];
  /** Zurückgelegte Teilschritte (Uhr für die eigene Spur) */
  steps: number;
  gapLeft: number;
  nextGap: number;
  turboUntil: number;
  slowUntil: number;
  wrapUntil: number;
  v: number;
}

/**
 * Kurven-Duell (à la "Achtung, die Kurve!"): Jeder Kopf fährt ständig geradeaus und zieht eine Spur.
 * Am Handy nur LINKS/RECHTS halten. Wer gegen Rand oder Spur fährt, ist raus –
 * alle anderen bekommen dafür je einen Punkt. 5–7 Runden (je nach Spielerzahl).
 */
export class KurveGame implements MiniGame {
  readonly kind = 'kurve' as const;
  private racers = new Map<string, Racer>();
  private owner = new Uint8Array(GW * GH);
  private stamp = new Int32Array(GW * GH);
  private sub: KurveState['sub'] = 'countdown';
  private round = 0;
  private deadline = 0;
  private roundStart = 0;
  private storm = false;
  private powerups: KurveState['powerups'] = [];
  private powerBorn = new Map<number, number>();
  private nextPowerAt = 0;
  private powerSeq = 0;
  private deaths: KurveState['deaths'] = [];
  private deathSeq = 0;
  private pickup: KurveState['pickup'] = null;
  private pickupSeq = 0;
  private roundWinner: string | null = null;
  /** Zuschauer: Wetten der Ausgeschiedenen auf den Rundensieger */
  private bets = new BetBook();
  private timers = new Timers();
  private last = Date.now();
  private rounds: number;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
    /** T-Shirt-Farbe pro Spieler (Index in SHIRTS) – wird, wenn frei, zur Spurfarbe */
    shirts: (number | undefined)[] = [],
  ) {
    this.rounds = KURVE.roundsFor(ids.length);
    const taken = new Set<number>();
    const colors = ids.map((_, i) => {
      const want = shirts[i];
      if (want !== undefined && want < KURVE.COLORS.length && !taken.has(want)) {
        taken.add(want);
        return want;
      }
      return -1;
    });
    ids.forEach((id, i) => {
      let c = colors[i];
      if (c < 0) {
        c = KURVE.COLORS.findIndex((_, k) => !taken.has(k));
        if (c < 0) c = i % KURVE.COLORS.length;
        taken.add(c);
      }
      this.racers.set(id, {
        id, idx: i + 1, color: c, x: 0, y: 0, a: 0, turn: 0, alive: true, score: 0,
        pts: [], steps: 0, gapLeft: 0, nextGap: 0, turboUntil: 0, slowUntil: 0, wrapUntil: 0, v: KURVE.SPEED,
      });
    });
    this.startRound();
    this.timers.every(TICK_MS, () => this.tick());
  }

  // ---------------------------------------------------------------- Ablauf

  private startRound() {
    this.round += 1;
    this.owner.fill(0);
    this.stamp.fill(0);
    this.powerups = [];
    this.powerBorn.clear();
    this.deaths = [];
    this.pickup = null;
    this.roundWinner = null;
    this.bets.newRound(this.round);
    this.storm = false;
    const spots = this.spawnSpots(this.racers.size);
    shuffle([...this.racers.values()]).forEach((r, i) => {
      const s = spots[i];
      r.x = s.x;
      r.y = s.y;
      r.a = this.spawnAngle(s.x, s.y);
      r.turn = 0;
      r.alive = true;
      r.pts = [r1(r.x), r1(r.y), 0];
      r.steps = 0;
      r.gapLeft = 0;
      r.nextGap = this.gapDistance();
      r.turboUntil = r.slowUntil = r.wrapUntil = 0;
      r.v = KURVE.SPEED;
    });
    this.sub = 'countdown';
    this.deadline = Date.now() + KURVE.COUNTDOWN_MS;
    this.timers.later(KURVE.COUNTDOWN_MS, () => {
      this.sub = 'play';
      this.roundStart = Date.now();
      this.deadline = this.roundStart + KURVE.ROUND_MAX_MS;
      this.nextPowerAt = this.roundStart + rand(KURVE.POWER_MIN_MS, KURVE.POWER_MAX_MS);
      this.last = Date.now();
      this.ctx.onChange();
    });
    this.ctx.onChange();
  }

  /** Startplätze mit Mindestabstand – klappt für bis zu 12 Spieler */
  private spawnSpots(n: number) {
    const margin = 40;
    for (let minD = 60; ; minD -= 6) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i < n; i++) {
          let ok = false;
          for (let t = 0; t < 60 && !ok; t++) {
            const p = { x: rand(A.x + margin, A.x + A.w - margin), y: rand(A.y + margin, A.y + A.h - margin) };
            if (pts.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= minD)) {
              pts.push(p);
              ok = true;
            }
          }
          if (!ok) break;
        }
        if (pts.length === n) return pts;
      }
      if (minD <= 12) {
        return Array.from({ length: n }, (_, i) => ({ x: A.x + margin + ((A.w - 2 * margin) * ((i % 6) + 0.5)) / 6, y: A.y + A.h * (i < 6 ? 0.35 : 0.65) }));
      }
    }
  }

  /** Zufällige Startrichtung mit genug Platz bis zur Wand (nicht alle zur Mitte – sonst knallt's sofort) */
  private spawnAngle(x: number, y: number) {
    const room = (a: number) => {
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const tx = dx > 0 ? (A.x + A.w - x) / dx : dx < 0 ? (A.x - x) / dx : Infinity;
      const ty = dy > 0 ? (A.y + A.h - y) / dy : dy < 0 ? (A.y - y) / dy : Infinity;
      return Math.min(tx, ty);
    };
    for (let t = 0; t < 30; t++) {
      const a = rand(-Math.PI, Math.PI);
      if (room(a) >= 80) return a;
    }
    return Math.atan2(A.y + A.h / 2 - y, A.x + A.w / 2 - x);
  }

  private gapDistance() {
    return KURVE.SPEED * rand(KURVE.GAP_MIN_MS, KURVE.GAP_MAX_MS) / 1000;
  }

  private tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.sub !== 'play') return;

    const elapsed = now - this.roundStart;
    const stormF = elapsed > KURVE.STORM_MS ? 1 + ((elapsed - KURVE.STORM_MS) / 1000) * KURVE.STORM_ACCEL : 1;
    this.storm = stormF > 1;

    const died: Racer[] = [];
    for (const r of shuffle([...this.racers.values()])) {
      if (!r.alive) continue;
      if (!this.move(r, dt, now, stormF)) died.push(r);
      else this.collect(r, now);
    }
    if (died.length) {
      for (const r of this.racers.values()) if (r.alive) r.score += died.length;
    }

    this.updatePowerups(now);

    const alive = [...this.racers.values()].filter((r) => r.alive);
    const needed = this.racers.size >= 2 ? 1 : 0;
    if (alive.length <= needed || now >= this.deadline) this.endRound(alive);
    this.ctx.onChange();
  }

  /** Bewegt einen Kopf in 1-px-Teilschritten. false = ausgeschieden */
  private move(r: Racer, dt: number, now: number, stormF: number): boolean {
    const v = KURVE.SPEED * stormF * (now < r.turboUntil ? KURVE.TURBO_F : 1) * (now < r.slowUntil ? KURVE.SLOW_F : 1);
    r.v = v;
    const dist = v * dt;
    const n = Math.max(1, Math.ceil(dist));
    const step = dist / n;
    const da = (r.turn * KURVE.TURN * dt) / n;
    const wrap = now < r.wrapUntil;
    for (let i = 0; i < n; i++) {
      r.a += da;
      r.x += Math.cos(r.a) * step;
      r.y += Math.sin(r.a) * step;
      r.steps += 1;

      // Lücken
      if (r.gapLeft > 0) {
        r.gapLeft -= step;
        if (r.gapLeft <= 0) {
          this.push(r, 0);
          r.nextGap = this.gapDistance();
        }
      } else {
        r.nextGap -= step;
        if (r.nextGap <= 0) {
          this.push(r, 1);
          r.gapLeft = KURVE.GAP_PX;
        }
      }

      // Rand
      const minX = A.x + 1, maxX = A.x + A.w - 1, minY = A.y + 1, maxY = A.y + A.h - 1;
      if (r.x < minX || r.x > maxX || r.y < minY || r.y > maxY) {
        if (wrap) {
          r.x = Math.max(minX, Math.min(maxX, r.x));
          r.y = Math.max(minY, Math.min(maxY, r.y));
          this.push(r, r.gapLeft > 0 ? 0 : 1);
          if (r.x <= minX) r.x = maxX - 0.5;
          else if (r.x >= maxX) r.x = minX + 0.5;
          if (r.y <= minY) r.y = maxY - 0.5;
          else if (r.y >= maxY) r.y = minY + 0.5;
          this.push(r, 0);
        } else {
          r.x = Math.max(minX, Math.min(maxX, r.x));
          r.y = Math.max(minY, Math.min(maxY, r.y));
          this.die(r);
          return false;
        }
      }

      if (this.hits(r)) {
        this.die(r);
        return false;
      }
      if (r.gapLeft <= 0) this.paint(r);
    }
    this.push(r, r.gapLeft > 0 ? 0 : 1);
    return true;
  }

  private push(r: Racer, pen: 0 | 1) {
    r.pts.push(r1(r.x), r1(r.y), pen);
  }

  /** Prüft drei Punkte knapp vor dem Kopf gegen das Raster */
  private hits(r: Racer): boolean {
    const c = Math.cos(r.a);
    const s = Math.sin(r.a);
    const probes = [
      [r.x + c * 2.2, r.y + s * 2.2],
      [r.x + c * 1.6 - s * 1.3, r.y + s * 1.6 + c * 1.3],
      [r.x + c * 1.6 + s * 1.3, r.y + s * 1.6 - c * 1.3],
    ];
    for (const [px, py] of probes) {
      const gx = Math.floor(px);
      const gy = Math.floor(py);
      if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
      const k = gy * GW + gx;
      const o = this.owner[k];
      if (!o) continue;
      if (o === r.idx && r.steps - this.stamp[k] <= KURVE.SELF_GRACE) continue;
      return true;
    }
    return false;
  }

  /** Spur ins Raster stempeln (3 × 3 px – passend zur Linienstärke auf dem TV) */
  private paint(r: Racer) {
    const cx = Math.round(r.x);
    const cy = Math.round(r.y);
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
        const k = y * GW + x;
        this.owner[k] = r.idx;
        this.stamp[k] = r.steps;
      }
    }
  }

  private die(r: Racer) {
    r.alive = false;
    this.push(r, r.gapLeft > 0 ? 0 : 1);
    this.deaths.push({ id: r.id, x: r1(r.x), y: r1(r.y), seq: ++this.deathSeq });
  }

  // ---------------------------------------------------------------- Power-ups

  private updatePowerups(now: number) {
    this.powerups = this.powerups.filter((p) => now - (this.powerBorn.get(p.id) ?? now) < KURVE.POWER_LIFE_MS);
    if (now < this.nextPowerAt) return;
    this.nextPowerAt = now + rand(KURVE.POWER_MIN_MS, KURVE.POWER_MAX_MS);
    if (this.powerups.length >= KURVE.POWER_MAX) return;
    for (let t = 0; t < 30; t++) {
      const x = Math.round(rand(A.x + 20, A.x + A.w - 20));
      const y = Math.round(rand(A.y + 20, A.y + A.h - 20));
      if ([...this.racers.values()].some((r) => r.alive && Math.hypot(r.x - x, r.y - y) < 30)) continue;
      if (this.powerups.some((p) => Math.hypot(p.x - x, p.y - y) < 30)) continue;
      if (this.areaUsed(x, y, KURVE.POWER_R)) continue;
      const id = ++this.powerSeq;
      this.powerups.push({ id, x, y, type: POWERS[Math.floor(Math.random() * POWERS.length)] });
      this.powerBorn.set(id, now);
      return;
    }
  }

  private areaUsed(cx: number, cy: number, rad: number) {
    for (let y = cy - rad; y <= cy + rad; y += 2) {
      for (let x = cx - rad; x <= cx + rad; x += 2) {
        if (this.owner[y * GW + x]) return true;
      }
    }
    return false;
  }

  private collect(r: Racer, now: number) {
    const hit = this.powerups.find((p) => Math.hypot(p.x - r.x, p.y - r.y) < KURVE.POWER_R + 1.5);
    if (!hit) return;
    this.powerups = this.powerups.filter((p) => p !== hit);
    if (hit.type === 'turbo') r.turboUntil = now + KURVE.TURBO_MS;
    else if (hit.type === 'wrap') r.wrapUntil = now + KURVE.WRAP_MS;
    else for (const o of this.racers.values()) if (o !== r) o.slowUntil = now + KURVE.SLOW_MS;
    this.pickup = { id: r.id, type: hit.type, x: hit.x, y: hit.y, seq: ++this.pickupSeq };
  }

  // ---------------------------------------------------------------- Rundenende

  private endRound(alive: Racer[]) {
    this.sub = 'roundEnd';
    this.roundWinner = alive.length === 1 ? alive[0].id : null;
    this.bets.resolve(this.roundWinner);
    this.deadline = Date.now() + KURVE.ROUND_END_MS;
    this.timers.later(KURVE.ROUND_END_MS, () => (this.round >= this.rounds ? this.end() : this.startRound()));
  }

  private end() {
    this.sub = 'over';
    this.deadline = Date.now();
    this.ctx.onChange();
    const score = (id: string) => this.racers.get(id)?.score ?? 0;
    const groups = this.bets.rank(this.ids, score);
    const best = groups[0] ?? [];
    this.timers.later(2500, () =>
      this.ctx.finish({
        groups,
        details: Object.fromEntries(this.ids.map((id) => [id, `${score(id)} Punkte${this.bets.detail(id)}`])),
        subtitle:
          best.length === 1
            ? `${this.ctx.nameOf(best[0])} fährt die schärfsten Kurven!`
            : `Gleichstand an der Spitze: ${best.map((id) => this.ctx.nameOf(id)).join(' & ')}`,
      }),
    );
  }

  // ---------------------------------------------------------------- Eingaben & Zustand

  input(id: string, action: string, payload: unknown) {
    const r = this.racers.get(id);
    if (r && action === 'bet') {
      const alive = [...this.racers.values()].filter((x) => x.alive).map((x) => x.id);
      if (this.bets.place(id, payload, this.ids, alive, this.sub === 'play')) this.ctx.onChange();
      return;
    }
    if (!r || action !== 'turn') return;
    const d = Number(asRecord(payload).dir);
    r.turn = d < 0 ? -1 : d > 0 ? 1 : 0;
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const players: Record<string, KurveHead> = {};
    for (const r of this.racers.values()) {
      const total = r.pts.length / 3;
      const from = Math.max(0, total - KURVE.TAIL);
      const fx: KurvePower[] = [];
      if (now < r.turboUntil) fx.push('turbo');
      if (now < r.slowUntil) fx.push('slow');
      if (now < r.wrapUntil) fx.push('wrap');
      players[r.id] = {
        x: r1(r.x),
        y: r1(r.y),
        a: Math.round(r.a * 100) / 100,
        v: Math.round(r.v),
        alive: r.alive,
        color: r.color,
        score: r.score,
        gap: r.gapLeft > 0,
        fx,
        trailStart: from,
        trail: r.pts.slice(from * 3),
      };
    }
    return {
      kind: 'kurve',
      state: {
        sub: this.sub,
        round: this.round,
        rounds: this.rounds,
        endsIn: Math.max(0, this.deadline - now),
        storm: this.storm,
        players,
        powerups: this.powerups,
        deaths: this.deaths,
        pickup: this.pickup,
        roundWinner: this.roundWinner,
        spectator: this.bets.info(
          [...this.racers.values()].filter((x) => x.alive).map((x) => x.id),
          this.round,
          this.sub === 'play',
          this.sub === 'play' || this.sub === 'countdown' ? undefined : this.roundWinner,
        ),
      },
    };
  }

  playerDisconnected(id: string) {
    const r = this.racers.get(id);
    if (r) r.turn = 0;
  }

  dispose() {
    this.timers.clear();
  }
}
