import type { MiniSnapshot, SkipInfo } from '../shared/types';
import { DARTS, type DartsDart, type DartsPlayer, type DartsState, dartsLanding, dartsNoise, dartsPhase, dartsPowerHint, dartsScore, dartsWobble } from '../shared/darts';
import { playerColor } from '../shared/players';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, groupByScore, phaseTimer, waitLabel } from './minigame';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const num = (v: unknown, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);

/** Normierte Wurf-Eingabe vom Handy */
export interface DartThrow {
  /** Dart-Nummer in der Runde (0 … 2) – gegen doppelt gesendete Würfe */
  n: number;
  /** Zielpunkt ohne Wackeln (mm) */
  ax: number;
  ay: number;
  /** Zeit (ms) seit Beginn des Zielens – bestimmt die Stelle auf der Wackel-Schleife */
  t: number;
  /** Wackel-Amplitude (mm), wird auf AMP_MIN … AMP_MAX begrenzt */
  amp: number;
  /** Kraft 0 … 1 */
  power: number;
  /** seitlicher Fehler −1 … 1 */
  side: number;
}

/** Fadenkreuz + Landepunkt eines Wurfs – reine Funktion, damit sie sich testen lässt */
export function resolveDart(playerId: string, round: number, seed: number, t: DartThrow) {
  const W = DARTS.WALL;
  const amp = clamp(t.amp, DARTS.AMP_MIN, DARTS.AMP_MAX);
  const wob = dartsWobble(clamp(t.t, 0, 600000), amp, dartsPhase(playerId, round, t.n));
  const cross = { x: clamp(t.ax, -W, W) + wob.x, y: clamp(t.ay, -W, W) + wob.y };
  let h = seed >>> 0;
  for (const ch of `${playerId}|${round}|${t.n}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const land = dartsLanding(cross, t.power, t.side, dartsNoise(h));
  return { cross, land, hit: dartsScore(land) };
}

/**
 * Darts an der Strandbar: alle werfen GLEICHZEITIG – pro Runde 3 Darts, 5 Runden, die letzte zählt doppelt.
 * Wer am Ende die meisten Punkte hat, gewinnt.
 */
export class DartsGame implements MiniGame {
  readonly kind = 'darts' as const;
  private sub: DartsState['sub'] = 'intro';
  private deadline = Date.now() + DARTS.INTRO_MS;
  private round = 0;
  private players: DartsPlayer[];
  private darts: DartsDart[] = [];
  private tally: DartsState['tally'] = null;
  private seq = 0;
  private closing = false;
  private readonly seed = (Math.random() * 2 ** 32) >>> 0;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.players = ids.map((id, i) => {
      // Spielerfarbe des Abends (Pfeile, Tafel)
      return { id, color: playerColor(ctx.colorOf?.(id) ?? i).num, total: 0, round: 0, thrown: 0, history: [] };
    });
    this.timers.later(DARTS.INTRO_MS, () => this.startRound());
  }

  private get mult() {
    return this.round === DARTS.ROUNDS ? DARTS.FINAL_MULT : 1;
  }

  private player(id: string) {
    return this.players.find((p) => p.id === id);
  }

  // ---------------------------------------------------------------- Ablauf

  private startRound() {
    this.round += 1;
    this.darts = [];
    this.tally = null;
    this.closing = false;
    for (const p of this.players) {
      p.round = 0;
      p.thrown = 0;
    }
    this.sub = 'throw';
    const r = this.round;
    // Zeit um (falls gesetzt) → wer noch Darts hat, wirft sie automatisch (eher ungenau)
    this.deadline = phaseTimer(this.timers, DARTS.ROUND_MS, () => {
      if (this.sub === 'throw' && this.round === r) this.throwRest();
    });
    for (const p of this.players) if (!this.ctx.isConnected(p.id)) this.autoLater(p.id);
    this.ctx.onChange();
  }

  private throwRest() {
    for (const p of this.players) while (p.thrown < DARTS.DARTS_PER_ROUND) this.throwDart(p.id, this.autoThrow(p), true);
  }

  /** VIP/Laptop: Erklärung/Zwischenstand überspringen bzw. Runde beenden (fehlende Darts fliegen automatisch) */
  skippable(): SkipInfo | null {
    if (this.sub === 'intro') return { label: 'Los geht’s', info: true };
    if (this.sub === 'tally') return { label: this.round >= DARTS.ROUNDS ? 'Zum Ergebnis' : 'Nächste Runde', info: true };
    if (this.sub === 'throw' && !this.closing) {
      const missing = this.players.filter((p) => p.thrown < DARTS.DARTS_PER_ROUND && this.ctx.isConnected(p.id)).map((p) => p.id);
      return { label: waitLabel(this.ctx, missing, 'Darts', 'Runde beenden') };
    }
    return null;
  }

  skip() {
    if (this.sub === 'intro') {
      this.timers.clear();
      this.startRound();
    } else if (this.sub === 'tally') {
      this.timers.clear();
      if (this.round >= DARTS.ROUNDS) this.over();
      else this.startRound();
    } else if (this.sub === 'throw' && !this.closing) this.throwRest();
  }

  /** Abwesende werfen nach und nach automatisch */
  private autoLater(id: string) {
    const r = this.round;
    this.timers.later(DARTS.AUTO_MS, () => {
      const p = this.player(id);
      if (!p || this.sub !== 'throw' || this.round !== r || this.ctx.isConnected(id) || p.thrown >= DARTS.DARTS_PER_ROUND) return;
      this.throwDart(id, this.autoThrow(p), true);
      this.autoLater(id);
    });
  }

  private autoThrow(p: DartsPlayer): DartThrow {
    return {
      n: p.thrown,
      ax: (Math.random() - 0.5) * 60,
      ay: -40 + (Math.random() - 0.5) * 80,
      t: Math.random() * 20000,
      amp: 28,
      power: DARTS.POWER_IDEAL + (Math.random() - 0.5) * 0.5,
      side: (Math.random() - 0.5) * 0.6,
    };
  }

  input(id: string, action: string, payload: unknown) {
    if (action !== 'throw' || this.sub !== 'throw') return;
    const p = asRecord(payload);
    this.throwDart(id, {
      n: Math.round(num(p.n, -1)),
      ax: num(p.ax),
      ay: num(p.ay),
      t: num(p.t),
      amp: num(p.amp, DARTS.AMP_MAX),
      power: clamp(num(p.power, DARTS.POWER_IDEAL), 0, 1),
      side: clamp(num(p.side), -1, 1),
    });
  }

  private throwDart(id: string, t: DartThrow, auto = false) {
    const p = this.player(id);
    if (!p || this.sub !== 'throw' || p.thrown >= DARTS.DARTS_PER_ROUND) return;
    if (t.n !== p.thrown) return; // doppelt gesendet oder veraltet
    const { land, hit } = resolveDart(id, this.round, this.seed, t);
    const points = hit.points * this.mult;
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
      points,
      power: dartsPowerHint(t.power),
      auto: auto || undefined,
    });
    p.thrown += 1;
    p.round += points;
    p.total += points;
    if (!this.closing && this.players.every((x) => x.thrown >= DARTS.DARTS_PER_ROUND)) {
      this.closing = true;
      this.deadline = Date.now() + DARTS.LAST_MS;
      const r = this.round;
      this.timers.later(DARTS.LAST_MS, () => this.round === r && this.endRound());
    }
    this.ctx.onChange();
  }

  private endRound() {
    if (this.sub !== 'throw') return;
    for (const p of this.players) p.history.push(p.round);
    const best = Math.max(...this.players.map((p) => p.round));
    this.tally = { best: this.players.filter((p) => p.round === best).map((p) => p.id), points: best };
    this.sub = 'tally';
    this.ctx.onChange();
    this.deadline = phaseTimer(this.timers, DARTS.TALLY_MS, () => (this.round >= DARTS.ROUNDS ? this.over() : this.startRound()));
  }

  private over() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.deadline = Date.now() + DARTS.OVER_MS;
    this.ctx.onChange();
    const ranked = [...this.players].sort((a, b) => b.total - a.total);
    const tie = ranked.length > 1 && ranked[0].total === ranked[1].total;
    const pts = (n: number) => `${n} ${n === 1 ? 'Punkt' : 'Punkte'}`;
    this.timers.later(DARTS.OVER_MS, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => this.player(id)?.total ?? 0),
        details: Object.fromEntries(this.players.map((p) => [p.id, pts(p.total)])),
        subtitle: tie
          ? `Gleichstand mit ${pts(ranked[0].total)}!`
          : `${this.ctx.nameOf(ranked[0].id)} wirft ${pts(ranked[0].total)} – Darts-König der Strandbar!`,
      }),
    );
  }

  snapshot(): MiniSnapshot {
    const state: DartsState = {
      sub: this.sub,
      endsIn: endsIn(this.deadline),
      round: this.round,
      rounds: DARTS.ROUNDS,
      mult: this.mult,
      players: this.players,
      darts: this.darts,
      tally: this.tally,
    };
    return { kind: 'darts', state };
  }

  playerDisconnected(id: string) {
    if (this.sub === 'throw') this.autoLater(id);
  }

  dispose() {
    this.timers.clear();
  }
}
