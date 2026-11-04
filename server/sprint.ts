import type { MiniSnapshot, SprintState } from '../shared/types';
import { SPRINT, SPRINT_POINTS } from '../shared/games';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore } from './minigame';

/**
 * Liegestuhl-Sprint: Warten, bis die Sonne aufgeht – dann so schnell wie möglich tippen.
 * Wer vorher tippt, hat einen Fehlstart. Die Reaktionszeit misst das Handy selbst
 * (fair, weil Netzwerk-Laufzeiten nicht mitzählen).
 */
export class SprintGame implements MiniGame {
  readonly kind = 'sprint' as const;
  private state: SprintState;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const points: Record<string, number> = {};
    for (const id of ids) points[id] = 0;
    this.state = { round: 0, rounds: SPRINT.ROUNDS, sub: 'wait', goSeq: 0, times: {}, points };
    this.nextRound();
  }

  snapshot(): MiniSnapshot {
    return { kind: 'sprint', state: this.state };
  }

  input(playerId: string, action: string, payload: unknown) {
    if (action !== 'tap' || !this.ids.includes(playerId)) return;
    const s = this.state;
    if (s.times[playerId] !== null) return; // schon getippt / Fehlstart
    if (s.sub === 'wait') {
      s.times[playerId] = 'early';
    } else if (s.sub === 'go') {
      const p = asRecord(payload);
      if (Number(p.seq) !== s.goSeq) {
        s.times[playerId] = 'early';
      } else {
        const ms = Number(p.ms);
        s.times[playerId] = Number.isFinite(ms) ? Math.round(Math.max(0, Math.min(SPRINT.GO_MS, ms))) : SPRINT.GO_MS;
      }
    } else {
      return;
    }
    this.ctx.onChange();
    if (s.sub === 'go' && this.ids.filter((id) => this.ctx.isConnected(id)).every((id) => s.times[id] !== null)) {
      this.timers.clear();
      this.reveal();
    }
  }

  playerDisconnected() {}

  dispose() {
    this.timers.clear();
  }

  private nextRound() {
    const s = this.state;
    if (s.round >= s.rounds) return this.finish();
    s.round += 1;
    s.sub = 'wait';
    s.times = Object.fromEntries(this.ids.map((id) => [id, null]));
    this.ctx.onChange();
    const wait = SPRINT.MIN_WAIT_MS + Math.random() * (SPRINT.MAX_WAIT_MS - SPRINT.MIN_WAIT_MS);
    this.timers.later(wait, () => {
      s.sub = 'go';
      s.goSeq += 1;
      this.ctx.onChange();
      this.timers.later(SPRINT.GO_MS, () => this.reveal());
    });
  }

  private reveal() {
    const s = this.state;
    const valid = this.ids
      .filter((id) => typeof s.times[id] === 'number')
      .sort((a, b) => (s.times[a] as number) - (s.times[b] as number));
    valid.forEach((id, i) => (s.points[id] += SPRINT_POINTS[i] ?? 0));
    s.sub = 'reveal';
    this.ctx.onChange();
    this.timers.later(SPRINT.REVEAL_MS, () => this.nextRound());
  }

  private finish() {
    const s = this.state;
    s.sub = 'over';
    this.ctx.onChange();
    this.timers.later(500, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => s.points[id]),
        details: Object.fromEntries(this.ids.map((id) => [id, `${s.points[id]} Punkte`])),
        subtitle: 'Wer zuerst sein Handtuch drauf hat, kriegt die Liege.',
      }),
    );
  }
}
