import type { FlunkyState, MiniSnapshot, Point, SkipInfo, Team } from '../shared/types';
import { possessive } from '../shared/players';
import {
  BOTTLE,
  FLUNKY,
  FLUNKY_AIM_IDLE_MS,
  TEAM_INFO,
  THROW_SPOT,
  clamp,
  computeLanding,
  nextBottle,
  nextSpot,
  nextWind,
  otherTeam,
} from '../shared/flunky';
import { type MiniCtx, type MiniGame, Timers, asRecord, splitTeams } from './minigame';

/** Mindestabstand zwischen zwei Taps eines Spielers (gegen Auto-Clicker / Multi-Touch-Spam) */
const MIN_TAP_GAP_MS = 55;

/**
 * Flunkyball: Die Teams werfen abwechselnd auf die Flasche in der Mitte – jeder Wurf von einem anderen Punkt der
 * Wurfzone, Richtung (Zielpfeil) und Kraft stellt der Werfer selbst ein, der Wind treibt den Ball seitlich ab.
 * Treffer → das werfende Team trinkt (tippen), höchstens `SIP_MAX` % pro Treffer, bis der Läufer des anderen Teams
 * die Flasche wieder aufgestellt hat (sie steht danach etwas versetzt). Wer zuerst ausgetrunken hat, gewinnt –
 * sonst nach `ROUNDS` Runden das Team, das mehr getrunken hat (Gleichstand: Verlängerung, dann Unentschieden).
 */
export class FlunkyGame implements MiniGame {
  readonly kind = 'flunky' as const;
  state: FlunkyState;
  private idx: Record<Team, number> = { A: 0, B: 0 };
  private lastTap = new Map<string, number>();
  private timers = new Timers();
  private seq = 0;
  private turnNo = 0;
  private lastSpot: Record<Team, Point | null> = { A: null, B: null };
  private hitsBy = new Map<string, number>();
  /** Verlängerungsrunden bisher */
  private extra = 0;
  /** Läufer hat die Flasche in diesem Treffer schon neu aufgestellt */
  private bottleMoved = false;

  constructor(
    playerIds: string[],
    private ctx: MiniCtx,
  ) {
    const beer: Record<string, number> = {};
    for (const id of playerIds) beer[id] = 100;
    const turnTeam: Team = Math.random() < 0.5 ? 'A' : 'B';
    this.state = {
      // Vom Spielbrett vorgegebene Teams (2 gegen 2) oder zufällig geteilt
      teams: splitTeams(playerIds, ctx.teams ?? ctx.warmTeams),
      beer,
      turnTeam,
      throwerId: '',
      sub: 'aim',
      wind: nextWind(0),
      runnerId: null,
      runProgress: 0,
      winner: null,
      lastThrow: null,
      spot: { ...THROW_SPOT[turnTeam] },
      bottle: { ...BOTTLE },
      aim: 0,
      round: 1,
      rounds: FLUNKY.ROUNDS,
      throws: { A: 0, B: 0 },
      hits: { A: 0, B: 0 },
      sipFloor: {},
      reason: null,
    };
    this.newTurn(true);
  }

  snapshot(): MiniSnapshot {
    return { kind: 'flunky', state: this.state };
  }

  input(playerId: string, action: string, payload: unknown) {
    const s = this.state;
    if (action === 'aim') {
      // Zielpfeil live (TV zeigt ihn) – nur der Werfer, nur beim Zielen
      if (s.sub !== 'aim' || playerId !== s.throwerId) return;
      const a = Number(asRecord(payload).aim);
      if (!Number.isFinite(a)) return;
      const aim = Math.round(clamp(a, -FLUNKY.AIM_MAX, FLUNKY.AIM_MAX) * 1000) / 1000;
      if (aim === s.aim) return;
      s.aim = aim;
      this.ctx.onChange();
    } else if (action === 'throw') {
      const p = asRecord(payload);
      this.throw(playerId, Number(p.aim ?? s.aim), Number(p.dev ?? 0), Number(p.power));
    } else if (action === 'tap') {
      this.tap(playerId);
    }
  }

  private throw(playerId: string, aim: number, dev: number, power: number) {
    const s = this.state;
    if (s.sub !== 'aim' || playerId !== s.throwerId) return;
    if (!Number.isFinite(aim) || !Number.isFinite(power)) return;
    if (!Number.isFinite(dev)) dev = 0;
    const team = s.turnTeam;
    s.aim = clamp(aim, -FLUNKY.AIM_MAX, FLUNKY.AIM_MAX);
    const dir = s.aim + clamp(dev, -FLUNKY.DEV_MAX, FLUNKY.DEV_MAX);
    const pw = clamp(power, 0, 1);
    const r = computeLanding(team, s.spot, dir, pw, s.wind, s.bottle);
    const r1 = (v: number) => Math.round(v * 10) / 10;
    s.lastThrow = {
      seq: ++this.seq,
      throwerId: playerId,
      team,
      from: { ...s.spot },
      to: { x: r1(r.to.x), y: r1(r.to.y) },
      hit: r.hit,
      bottle: { ...s.bottle },
      aim: Math.round(dir * 1000) / 1000,
      power: Math.round(pw * 1000) / 1000,
      wind: s.wind,
      along: r1(r.along),
      lat: r1(r.lat),
    };
    s.throws[team]++;
    if (r.hit) {
      s.hits[team]++;
      this.hitsBy.set(playerId, (this.hitsBy.get(playerId) ?? 0) + 1);
    }
    s.sub = 'flight';
    this.ctx.onChange();
    if (r.hit) this.timers.later(FLUNKY.FLIGHT_MS, () => this.startChug());
    else this.timers.later(FLUNKY.FLIGHT_MS + FLUNKY.MISS_PAUSE_MS, () => this.advance());
  }

  /** Treffer: das werfende Team trinkt (mit Schluck-Limit), das andere schickt einen Läufer */
  private startChug() {
    const s = this.state;
    s.sub = 'chug';
    s.runnerId = this.pick(otherTeam(s.turnTeam));
    s.runProgress = 0;
    s.sipFloor = {};
    for (const id of s.teams[s.turnTeam]) s.sipFloor[id] = Math.max(0, Math.round((s.beer[id] - FLUNKY.SIP_MAX) * 10) / 10);
    this.bottleMoved = false;
    this.ctx.onChange();
  }

  private tap(playerId: string) {
    const s = this.state;
    if (s.sub !== 'chug') return;
    const now = Date.now();
    if (now - (this.lastTap.get(playerId) ?? 0) < MIN_TAP_GAP_MS) return;
    this.lastTap.set(playerId, now);

    const drinking = s.turnTeam;
    if (s.teams[drinking].includes(playerId)) {
      const floor = s.sipFloor[playerId] ?? 0;
      if (s.beer[playerId] <= floor) return;
      s.beer[playerId] = Math.max(floor, Math.round((s.beer[playerId] - FLUNKY.DRINK_PER_TAP) * 10) / 10);
      if (this.teamDone(drinking)) return this.end(drinking, 'empty');
      // Alle haben ihr Limit für diesen Treffer → Flasche wird aufgestellt, keiner wartet auf den Läufer
      if (this.drinkersAtLimit()) return this.finishChug();
      this.ctx.onChange();
    } else if (playerId === s.runnerId) {
      s.runProgress += 1;
      // An der Flasche angekommen: sie wird etwas versetzt wieder aufgestellt
      if (!this.bottleMoved && s.runProgress >= FLUNKY.RUN_TAPS / 2) this.moveBottle();
      if (s.runProgress >= FLUNKY.RUN_TAPS) {
        s.runProgress = FLUNKY.RUN_TAPS;
        return this.finishChug();
      }
      this.ctx.onChange();
    }
  }

  private moveBottle() {
    this.bottleMoved = true;
    this.state.bottle = nextBottle();
  }

  private finishChug() {
    const s = this.state;
    if (s.sub !== 'chug') return;
    if (!this.bottleMoved) this.moveBottle();
    s.sub = 'reset';
    this.ctx.onChange();
    this.timers.later(FLUNKY.RESET_MS, () => this.advance());
  }

  private drinkersAtLimit() {
    const s = this.state;
    const live = s.teams[s.turnTeam].filter((id) => this.ctx.isConnected(id));
    return live.length > 0 && live.every((id) => s.beer[id] <= (s.sipFloor[id] ?? 0));
  }

  private end(winner: Team | null, reason: NonNullable<FlunkyState['reason']>) {
    const s = this.state;
    if (s.sub === 'over') return;
    s.sub = 'over';
    s.winner = winner;
    s.reason = reason;
    this.timers.clear();
    this.ctx.onChange();
    this.timers.later(FLUNKY.OVER_MS, () => {
      const details: Record<string, string> = {};
      for (const t of ['A', 'B'] as Team[]) {
        for (const id of s.teams[t]) {
          const h = this.hitsBy.get(id) ?? 0;
          details[id] = `${TEAM_INFO[t].name} · ${Math.round(100 - s.beer[id])}% getrunken · ${h} Treffer`;
        }
      }
      if (!winner) {
        this.ctx.finish({ groups: [[...s.teams.A, ...s.teams.B]], details, subtitle: 'Unentschieden – beide Teams haben gleich viel getrunken!', coins: [6] });
        return;
      }
      const loser = otherTeam(winner);
      const pct = (t: Team) => Math.round(100 - this.liveBeer(t));
      const subtitle =
        reason === 'empty'
          ? `${TEAM_INFO[winner].name} hat zuerst ausgetrunken!`
          : reason === 'forfeit'
            ? `${TEAM_INFO[winner].name} gewinnt – ${TEAM_INFO[loser].name} ist weg.`
            : `Nach ${s.throws[winner]} Runden: ${TEAM_INFO[winner].name} hat mehr getrunken (${pct(winner)} % zu ${pct(loser)} %)`;
      this.ctx.finish({ groups: [s.teams[winner], s.teams[loser]], details, subtitle, coins: [10, 3] });
    });
  }

  playerDisconnected(id: string) {
    const s = this.state;
    if (s.sub === 'over') return;
    // Ein ganzes Team weg → das andere gewinnt; wer noch trinkt, muss nicht auf Abwesende warten
    for (const t of ['A', 'B'] as Team[]) {
      if (!s.teams[t].some((p) => this.ctx.isConnected(p))) return this.end(otherTeam(t), 'forfeit');
    }
    if (s.sub === 'chug' && this.teamDone(s.turnTeam)) return this.end(s.turnTeam, 'empty');
    if (s.sub === 'chug' && this.drinkersAtLimit()) return this.finishChug();
    if (s.sub === 'aim' && s.throwerId === id) {
      this.skipThrow();
    } else if (s.sub === 'chug' && s.runnerId === id) {
      s.runnerId = this.pick(otherTeam(s.turnTeam));
      if (s.runnerId === id) this.finishChug();
      else this.ctx.onChange();
    }
  }

  dispose() {
    this.timers.clear();
  }

  private newTurn(first = false) {
    const s = this.state;
    const team = s.turnTeam;
    s.sub = 'aim';
    if (!first) s.wind = nextWind(s.wind);
    s.throwerId = this.pick(team);
    // Jeder Wurf von woanders: seitlich versetzt, mal näher, mal weiter
    s.spot = nextSpot(team, this.lastSpot[team]);
    this.lastSpot[team] = s.spot;
    s.aim = 0;
    s.round = s.throws[team] + 1;
    s.runnerId = null;
    s.runProgress = 0;
    s.sipFloor = {};
    this.ctx.onChange();
    const turn = ++this.turnNo;
    if (FLUNKY_AIM_IDLE_MS !== null) {
      this.timers.later(FLUNKY_AIM_IDLE_MS, () => {
        if (this.turnNo === turn && s.sub === 'aim') this.skipThrow();
      });
    }
  }

  /** VIP: Wurf überspringen (zählt als Fehlwurf, das andere Team ist dran). Trinken/Laufen ist Echtzeit – kein Überspringen. */
  skippable(): SkipInfo | null {
    const s = this.state;
    return s.sub === 'aim' && s.throwerId ? { label: `${possessive(this.ctx.nameOf(s.throwerId))} Wurf überspringen` } : null;
  }

  skip() {
    if (this.state.sub === 'aim') this.skipThrow();
  }

  /** Wurf fällt aus (VIP, offline) – zählt als Fehlwurf, damit die Runden aufgehen */
  private skipThrow() {
    this.state.throws[this.state.turnTeam]++;
    this.advance();
  }

  /** Team hat ausgetrunken – wer offline/entfernt ist, zählt nicht (sonst gewinnt das Team nie). */
  private teamDone(team: Team) {
    const s = this.state;
    const live = s.teams[team].filter((id) => this.ctx.isConnected(id));
    return live.length > 0 && live.every((id) => s.beer[id] <= 0);
  }

  /** Restbier eines Teams im Schnitt – nur wer noch da ist (wer gegangen ist, kann nicht mehr trinken) */
  private liveBeer(team: Team) {
    const s = this.state;
    const live = s.teams[team].filter((id) => this.ctx.isConnected(id));
    const ids = live.length ? live : s.teams[team];
    return ids.reduce((sum, id) => sum + s.beer[id], 0) / Math.max(1, ids.length);
  }

  private advance() {
    const s = this.state;
    if (s.sub === 'over') return;
    const list = s.teams[s.turnTeam];
    this.idx[s.turnTeam] = (this.idx[s.turnTeam] + 1) % Math.max(1, list.length);
    // Runde vorbei (beide Teams gleich oft geworfen) und alle Runden gespielt → wer hat mehr getrunken?
    if (s.throws.A === s.throws.B && s.throws.A >= s.rounds + this.extra) {
      const a = this.liveBeer('A');
      const b = this.liveBeer('B');
      if (Math.abs(a - b) >= 0.5) return this.end(a < b ? 'A' : 'B', 'rounds');
      if (this.extra >= FLUNKY.EXTRA_ROUNDS) return this.end(null, 'draw');
      this.extra++;
    }
    s.turnTeam = otherTeam(s.turnTeam);
    this.newTurn();
  }

  /** Nächster verbundener Spieler eines Teams (reihum). */
  private pick(team: Team): string {
    const list = this.state.teams[team];
    for (let k = 0; k < list.length; k++) {
      const i = (this.idx[team] + k) % list.length;
      if (this.ctx.isConnected(list[i])) {
        this.idx[team] = i;
        return list[i];
      }
    }
    return list[this.idx[team] % list.length];
  }
}
