import type { MiniSnapshot, WrapState } from '../shared/types';
import { INGREDIENT_NAMES, WRAP, WRAP_DISTRACTORS, WRAP_RECIPE } from '../shared/dategames';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

/**
 * Wraps mit Sriracha-Mayo: Am Handy dreht sich ein Zutatenrad.
 * Wer im richtigen Moment greift, bekommt die nächste Zutat. Jeder baut für den anderen.
 */
export class WrapGame implements MiniGame {
  readonly kind = 'wrap' as const;
  private state: WrapState;
  private started = Date.now();
  private deadline = Date.now() + WRAP.TIME_MS;
  private timers = new Timers();
  private seq = 0;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.state = {
      sub: 'build',
      endsIn: WRAP.TIME_MS,
      recipe: WRAP_RECIPE,
      players: Object.fromEntries(
        ids.map((id) => [id, { step: 0, mistakes: 0, done: false, doneMs: null, wheel: shuffle([...WRAP_RECIPE, ...WRAP_DISTRACTORS]), speed: WRAP.BASE_SPEED, lastGrab: null }]),
      ),
      forWhom: Object.fromEntries(ids.map((id, i) => [id, ids[(i + 1) % ids.length]])),
    };
    this.timers.later(WRAP.TIME_MS, () => this.end());
  }

  snapshot(): MiniSnapshot {
    return { kind: 'wrap', state: { ...this.state, endsIn: Math.max(0, this.deadline - Date.now()) } };
  }

  input(id: string, action: string, payload: unknown) {
    const p = this.state.players[id];
    if (!p || p.done || action !== 'grab' || this.state.sub !== 'build') return;
    const item = String(asRecord(payload).item ?? '');
    if (!(item in INGREDIENT_NAMES)) return;
    const ok = item === WRAP_RECIPE[p.step];
    p.lastGrab = { item, ok, seq: ++this.seq };
    if (ok) {
      p.step += 1;
      p.speed = WRAP.BASE_SPEED + p.step * WRAP.SPEED_STEP;
      p.wheel = shuffle(p.wheel);
      if (p.step >= WRAP_RECIPE.length) {
        p.done = true;
        p.doneMs = Date.now() - this.started;
      }
    } else {
      p.mistakes += 1;
    }
    if (Object.values(this.state.players).every((pl) => pl.done)) this.end();
    else this.ctx.onChange();
  }

  private end() {
    if (this.state.sub === 'over') return;
    this.state.sub = 'over';
    this.timers.clear();
    this.ctx.onChange();
    const players = Object.entries(this.state.players);
    const per = 10 / Math.max(1, players.length);
    let hearts = 0;
    for (const [, p] of players) {
      const part = p.done ? per - Math.min(per * 0.6, p.mistakes * 0.6) - ((p.doneMs ?? 0) > 40000 ? 1 : 0) : (p.step / WRAP_RECIPE.length) * per * 0.4;
      hearts += Math.max(0, part);
    }
    hearts = Math.max(0, Math.min(10, Math.round(hearts)));
    const coop = this.ctx.mode === 'date';
    const score = (id: string) => {
      const p = this.state.players[id];
      return p.done ? 1e6 - ((p.doneMs ?? 0) + p.mistakes * 2000) : p.step * 1000 - p.mistakes;
    };
    this.timers.later(2500, () =>
      this.ctx.finish({
        groups: coop ? [this.ids] : groupByScore(this.ids, score),
        details: Object.fromEntries(
          players.map(([id, p]) => [id, p.done ? `fertig in ${((p.doneMs ?? 0) / 1000).toFixed(1)}s · ${p.mistakes} Patzer` : `${p.step}/${WRAP_RECIPE.length} Zutaten`]),
        ),
        subtitle: hearts >= 8 ? 'Perfekte Wraps – mit extra viel Sriracha-Mayo!' : hearts >= 5 ? 'Lecker – auch wenn nicht alles ganz drin blieb.' : 'Kreative Wraps ... sagen wir mal so.',
        hearts: coop ? hearts : undefined,
      }),
    );
  }

  playerDisconnected() {}

  dispose() {
    this.timers.clear();
  }
}
