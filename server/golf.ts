import type { GolfBallPub, GolfFx, GolfFxKind, GolfState, MiniSnapshot, SkipInfo } from '../shared/types';
import { GOLF, GOLF_HOLES, type GolfBody, golfIdealPutt, golfPowerToSpeed, golfStep, golfWalls } from '../shared/golf';
import { SHIRTS } from '../shared/avatar';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, groupByScore, shuffle, waitLabel } from './minigame';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const num = (v: unknown, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const r1 = (v: number) => Math.round(v * 10) / 10;
const hexNum = (h: string) => parseInt(h.slice(1), 16);
/** Ersatzfarben, falls zwei Spieler dieselbe Shirt-Farbe haben (oder Weiß/Schwarz) */
const FALLBACK = ['#e0503f', '#3f8fe0', '#ffd25e', '#9b5fc0', '#f0973a', '#2fb5a5', '#f07aa8', '#46b04a', '#8fd8ff', '#c9467e', '#a0e060', '#ff9a7a'];

interface Ball extends GolfBody {
  strokes: number;
  done: 0 | 1 | 2;
  moving: boolean;
  /** Position vor dem letzten Schlag (für Wasser/aus dem Platz) */
  sx: number;
  sy: number;
  /** Wartezeit nach „Platsch“, bevor der Ball zurückgelegt wird */
  wait: number;
  rollS: number;
  restSince: number;
  aim: [number, number] | null;
}

/**
 * Urlaubs-Minigolf: alle Löcher (Party-Modus: 5), alle putten GLEICHZEITIG auf demselben Loch (Bälle stoßen nicht zusammen).
 * Physik läuft in Echtzeit auf dem Server (fester Takt, deterministisch), der TV bekommt nur die Ballpositionen.
 */
export class GolfGame implements MiniGame {
  readonly kind = 'golf' as const;
  private order: string[];
  private colors: Record<string, number> = {};
  private sub: GolfState['sub'] = 'intro';
  private deadline = Date.now() + GOLF.INTRO_MS;
  private hole = 0;
  private t = 0;
  private balls: Record<string, Ball> = {};
  private scores: Record<string, (number | null)[]> = {};
  private fx: GolfFx[] = [];
  private fxSeq = 0;
  private walls: number[][] = [];
  private doneAt = 0;
  private playStart = 0;
  private steps = 0;
  private sentAt = 0;
  private timers = new Timers();
  /** Party-Modus: nur 5 Bahnen (Pacing auf dem Spielbrett), sonst alle */
  private holeCount: number;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.holeCount = ctx.mode === 'party' ? Math.min(5, GOLF_HOLES.length) : GOLF_HOLES.length;
    this.order = shuffle(ids);
    const used = new Set<string>();
    this.order.forEach((id, i) => {
      let col = SHIRTS[ctx.lookOf?.(id)?.shirt ?? -1] ?? FALLBACK[i % FALLBACK.length];
      if (used.has(col) || col === '#f4efe2' || col === '#3b3b4f') col = FALLBACK.find((c) => !used.has(c)) ?? col;
      used.add(col);
      this.colors[id] = hexNum(col);
      this.scores[id] = GOLF_HOLES.slice(0, this.holeCount).map(() => null);
    });
    this.timers.later(GOLF.INTRO_MS, () => this.startHole(0));
    this.timers.every(Math.round(GOLF.TICK_S * 1000), () => this.tick());
  }

  // ---------------------------------------------------------------- Ablauf

  private startHole(i: number) {
    this.hole = i;
    const h = GOLF_HOLES[i];
    this.walls = golfWalls(h);
    this.t = 0;
    this.fx = [];
    this.balls = {};
    for (const id of this.order) {
      this.balls[id] = {
        x: h.tee.x,
        y: h.tee.y,
        vx: 0,
        vy: 0,
        tube: 0,
        tubeV: 0,
        tubeIdx: 0,
        lip: 0,
        strokes: 0,
        done: 0,
        moving: false,
        sx: h.tee.x,
        sy: h.tee.y,
        wait: 0,
        rollS: 0,
        restSince: Date.now(),
        aim: null,
      };
    }
    this.sub = 'tee';
    this.deadline = Date.now() + GOLF.TEE_MS;
    this.ctx.onChange();
    this.timers.later(GOLF.TEE_MS, () => {
      this.sub = 'play';
      this.playStart = Date.now();
      this.steps = 0;
      this.deadline = GOLF.HOLE_S === null ? 0 : Date.now() + GOLF.HOLE_S * 1000;
      this.doneAt = 0;
      for (const b of Object.values(this.balls)) b.restSince = Date.now();
      this.ctx.onChange();
    });
  }

  /**
   * Physik im festen Takt (TICK_S), an der echten Uhr ausgerichtet: Hinkt der Timer hinterher, werden
   * Schritte nachgeholt – so passt die Lochzeit `t` zur Uhr von TV/Handy (Leuchtturm, Surfbrett).
   */
  private tick() {
    if (this.sub !== 'play') return;
    const now = Date.now();
    const due = Math.floor((now - this.playStart) / (GOLF.TICK_S * 1000));
    let changed = false;
    for (let n = 0; n < 8 && this.steps < due; n++) {
      this.steps++;
      if (this.step(now)) changed = true;
    }
    if (this.steps < due) this.steps = due; // nach einem Hänger nicht ewig nachholen
    if (!this.doneAt && this.order.every((id) => this.balls[id].done)) {
      this.doneAt = now;
      this.timers.later(GOLF.DONE_PAUSE_MS, () => this.endHole());
    }
    if (!this.doneAt && this.deadline && now >= this.deadline) {
      this.capRest(now);
      changed = true;
    }
    // ab und zu auch ohne Bewegung senden, damit TV/Handys ihre Lochzeit nachstellen
    if (changed || now - this.sentAt > 2000) {
      this.sentAt = now;
      this.ctx.onChange();
    }
  }

  /** Ein Physik-Takt für alle Bälle; true = etwas hat sich bewegt */
  private step(now: number): boolean {
    const h = GOLF_HOLES[this.hole];
    const dt = GOLF.TICK_S / GOLF.SUBSTEPS;
    let changed = false;
    for (const id of this.order) {
      const b = this.balls[id];
      if (b.done) continue;
      if (b.wait > 0) {
        b.wait -= GOLF.TICK_S;
        if (b.wait <= 0) {
          b.wait = 0;
          b.x = b.sx;
          b.y = b.sy;
          this.rest(id, b);
        }
        changed = true;
        continue;
      }
      if (!b.moving) {
        // Offline → automatischer Schlag, damit niemand das Loch aufhält
        if (!this.ctx.isConnected(id) && now - b.restSince > GOLF.AUTO_MS) this.autoPutt(id);
        continue;
      }
      changed = true;
      b.rollS += GOLF.TICK_S;
      for (let k = 0; k < GOLF.SUBSTEPS && b.moving; k++) {
        const ev = golfStep(b, h, this.walls, this.t + k * dt, dt);
        for (const e of ev) this.onEvent(id, b, e);
      }
      if (b.moving && b.rollS > GOLF.MAX_ROLL_S && b.tube <= 0) {
        b.vx = b.vy = 0;
        this.rest(id, b);
      }
    }
    this.t = this.steps * GOLF.TICK_S;
    return changed;
  }

  private onEvent(id: string, b: Ball, e: string) {
    switch (e) {
      case 'stop':
        this.rest(id, b);
        break;
      case 'hole': {
        b.moving = false;
        b.done = 1;
        this.scores[id][this.hole] = b.strokes;
        this.addFx(id, b.strokes === 1 ? 'ace' : 'hole', b.x, b.y, b.strokes);
        break;
      }
      case 'water':
        // +1 Strafschlag, Ball zurück an die Stelle vor dem Schlag
        b.strokes += 1;
        b.moving = false;
        b.wait = 0.9;
        this.addFx(id, 'water', b.x, b.y);
        break;
      case 'out':
        b.moving = false;
        b.wait = 0.4;
        this.addFx(id, 'out', b.x, b.y);
        break;
      case 'tube':
        this.addFx(id, 'tube', b.x, b.y);
        break;
      case 'bump':
        this.addFx(id, 'bump', b.x, b.y);
        break;
      case 'lip':
        this.addFx(id, 'lip', b.x, b.y);
        break;
    }
  }

  /** Ball liegt: Schlag-Limit prüfen */
  private rest(id: string, b: Ball) {
    b.moving = false;
    b.vx = b.vy = 0;
    b.restSince = Date.now();
    if (b.strokes >= GOLF.MAX_STROKES && !b.done) {
      b.done = 2;
      this.scores[id][this.hole] = GOLF.MAX_SCORE;
      this.addFx(id, 'cap', b.x, b.y, GOLF.MAX_SCORE);
    }
  }

  private addFx(id: string, k: GolfFxKind, x: number, y: number, n?: number) {
    this.fx.push({ seq: ++this.fxSeq, id, k, x: r1(x), y: r1(y), ...(n !== undefined ? { n } : {}) });
    if (this.fx.length > 16) this.fx.splice(0, this.fx.length - 16);
  }

  /** Zeit um bzw. VIP beendet das Loch: wer noch spielt, bekommt +2 (max. 7) */
  private capRest(now = Date.now()) {
    for (const id of this.order) {
      const b = this.balls[id];
      if (b.done) continue;
      b.done = 2;
      b.moving = false;
      b.vx = b.vy = 0;
      this.scores[id][this.hole] = Math.min(GOLF.MAX_SCORE, b.strokes + 2);
      this.addFx(id, 'cap', b.x, b.y, this.scores[id][this.hole]!);
    }
    this.doneAt = now;
    this.timers.later(600, () => this.endHole());
  }

  /** VIP/Laptop: Erklärung/Scorekarte überspringen oder das Loch beenden */
  skippable(): SkipInfo | null {
    if (this.sub === 'intro') return { label: 'Los geht’s', info: true };
    if (this.sub === 'card') return { label: this.hole >= GOLF_HOLES.length - 1 ? 'Zum Ergebnis' : 'Nächstes Loch', info: true };
    if (this.sub === 'play' && !this.doneAt) {
      const missing = this.order.filter((id) => !this.balls[id]?.done && this.ctx.isConnected(id));
      return { label: waitLabel(this.ctx, missing, 'Ball', 'Loch beenden') };
    }
    return null;
  }

  skip() {
    if (this.sub === 'intro') {
      this.timers.clear();
      this.timers.every(Math.round(GOLF.TICK_S * 1000), () => this.tick());
      this.startHole(0);
    } else if (this.sub === 'card') {
      this.timers.clear();
      this.timers.every(Math.round(GOLF.TICK_S * 1000), () => this.tick());
      if (this.hole >= GOLF_HOLES.length - 1) this.over();
      else this.startHole(this.hole + 1);
    } else if (this.sub === 'play' && !this.doneAt) {
      this.capRest();
      this.ctx.onChange();
    }
  }

  private endHole() {
    if (this.sub !== 'play') return;
    this.sub = 'card';
    const last = this.hole >= this.holeCount - 1;
    const ms = last ? GOLF.LAST_CARD_MS : GOLF.CARD_MS;
    this.deadline = Date.now() + ms;
    this.ctx.onChange();
    this.timers.later(ms, () => (last ? this.over() : this.startHole(this.hole + 1)));
  }

  private autoPutt(id: string) {
    const b = this.balls[id];
    const ideal = golfIdealPutt(GOLF_HOLES[this.hole], b);
    this.putt(id, ideal.angle + (Math.random() - 0.5) * 0.2, clamp(ideal.power * (0.8 + Math.random() * 0.4), 0.05, 1));
  }

  private putt(id: string, angle: number, power: number) {
    const b = this.balls[id];
    if (!b || b.done || b.moving || b.wait > 0) return;
    const v = golfPowerToSpeed(power);
    b.strokes += 1;
    b.sx = b.x;
    b.sy = b.y;
    b.vx = Math.cos(angle) * v;
    b.vy = Math.sin(angle) * v;
    b.moving = true;
    b.rollS = 0;
    b.aim = null;
    this.ctx.onChange();
  }

  input(id: string, action: string, payload: unknown) {
    if (this.sub !== 'play') return;
    const b = this.balls[id];
    if (!b || b.done || b.moving) return;
    const p = asRecord(payload);
    if (action === 'aim') {
      const a = num(p.a, NaN);
      if (!Number.isFinite(a)) {
        b.aim = null;
      } else {
        b.aim = [Math.round(a * 1000) / 1000, Math.round(clamp(num(p.p), 0, 1) * 100) / 100];
      }
      this.ctx.onChange();
    } else if (action === 'putt') {
      // seq = Schläge vor diesem Schlag (gegen doppelte Schläge)
      if (p.seq !== undefined && num(p.seq) !== b.strokes) return;
      const a = num(p.a, NaN);
      const pw = num(p.p, NaN);
      if (!Number.isFinite(a) || !Number.isFinite(pw)) return;
      this.putt(id, a, clamp(pw, 0.02, 1));
    }
  }

  private total(id: string) {
    return this.scores[id].reduce<number>((a, s) => a + (s ?? 0), 0);
  }

  private over() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.deadline = Date.now() + 4000;
    this.ctx.onChange();
    const par = GOLF_HOLES.slice(0, this.holeCount).reduce((a, h) => a + h.par, 0);
    const rel = (n: number) => (n === par ? 'Par' : n > par ? `+${n - par}` : `${n - par}`);
    const ranked = [...this.ids].sort((a, b) => this.total(a) - this.total(b));
    const best = ranked[0];
    const tie = ranked.length > 1 && this.total(ranked[0]) === this.total(ranked[1]);
    const aces = this.ids.reduce((a, id) => a + this.scores[id].filter((s) => s === 1).length, 0);
    this.timers.later(4000, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => -this.total(id)),
        details: Object.fromEntries(this.ids.map((id) => [id, `${this.total(id)} Schläge (${rel(this.total(id))})`])),
        subtitle: tie
          ? `Gleichstand mit ${this.total(best)} Schlägen!`
          : `${this.ctx.nameOf(best)} gewinnt mit ${this.total(best)} Schlägen${aces ? ` · ${aces}× Hole-in-one` : ''}!`,
      }),
    );
  }

  snapshot(): MiniSnapshot {
    const balls: Record<string, GolfBallPub> = {};
    for (const id of this.order) {
      const b = this.balls[id];
      if (!b) continue;
      balls[id] = {
        x: r1(b.x),
        y: r1(b.y),
        s: b.strokes,
        d: b.done,
        m: b.moving || b.wait > 0,
        ...(b.tube > 0 ? { tube: true } : {}),
        aim: b.aim,
      };
    }
    return {
      kind: 'golf',
      state: {
        sub: this.sub,
        endsIn: endsIn(this.deadline),
        hole: this.hole,
        holes: this.holeCount,
        // Lochzeit nach der Uhr (nicht nur nach dem letzten Takt) – TV/Handys zählen ab Empfang weiter
        t: Math.round((this.sub === 'play' ? Math.max(this.t, (Date.now() - this.playStart) / 1000) : this.t) * 1000) / 1000,
        order: this.order,
        colors: this.colors,
        balls,
        scores: this.scores,
        par: GOLF_HOLES.slice(0, this.holeCount).map((h) => h.par),
        fx: this.fx,
      },
    };
  }

  playerDisconnected(_id: string) {
    // Offline-Spieler schlagen automatisch (siehe tick)
  }

  dispose() {
    this.timers.clear();
  }
}
