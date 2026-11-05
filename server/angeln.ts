import type { MiniSnapshot } from '../shared/types';
import {
  ANGELN,
  type AngelCatch,
  type AngelLost,
  type AngelnState,
  type AngelPlayer,
  FISH,
  FISH_KINDS,
  type FishKind,
  castY,
  fishPoints,
  fmtKg,
  laneW,
  laneX,
} from '../shared/angeln';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore } from './minigame';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Zum Testen kürzer: ANGELN_ROUND_MS=60000 npm run dev */
const ROUND_MS = Number(process.env.ANGELN_ROUND_MS) || ANGELN.ROUND_MS;

interface P extends AngelPlayer {
  /** Ende des aktuellen Zustands (Wurfflug, Anbiss-Fenster, Anzeige) */
  until: number;
  biteAt: number;
  nibbleAt: number[];
  /** Geheim bis zum Fang */
  fish: { kind: FishKind; kg: number; str: number } | null;
  nextBurst: number;
  burstUntil: number;
  burstPow: number;
  tilt: number;
}

/**
 * Angeln: Alle stehen auf dem Steg am Ferienhaus und angeln gleichzeitig.
 * Auswerfen (Schwung/Wischen, Kraft = Weite = Tiefe) → auf den Biss warten → rechtzeitig anschlagen →
 * Drill: Spannung in der grünen Zone halten (halten = kurbeln), der Fisch zieht in Schüben.
 * Fischwahl, Bisszeit, Zugmuster und Ausgang entscheidet der Server.
 */
export class AngelnGame implements MiniGame {
  readonly kind = 'angeln' as const;
  private players = new Map<string, P>();
  private catches: AngelCatch[] = [];
  private record: AngelCatch | null = null;
  private seq = 0;
  private sub: AngelnState['sub'] = 'intro';
  private deadline = Date.now() + ANGELN.INTRO_MS;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    ids.forEach((id, i) => {
      this.players.set(id, {
        lane: i,
        st: 'idle',
        castSeq: 0,
        fx: laneX(i, ids.length),
        fy: ANGELN.NEAR_Y,
        depth: 0,
        left: 0,
        nibbles: 0,
        tension: 0,
        prog: 1,
        pull: 0,
        slack: 0,
        hold: false,
        size: 0,
        lost: null,
        score: 0,
        count: 0,
        last: null,
        best: null,
        until: 0,
        biteAt: 0,
        nibbleAt: [],
        fish: null,
        nextBurst: 0,
        burstUntil: 0,
        burstPow: 0,
        tilt: 0,
      });
    });
    let last = Date.now();
    this.timers.every(ANGELN.TICK_MS, () => {
      const now = Date.now();
      this.tick(now, Math.min(0.2, (now - last) / 1000));
      last = now;
    });
  }

  // ---------------------------------------------------------------- Ablauf

  private tick(now: number, dt: number) {
    if (this.sub === 'over') return;
    if (this.sub === 'intro' && now >= this.deadline) {
      this.sub = 'play';
      this.deadline = now + ROUND_MS;
    } else if (this.sub === 'play' && now >= this.deadline) {
      this.sub = 'last';
      this.deadline = now + ANGELN.LAST_MS;
      // Wer noch keinen Fisch dran hat, holt ein
      for (const p of this.players.values()) if (p.st === 'idle' || p.st === 'cast' || p.st === 'wait') this.toIdle(p);
    }
    for (const [id, p] of this.players) this.step(id, p, now, dt);
    if (this.sub === 'last') {
      const busy = [...this.players.values()].some((p) => p.st === 'bite' || p.st === 'reel');
      if (now >= this.deadline) {
        for (const p of this.players.values()) if (p.st === 'bite' || p.st === 'reel') this.lose(p, 'time', now);
        return this.end();
      }
      if (!busy) return this.end();
    }
    this.ctx.onChange();
  }

  private step(id: string, p: P, now: number, dt: number) {
    switch (p.st) {
      case 'cast':
        if (now >= p.until) {
          p.st = 'wait';
          this.prepareBite(p, now);
        }
        break;
      case 'wait':
        while (p.nibbleAt.length && now >= p.nibbleAt[0]) {
          p.nibbleAt.shift();
          p.nibbles += 1;
        }
        if (now >= p.biteAt) {
          p.st = 'bite';
          p.until = now + (p.fish && FISH[p.fish.kind].rare ? ANGELN.STRIKE_MS_RARE : ANGELN.STRIKE_MS);
        }
        break;
      case 'bite':
        if (now >= p.until) this.lose(p, 'late', now);
        break;
      case 'reel':
        this.reel(id, p, now, dt);
        break;
      case 'caught':
      case 'lost':
        if (now >= p.until) this.toIdle(p);
        break;
    }
    p.left = Math.max(0, p.until - now);
  }

  /** Fisch auswählen (je tiefer, desto größer), Bisszeit und Zupfer festlegen */
  private prepareBite(p: P, now: number) {
    const d = p.depth;
    const weights = FISH_KINDS.map((k) => {
      const f = FISH[k];
      const z = (d - f.depth) / f.spread;
      return f.weight * Math.exp(-(z * z) / 2);
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let kind: FishKind = 'rotauge';
    for (let i = 0; i < FISH_KINDS.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        kind = FISH_KINDS[i];
        break;
      }
    }
    const f = FISH[kind];
    // Tiefe Würfe → eher schwere Exemplare
    const frac = Math.pow(Math.random(), 1.8 - 1.2 * d);
    const rawKg = f.kg[0] + (f.kg[1] - f.kg[0]) * frac;
    const kg = rawKg < 1 ? Math.round(rawKg * 100) / 100 : Math.round(rawKg * 10) / 10;
    const str = f.fight * (0.55 + 0.45 * frac);
    p.fish = { kind, kg, str };
    p.size = str < 0.12 ? 0 : str < 0.35 ? 1 : str < 0.65 ? 2 : 3;
    p.biteAt = now + rand(ANGELN.BITE_MIN_MS, ANGELN.BITE_MAX_MS) * (0.85 + 0.3 * d);
    const n = Math.random() < 0.3 ? 0 : Math.random() < 0.6 ? 1 : 2;
    p.nibbleAt = Array.from({ length: n }, () => rand(now + 900, p.biteAt - 700))
      .filter((t) => t > now)
      .sort((a, b) => a - b);
  }

  /** Drill: Spannung und Reststrecke */
  private reel(id: string, p: P, now: number, dt: number) {
    const s = p.fish?.str ?? 0;
    // Zug in Schüben, mal nach links, mal nach rechts
    if (p.pull === 0 && s >= 0.12 && now >= p.nextBurst) {
      p.pull = Math.random() < 0.5 ? -1 : 1;
      p.burstUntil = now + rand(500, 1000) + 500 * s;
      p.burstPow = 0.35 + 0.55 * s;
    } else if (p.pull !== 0 && now >= p.burstUntil) {
      p.pull = 0;
      p.nextBurst = now + rand(1200, 2800) * (1.5 - 0.5 * s);
    }
    const pull = 0.12 + 0.3 * s + (p.pull ? p.burstPow : 0);
    // Gegen die Zugrichtung kippen hilft
    const counter = p.pull ? clamp(-p.tilt * p.pull, 0, 1) * ANGELN.TILT_COUNTER : 0;
    const eff = pull * (1 - counter);
    if (p.hold) {
      p.tension += (ANGELN.REEL_UP + ANGELN.PULL_UP * eff) * dt;
      if (p.tension > ANGELN.SLACK) {
        const speed = ANGELN.REEL_FAST - (ANGELN.REEL_FAST - ANGELN.REEL_SLOW) * s;
        p.prog -= speed * (p.pull ? 0.6 : 1) * dt;
      }
    } else {
      p.tension += (-ANGELN.REL_DOWN + ANGELN.PULL_HOLD * eff) * dt;
      p.prog = Math.min(1, p.prog + ANGELN.TAKE_LINE * eff * dt);
    }
    p.tension = clamp(p.tension, 0, ANGELN.SNAP);
    if (p.tension >= ANGELN.SNAP) return this.lose(p, 'snap', now);
    if (p.tension < ANGELN.SLACK) {
      p.slack += dt * 1000;
      if (p.slack >= ANGELN.SLACK_MS) return this.lose(p, 'slack', now);
    } else {
      p.slack = Math.max(0, p.slack - dt * 2000);
    }
    if (p.prog <= 0) this.land(id, p, now);
  }

  private land(id: string, p: P, now: number) {
    const fish = p.fish;
    if (!fish) return this.toIdle(p);
    const c: AngelCatch = { seq: ++this.seq, pid: id, kind: fish.kind, kg: fish.kg, pts: fishPoints(fish.kind, fish.kg) };
    p.score += c.pts;
    p.count += 1;
    p.last = c;
    if (!p.best || c.pts > p.best.pts) p.best = c;
    if (!FISH[c.kind].junk && (!this.record || c.kg > this.record.kg)) this.record = c;
    this.catches.push(c);
    if (this.catches.length > 16) this.catches.shift();
    p.st = 'caught';
    p.until = now + ANGELN.CAUGHT_MS;
    p.prog = 0;
    p.hold = false;
    p.pull = 0;
  }

  private lose(p: P, why: AngelLost, now: number) {
    p.st = 'lost';
    p.lost = why;
    p.until = now + ANGELN.LOST_MS;
    p.hold = false;
    p.pull = 0;
    p.fish = null;
  }

  private toIdle(p: P) {
    p.st = 'idle';
    p.until = 0;
    p.fish = null;
    p.hold = false;
    p.pull = 0;
    p.tension = 0;
    p.prog = 1;
    p.slack = 0;
    p.nibbleAt = [];
    p.fy = ANGELN.NEAR_Y;
    p.fx = laneX(p.lane, this.ids.length);
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p || this.sub === 'over') return;
    const pl = asRecord(payload);
    const now = Date.now();
    if (action === 'cast') {
      if (this.sub !== 'play' || p.st !== 'idle') return;
      const power = Number(pl.power);
      const aim = Number(pl.aim);
      if (!Number.isFinite(power)) return;
      p.depth = clamp(power, ANGELN.MIN_POWER, 1);
      const w = laneW(this.ids.length);
      p.fx = laneX(p.lane, this.ids.length) + clamp(Number.isFinite(aim) ? aim : 0, -1, 1) * w * 0.38;
      p.fy = castY(p.depth);
      p.st = 'cast';
      p.castSeq += 1;
      p.until = now + ANGELN.CAST_MS;
      p.lost = null;
      p.nibbles = 0;
    } else if (action === 'strike') {
      if (p.st === 'wait') this.lose(p, 'early', now);
      else if (p.st === 'bite') {
        p.st = 'reel';
        p.tension = 0.4;
        p.prog = 1;
        p.slack = 0;
        p.pull = 0;
        p.nextBurst = now + rand(500, 1400);
        p.hold = false;
        p.until = 0;
      }
    } else if (action === 'reel') {
      if (p.st !== 'reel') return;
      p.hold = !!pl.hold;
      const tilt = Number(pl.tilt);
      p.tilt = Number.isFinite(tilt) ? clamp(tilt, -1, 1) : 0;
    } else if (action === 'reelIn') {
      if (p.st === 'wait' || p.st === 'cast') this.toIdle(p);
    }
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Ende

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.deadline = Date.now() + ANGELN.OVER_MS;
    this.ctx.onChange();
    this.timers.clear();
    const list = [...this.players.entries()];
    const rec = this.record;
    const subtitle = rec
      ? `Größter Fang: ${this.ctx.nameOf(rec.pid)} mit ${FISH[rec.kind].name}, ${fmtKg(rec.kg)}!`
      : list.some(([, p]) => p.count)
        ? 'Nur Krempel am Haken – aber immerhin!'
        : 'Heute wollte kein Fisch beißen …';
    this.timers.later(ANGELN.OVER_MS, () => {
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => this.players.get(id)?.score ?? 0),
        details: Object.fromEntries(
          list.map(([id, p]) => {
            const best = p.best ? ` · ${FISH[p.best.kind].name} ${fmtKg(p.best.kg)}` : '';
            return [id, `${p.score} P. · ${p.count} ${p.count === 1 ? 'Fang' : 'Fänge'}${best}`];
          }),
        ),
        subtitle,
      });
    });
  }

  snapshot(): MiniSnapshot {
    const players: Record<string, AngelPlayer> = {};
    for (const [id, p] of this.players) {
      players[id] = {
        lane: p.lane,
        st: p.st,
        castSeq: p.castSeq,
        fx: Math.round(p.fx * 10) / 10,
        fy: Math.round(p.fy * 10) / 10,
        depth: r2(p.depth),
        left: Math.round(p.left),
        nibbles: p.nibbles,
        tension: r2(p.tension),
        prog: r2(p.prog),
        pull: p.pull,
        slack: Math.round(p.slack),
        hold: p.hold,
        size: p.size,
        lost: p.lost,
        score: p.score,
        count: p.count,
        last: p.last,
        best: p.best,
      };
    }
    return {
      kind: 'angeln',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - Date.now()),
        players,
        catches: this.catches,
        record: this.record,
      },
    };
  }

  playerDisconnected(id: string) {
    const p = this.players.get(id);
    if (p) p.hold = false;
  }

  dispose() {
    this.timers.clear();
  }
}
