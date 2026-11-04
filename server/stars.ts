import type { MiniSnapshot, StarsState } from '../shared/types';
import { CONSTELLATIONS, STARS } from '../shared/dategames';
import { type MiniCtx, type MiniGame, Timers, asRecord, shuffle } from './minigame';

/**
 * Tanz unter den Sternen: Gemeinsam Sterne zu Sternbildern verbinden.
 * Beide Handys zeigen denselben Himmel, jede richtige Linie zählt für beide.
 */
export class StarsGame implements MiniGame {
  readonly kind = 'stars' as const;
  private state: StarsState;
  private deadline = Date.now() + STARS.TIME_MS;
  private timers = new Timers();
  private seq = 0;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.state = {
      sub: 'draw',
      endsIn: STARS.TIME_MS,
      round: 0,
      rounds: CONSTELLATIONS.length,
      name: '',
      hint: '',
      stars: [],
      edges: [],
      found: [],
      edgeTotal: 0,
      wrong: 0,
      completed: 0,
      lastWrong: null,
    };
    this.nextRound();
    this.timers.later(STARS.TIME_MS, () => this.end());
  }

  private nextRound() {
    const s = this.state;
    if (s.round >= CONSTELLATIONS.length) return this.end();
    const c = CONSTELLATIONS[s.round];
    s.round += 1;
    s.sub = 'draw';
    s.name = c.name;
    s.hint = c.hint;
    // Sternbild etwas zufällig verschieben/skalieren, dazu Ablenkungssterne
    const sc = 0.78 + Math.random() * 0.12;
    const ox = (1 - sc) * Math.random();
    const oy = (1 - sc) * Math.random();
    const pts = c.stars.map(([x, y]) => ({ x: ox + x * sc, y: oy + y * sc, big: true }));
    let tries = 0;
    while (pts.length < c.stars.length + STARS.DISTRACTORS && tries++ < 500) {
      const p = { x: 0.05 + Math.random() * 0.9, y: 0.06 + Math.random() * 0.88, big: Math.random() < 0.35 };
      if (pts.every((q) => Math.hypot(q.x - p.x, (q.y - p.y) * 0.66) > 0.09)) pts.push(p);
    }
    const ids = shuffle(pts.map((_, i) => i));
    s.stars = pts.map((p, i) => ({ id: ids[i], x: p.x, y: p.y, big: p.big }));
    s.edges = c.edges.map(([a, b]) => [ids[a], ids[b]] as [number, number]);
    s.found = [];
    this.ctx.onChange();
  }

  snapshot(): MiniSnapshot {
    // Die Lösung (edges) bleibt geheim – nur bereits gefundene Linien werden geschickt
    return { kind: 'stars', state: { ...this.state, edges: [], edgeTotal: this.state.edges.length, endsIn: Math.max(0, this.deadline - Date.now()) } };
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (action !== 'link' || s.sub !== 'draw' || !this.ids.includes(id)) return;
    const p = asRecord(payload);
    const a = Number(p.a);
    const b = Number(p.b);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return;
    const same = (e: [number, number]) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a);
    if (s.found.some(same)) return;
    if (s.edges.some(same)) {
      s.found.push([a, b]);
      if (s.found.length >= s.edges.length) {
        s.sub = 'done';
        s.completed += 1;
        this.timers.later(STARS.DONE_MS, () => this.nextRound());
      }
    } else {
      s.wrong += 1;
      s.lastWrong = { a, b, seq: ++this.seq };
    }
    this.ctx.onChange();
  }

  private end() {
    const s = this.state;
    if (s.sub === 'over') return;
    s.sub = 'over';
    this.timers.clear();
    this.ctx.onChange();
    const hearts = Math.max(0, Math.min(10, s.completed * 2 + (s.completed === s.rounds ? 2 : 0) - Math.floor(s.wrong / 4)));
    this.timers.later(2500, () =>
      this.ctx.finish({
        groups: [this.ids],
        details: Object.fromEntries(this.ids.map((id) => [id, `${s.completed}/${s.rounds} Sternbilder`])),
        subtitle: s.completed === s.rounds ? 'Ihr habt sogar euer Herz am Himmel gefunden.' : 'Die Sterne waren schön – egal welche es waren.',
        hearts: this.ctx.mode === 'date' ? hearts : undefined,
      }),
    );
  }

  playerDisconnected() {}

  dispose() {
    this.timers.clear();
  }
}
