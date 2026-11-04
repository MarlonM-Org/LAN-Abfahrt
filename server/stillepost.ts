import type { MiniSnapshot, PostDrawing, PostEntry, PrivateState, StillepostState } from '../shared/types';
import { POST, POST_PROMPTS, POST_ERASER, POST_BRUSHES } from '../shared/stillepost';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

type Task = 'write' | 'draw' | 'describe';

/**
 * Stille Post mit Bildern (à la Gartic Phone / Telestrations).
 * Jeder schreibt einen Startsatz, danach wandern die Ketten reihum:
 * malen → beschreiben → malen … Am Ende führt der TV jede Kette vor.
 *
 * Kette c gehört order[c]; Schritt k von Kette c macht order[(c + k) % n].
 * Weil es höchstens n Schritte gibt, sieht niemand seine eigene Kette wieder.
 */
export class StillepostGame implements MiniGame {
  readonly kind = 'stillepost' as const;
  private state: StillepostState;
  private order: string[];
  private n: number;
  private chains: PostEntry[][];
  private step = 0;
  /** Entwürfe/Abgaben des aktuellen Schritts */
  private drafts = new Map<string, { text?: string; drawing?: PostDrawing }>();
  private done = new Set<string>();
  private votes = new Map<string, number>();
  private suggestions = new Map<string, { text: string; seq: number }>();
  private pool: string[];
  private deadline = 0;
  private timers = new Timers();
  private best: { by: string; likes: number; entry: PostEntry } | null = null;

  constructor(
    ids: string[],
    private ctx: MiniCtx,
    customPrompts: string[] = [],
  ) {
    this.order = shuffle(ids);
    this.n = this.order.length;
    this.chains = this.order.map(() => []);
    // Eigene Startsätze der Gruppe zuerst anbieten, dann die Standardsätze
    const custom = shuffle(customPrompts);
    this.pool = [...custom, ...shuffle(POST_PROMPTS.filter((p) => !custom.includes(p)))];
    this.state = {
      sub: 'write',
      round: 1,
      steps: Math.max(1, Math.min(this.n, POST.MAX_STEPS)),
      endsIn: 0,
      order: this.order,
      done: [],
      chain: 0,
      chains: this.n,
      shown: 0,
      entries: [],
      voted: [],
      chainLikes: null,
      likes: Object.fromEntries(this.order.map((id) => [id, 0])),
    };
    this.startStep(0);
  }

  // ---------------------------------------------------------------- Spielrunde

  private taskOf(step: number): Task {
    return step === 0 ? 'write' : step % 2 === 1 ? 'draw' : 'describe';
  }

  private chainOf(playerIdx: number, step = this.step) {
    return (((playerIdx - step) % this.n) + this.n) % this.n;
  }

  private startStep(step: number) {
    this.step = step;
    const task = this.taskOf(step);
    const ms = task === 'write' ? POST.WRITE_MS : task === 'draw' ? POST.DRAW_MS : POST.DESCRIBE_MS;
    const s = this.state;
    s.sub = task;
    s.round = step + 1;
    s.done = [];
    this.done.clear();
    this.drafts.clear();
    this.deadline = Date.now() + ms;
    this.timers.clear();
    this.timers.later(ms, () => this.endStep(step));
    this.ctx.onChange();
  }

  private get playing() {
    const sub = this.state.sub;
    return sub === 'write' || sub === 'draw' || sub === 'describe';
  }

  /** Schritt abschließen (mehrfache Aufrufe für denselben Schritt werden ignoriert) */
  private endStep(step: number) {
    if (step !== this.step || !this.playing) return;
    this.timers.clear();
    const task = this.taskOf(this.step);
    this.order.forEach((id, i) => {
      const d = this.drafts.get(id);
      const chain = this.chains[this.chainOf(i)];
      if (task === 'draw') {
        chain.push({ by: id, kind: 'drawing', drawing: d?.drawing ?? { s: [] } });
      } else {
        const fallback = task === 'write' ? this.nextPrompt() : '??? (keine Ahnung)';
        chain.push({ by: id, kind: 'text', text: d?.text || fallback });
      }
    });
    if (this.step + 1 < this.state.steps) this.startStep(this.step + 1);
    else this.startReveal();
  }

  private nextPrompt() {
    const p = this.pool.shift() ?? POST_PROMPTS[Math.floor(Math.random() * POST_PROMPTS.length)];
    this.pool.push(p);
    return p;
  }

  private checkAllDone() {
    const s = this.state;
    if (this.playing) {
      const active = this.order.filter((id) => this.ctx.isConnected(id));
      const step = this.step;
      if (active.length && active.every((id) => this.done.has(id))) this.timers.later(500, () => this.endStep(step));
    } else if (s.sub === 'vote') {
      const voters = this.order.filter((id) => this.ctx.isConnected(id) && this.canVote(id));
      if (voters.every((id) => this.votes.has(id))) this.timers.later(600, () => this.endVote());
    }
  }

  // ---------------------------------------------------------------- Vorführung

  private startReveal() {
    const s = this.state;
    s.sub = 'reveal';
    s.chain = 0;
    s.round = 1;
    s.shown = 1;
    s.done = [];
    this.deadline = 0;
    this.ctx.onChange();
  }

  private ownEntries(id: string) {
    return this.chains[this.state.chain].flatMap((e, i) => (e.by === id ? [i] : []));
  }

  private canVote(id: string) {
    return this.ownEntries(id).length < this.chains[this.state.chain].length;
  }

  private startVote() {
    const s = this.state;
    s.sub = 'vote';
    s.voted = [];
    this.votes.clear();
    this.deadline = Date.now() + POST.VOTE_MS;
    this.timers.clear();
    this.timers.later(POST.VOTE_MS, () => this.endVote());
    this.ctx.onChange();
  }

  private endVote() {
    const s = this.state;
    if (s.sub !== 'vote') return;
    this.timers.clear();
    const chain = this.chains[s.chain];
    const likes = chain.map(() => 0);
    for (const v of this.votes.values()) likes[v] += 1;
    chain.forEach((e, i) => {
      s.likes[e.by] = (s.likes[e.by] ?? 0) + likes[i];
      if (likes[i] > 0 && (!this.best || likes[i] > this.best.likes)) this.best = { by: e.by, likes: likes[i], entry: e };
    });
    s.chainLikes = likes;
    s.sub = 'tally';
    this.deadline = 0;
    this.ctx.onChange();
  }

  private nextChain() {
    const s = this.state;
    if (s.chain + 1 >= this.n) return this.finish();
    s.chain += 1;
    s.round = s.chain + 1;
    s.shown = 1;
    s.voted = [];
    s.chainLikes = null;
    s.sub = 'reveal';
    this.ctx.onChange();
  }

  vipAction(action: string) {
    const s = this.state;
    if (action !== 'next') return;
    if (s.sub === 'reveal') {
      if (s.shown < this.chains[s.chain].length) {
        s.shown += 1;
        this.ctx.onChange();
      } else this.startVote();
    } else if (s.sub === 'vote') this.endVote();
    else if (s.sub === 'tally') this.nextChain();
  }

  private finish() {
    const s = this.state;
    s.sub = 'over';
    this.timers.clear();
    this.ctx.onChange();
    const best = this.best;
    const subtitle = best
      ? `Publikumsliebling: ${this.ctx.nameOf(best.by)} mit ${best.entry.kind === 'drawing' ? 'einem Kunstwerk' : `„${shorten(best.entry.text ?? '', 40)}“`}`
      : 'Hauptsache, es wurde gelacht!';
    this.timers.later(800, () =>
      this.ctx.finish({
        groups: groupByScore(this.order, (id) => s.likes[id] ?? 0),
        details: Object.fromEntries(this.order.map((id) => [id, `${s.likes[id] ?? 0} Like${s.likes[id] === 1 ? '' : 's'}`])),
        subtitle,
      }),
    );
  }

  // ---------------------------------------------------------------- Schnittstelle

  snapshot(): MiniSnapshot {
    const s = this.state;
    const reveal = s.sub === 'reveal' || s.sub === 'vote' || s.sub === 'tally';
    const chain = reveal ? this.chains[s.chain] : [];
    return {
      kind: 'stillepost',
      state: {
        ...s,
        done: [...this.done],
        voted: [...this.votes.keys()],
        endsIn: this.deadline ? Math.max(0, this.deadline - Date.now()) : 0,
        entries: s.sub === 'reveal' ? chain.slice(0, s.shown) : chain,
      },
    };
  }

  privateFor(id: string): PrivateState {
    const s = this.state;
    const i = this.order.indexOf(id);
    if (i < 0) return null;
    const base = { round: s.round, text: null, suggest: null, drawing: null, done: false, own: [] as number[], myVote: null };
    if (s.sub === 'write' || s.sub === 'draw' || s.sub === 'describe') {
      const prev = this.step > 0 ? this.chains[this.chainOf(i)][this.step - 1] : null;
      return {
        kind: 'stillepost',
        state: {
          ...base,
          task: s.sub,
          text: s.sub === 'draw' ? (prev?.text ?? '') : null,
          suggest: s.sub === 'write' ? (this.suggestions.get(id) ?? null) : null,
          drawing: s.sub === 'describe' ? (prev?.drawing ?? { s: [] }) : null,
          done: this.done.has(id),
        },
      };
    }
    if (s.sub === 'vote') {
      return { kind: 'stillepost', state: { ...base, task: 'vote', own: this.ownEntries(id), myVote: this.votes.get(id) ?? null } };
    }
    return { kind: 'stillepost', state: { ...base, task: 'none' } };
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (!this.order.includes(id)) return;
    const p = asRecord(payload);
    const playing = this.playing;

    if (action === 'random' && s.sub === 'write' && !this.done.has(id)) {
      const text = this.nextPrompt();
      const seq = (this.suggestions.get(id)?.seq ?? 0) + 1;
      this.suggestions.set(id, { text, seq });
      this.drafts.set(id, { text });
      return this.ctx.onChange();
    }
    if (action === 'text' && (s.sub === 'write' || s.sub === 'describe')) {
      if (Number(p.round) !== s.round || this.done.has(id)) return;
      this.drafts.set(id, { text: cleanText(p.text) });
      if (p.done) this.markDone(id);
      return;
    }
    if (action === 'drawing' && s.sub === 'draw') {
      if (Number(p.round) !== s.round || this.done.has(id)) return;
      this.drafts.set(id, { drawing: cleanDrawing(p.drawing) });
      if (p.done) this.markDone(id);
      return;
    }
    if (action === 'undone' && playing && this.done.delete(id)) {
      const step = this.step;
      this.timers.clear();
      this.timers.later(Math.max(0, this.deadline - Date.now()), () => this.endStep(step));
      return this.ctx.onChange();
    }
    if (action === 'vote' && s.sub === 'vote' && !this.votes.has(id)) {
      const entry = Number(p.entry);
      const chain = this.chains[s.chain];
      if (!Number.isInteger(entry) || entry < 0 || entry >= chain.length || chain[entry].by === id) return;
      this.votes.set(id, entry);
      this.ctx.onChange();
      this.checkAllDone();
    }
  }

  private markDone(id: string) {
    this.done.add(id);
    this.ctx.onChange();
    this.checkAllDone();
  }

  playerDisconnected() {
    this.checkAllDone();
  }

  dispose() {
    this.timers.clear();
  }
}

const shorten = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 3).trimEnd()}...` : t);

function cleanText(raw: unknown) {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, POST.MAX_TEXT);
}

/** Zeichnung prüfen: nur ganze Zahlen im Raster, Punkte und Striche gedeckelt */
export function cleanDrawing(raw: unknown): PostDrawing {
  const strokes = asRecord(raw).s;
  const out: PostDrawing = { s: [] };
  if (!Array.isArray(strokes)) return out;
  let budget = POST.MAX_POINTS;
  for (const st of strokes.slice(0, POST.MAX_STROKES)) {
    const r = asRecord(st);
    const pts = Array.isArray(r.p) ? r.p : [];
    const n = Math.min(Math.floor(pts.length / 2), budget);
    if (n < 1) continue;
    const p: number[] = new Array(n * 2);
    for (let i = 0; i < n * 2; i++) {
      const v = Math.round(Number(pts[i]));
      p[i] = Number.isFinite(v) ? Math.max(0, Math.min(POST.GRID, v)) : 0;
    }
    const c = Math.round(Number(r.c));
    const w = Math.round(Number(r.w));
    out.s.push({
      c: Number.isFinite(c) ? Math.max(0, Math.min(POST_ERASER, c)) : 0,
      w: Number.isFinite(w) ? Math.max(0, Math.min(POST_BRUSHES.length - 1, w)) : 1,
      p,
    });
    budget -= n;
    if (budget <= 0) break;
  }
  return out;
}
