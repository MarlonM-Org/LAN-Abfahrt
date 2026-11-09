import type { MiniSnapshot, PostStroke, PrivateState, SkipInfo } from '../shared/types';
import {
  MALER, MALER_WORDS, type MalerChat, type MalerInk, type MalerOp, type MalerPrivate, type MalerResult, type MalerState,
  applyInkOp, cleanOp, cleanStrokes, cloneStrokes, malerDisplay, malerDrawMs, malerDrawerPer, malerGuessPoints,
  malerHint, malerHintCount, malerHintTimes, malerLetterIdx, malerMatch, strokePoints,
} from '../shared/maler';
import { possessive } from '../shared/players';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, groupByScore, shuffle } from './minigame';

interface Mine {
  text: string;
  res: MalerResult;
}

/**
 * Montagsmaler live (à la skribbl.io): Reihum malt einer am Handy ein geheimes Wort (Wahl aus drei), die Striche
 * gehen gebündelt (~15 Hz) über den Server live auf den TV. Alle anderen tippen Tipps ein – richtige bleiben am TV
 * geheim („✓ Lena hat's!“), falsche laufen als Chat mit, „knapp daneben!“ erfährt nur der Ratende. Mit der Zeit
 * werden Buchstaben aufgedeckt. Punkte: Rater nach Reihenfolge/Restzeit, Maler pro richtigem Rater.
 *
 * Striche: Der Server führt die Strichliste des Bilds und ein Op-Protokoll (`MalerInk`). Der Snapshot trägt nur die
 * jüngsten Ops; wer zurückhängt (neuer TV, Neuverbindung), bekommt ein Schlüsselbild aller Striche – alle paar
 * Sekunden, in der Auflösung immer und auf Anfrage (TV: `host:mini` „sync“, Handy: Eingabe `sync`).
 * Das Maler-Handy zählt seine Ops mit; passt der Zähler nicht (verlorene Nachrichten nach einem Aussetzer), bittet
 * der Server per `need` um das ganze Bild.
 */
export class MalerGame implements MiniGame {
  readonly kind = 'maler' as const;
  private state: MalerState;
  private timers = new Timers();
  private deadline = 0;
  private pool: string[];
  /** Eintrag (mit Alternativen) und Wahl des aktuellen Bilds */
  private entry = '';
  private choices: string[] = [];
  private revealed = new Set<number>();
  private drawMs = 0;
  /** Rater beim Start des Bilds (für die Maler-Punkte) */
  private guessers = 1;
  // --- Striche des aktuellen Bilds
  private strokes: PostStroke[] = [];
  private log: { op: MalerOp; at: number }[] = [];
  private seq = 0;
  /** So viele Ops hat der Maler in diesem Bild geschickt (sein Zähler) */
  private drawerN = 0;
  private needFull = false;
  private keyUntil = 0;
  private lastKeyReq = 0;
  // --- Raten
  private mine = new Map<string, Mine[]>();
  private tries = new Map<string, number>();
  private lastGuessAt = new Map<string, number>();
  private chatN = 0;
  /** Wie oft jemand als Erste/r richtig lag (Untertitel) */
  private firsts = new Map<string, number>();
  private best: { by: string; word: string; share: number } | null = null;
  private turnIdx = -1;
  private gen = 0;
  /** „Alle haben's“ ist schon eingeplant (für dieses Bild) */
  private allDone = false;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    // Malen dürfen höchstens MAX_TURNS – bei vielen Spielern Menschen zuerst (Bots malen nur Kritzeleien)
    const humans = shuffle(ids.filter((id) => !ctx.isBot?.(id)));
    const bots = shuffle(ids.filter((id) => ctx.isBot?.(id)));
    const order = shuffle([...humans, ...bots].slice(0, MALER.MAX_TURNS));
    this.pool = shuffle(MALER_WORDS);
    const zero = () => Object.fromEntries(ids.map((id) => [id, 0]));
    this.state = {
      sub: 'choose',
      round: 0,
      rounds: order.length,
      endsIn: 0,
      total: 0,
      players: [...ids],
      order,
      drawer: order[0],
      hint: '',
      guessed: [],
      points: zero(),
      gain: zero(),
      chat: [],
      word: null,
      why: null,
      ink: { seq: 0, from: 0, ops: [], full: null },
    };
    // Schlüsselbild regelmäßig (z. B. für einen TV über den Online-Tunnel, der nicht nachfragen kann) + Aufpasser
    this.timers.every(MALER.KEY_MS, () => {
      if (this.state.sub === 'draw' && this.seq > 0) this.keyframe();
    });
    this.timers.every(500, () => this.watch());
    this.nextTurn();
  }

  // ---------------------------------------------------------------- Ablauf

  /** Phasen-Timer: nur der jüngste zählt (Überspringen, „alle haben's“ oder ein weggegangener Maler kommen ihm zuvor) */
  private schedule(ms: number, fn: () => void) {
    const gen = ++this.gen;
    this.deadline = Date.now() + ms;
    this.state.total = ms;
    this.timers.later(ms, () => {
      if (gen === this.gen) fn();
    });
  }

  /** Nächster Maler, der da ist – sonst Ende */
  private nextTurn() {
    const s = this.state;
    while (++this.turnIdx < s.order.length) {
      const id = s.order[this.turnIdx];
      if (this.ctx.isConnected(id) && !this.ctx.isGone?.(id)) return this.startChoose(id);
    }
    this.finish();
  }

  private startChoose(drawer: string) {
    const s = this.state;
    s.sub = 'choose';
    s.round = this.turnIdx + 1;
    s.drawer = drawer;
    s.hint = '';
    s.guessed = [];
    s.gain = Object.fromEntries(this.ids.map((id) => [id, 0]));
    s.chat = [];
    s.word = null;
    s.why = null;
    this.entry = '';
    this.revealed.clear();
    this.mine.clear();
    this.tries.clear();
    this.resetInk();
    this.choices = this.drawChoices();
    this.schedule(MALER.CHOOSE_MS, () => this.choose(this.choices[Math.floor(Math.random() * this.choices.length)]));
    this.ctx.onChange();
  }

  /** Drei Wörter, die heute noch nicht dran waren */
  private drawChoices(): string[] {
    if (this.pool.length < MALER.CHOICES) this.pool.push(...shuffle(MALER_WORDS));
    return this.pool.splice(0, MALER.CHOICES);
  }

  private choose(entry: string) {
    const s = this.state;
    if (s.sub !== 'choose' || !this.choices.includes(entry)) return;
    this.entry = entry;
    // Nicht gewählte Wörter kommen später wieder in den Topf
    this.pool.push(...this.choices.filter((c) => c !== entry));
    s.sub = 'draw';
    const word = malerDisplay(entry);
    s.hint = malerHint(word);
    this.allDone = false;
    this.resetInk();
    this.drawMs = malerDrawMs(this.ids.length);
    this.guessers = Math.max(1, this.ids.filter((id) => id !== s.drawer && this.ctx.isConnected(id)).length);
    this.schedule(this.drawMs, () => this.endDraw('time'));
    // Buchstaben-Hinweise nach und nach (zufällige Stellen)
    const letters = shuffle(malerLetterIdx(word));
    const times = malerHintTimes(Math.min(malerHintCount(letters.length), letters.length - 1));
    const round = s.round;
    times.forEach((f, i) =>
      this.timers.later(this.drawMs * f, () => {
        if (s.sub !== 'draw' || s.round !== round) return;
        this.revealed.add(letters[i]);
        s.hint = malerHint(word, this.revealed);
        this.ctx.onChange();
      }),
    );
    this.ctx.onChange();
  }

  private endDraw(why: MalerState['why']) {
    const s = this.state;
    if (s.sub !== 'draw') return;
    s.sub = 'reveal';
    s.why = why;
    s.word = malerDisplay(this.entry);
    s.hint = malerHint(s.word, new Set(malerLetterIdx(s.word)));
    const share = s.guessed.length / this.guessers;
    if (s.guessed.length && (!this.best || share > this.best.share)) this.best = { by: s.drawer, word: s.word, share };
    this.schedule(MALER.REVEAL_MS, () => this.nextTurn());
    this.ctx.onChange();
  }

  private finish() {
    const s = this.state;
    if (s.sub === 'over') return;
    s.sub = 'over';
    s.word = null;
    this.gen++;
    this.deadline = 0;
    s.total = 0;
    this.resetInk();
    this.ctx.onChange();
    const first = [...this.firsts.entries()].sort((a, b) => b[1] - a[1])[0];
    const subtitle = this.best && this.best.share >= 1
      ? `${possessive(this.ctx.nameOf(this.best.by))} „${this.best.word}“ haben alle erraten!`
      : first
        ? `Schnellste Rate-Nase: ${this.ctx.nameOf(first[0])} (${first[1]}× zuerst)`
        : 'Kunst ist eben Geschmackssache!';
    this.timers.later(800, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => s.points[id] ?? 0),
        details: Object.fromEntries(this.ids.map((id) => [id, `${s.points[id] ?? 0} Punkte`])),
        subtitle,
      }),
    );
  }

  /** Läuft alle 500 ms: Maler weg? Alle (verbliebenen) Rater fertig? */
  private watch() {
    const s = this.state;
    if (s.sub === 'choose' && (!this.ctx.isConnected(s.drawer) || this.ctx.isGone?.(s.drawer))) {
      // Maler ist weg, bevor er überhaupt angefangen hat → gleich der Nächste
      this.nextTurn();
      return;
    }
    if (s.sub !== 'draw') return;
    const off = this.ctx.offlineMs?.(s.drawer) ?? (this.ctx.isConnected(s.drawer) ? 0 : MALER.DRAWER_OFFLINE_MS);
    if (off >= MALER.DRAWER_OFFLINE_MS || this.ctx.isGone?.(s.drawer)) return this.endDraw('gone');
    this.checkAllGuessed();
  }

  private checkAllGuessed() {
    const s = this.state;
    if (s.sub !== 'draw' || this.allDone) return;
    const active = this.ids.filter((id) => id !== s.drawer && this.ctx.isConnected(id));
    if (!active.length || !active.every((id) => s.guessed.includes(id))) return;
    this.allDone = true;
    this.schedule(MALER.ALL_DONE_MS, () => this.endDraw('all'));
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Striche

  private resetInk() {
    this.strokes = [];
    this.log = [];
    this.seq = 0;
    this.drawerN = 0;
    this.needFull = false;
    this.keyUntil = 0;
  }

  private push(op: MalerOp) {
    applyInkOp(this.strokes, op);
    this.log.push({ op, at: Date.now() });
    this.seq++;
    // Protokoll klein halten: nur, was noch ins Zeitfenster fällt (plus Puffer)
    if (this.log.length > 400) this.log.splice(0, this.log.length - 300);
  }

  /** Nächste Snapshots tragen alle Striche (Schlüsselbild) */
  private keyframe() {
    this.keyUntil = Date.now() + 250;
    this.ctx.onChange();
  }

  private ink(): MalerInk {
    const s = this.state;
    if (s.sub === 'choose' || s.sub === 'over') return { seq: 0, from: 0, ops: [], full: null };
    const now = Date.now();
    let i = this.log.length;
    while (i > 0 && now - this.log[i - 1].at <= MALER.OPS_WINDOW_MS) i--;
    const ops = this.log.slice(i).map((e) => e.op);
    const full = s.sub === 'reveal' || now < this.keyUntil ? cloneStrokes(this.strokes) : null;
    return { seq: this.seq, from: this.seq - ops.length, ops, full };
  }

  private onInk(p: Record<string, unknown>) {
    const raw = Array.isArray(p.ops) ? p.ops.slice(0, MALER.MSG_OPS) : [];
    if (Number(p.n) !== this.drawerN) {
      // Nachrichten verloren (z. B. WLAN-Aussetzer) → ganzes Bild vom Handy holen
      if (!this.needFull) {
        this.needFull = true;
        this.ctx.onChange();
      }
      return;
    }
    this.drawerN += raw.length;
    let pts = strokePoints(this.strokes);
    for (const r of raw) {
      const op = cleanOp(r);
      if (!op) continue;
      if (op.t === 's' && this.strokes.length >= MALER.MAX_STROKES) continue;
      if ((op.t === 's' || op.t === 'a') && pts + op.p.length / 2 > MALER.MAX_POINTS) continue;
      if (op.t === 'a' && !this.strokes.length) continue;
      if ((op.t === 'u' || op.t === 'x') && !this.strokes.length) continue;
      this.push(op);
      pts = strokePoints(this.strokes);
    }
    this.ctx.onChange();
  }

  /** Ganzes Bild vom Maler-Handy übernehmen (nach Aussetzer oder nach einem Neuladen der Seite) */
  private onFull(p: Record<string, unknown>) {
    const strokes = cleanStrokes(p.s);
    this.drawerN = Math.max(0, Math.round(Number(p.n)) || 0);
    this.needFull = false;
    this.push({ t: 'x' });
    for (const st of strokes) this.push({ t: 's', c: st.c, w: st.w, p: st.p });
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Raten

  private chat(line: Omit<MalerChat, 'n'>) {
    const s = this.state;
    s.chat.push({ n: ++this.chatN, ...line });
    if (s.chat.length > MALER.CHAT_MAX) s.chat.splice(0, s.chat.length - MALER.CHAT_MAX);
  }

  private onGuess(id: string, raw: unknown) {
    const s = this.state;
    if (s.sub !== 'draw' || id === s.drawer || s.guessed.includes(id)) return;
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MALER.GUESS_MAX);
    if (!text) return;
    const now = Date.now();
    if (now - (this.lastGuessAt.get(id) ?? 0) < MALER.GUESS_GAP_MS) return;
    this.lastGuessAt.set(id, now);
    const res = malerMatch(text, this.entry);
    const list = this.mine.get(id) ?? [];
    list.push({ text, res });
    if (list.length > MALER.MINE_MAX) list.shift();
    this.mine.set(id, list);
    this.tries.set(id, (this.tries.get(id) ?? 0) + 1);
    if (res === 'hit') {
      const order = s.guessed.length;
      const rem = Math.max(0, this.deadline - now) / Math.max(1, this.drawMs);
      const pts = malerGuessPoints(rem, order);
      s.guessed.push(id);
      s.points[id] = (s.points[id] ?? 0) + pts;
      s.gain[id] = (s.gain[id] ?? 0) + pts;
      const per = malerDrawerPer(this.guessers);
      s.points[s.drawer] = (s.points[s.drawer] ?? 0) + per;
      s.gain[s.drawer] = (s.gain[s.drawer] ?? 0) + per;
      if (order === 0) this.firsts.set(id, (this.firsts.get(id) ?? 0) + 1);
      this.chat({ id, text: null, ok: true });
      this.checkAllGuessed();
    } else if (res === 'miss') {
      // Knapp daneben bleibt privat (am TV stünde sonst fast die Lösung)
      this.chat({ id, text });
    }
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Schnittstelle

  snapshot(): MiniSnapshot {
    return { kind: 'maler', state: { ...this.state, endsIn: endsIn(this.deadline), ink: this.ink() } };
  }

  privateFor(id: string): PrivateState {
    const s = this.state;
    if (!this.ids.includes(id)) return null;
    const drawer = id === s.drawer && (s.sub === 'choose' || s.sub === 'draw');
    const got = s.guessed.includes(id);
    const p: MalerPrivate = {
      round: s.round,
      role: s.sub === 'choose' || s.sub === 'draw' ? (drawer ? 'draw' : got ? 'got' : 'guess') : 'none',
      choices: drawer && s.sub === 'choose' ? this.choices.map(malerDisplay) : null,
      word: (drawer || got) && this.entry ? malerDisplay(this.entry) : null,
      mine: this.mine.get(id) ?? [],
      tries: this.tries.get(id) ?? 0,
      need: drawer && s.sub === 'draw' && this.needFull,
    };
    return { kind: 'maler', state: p };
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (!this.ids.includes(id)) return;
    const p = asRecord(payload);
    if (action === 'sync') {
      // Schlüsselbild anfordern (Handy nach Neuladen) – höchstens alle 500 ms
      const now = Date.now();
      if (now - this.lastKeyReq > 500 && s.sub === 'draw') {
        this.lastKeyReq = now;
        this.keyframe();
      }
      return;
    }
    if (Number(p.round) !== s.round) return;
    if (action === 'choose' && id === s.drawer && s.sub === 'choose') {
      const i = Math.round(Number(p.index));
      if (i >= 0 && i < this.choices.length) this.choose(this.choices[i]);
      return;
    }
    if (action === 'ink' && id === s.drawer && s.sub === 'draw') return this.onInk(p);
    if (action === 'full' && id === s.drawer && s.sub === 'draw') return this.onFull(p);
    if (action === 'guess') return this.onGuess(id, p.text);
  }

  /** TV: „mir fehlen Striche“ → Schlüsselbild */
  hostInput(action: string) {
    if (action !== 'sync') return;
    const now = Date.now();
    if (now - this.lastKeyReq < 300) return;
    this.lastKeyReq = now;
    if (this.state.sub === 'draw') this.keyframe();
  }

  playerDisconnected() {
    // Wer weg ist, blockiert das „alle haben's“ nicht mehr
    if (this.state.sub === 'draw') this.checkAllGuessed();
  }

  skippable(): SkipInfo | null {
    const s = this.state;
    if (s.sub === 'choose') return { label: `${possessive(this.ctx.nameOf(s.drawer))} Wortwahl überspringen` };
    if (s.sub === 'draw') return { label: 'Bild auflösen' };
    if (s.sub === 'reveal') return { label: s.round >= s.rounds ? 'Zum Ergebnis' : 'Nächstes Bild', info: true };
    return null;
  }

  skip() {
    const s = this.state;
    if (s.sub === 'choose') this.choose(this.choices[Math.floor(Math.random() * this.choices.length)]);
    else if (s.sub === 'draw') this.endDraw('skip');
    else if (s.sub === 'reveal') this.nextTurn();
  }

  dispose() {
    this.timers.clear();
  }
}
