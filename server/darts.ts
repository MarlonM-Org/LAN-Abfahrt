import type { MiniSnapshot, SkipInfo } from '../shared/types';
import {
  DARTS,
  type DartsDart,
  type DartsPlayer,
  type DartsState,
  type DartsTally,
  dartsAimFor,
  dartsApply,
  dartsCross,
  dartsDone,
  dartsLeft,
  dartsNoise,
  dartsPhase,
  dartsRank,
  dartsSay,
  dartsScore,
} from '../shared/darts';
import { playerColor } from '../shared/players';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, phaseTimer, waitLabel } from './minigame';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const num = (v: unknown, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** So weit darf der Wurf-Zeitpunkt des Handys (Serverzeit) zurück bzw. voraus liegen – Laufzeit und Uhrabgleich */
const AT_PAST_MS = 1500;
const AT_AHEAD_MS = 250;
/** Streuung (mm, 1 σ) der automatischen Würfe für Handys, die weg sind */
const AUTO_NOISE_MM = 14;

/** Normierte Wurf-Eingabe vom Handy */
export interface DartThrow {
  /** Dart-Nummer in der Runde (0 … 2) – gegen doppelt gesendete Würfe */
  n: number;
  /** Zielpunkt ohne Atmen (mm) */
  ax: number;
  ay: number;
  /** Atem-Amplitude (mm), wird auf AMP_MIN … AMP_MAX begrenzt */
  amp: number;
  /** Serverzeit (ms) des Loslassens bzw. Tippens – bestimmt die Stelle auf der Atem-Schleife */
  at: number;
}

/**
 * Landepunkt eines Wurfs: genau das Fadenkreuz (Zielpunkt + Atmen) im Moment des Loslassens – reine Funktion,
 * damit sie sich testen lässt. `t0` = Serverzeit des Rundenbeginns.
 */
export function resolveDart(playerId: string, round: number, t0: number, t: DartThrow) {
  const W = DARTS.WALL;
  const aim = { x: clamp(t.ax, -W, W), y: clamp(t.ay, -W, W) };
  const land = dartsCross(aim, Math.max(0, t.at - t0), t.amp, dartsPhase(playerId, round));
  return { land, hit: dartsScore(land) };
}

/**
 * Darts, 301 Single Out: Alle werfen GLEICHZEITIG ihre Aufnahme (3 Darts), Punkte werden abgezogen.
 * Wer genau auf 0 kommt, hat ausgecheckt (jedes Feld darf beenden); wer unter 0 kommt, hat überworfen – die Aufnahme
 * zählt nicht, die restlichen Darts verfallen. Checken mehrere in derselben Runde aus, gewinnt, wer weniger Darts
 * brauchte. Nach MAX_ROUNDS Runden gewinnt der niedrigste Rest. Kein Zeitlimit: Der Server wirft nur für Handys,
 * die weg sind; der VIP kann eine Runde beenden (fehlende Darts verfallen).
 */
export class DartsGame implements MiniGame {
  readonly kind = 'darts' as const;
  private sub: DartsState['sub'] = 'intro';
  private deadline = Date.now() + DARTS.INTRO_MS;
  private round = 0;
  private t0 = Date.now();
  private players: DartsPlayer[];
  private darts: DartsDart[] = [];
  private tally: DartsTally | null = null;
  private winners: string[] = [];
  private seq = 0;
  private autoSeq = 0;
  private closing = false;
  private readonly seed = (Math.random() * 2 ** 32) >>> 0;
  private timers = new Timers();

  constructor(
    ids: string[],
    private ctx: MiniCtx,
  ) {
    this.players = ids.map((id, i) => ({
      id,
      // Spielerfarbe des Abends (Pfeile, Fadenkreuz, Tafel)
      color: playerColor(ctx.colorOf?.(id) ?? i).num,
      rest: DARTS.START,
      start: DARTS.START,
      scored: 0,
      thrown: 0,
      bust: false,
      out: 0,
      skipped: false,
      history: [],
      aim: null,
    }));
    this.timers.later(DARTS.INTRO_MS, () => this.startRound());
  }

  private player(id: string) {
    return this.players.find((p) => p.id === id);
  }

  /** Ist das Spiel nach dieser Runde vorbei (jemand hat ausgecheckt oder Rundenlimit)? */
  private get decided() {
    return this.players.some((p) => p.out > 0) || this.round >= DARTS.MAX_ROUNDS;
  }

  // ---------------------------------------------------------------- Ablauf

  private startRound() {
    if (this.sub === 'over') return;
    this.round += 1;
    this.darts = [];
    this.tally = null;
    this.closing = false;
    this.t0 = Date.now();
    for (const p of this.players) {
      p.start = p.rest;
      p.scored = 0;
      p.thrown = 0;
      p.bust = false;
      p.skipped = false;
      p.aim = null;
    }
    this.sub = 'throw';
    this.deadline = 0; // kein Zeitlimit
    for (const p of this.players) if (!this.ctx.isConnected(p.id)) this.autoLater(p.id);
    this.ctx.onChange();
  }

  /** VIP/Laptop: Erklärung/Zwischenstand überspringen bzw. Runde beenden (fehlende Darts verfallen) */
  skippable(): SkipInfo | null {
    if (this.sub === 'intro') return { label: 'Los geht’s', info: true };
    if (this.sub === 'tally') return { label: 'Nächste Runde', info: true };
    if (this.sub === 'throw' && !this.closing) {
      const missing = this.players.filter((p) => !dartsDone(p) && this.ctx.isConnected(p.id)).map((p) => p.id);
      return { label: waitLabel(this.ctx, missing, 'Darts', 'Runde beenden') };
    }
    return null;
  }

  skip() {
    if (this.sub === 'intro' || this.sub === 'tally') {
      this.timers.clear();
      this.startRound();
    } else if (this.sub === 'throw') {
      if (this.closing) {
        // (nur Tests/Laptop) Anzeige nach dem letzten Dart abkürzen
        this.timers.clear();
        this.endRound();
        return;
      }
      for (const p of this.players) {
        if (dartsDone(p)) continue;
        p.skipped = true;
        p.aim = null;
      }
      this.closeRound();
      this.ctx.onChange();
    }
  }

  /** Abwesende werfen nach und nach automatisch */
  private autoLater(id: string) {
    const r = this.round;
    this.timers.later(DARTS.AUTO_MS, () => {
      const p = this.player(id);
      if (!p || this.sub !== 'throw' || this.round !== r || this.ctx.isConnected(id) || dartsDone(p)) return;
      this.throwDart(id, this.autoThrow(p), true);
      this.autoLater(id);
    });
  }

  /** Automatischer Wurf: zielt wie ein Bot auf den Checkout-Weg, aber mit deutlicher Streuung */
  private autoThrow(p: DartsPlayer): DartThrow {
    const target = dartsAimFor(p.rest, dartsLeft(p));
    const [nx, ny] = dartsNoise((this.seed ^ Math.imul(++this.autoSeq, 2654435761)) >>> 0);
    return { n: p.thrown, ax: target.x + nx * AUTO_NOISE_MM, ay: target.y + ny * AUTO_NOISE_MM, amp: DARTS.AMP_MIN + 6, at: Date.now() };
  }

  input(id: string, action: string, payload: unknown) {
    if (this.sub !== 'throw') return;
    const p = this.player(id);
    if (!p || dartsDone(p)) return;
    const m = asRecord(payload);
    const W = DARTS.WALL;
    if (action === 'aim') {
      // Live-Zielposition fürs TV (ohne Atmen – das rechnet der TV selbst aus t0)
      p.aim = {
        x: r1(clamp(num(m.x), -W, W)),
        y: r1(clamp(num(m.y), -W, W)),
        amp: r1(clamp(num(m.amp, DARTS.AMP_MAX), DARTS.AMP_MIN, DARTS.AMP_MAX)),
        on: m.on === true,
      };
      this.ctx.onChange();
      return;
    }
    if (action !== 'throw') return;
    const now = Date.now();
    this.throwDart(id, {
      n: Math.round(num(m.n, -1)),
      ax: num(m.ax),
      ay: num(m.ay),
      amp: num(m.amp, DARTS.AMP_MAX),
      at: clamp(num(m.at, now), now - AT_PAST_MS, now + AT_AHEAD_MS),
    });
  }

  private throwDart(id: string, t: DartThrow, auto = false) {
    const p = this.player(id);
    if (!p || this.sub !== 'throw' || dartsDone(p)) return;
    if (t.n !== p.thrown) return; // doppelt gesendet oder veraltet
    const { land, hit } = resolveDart(id, this.round, this.t0, t);
    const res = dartsApply(p.rest, hit.points);
    p.thrown += 1;
    if (res.bust) {
      // überworfen: Aufnahme zählt nicht, Stand wie vorher, restliche Darts verfallen
      p.bust = true;
      p.rest = p.start;
      p.scored = 0;
    } else {
      p.rest = res.rest;
      p.scored += hit.points;
      // Darts bis zum Checkout wie im echten Darts: jede frühere Aufnahme zählt 3
      if (res.out) p.out = (this.round - 1) * DARTS.DARTS_PER_ROUND + p.thrown;
    }
    if (dartsDone(p)) p.aim = null;
    // Hand zittert nach dem Wurf nach (das Handy rechnet dasselbe, der TV sieht es sofort)
    else if (p.aim) p.aim = { ...p.aim, amp: Math.max(p.aim.amp, DARTS.AMP_AFTER) };
    this.darts.push({
      seq: ++this.seq,
      owner: id,
      round: this.round,
      n: t.n,
      x: land.x,
      y: land.y,
      ring: hit.ring,
      seg: hit.seg,
      label: hit.label,
      short: hit.short,
      points: hit.points,
      rest: p.rest,
      bust: res.bust || undefined,
      out: res.out || undefined,
      auto: auto || undefined,
    });
    if (!this.closing && this.players.every(dartsDone)) this.closeRound();
    this.ctx.onChange();
  }

  /** Alle fertig → kurz den letzten Dart zeigen, dann Wertung */
  private closeRound() {
    if (this.closing) return;
    this.closing = true;
    this.deadline = Date.now() + DARTS.LAST_MS;
    const r = this.round;
    this.timers.later(DARTS.LAST_MS, () => this.round === r && this.endRound());
  }

  private endRound() {
    if (this.sub !== 'throw') return;
    for (const p of this.players) {
      p.history.push(p.bust ? null : p.scored);
      p.aim = null;
    }
    const ranked = [...this.players].sort(dartsRank);
    const scored = this.players.filter((p) => !p.bust).map((p) => p.scored);
    const best = scored.length ? Math.max(...scored) : 0;
    this.tally = {
      lead: this.players.filter((p) => dartsRank(p, ranked[0]) === 0).map((p) => p.id),
      rest: ranked[0].rest,
      busts: this.players.filter((p) => p.bust).map((p) => p.id),
      outs: this.players.filter((p) => p.out > 0).map((p) => p.id),
      best: best > 0 ? this.players.filter((p) => !p.bust && p.scored === best).map((p) => p.id) : [],
      points: best,
    };
    if (this.decided) return this.over();
    this.sub = 'tally';
    this.deadline = phaseTimer(this.timers, DARTS.TALLY_MS, () => this.startRound());
    this.ctx.onChange();
  }

  /** Platzierungen: Ausgecheckte nach Darts, dann nach Rest (gleich = gleicher Platz) */
  private groups(): string[][] {
    const ranked = [...this.players].sort(dartsRank);
    const groups: string[][] = [];
    ranked.forEach((p, i) => {
      if (i > 0 && dartsRank(ranked[i - 1], p) === 0) groups[groups.length - 1].push(p.id);
      else groups.push([p.id]);
    });
    return groups;
  }

  private over() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    const groups = this.groups();
    this.winners = groups[0] ?? [];
    this.deadline = Date.now() + DARTS.OVER_MS;
    this.ctx.onChange();
    const name = (id: string) => this.ctx.nameOf(id);
    const names = (ids: string[]) => ids.map(name).join(' & ');
    const outs = this.players.filter((p) => p.out > 0);
    let subtitle: string;
    if (outs.length === 1) {
      const last = this.darts.find((d) => d.owner === outs[0].id && d.out);
      subtitle = `${name(outs[0].id)} checkt${last ? ` mit ${dartsSay(last)}` : ''} aus!`;
    } else if (outs.length > 1) {
      subtitle =
        this.winners.length > 1
          ? `${names(this.winners)} checken gleichzeitig aus!`
          : `${name(this.winners[0])} checkt mit weniger Darts aus als ${names(outs.filter((p) => p.id !== this.winners[0]).map((p) => p.id))}!`;
    } else {
      const rest = this.player(this.winners[0])?.rest ?? DARTS.START;
      subtitle =
        this.winners.length > 1
          ? `Nach ${DARTS.MAX_ROUNDS} Runden Gleichstand mit Rest ${rest}!`
          : `Nach ${DARTS.MAX_ROUNDS} Runden: ${name(this.winners[0])} mit Rest ${rest} vorn!`;
    }
    this.timers.later(DARTS.OVER_MS, () =>
      this.ctx.finish({
        groups,
        details: Object.fromEntries(this.players.map((p) => [p.id, p.out ? `ausgecheckt (${p.out} Darts)` : `Rest ${p.rest}`])),
        subtitle,
      }),
    );
  }

  snapshot(): MiniSnapshot {
    const state: DartsState = {
      sub: this.sub,
      endsIn: endsIn(this.deadline),
      round: this.round,
      rounds: DARTS.MAX_ROUNDS,
      start: DARTS.START,
      t0: this.t0,
      players: this.players,
      darts: this.darts,
      tally: this.tally,
      winners: this.winners,
    };
    return { kind: 'darts', state };
  }

  playerDisconnected(id: string) {
    const p = this.player(id);
    if (p?.aim) p.aim = { ...p.aim, on: false };
    if (this.sub === 'throw') this.autoLater(id);
  }

  dispose() {
    this.timers.clear();
  }
}
