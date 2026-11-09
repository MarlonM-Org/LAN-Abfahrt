import type { MiniSnapshot, PrivateState, SkipInfo } from '../shared/types';
import { LEXIKON, LEX_TOO_CLOSE, type LexState, type LexStep, lexClean, lexKey, lexRounds, lexTooClose } from '../shared/lexikon';
import { LEX_ENTRIES, type LexEntry } from './lexikonData';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, groupByScore, shuffle, waitLabel } from './minigame';

// ---------------------------------------------------------------- Auswahl der Einträge (kein Eintrag doppelt pro Abend)

/** Schon gespielte Einträge (Aufgabentext) – lebt so lange wie der Server, also einen Abend lang */
const usedTonight = new Set<string>();

/** Für Tests: Gedächtnis des Abends löschen */
export function lexResetAbend() {
  usedTonight.clear();
}

/**
 * `n` Einträge für ein Spiel: nur noch nicht gespielte (sind alle durch, geht es von vorn los),
 * möglichst abwechselnd Wort/Herkunft/Fakt. Als gespielt gilt ein Eintrag erst, wenn seine Frage startet.
 */
export function lexPick(n: number, pool: readonly LexEntry[] = LEX_ENTRIES): LexEntry[] {
  const fresh = pool.filter((e) => !usedTonight.has(e.q));
  let extra: LexEntry[] = [];
  if (fresh.length < n) {
    // Alle einmal durch: erst die letzten frischen, dann geht es von vorn los
    usedTonight.clear();
    extra = shuffle(pool.filter((e) => !fresh.includes(e))).slice(0, n - fresh.length);
  }
  const rest = shuffle(fresh);
  const out: LexEntry[] = [];
  while (out.length < n && rest.length) {
    const prev = out[out.length - 1]?.cat;
    const i = Math.max(0, rest.findIndex((e) => e.cat !== prev));
    out.push(rest.splice(i, 1)[0]);
  }
  return [...out, ...extra];
}

/** Eine Antwort in der Abstimmung */
interface Answer {
  text: string;
  key: string;
  truth: boolean;
  /** Haus-Lüge (vom Lexikon, nicht von einem Spieler) */
  house: boolean;
  /** Autoren – gleiche Lügen werden zusammengefasst */
  by: string[];
}

/**
 * Lügen-Lexikon (à la Fibbage).
 * Ein seltenes Wort oder ein kurioser Fakt mit Lücke: Alle schreiben eine glaubwürdige Fälschung (zu nah an der Wahrheit
 * wird freundlich abgewiesen, gleiche Lügen zusammengefasst, bei wenigen Lügen füllen Haus-Lügen auf). Dann tippt jeder auf
 * die vermutete Wahrheit – die eigene Lüge ist nicht wählbar. Aufdecken Lüge für Lüge (wer ist reingefallen, wem gehört
 * sie), zum Schluss die Wahrheit mit Erklärung. Punkte: Wahrheit gefunden +100, pro reingefallenem Mitspieler +50 für den
 * Lügner; die letzte Frage zählt doppelt. Auf dem Spielbrett nur eine Frage.
 */
export class LexikonGame implements MiniGame {
  readonly kind = 'lexikon' as const;
  private state: LexState;
  private plan: LexEntry[];
  private entry: LexEntry;
  private lies = new Map<string, string>();
  private drafts = new Map<string, string>();
  private rejects = new Map<string, { seq: number; text: string }>();
  private suggestions = new Map<string, { seq: number; text: string }>();
  private answers: Answer[] = [];
  private picks = new Map<string, number>();
  private stepPlan: LexStep[] = [];
  private pendingGain: Record<string, number> = {};
  /** Für den Untertitel: beste Lüge und wie oft jemand die Wahrheit fand */
  private best: { by: string[]; text: string; fooled: number } | null = null;
  private found = new Map<string, number>();
  private deadline = 0;
  private timers = new Timers();
  private pending: (() => void) | null = null;
  private seq = 0;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const rounds = ctx.mode === 'party' ? LEXIKON.PARTY_ROUNDS : lexRounds(ids.length);
    this.plan = lexPick(rounds);
    this.entry = this.plan[0];
    const zero = () => Object.fromEntries(ids.map((id) => [id, 0]));
    this.state = {
      sub: 'write',
      round: 0,
      rounds: this.plan.length,
      mult: 1,
      endsIn: 0,
      cat: this.entry.cat,
      prompt: '',
      players: [...ids],
      written: [],
      options: null,
      voted: [],
      steps: [],
      stepCount: 0,
      why: null,
      authors: null,
      points: zero(),
      gain: zero(),
    };
    this.startRound(1);
  }

  // ---------------------------------------------------------------- Ablaufsteuerung (wie Sprüche-Duell)

  /** Nächsten Schritt nach `ms` ausführen (null = erst, wenn alle fertig sind) – VIP/Laptop können ihn vorziehen */
  private schedule(ms: number | null, fn: () => void) {
    this.timers.clear();
    this.deadline = ms === null ? 0 : Date.now() + ms;
    const token = ++this.seq;
    const run = () => {
      if (this.seq !== token) return;
      this.seq++;
      this.pending = null;
      this.timers.clear();
      fn();
    };
    this.pending = run;
    if (ms !== null) this.timers.later(ms, run);
  }

  /** Alle fertig → kurz durchatmen, dann weiter */
  private soon(ms = 900) {
    const run = this.pending;
    if (!run) return;
    this.timers.clear();
    this.timers.later(ms, run);
  }

  private connected = (id: string) => this.ctx.isConnected(id);

  private tooClose(text: string) {
    return lexTooClose(text, [this.entry.a, ...this.entry.alt]);
  }

  // ---------------------------------------------------------------- Schreiben

  private startRound(round: number) {
    const s = this.state;
    this.entry = this.plan[round - 1];
    usedTonight.add(this.entry.q);
    s.round = round;
    s.sub = 'write';
    s.cat = this.entry.cat;
    s.prompt = this.entry.q;
    s.mult = round === s.rounds && s.rounds > 1 ? LEXIKON.FINAL_MULT : 1;
    s.written = [];
    s.options = null;
    s.voted = [];
    s.steps = [];
    s.stepCount = 0;
    s.why = null;
    s.authors = null;
    for (const id of this.ids) s.gain[id] = 0;
    this.lies.clear();
    this.drafts.clear();
    this.rejects.clear();
    this.suggestions.clear();
    this.picks.clear();
    this.answers = [];
    this.stepPlan = [];
    this.schedule(LEXIKON.WRITE_MS, () => this.endWrite());
    this.ctx.onChange();
  }

  private reject(id: string, text: string) {
    this.rejects.set(id, { seq: (this.rejects.get(id)?.seq ?? 0) + 1, text });
    this.ctx.onChange();
  }

  /** „Lüge vorschlagen“: erst die Haus-Lügen dieses Eintrags, dann welche aus derselben Kategorie */
  private suggestFor(id: string) {
    const cur = this.suggestions.get(id)?.text;
    const taken = new Set([...this.lies.values(), ...[...this.suggestions].filter(([o]) => o !== id).map(([, v]) => v.text)].map(lexKey));
    const ok = (t: string) => t !== cur && !taken.has(lexKey(t)) && !this.tooClose(t);
    let pool = this.entry.lies.filter(ok);
    if (!pool.length) pool = LEX_ENTRIES.filter((e) => e.cat === this.entry.cat && e !== this.entry).flatMap((e) => e.lies).filter(ok);
    const text = pool[Math.floor(Math.random() * pool.length)] ?? 'Keine Ahnung';
    this.suggestions.set(id, { text, seq: (this.suggestions.get(id)?.seq ?? 0) + 1 });
    this.ctx.onChange();
  }

  private endWrite() {
    const s = this.state;
    // Entwürfe zählen – sofern sie nicht zu nah an der Wahrheit sind
    for (const id of this.ids) {
      const d = this.drafts.get(id);
      if (!this.lies.has(id) && d && !this.tooClose(d)) this.lies.set(id, d);
    }
    // Gleiche Lügen zusammenfassen (Groß-/Kleinschreibung, Artikel, Umlaute egal)
    const merged = new Map<string, Answer>();
    for (const id of this.ids) {
      const text = this.lies.get(id);
      if (!text) continue;
      const key = lexKey(text);
      const a = merged.get(key);
      if (a) a.by.push(id);
      else merged.set(key, { text, key, truth: false, house: false, by: [id] });
    }
    const answers: Answer[] = [{ text: this.entry.a, key: lexKey(this.entry.a), truth: true, house: false, by: [] }, ...merged.values()];
    // Zu wenig Auswahl → Haus-Lügen auffüllen
    for (const t of shuffle(this.entry.lies)) {
      if (answers.length >= LEXIKON.MIN_OPTIONS) break;
      const key = lexKey(t);
      if (!answers.some((a) => a.key === key)) answers.push({ text: t, key, truth: false, house: true, by: [] });
    }
    this.answers = shuffle(answers);
    s.options = this.answers.map((a) => a.text);
    s.written = this.ids.filter((id) => this.lies.has(id));
    s.voted = [];
    s.sub = 'vote';
    this.picks.clear();
    this.suggestions.clear();
    this.schedule(LEXIKON.VOTE_MS, () => this.endVote());
    if (!this.ids.some(this.connected)) this.soon(1500);
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Abstimmen + Aufdecken

  private endVote() {
    const s = this.state;
    const pickers = this.answers.map(() => [] as string[]);
    for (const id of this.ids) {
      const i = this.picks.get(id);
      if (i !== undefined) pickers[i].push(id);
    }
    const gain: Record<string, number> = Object.fromEntries(this.ids.map((id) => [id, 0]));
    const lies: LexStep[] = [];
    this.answers.forEach((a, i) => {
      if (a.truth || !pickers[i].length) return;
      const points = a.house ? 0 : LEXIKON.FOOL_POINTS * s.mult * pickers[i].length;
      for (const by of a.by) gain[by] += points;
      lies.push({ idx: i, truth: false, by: [...a.by], pickers: pickers[i], points });
      if (!a.house && (!this.best || pickers[i].length > this.best.fooled)) this.best = { by: [...a.by], text: a.text, fooled: pickers[i].length };
    });
    // Von der harmlosesten zur erfolgreichsten Lüge (gleich viele: zufällig) – dann die Wahrheit
    const order = shuffle(lies).sort((x, y) => x.pickers.length - y.pickers.length);
    const ti = this.answers.findIndex((a) => a.truth);
    const truthPoints = LEXIKON.TRUTH_POINTS * s.mult;
    for (const id of pickers[ti]) {
      gain[id] += truthPoints;
      this.found.set(id, (this.found.get(id) ?? 0) + 1);
    }
    this.stepPlan = [...order, { idx: ti, truth: true, by: [], pickers: pickers[ti], points: truthPoints }];
    this.pendingGain = gain;
    s.stepCount = this.stepPlan.length;
    s.steps = [];
    s.sub = 'reveal';
    this.nextStep();
  }

  private nextStep() {
    const s = this.state;
    const next = this.stepPlan[s.steps.length];
    if (!next) return this.afterReveal();
    s.steps = [...s.steps, next];
    if (next.truth) {
      s.why = this.entry.why;
      s.authors = this.answers.map((a) => (a.truth ? null : [...a.by]));
      for (const id of this.ids) {
        s.gain[id] = this.pendingGain[id] ?? 0;
        s.points[id] = (s.points[id] ?? 0) + s.gain[id];
      }
    }
    this.schedule(next.truth ? LEXIKON.TRUTH_MS : LEXIKON.LIE_MS, () => this.nextStep());
    this.ctx.onChange();
  }

  private afterReveal() {
    const s = this.state;
    // Eine einzige Frage (Spielbrett): gleich zur Auswertung
    if (s.round >= s.rounds && s.rounds === 1) return this.finish();
    s.sub = 'scores';
    this.schedule(LEXIKON.SCORES_MS, () => (s.round >= s.rounds ? this.finish() : this.startRound(s.round + 1)));
    this.ctx.onChange();
  }

  private finish() {
    const s = this.state;
    s.sub = 'over';
    this.pending = null;
    this.deadline = 0;
    this.timers.clear();
    this.ctx.onChange();
    const names = (ids: string[]) => ids.map((id) => this.ctx.nameOf(id)).join(' & ');
    const b = this.best;
    const finder = [...this.found].sort((x, y) => y[1] - x[1])[0];
    const subtitle = b
      ? `Beste Lüge: „${b.text}“ von ${names(b.by)} (${b.fooled}× reingefallen)`
      : finder
        ? `Wahrheitsfinder: ${this.ctx.nameOf(finder[0])} (${finder[1]}× richtig)`
        : 'Das Lexikon hat alle reingelegt!';
    this.timers.later(600, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => s.points[id] ?? 0),
        details: Object.fromEntries(this.ids.map((id) => [id, `${s.points[id] ?? 0} Punkte`])),
        subtitle,
      }),
    );
  }

  private checkAllDone() {
    const s = this.state;
    if (!this.pending) return;
    if (s.sub === 'write') {
      const active = this.ids.filter(this.connected);
      if (active.length && active.every((id) => this.lies.has(id))) this.soon();
    } else if (s.sub === 'vote') {
      const active = this.ids.filter(this.connected);
      if (active.every((id) => this.picks.has(id))) this.soon();
    }
  }

  // ---------------------------------------------------------------- Schnittstelle

  snapshot(): MiniSnapshot {
    return { kind: 'lexikon', state: { ...this.state, endsIn: endsIn(this.deadline) } };
  }

  privateFor(id: string): PrivateState {
    if (!this.ids.includes(id)) return null;
    const s = this.state;
    const write = s.sub === 'write';
    return {
      kind: 'lexikon',
      state: {
        round: s.round,
        sub: s.sub,
        lie: this.lies.get(id) ?? null,
        reject: write ? (this.rejects.get(id) ?? null) : null,
        suggest: write ? (this.suggestions.get(id) ?? null) : null,
        mine: write ? [] : this.answers.flatMap((a, i) => (a.by.includes(id) ? [i] : [])),
        pick: this.picks.get(id) ?? null,
      },
    };
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (!this.ids.includes(id)) return;
    const p = asRecord(payload);
    if (Number(p.round) !== s.round) return;

    if (s.sub === 'write') {
      if (this.lies.has(id)) return;
      if (action === 'draft') {
        this.drafts.set(id, lexClean(p.text));
        return;
      }
      if (action === 'suggest') return this.suggestFor(id);
      if (action !== 'lie') return;
      const text = lexClean(p.text);
      if (!text) return this.reject(id, 'Schreib etwas – oder lass dir eine Lüge vorschlagen.');
      if (this.tooClose(text)) return this.reject(id, LEX_TOO_CLOSE);
      this.lies.set(id, text);
      this.suggestions.delete(id);
      s.written = this.ids.filter((x) => this.lies.has(x));
      this.ctx.onChange();
      return this.checkAllDone();
    }

    if (s.sub === 'vote' && action === 'pick') {
      const idx = Number(p.idx);
      const a = this.answers[idx];
      if (!Number.isInteger(idx) || !a || a.by.includes(id)) return;
      this.picks.set(id, idx);
      s.voted = this.ids.filter((x) => this.picks.has(x));
      this.ctx.onChange();
      return this.checkAllDone();
    }
  }

  /** VIP: Aufdecken und Zwischenstand vorziehen (Schreiben/Tippen nur über „Überspringen“) */
  vipAction(action: string) {
    if (action !== 'next' || !this.pending) return;
    const sub = this.state.sub;
    if (sub === 'reveal' || sub === 'scores') this.pending();
  }

  /** VIP/Laptop: jeden Schritt vorziehen – beim Schreiben zählen Entwürfe, sonst füllen Haus-Lügen auf */
  skippable(): SkipInfo | null {
    if (!this.pending) return null;
    const s = this.state;
    if (s.sub === 'write') {
      const missing = this.ids.filter((id) => this.connected(id) && !this.lies.has(id));
      return { label: waitLabel(this.ctx, missing, 'Lüge', 'Schreiben beenden') };
    }
    if (s.sub === 'vote') {
      const missing = this.ids.filter((id) => this.connected(id) && !this.picks.has(id));
      return { label: waitLabel(this.ctx, missing, 'Tipp', 'Abstimmung beenden') };
    }
    if (s.sub === 'reveal') return { label: 'Weiter', info: true };
    if (s.sub === 'scores') return { label: s.round >= s.rounds ? 'Zur Auswertung' : 'Nächste Frage', info: true };
    return null;
  }

  skip() {
    this.pending?.();
  }

  playerDisconnected() {
    this.checkAllDone();
  }

  dispose() {
    this.timers.clear();
    this.pending = null;
  }
}
