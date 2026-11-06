import type { LiederGenreInfo, LiederState, MiniSnapshot, PrivateState, SkipInfo } from '../shared/types';
import { LIEDER, liederNorm, liederOptions, liederPerPlayer, liederPoints, liederRounds } from '../shared/lieder';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, groupByScore, shuffle, waitLabel } from './minigame';
import type { Lied, LiedTon, LiederTon } from './liederton';

/** Eine vorbereitete Runde: Lied, Ton-Token und die Antworten */
interface Prepared {
  lied: Lied;
  ton: LiedTon;
  options: string[];
  index: number;
}

/**
 * Guess the Song (à la SongPop, intern „lieder“).
 *
 * Erst wählt jeder geheim seine Genres (1 gegen 1: je 4, zu dritt 3, bis 6 Spieler 2, sonst 1). Daraus entsteht der
 * Rundenplan: reihum (zufälliger Startspieler) kommt jeweils ein zufälliges Genre des nächsten Spielers dran, jedes
 * gewählte Genre genau einmal. Pro Runde läuft auf dem TV ein Lied aus dem Genre; alle tippen am Handy den Titel an
 * (4 Antworten, später 6, am Ende 8 – falsche bevorzugt aus demselben Genre). Richtig: 2 Punkte + Tempo-Bonus bis 3,
 * der Schnellste bekommt noch +1.
 *
 * Der TV lädt den Ton in der Ansage-Phase (`prep`) vor und meldet `ready` bzw. `error` (`hostInput`), erst dann läuft
 * die Uhr – so verliert niemand Zeit, weil das Lied noch lädt.
 */
export class LiederGame implements MiniGame {
  readonly kind = 'lieder' as const;
  private state: LiederState;
  private songs: Lied[];
  private byGenre = new Map<string, Lied[]>();
  private picks = new Map<string, string[]>();
  /** In diesem Spiel schon verplante Lieder */
  private used = new Set<string>();
  private prepared = new Map<number, Promise<Prepared | null>>();
  private cur: Prepared | null = null;
  private choices = new Map<string, number>();
  private times = new Map<string, number>();
  private prepStart = 0;
  private audioAt = 0;
  private playStart = 0;
  private tvReady = false;
  /** Ton-Fehler in dieser Runde (dann ein anderes Lied) */
  private retries = 0;
  private roundSeq = 0;
  private timers = new Timers();
  private pending: (() => void) | null = null;
  private seq = 0;
  private deadline = 0;
  private phaseEnd = 0;
  private disposed = false;
  /** Schnellste richtige Antwort des Spiels */
  private best: { id: string; ms: number; title: string } | null = null;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
    private ton: LiederTon,
  ) {
    const lib = ton.library();
    this.songs = lib.songs;
    for (const l of lib.songs) this.byGenre.set(l.genre, [...(this.byGenre.get(l.genre) ?? []), l]);
    const genres: LiederGenreInfo[] = lib.genres.map((g) => ({ ...g, n: this.byGenre.get(g.id)?.length ?? 0 })).filter((g) => g.n >= LIEDER.MIN_SONGS);
    const n = ids.length;
    // Kein Spielbrett-Spiel (BOARD_KINDS) – deshalb immer der volle Rundenplan, auch aus der Party-Lobby
    const rounds = liederRounds(n);
    this.state = {
      sub: 'pick',
      round: 0,
      rounds,
      endsIn: 0,
      players: [...ids],
      perPlayer: Math.max(1, Math.min(liederPerPlayer(n), genres.length)),
      genres,
      picked: [],
      picks: null,
      plan: null,
      genre: null,
      owner: null,
      options: [],
      answered: [],
      audio: null,
      answer: null,
      choices: null,
      times: null,
      gain: null,
      first: null,
      points: Object.fromEntries(ids.map((id) => [id, 0])),
      credit: null,
      // Nur der eingebaute Soundtrack da → Hinweis, wie mehr Genres dazukommen
      note: genres.length <= 1 ? 'Mehr Genres: eigene MP3s nach data/lieder/<Genre>/ legen' : null,
    };
    if (!genres.length) {
      this.state.sub = 'over';
      this.state.note = 'Keine Lieder gefunden!';
      this.timers.later(5000, () => this.ctx.finish({ groups: [this.ids], details: {}, subtitle: 'Keine Lieder mit Ton gefunden.' }));
      return;
    }
    // Nur ein Genre → nichts zu wählen
    if (genres.length === 1) {
      for (const id of ids) this.picks.set(id, [genres[0].id]);
      this.endPick();
      return;
    }
    this.schedule(LIEDER.PICK_MS, () => this.endPick());
  }

  // ---------------------------------------------------------------- Ablaufsteuerung (wie Schätzkönig)

  /** Nächster Schritt nach `ms` – VIP/Laptop können ihn vorziehen */
  private schedule(ms: number, fn: () => void) {
    this.timers.clear();
    this.deadline = Date.now() + ms;
    this.phaseEnd = this.deadline;
    const token = ++this.seq;
    const run = () => {
      if (this.seq !== token) return;
      this.seq++;
      this.pending = null;
      this.timers.clear();
      fn();
    };
    this.pending = run;
    this.timers.later(ms, run);
  }

  /** Alle fertig → kurz durchatmen, dann weiter */
  private soon(ms: number) {
    const run = this.pending;
    if (!run || this.deadline - Date.now() <= ms) return;
    this.timers.clear();
    this.deadline = Date.now() + ms;
    this.timers.later(ms, run);
  }

  /** Doch nicht alle fertig (Genres zurückgenommen) → wieder die normale Restzeit */
  private resume() {
    const run = this.pending;
    if (!run || this.deadline >= this.phaseEnd) return;
    this.timers.clear();
    this.deadline = this.phaseEnd;
    this.timers.later(Math.max(0, this.phaseEnd - Date.now()), run);
  }

  private connected = (id: string) => this.ctx.isConnected(id);

  // ---------------------------------------------------------------- Genre-Wahl

  private endPick() {
    const s = this.state;
    const avail = s.genres.map((g) => g.id);
    // Wer nicht fertig wurde, bekommt zufällige Genres dazu (am liebsten welche, die noch keiner hat)
    for (const id of this.ids) {
      const mine = [...(this.picks.get(id) ?? [])];
      const taken = new Set([...this.picks.values()].flat());
      const pool = shuffle(avail.filter((g) => !mine.includes(g))).sort((a, b) => Number(taken.has(a)) - Number(taken.has(b)));
      while (mine.length < s.perPlayer && pool.length) mine.push(pool.shift()!);
      this.picks.set(id, mine);
    }
    // Rundenplan: reihum ab einem zufälligen Spieler, jeweils ein zufälliges (noch nicht dagewesenes) Genre von ihm
    const order = shuffle(this.ids);
    const slots = Math.ceil(s.rounds / order.length);
    const seqs = new Map(
      order.map((id) => {
        // Jedes Genre einmal in zufälliger Reihenfolge; reicht das nicht (zu wenig Genres da), wird neu gemischt
        const seq: string[] = [];
        const mine = this.picks.get(id)!.length ? this.picks.get(id)! : avail;
        while (seq.length < slots) seq.push(...shuffle(mine));
        return [id, seq.slice(0, slots)];
      }),
    );
    const plan: { genre: string; owner: string }[] = [];
    for (let i = 0; i < slots && plan.length < s.rounds; i++) for (const id of order) if (plan.length < s.rounds) plan.push({ genre: seqs.get(id)![i] ?? avail[0], owner: id });
    s.picks = Object.fromEntries(this.picks);
    s.plan = plan;
    s.picked = [...this.ids];
    s.sub = 'genres';
    this.prefetch(1);
    this.schedule(LIEDER.GENRES_MS, () => this.startRound(1));
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Lieder vorbereiten

  private prefetch(round: number) {
    if (round > this.state.rounds || this.prepared.has(round)) return;
    this.prepared.set(round, this.prepare(round));
  }

  /** `anyGenre`: nach wiederholten Ton-Fehlern lieber irgendein Lied als gar keins */
  private async prepare(round: number, anyGenre = false): Promise<Prepared | null> {
    const want = anyGenre ? null : (this.state.plan?.[round - 1]?.genre ?? null);
    for (let attempt = 0; attempt < 4; attempt++) {
      // Genre leer (alle schon gelaufen)? Dann ein Lied aus irgendeinem Genre
      const lied = this.pick(want) ?? this.pick(null);
      if (!lied) return null;
      this.used.add(lied.id);
      const ton = await this.ton.resolve(lied).catch(() => null);
      if (this.disposed) return null;
      if (ton) return { lied, ton, ...this.makeOptions(lied, round) };
    }
    return null;
  }

  private pick(genre: string | null): Lied | null {
    const pool = (genre ? (this.byGenre.get(genre) ?? []) : this.songs).filter((l) => !this.used.has(l.id));
    return this.ton.choose(pool);
  }

  /** Richtiger Titel + falsche aus demselben Genre (dann aus allen), gemischt */
  private makeOptions(lied: Lied, round: number) {
    const k = liederOptions(round, this.state.rounds);
    const seen = new Set([liederNorm(lied.title)]);
    const out = [lied.title];
    const { same, all } = this.ton.titlePool(lied.genre, this.songs);
    for (const t of [...shuffle(same), ...shuffle(all)]) {
      if (out.length >= k) break;
      const key = liederNorm(t);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    const options = shuffle(out);
    return { options, index: options.indexOf(lied.title) };
  }

  // ---------------------------------------------------------------- Runden

  private startRound(round: number) {
    const s = this.state;
    const p = s.plan?.[round - 1];
    s.round = round;
    s.sub = 'prep';
    s.genre = p?.genre ?? null;
    s.owner = p?.owner ?? null;
    s.options = [];
    s.answered = [];
    s.audio = null;
    s.answer = null;
    s.choices = null;
    s.times = null;
    s.gain = null;
    s.first = null;
    s.credit = null;
    if (!this.retries) s.note = null;
    this.cur = null;
    this.choices.clear();
    this.times.clear();
    this.tvReady = false;
    this.prepStart = Date.now();
    this.audioAt = 0;
    this.timers.clear();
    this.pending = null;
    this.deadline = 0;
    const token = ++this.roundSeq;
    this.prefetch(round);
    void this.prepared.get(round)!.then((prep) => this.onPrepared(round, token, prep));
    // Ansage-Phase: alle 200 ms schauen, ob der TV bereit ist
    this.timers.every(200, () => this.tryPlay());
    this.ctx.onChange();
  }

  private onPrepared(round: number, token: number, prep: Prepared | null) {
    const s = this.state;
    if (this.disposed || token !== this.roundSeq || s.sub !== 'prep' || s.round !== round) return;
    if (!prep) {
      // Gar kein Ton mehr zu finden → Runde auslassen
      s.note = 'Kein Ton gefunden – Runde fällt aus';
      this.ctx.onChange();
      this.schedule(2500, () => (round >= s.rounds ? this.finish() : this.startRound(round + 1)));
      return;
    }
    this.cur = prep;
    this.audioAt = Date.now();
    s.genre = prep.lied.genre;
    s.audio = { token: prep.ton.token, start: prep.ton.start, kind: prep.ton.kind };
    s.credit = prep.ton.credit;
    this.ctx.onChange();
  }

  /** Ansage vorbei und TV bereit (oder zu lange gewartet, oder gar kein TV offen) → Song ab! */
  private tryPlay() {
    const s = this.state;
    if (s.sub !== 'prep' || !this.cur) return;
    const now = Date.now();
    if (now - this.prepStart < LIEDER.PREP_MIN_MS) return;
    const noTv = (this.ctx.hosts?.() ?? 1) === 0;
    if (!this.tvReady && !noTv && now - this.audioAt < LIEDER.PREP_MAX_MS) return;
    this.startPlay();
  }

  private startPlay() {
    const s = this.state;
    s.sub = 'play';
    s.options = this.cur!.options;
    this.playStart = Date.now();
    this.retries = 0;
    this.schedule(LIEDER.PLAY_MS, () => this.reveal());
    this.prefetch(s.round + 1);
    this.ctx.onChange();
  }

  private reveal() {
    const s = this.state;
    const cur = this.cur!;
    const right = this.ids.filter((id) => this.choices.get(id) === cur.index).sort((a, b) => this.times.get(a)! - this.times.get(b)!);
    const gain: Record<string, number> = Object.fromEntries(this.ids.map((id) => [id, 0]));
    right.forEach((id, i) => {
      gain[id] = liederPoints(this.times.get(id)!) + (i === 0 ? LIEDER.FIRST_BONUS : 0);
      s.points[id] = (s.points[id] ?? 0) + gain[id];
    });
    const first = right[0] ?? null;
    if (first && (!this.best || this.times.get(first)! < this.best.ms)) this.best = { id: first, ms: this.times.get(first)!, title: cur.lied.title };
    s.answer = { title: cur.lied.title, artist: cur.lied.artist, year: cur.lied.year, index: cur.index };
    s.choices = Object.fromEntries(this.choices);
    s.times = Object.fromEntries(this.times);
    s.gain = gain;
    s.first = first;
    s.sub = 'reveal';
    this.ton.played(cur.lied.id);
    this.schedule(LIEDER.REVEAL_MS, () => (s.round >= s.rounds ? this.finish() : this.startRound(s.round + 1)));
    this.ctx.onChange();
  }

  private finish() {
    const s = this.state;
    s.sub = 'over';
    this.pending = null;
    this.deadline = 0;
    this.timers.clear();
    this.ctx.onChange();
    const b = this.best;
    const subtitle = b ? `Schnellstes Ohr: ${this.ctx.nameOf(b.id)} (${(b.ms / 1000).toFixed(1).replace('.', ',')} s bei „${b.title}“)` : 'Diesmal hat keiner einen Song erkannt …';
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
    const active = this.ids.filter(this.connected);
    if (!active.length) return;
    if (s.sub === 'pick' && active.every((id) => s.picked.includes(id))) this.soon(900);
    if (s.sub === 'play' && active.every((id) => this.choices.has(id))) this.soon(LIEDER.ALL_DONE_MS);
  }

  // ---------------------------------------------------------------- Schnittstelle

  snapshot(): MiniSnapshot {
    return { kind: 'lieder', state: { ...this.state, endsIn: endsIn(this.deadline) } };
  }

  privateFor(id: string): PrivateState {
    if (!this.ids.includes(id)) return null;
    const s = this.state;
    const bot = s.sub === 'play' && this.cur && this.ctx.isBot?.(id) ? { botAnswer: this.cur.index } : {};
    return { kind: 'lieder', state: { round: s.round, picks: this.picks.get(id) ?? [], choice: this.choices.get(id) ?? null, ...bot } };
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    if (!this.ids.includes(id)) return;
    const p = asRecord(payload);
    if (s.sub === 'pick') {
      if (action === 'genres' && !s.picked.includes(id)) {
        const list = Array.isArray(p.genres) ? p.genres.map(String) : [];
        const valid = new Set(s.genres.map((g) => g.id));
        if (list.length !== s.perPlayer || new Set(list).size !== list.length || !list.every((g) => valid.has(g))) return;
        this.picks.set(id, list);
        s.picked = [...s.picked, id];
        this.ctx.onChange();
        return this.checkAllDone();
      }
      if (action === 'unpick' && s.picked.includes(id)) {
        this.picks.delete(id);
        s.picked = s.picked.filter((x) => x !== id);
        this.resume();
        this.ctx.onChange();
      }
      return;
    }
    if (action === 'answer' && s.sub === 'play' && Number(p.round) === s.round && !this.choices.has(id)) {
      const i = Number(p.index);
      if (!Number.isInteger(i) || i < 0 || i >= s.options.length) return;
      this.choices.set(id, i);
      this.times.set(id, Date.now() - this.playStart);
      s.answered = [...s.answered, id];
      this.ctx.onChange();
      this.checkAllDone();
    }
  }

  /** Vom TV: `ready` (Ton geladen) bzw. `error` (lässt sich nicht abspielen) für den Token der Runde */
  hostInput(action: string, payload: unknown) {
    const s = this.state;
    const token = String(asRecord(payload).token ?? '');
    if (!s.audio || s.audio.token !== token) return;
    if (action === 'ready' && s.sub === 'prep') {
      this.tvReady = true;
      this.tryPlay();
      return;
    }
    // Ton kaputt: noch in der Ansage (oder bevor jemand getippt hat) → anderes Lied derselben Runde
    if (action === 'error' && (s.sub === 'prep' || (s.sub === 'play' && !this.choices.size)) && this.retries < 3) {
      this.ton.markBad(token);
      this.retries++;
      // Ab dem zweiten Fehler in Folge: Lied aus irgendeinem Genre (das gewünschte ist wohl kaputt)
      this.prepared.set(s.round, this.prepare(s.round, this.retries >= 2));
      s.note = 'Song hakt – der nächste!';
      this.startRound(s.round);
    }
  }

  /** VIP: `next` zieht Info-Screens vor */
  vipAction(action: string) {
    const s = this.state;
    if (action === 'next' && this.pending && (s.sub === 'genres' || s.sub === 'reveal')) this.pending();
  }

  skippable(): SkipInfo | null {
    if (!this.pending) return null;
    const s = this.state;
    if (s.sub === 'pick') {
      const missing = this.ids.filter((id) => this.connected(id) && !s.picked.includes(id));
      return { label: waitLabel(this.ctx, missing, 'Genre-Wahl', 'Genre-Wahl beenden') };
    }
    if (s.sub === 'play') {
      const missing = this.ids.filter((id) => this.connected(id) && !this.choices.has(id));
      return { label: waitLabel(this.ctx, missing, 'Antwort', 'Auflösen') };
    }
    if (s.sub === 'genres') return { label: 'Los geht’s', info: true };
    if (s.sub === 'reveal') return { label: s.round >= s.rounds ? 'Zur Auswertung' : 'Nächster Song', info: true };
    return null;
  }

  skip() {
    this.pending?.();
  }

  playerDisconnected() {
    this.checkAllDone();
  }

  dispose() {
    this.disposed = true;
    this.timers.clear();
    this.pending = null;
  }
}
