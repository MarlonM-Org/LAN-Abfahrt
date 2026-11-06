import { BB, type BalanceKind, type BalanceSample, type BalanceTurn, liveOf, parseSample } from '../shared/balance';
import type { MiniKind, MiniSnapshot, SkipInfo } from '../shared/types';
import { possessive } from '../shared/players';
import { type MiniCtx, type MiniGame, Timers } from './minigame';

const median = (a: number[]) => {
  const b = [...a].sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};

/**
 * Messwerte des Balance Boards für den Spieler, der gerade dran ist: frisch halten, Körpergewicht einmessen,
 * Gewichtsspitzen (Abdrücken/Hochschnellen) erkennen.
 */
export class BoardFeed {
  private s: BalanceSample | null = null;
  private at = 0;
  /** Eingemessenes Körpergewicht (kg), 0 = noch nicht */
  base = 0;
  /** Einmessen: gesammelte ruhige Stehzeit (ms), Gewichte der letzten ~2 s, wann zuletzt jemand stand */
  private calibMs = 0;
  private calibW: number[] = [];
  private calibLast = 0;
  private calibSeen = 0;
  private calibFirst = 0;
  /** Für die Sprung-Erkennung: vorheriges Verhältnis Gewicht/Körpergewicht */
  private spikeArmed = true;

  feed(s: BalanceSample) {
    this.s = s;
    this.at = Date.now();
  }

  get fresh() {
    return Date.now() - this.at < BB.STALE_MS;
  }

  get sample(): BalanceSample | null {
    return this.fresh ? this.s : null;
  }

  /** Neuer Spieler: Einmessung verwerfen (der Messwert selbst bleibt – das Board ist ja noch da) */
  resetPlayer() {
    this.base = 0;
    this.calibReset();
    this.spikeArmed = true;
  }

  private calibReset() {
    this.calibMs = 0;
    this.calibW = [];
    this.calibSeen = 0;
    this.calibFirst = 0;
  }

  /**
   * Ruhig stehen → Fortschritt 0…1; bei 1 ist `base` gesetzt (Median der letzten Werte).
   * Nachsichtig mit echten Boards: kurze Funklöcher (< 1,5 s) und Wackeln setzen nicht zurück, sondern halten bzw.
   * bremsen den Fortschritt; wer 5 s drauf steht, ist auf jeden Fall eingemessen.
   */
  calibrate(): number {
    const s = this.sample;
    const now = Date.now();
    const dt = this.calibLast ? Math.min(150, now - this.calibLast) : 0;
    this.calibLast = now;
    if (!s || s.w < BB.MIN_KG) {
      if (!this.calibSeen || now - this.calibSeen > 1500) this.calibReset();
      return Math.min(1, this.calibMs / BB.CALIB_MS);
    }
    this.calibSeen = now;
    if (!this.calibFirst) this.calibFirst = now;
    const w = this.calibW;
    w.push(s.w);
    if (w.length > 60) w.shift();
    const med = median(w);
    const calm = Math.abs(s.w - med) <= Math.max(6, med * 0.12);
    this.calibMs = calm ? this.calibMs + dt : Math.max(0, this.calibMs - dt);
    const p = now - this.calibFirst >= BB.CALIB_MAX_MS ? 1 : Math.min(1, this.calibMs / BB.CALIB_MS);
    if (p >= 1) this.base = med;
    return p;
  }

  /** Gewicht relativ zum Körpergewicht (1 = normal stehen) */
  ratio(): number {
    const s = this.sample;
    return s && this.base ? s.w / this.base : 1;
  }

  /** Steht (noch) jemand drauf? */
  standing(): boolean {
    const s = this.sample;
    return !!s && s.w >= BB.MIN_KG;
  }

  /**
   * Gewichtsspitze erkannt? (schnell hochdrücken = kurz mehr Gewicht, abspringen/entlasten = kurz weniger).
   * Meldet jede Spitze einmal; danach erst wieder, wenn das Gewicht zur Ruhe gekommen ist.
   */
  spike(): boolean {
    const r = this.ratio();
    const hit = r > BB.JUMP_HI || r < BB.JUMP_LO;
    if (hit && this.spikeArmed) {
      this.spikeArmed = false;
      return true;
    }
    if (!hit && r > 0.9 && r < 1.1) this.spikeArmed = true;
    return false;
  }

  live() {
    return liveOf(this.sample, this.base);
  }
}

/**
 * Grundgerüst der Board-Spiele: reihum ist genau einer dran. Phase `ready` wartet, bis er auf dem Board steht
 * und eingemessen ist (max. `BB.READY_MS`, sonst „nicht angetreten“). Danach übernimmt das Spiel (`startRun()`,
 * `step()`), bis es `endRun()` aufruft. Messwerte kommen vom Laptop (`balance()`, nur für Menschen) oder vom Bot
 * selbst (Eingabe `bb`, nur wenn der Bot dran ist).
 */
export abstract class BalanceTurnGame<S extends BalanceTurn & { sub: string }> implements MiniGame {
  abstract readonly kind: MiniKind;
  protected abstract state: S;
  protected feed = new BoardFeed();
  protected timers = new Timers();
  /** Wer in dieser Runde noch dran kommt */
  protected queue: string[] = [];
  protected deadline = 0;
  private lastTick = 0;

  constructor(
    protected ids: string[],
    protected ctx: MiniCtx,
    protected tickMs: number,
  ) {}

  abstract snapshot(): MiniSnapshot;
  /** Alle Einträge für den Spieler in dieser Runde: „nicht angetreten“ */
  protected abstract dns(id: string): void;
  /** Eingemessen → los (z. B. Phase `gate`) */
  protected abstract startRun(): void;
  /** Ein Simulationsschritt während des Laufs (dt in s) */
  protected abstract step(dt: number): void;
  /** Runde vorbei (alle waren dran) → nächste Runde mit `beginRound()` oder Spielende */
  protected abstract roundDone(): void;

  /** Spieler-ID des Board-Besitzers, aktuell */
  protected get active() {
    return this.state.active;
  }

  protected start() {
    this.lastTick = Date.now();
    this.timers.every(this.tickMs, () => this.tick());
  }

  protected beginRound(order: string[]) {
    this.state.order = order;
    this.queue = [...order];
    this.nextTurn();
  }

  /** Bestenliste neu laden (am Anfang jedes Zugs und nach einem neuen Rekord) */
  protected refreshRecords() {
    this.state.records = this.ctx.records?.(this.kind as BalanceKind) ?? [];
  }

  protected nextTurn() {
    const s = this.state;
    this.refreshRecords();
    let next: string | undefined;
    while ((next = this.queue.shift())) {
      if (this.ctx.isConnected(next) && !this.ctx.isGone?.(next)) break;
      this.dns(next);
    }
    if (!next) {
      s.active = null;
      return this.roundDone();
    }
    s.active = next;
    (s as BalanceTurn & { sub: string }).sub = 'ready';
    s.calib = 0;
    this.feed.resetPlayer();
    this.deadline = Date.now() + BB.READY_MS;
    this.ctx.onChange();
  }

  /** Der Lauf ist vorbei – nach `ms` kommt der Nächste */
  protected endRun(ms: number) {
    this.deadline = 0;
    this.timers.later(ms, () => this.nextTurn());
  }

  private tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const s = this.state;
    s.board = this.feed.fresh;
    s.bal = this.feed.live();
    s.endsIn = this.deadline ? Math.max(0, this.deadline - now) : 0;
    if (s.sub === 'ready' && s.active) {
      s.calib = this.feed.calibrate();
      if (s.calib >= 1) {
        this.deadline = 0;
        s.endsIn = 0;
        this.startRun();
      } else if (now >= this.deadline) {
        this.dns(s.active);
        this.nextTurn();
      }
    } else if (s.active) {
      this.step(dt);
    }
    this.ctx.onChange();
  }

  /** Messwert vom Laptop (Board oder Tastatur-Ersatz) – gilt für den Menschen, der dran ist */
  balance(sample: BalanceSample) {
    const a = this.active;
    if (a && !this.ctx.isBot?.(a)) this.feed.feed(sample);
  }

  input(playerId: string, action: string, payload: unknown) {
    if (action !== 'bb' || playerId !== this.active || !this.ctx.isBot?.(playerId)) return;
    const s = parseSample(payload);
    if (s) this.feed.feed(s);
  }

  playerDisconnected(id: string) {
    // Wer gar nicht erst aufs Board kommt und weg ist, wird übersprungen; ein laufender Sprung/Flug geht weiter
    if (id === this.active && this.state.sub === 'ready') {
      this.dns(id);
      this.nextTurn();
    }
  }

  skippable(): SkipInfo | null {
    const a = this.active;
    if (this.state.sub === 'ready' && a) return { label: `${possessive(this.ctx.nameOf(a))} Versuch überspringen` };
    return null;
  }

  skip() {
    const a = this.active;
    if (this.state.sub !== 'ready' || !a) return;
    this.dns(a);
    this.nextTurn();
  }

  dispose() {
    this.timers.clear();
  }
}
