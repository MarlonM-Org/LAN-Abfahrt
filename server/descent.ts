import type { DescentState, MiniSnapshot } from '../shared/types';
import { DESCENT, DESCENT_LENGTH, DESCENT_OBSTACLES } from '../shared/dategames';
import { type MiniCtx, type MiniGame, Timers, groupByScore } from './minigame';

interface Runner {
  s: number;
  jumpUntil: number;
  stunUntil: number;
  hits: number;
  finished: boolean;
  finishMs: number | null;
  /** Hindernisse, über die der Läufer schon gestolpert ist – danach klettert er drüber statt erneut hängenzubleiben */
  cleared: Set<number>;
  /** Sprung gedrückt, während man noch stolpert/in der Luft ist → wird nachgeholt (Eingabepuffer) */
  jumpQueuedUntil: number;
}

/** So lange gilt ein zu früh gedrückter Sprung noch (ms) */
const JUMP_BUFFER_MS = 250;

const TICK_MS = 50;

/**
 * Der Abstieg: Beide laufen automatisch den Zickzack-Weg hinunter.
 * Von oben rollen Steine nach, auf dem Weg liegen Flaschen, Tauben und Pfützen.
 * Am Handy wird nur gesprungen.
 */
export class DescentGame implements MiniGame {
  readonly kind = 'descent' as const;
  private runners = new Map<string, Runner>();
  private stones: { id: number; s: number }[] = [];
  private stoneId = 0;
  private nextStone = 0;
  private sub: DescentState['sub'] = 'countdown';
  private deadline = 0;
  private startedAt = 0;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    ids.forEach((id, i) => this.runners.set(id, { s: 18 - i * 16, jumpUntil: 0, stunUntil: 0, hits: 0, finished: false, finishMs: null, cleared: new Set(), jumpQueuedUntil: 0 }));
    this.deadline = Date.now() + DESCENT.COUNTDOWN_MS;
    this.timers.later(DESCENT.COUNTDOWN_MS, () => this.start());
  }

  private start() {
    this.sub = 'run';
    this.startedAt = Date.now();
    this.deadline = this.startedAt + DESCENT.TIME_MS;
    this.nextStone = this.startedAt + 1500;
    let last = Date.now();
    this.timers.every(TICK_MS, () => {
      const now = Date.now();
      this.tick(now, (now - last) / 1000);
      last = now;
    });
    this.ctx.onChange();
  }

  private tick(now: number, dt: number) {
    if (this.sub !== 'run') return;
    // Läufer
    for (const r of this.runners.values()) {
      if (r.finished || now < r.stunUntil) continue;
      // Gepufferter Sprung (zu früh gedrückt) – sobald man wieder auf den Beinen ist
      if (r.jumpQueuedUntil >= now && now >= r.jumpUntil) {
        r.jumpQueuedUntil = 0;
        r.jumpUntil = now + DESCENT.JUMP_MS;
      }
      const prev = r.s;
      r.s += DESCENT.SPEED * dt;
      const airborne = now < r.jumpUntil;
      if (!airborne) {
        const i = DESCENT_OBSTACLES.findIndex((o, k) => !r.cleared.has(k) && prev < o.s - 4 && r.s >= o.s - 4);
        if (i >= 0) {
          // Gestolpert: kurz liegen, dann über das Hindernis klettern (nie zweimal am selben hängen bleiben)
          r.s = DESCENT_OBSTACLES[i].s - 6;
          r.stunUntil = now + DESCENT.STUN_OBSTACLE_MS;
          r.hits += 1;
          r.cleared.add(i);
          r.jumpQueuedUntil = 0;
        }
      }
      if (r.s >= DESCENT_LENGTH) {
        r.s = DESCENT_LENGTH;
        r.finished = true;
        r.finishMs = now - this.startedAt;
      }
    }
    // Steine
    if (now >= this.nextStone) {
      this.stones.push({ id: ++this.stoneId, s: 0 });
      this.nextStone = now + 2000 + Math.random() * 1600;
    }
    for (const st of this.stones) st.s += DESCENT.STONE_SPEED * dt;
    this.stones = this.stones.filter((st) => {
      if (st.s > DESCENT_LENGTH) return false;
      for (const r of this.runners.values()) {
        if (r.finished || now < r.jumpUntil || now < r.stunUntil) continue;
        if (Math.abs(st.s - r.s) < DESCENT.HIT_RADIUS) {
          r.hits += 1;
          r.stunUntil = now + DESCENT.STUN_STONE_MS;
          return false;
        }
      }
      return true;
    });

    const allDone = [...this.runners.values()].every((r) => r.finished);
    if (allDone || now >= this.deadline) this.end();
    else this.ctx.onChange();
  }

  input(id: string, action: string) {
    const r = this.runners.get(id);
    if (!r || action !== 'jump' || this.sub !== 'run' || r.finished) return;
    const now = Date.now();
    if (now < r.jumpUntil || now < r.stunUntil) {
      // Zu früh gedrückt (kurz vor der Landung bzw. beim Aufstehen): kurz merken statt verschlucken
      if (now < r.stunUntil || r.jumpUntil - now < 200) r.jumpQueuedUntil = Math.max(r.jumpUntil, r.stunUntil, now) + JUMP_BUFFER_MS;
      return;
    }
    r.jumpUntil = now + DESCENT.JUMP_MS;
    this.ctx.onChange();
  }

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.timers.clear();
    this.ctx.onChange();
    const runners = [...this.runners.entries()];
    const hits = runners.reduce((a, [, r]) => a + r.hits, 0);
    const unfinished = runners.filter(([, r]) => !r.finished).length;
    const hearts = Math.max(1, Math.min(10, 10 - hits - unfinished * 3));
    const coop = this.ctx.mode === 'date';
    // Wettkampf: Wer zuerst unten ist (Stolperer kosten 1,5 s), sonst wer am weitesten kam
    const score = (r: Runner) => (r.finished ? 1e6 - (r.finishMs! + r.hits * 1500) : r.s);
    this.timers.later(2500, () =>
      this.ctx.finish({
        groups: coop ? [this.ids] : groupByScore(this.ids, (id) => score(this.runners.get(id)!)),
        details: Object.fromEntries(
          runners.map(([id, r]) => [id, r.finished ? `${(r.finishMs! / 1000).toFixed(1)}s · ${r.hits}x gestolpert` : `nicht unten · ${r.hits}x gestolpert`]),
        ),
        subtitle: unfinished ? 'Puh, der Abhang hatte es in sich!' : hits <= 2 ? 'Elegant wie Gämsen – ihr seid unten!' : 'Unten angekommen – mit ein paar blauen Flecken.',
        hearts: coop ? hearts : undefined,
      }),
    );
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    return {
      kind: 'descent',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - now),
        length: DESCENT_LENGTH,
        runners: Object.fromEntries(
          [...this.runners.entries()].map(([id, r]) => [
            id,
            { s: r.s, jumpLeft: Math.max(0, r.jumpUntil - now), stunned: now < r.stunUntil, hits: r.hits, finished: r.finished },
          ]),
        ),
        stones: this.stones,
        obstacles: DESCENT_OBSTACLES,
      },
    };
  }

  playerDisconnected() {}

  dispose() {
    this.timers.clear();
  }
}
