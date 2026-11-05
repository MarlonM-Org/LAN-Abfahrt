import type { MiniSnapshot, SprintState } from '../shared/types';
import { SPRINT, SPRINT_POINTS } from '../shared/games';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore } from './minigame';

/**
 * Liegestuhl-Sprint: Warten, bis die Sonne aufgeht – dann so schnell wie möglich tippen.
 * Wer vorher tippt, hat einen Fehlstart. Die Reaktionszeit misst der Server selbst
 * (Zeit zwischen „LOS“ und Eingang des Taps, abzüglich der vom Handy per Uhrabgleich
 * gemessenen Laufzeit). Die Zeit, die das Handy meldet, dient nur als Plausibilitätsgrenze.
 */
/** Höchstens so viel Netzwerk-Laufzeit wird abgezogen (schützt vor geschönten Angaben) */
const MAX_RTT_MS = 250;

export class SprintGame implements MiniGame {
  readonly kind = 'sprint' as const;
  private state: SprintState;
  private timers = new Timers();
  /** Serverzeit, zu der „LOS“ verschickt wurde */
  private goAt = 0;

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
        s.times[playerId] = this.reactionMs(p);
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

  playerDisconnected() {
    const s = this.state;
    if (s.sub === 'go' && this.ids.filter((id) => this.ctx.isConnected(id)).every((id) => s.times[id] !== null)) {
      this.timers.clear();
      this.reveal();
    }
  }

  /**
   * Reaktionszeit aus Server-Sicht: Rohzeit seit „LOS“ minus Laufzeit hin (LOS ans Handy) und zurück (Tap zum
   * Server), also eine volle Round-Trip-Zeit – geschätzt per Uhrabgleich am Handy (`rtt`), gedeckelt.
   * Die Handy-Zeit (`ms`) hebt das Ergebnis höchstens an (wer behauptet, langsamer gewesen zu sein, bekommt das),
   * kann es aber nie unter die Server-Schätzung drücken.
   */
  private reactionMs(p: Record<string, unknown>) {
    const raw = Math.min(SPRINT.GO_MS, Math.max(0, Date.now() - this.goAt));
    const rtt = Number(p.rtt);
    const net = Number.isFinite(rtt) ? Math.min(MAX_RTT_MS, Math.max(0, rtt)) : 0;
    const est = Math.max(0, raw - net);
    const phone = Number(p.ms);
    const t = Number.isFinite(phone) ? Math.max(est, Math.min(raw, phone)) : est;
    return Math.round(t);
  }

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
      this.goAt = Date.now();
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
