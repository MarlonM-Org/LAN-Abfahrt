import type { FunkSide, FunkState, MiniSnapshot, PrivateState, SkipInfo, Team } from '../shared/types';
import { TEAM_INFO } from '../shared/flunky';
import { FUNK, FUNK_PAIRS, funkClamp, funkOther, funkPoints, funkRounds } from '../shared/funk';
import { possessive } from '../shared/players';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, phaseTimer, shuffle, waitLabel } from './minigame';

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Funkfrequenz (à la Wavelength): Team Sonne gegen Team Meer.
 *
 * Pro Runde funkt ein Team: Nur der Funker sieht das geheime Ziel auf der Skala zwischen zwei Polen
 * und gibt laut einen Hinweis (optional auch getippt, dann steht er am TV). Sein Team stellt am Handy
 * einen Schieber – der Zeiger am TV ist der Mittelwert. Nach 45 s (oder wenn der Kapitän bestätigt)
 * steht der Tipp, und das andere Team wettet per Mehrheit „weiter links“ oder „weiter rechts“.
 * Treffer in den Zonen ±5/±12/±20 geben 4/3/2 Punkte, die richtige Wette 1 Punkt fürs Gegnerteam.
 * Teams wechseln sich ab, der Funker rotiert innerhalb des Teams. 6 bzw. 8 Runden, früher Schluss bei 10 Punkten.
 */
export class FunkGame implements MiniGame {
  readonly kind = 'funk' as const;
  private state: FunkState;
  private target = 50;
  private pairs: [string, string][];
  private start: Team;
  /** Funker-/Kapitäns-Rotation pro Team */
  private funkTurn: Record<Team, number> = { A: 0, B: 0 };
  private capTurn: Record<Team, number> = { A: 0, B: 0 };
  private deadline = 0;
  private timers = new Timers();
  /** Nächster Schritt nach einem Info-Screen (Intro, Auflösung) */
  private after: (() => void) | null = null;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const teams: Record<Team, string[]> = { A: [], B: [] };
    shuffle(ids).forEach((id, i) => teams[i % 2 === 0 ? 'A' : 'B'].push(id));
    // Pole zufällig auch mal andersherum, damit „gut“ nicht immer rechts liegt
    this.pairs = shuffle(FUNK_PAIRS).map((p) => (Math.random() < 0.5 ? p : [p[1], p[0]]));
    this.start = Math.random() < 0.5 ? 'A' : 'B';
    this.state = {
      sub: 'intro',
      round: 0,
      rounds: funkRounds(ids.length),
      endsIn: 0,
      phaseNo: 0,
      teams,
      score: { A: 0, B: 0 },
      active: this.start,
      funker: teams[this.start][0],
      captain: null,
      pair: this.pairs[0],
      clue: null,
      dial: 50,
      dials: {},
      locked: false,
      bets: {},
      reveal: null,
      winScore: FUNK.WIN_SCORE,
      funkCount: Object.fromEntries(ids.map((id) => [id, 0])),
    };
    this.nextRound();
  }

  snapshot(): MiniSnapshot {
    return { kind: 'funk', state: { ...this.state, endsIn: endsIn(this.deadline) } };
  }

  privateFor(id: string): PrivateState {
    const s = this.state;
    if (!this.ids.includes(id) || s.round === 0) return null;
    const role = id === s.funker ? 'funker' : s.teams[s.active].includes(id) ? 'team' : 'gegner';
    const secret = s.sub !== 'reveal' && s.sub !== 'over';
    return {
      kind: 'funk',
      state: {
        round: s.round,
        role,
        target: role === 'funker' && secret ? this.target : null,
        // Testspieler „hören“ den Hinweis nicht – sie bekommen das Ziel und streuen selbst kräftig
        ...(role === 'team' && s.sub === 'tune' && this.ctx.isBot?.(id) ? { botHint: this.target } : {}),
      },
    };
  }

  input(id: string, action: string, payload: unknown) {
    if (!this.ids.includes(id)) return;
    const s = this.state;
    const p = asRecord(payload);

    if (action === 'clue' && id === s.funker && (s.sub === 'clue' || s.sub === 'tune' || s.sub === 'intro')) {
      if (typeof p.text === 'string') s.clue = cleanClue(p.text);
      if (p.go === true && (s.sub === 'clue' || s.sub === 'intro')) return this.startTune();
      this.ctx.onChange();
    } else if (action === 'dial' && s.sub === 'tune' && !s.locked && this.guessers().includes(id)) {
      const v = Number(p.v);
      if (!Number.isFinite(v)) return;
      s.dials[id] = r1(funkClamp(v));
      s.dial = this.mean();
      this.ctx.onChange();
    } else if (action === 'lock' && s.sub === 'tune' && id === s.captain) {
      this.lockTip();
    } else if (action === 'bet' && s.sub === 'bet' && s.teams[funkOther(s.active)].includes(id) && !(id in s.bets)) {
      const side: FunkSide | null = p.side === 'left' || p.side === 'right' ? p.side : null;
      if (!side) return;
      s.bets[id] = side;
      if (!this.checkAllBet()) this.ctx.onChange();
    }
  }

  playerDisconnected(id: string) {
    const s = this.state;
    // Funker weg, bevor das Drehen losgeht → ein anderer aus dem Team übernimmt (kennt dann das Ziel)
    if (id === s.funker && (s.sub === 'intro' || s.sub === 'clue')) {
      const alt = s.teams[s.active].filter((o) => o !== id && this.ctx.isConnected(o));
      if (alt.length) {
        s.funkCount[id] = Math.max(0, s.funkCount[id] - 1);
        s.funker = alt[0];
        s.funkCount[s.funker] += 1;
        s.clue = null;
        if (s.captain === s.funker) s.captain = this.pickCaptain(s.active, s.funker);
        delete s.dials[s.funker];
      }
    }
    if (id === s.captain && (s.sub === 'intro' || s.sub === 'clue' || s.sub === 'tune')) s.captain = this.pickCaptain(s.active, s.funker);
    if (s.sub === 'bet' && this.checkAllBet()) return;
    this.ctx.onChange();
  }

  dispose() {
    this.timers.clear();
  }

  // ---------------------------------------------------------------- Ablauf

  /** Wer im funkenden Team dreht (alle außer dem Funker) */
  private guessers(): string[] {
    const s = this.state;
    return s.teams[s.active].filter((id) => id !== s.funker);
  }

  /** Zeiger = Mittelwert aller Regler, die schon gedreht wurden (sonst Mitte); wer weg ist, zählt nicht mit */
  private mean(): number {
    const set = this.guessers().filter((id) => id in this.state.dials);
    const live = set.filter((id) => this.ctx.isConnected(id));
    const vals = (live.length ? live : set).map((id) => this.state.dials[id]);
    return vals.length ? r1(vals.reduce((a, b) => a + b, 0) / vals.length) : 50;
  }

  /** Nächster aus dem Team in der Rotation (Verbundene zuerst) */
  private rotate(team: Team, turn: Record<Team, number>, skip: string | null): string | null {
    const list = this.state.teams[team].filter((id) => id !== skip);
    if (!list.length) return null;
    for (let k = 0; k < list.length; k++) {
      const id = list[(turn[team] + k) % list.length];
      if (this.ctx.isConnected(id)) {
        turn[team] = turn[team] + k + 1;
        return id;
      }
    }
    return list[turn[team]++ % list.length];
  }

  private pickCaptain(team: Team, funker: string): string | null {
    return this.rotate(team, this.capTurn, funker);
  }

  private nextRound() {
    const s = this.state;
    this.timers.clear();
    if (s.round >= s.rounds || s.score.A >= FUNK.WIN_SCORE || s.score.B >= FUNK.WIN_SCORE) return this.finishGame();
    s.round += 1;
    s.phaseNo += 1;
    s.active = s.round % 2 === 1 ? this.start : funkOther(this.start);
    s.funker = this.rotate(s.active, this.funkTurn, null) ?? s.teams[s.active][0];
    s.funkCount[s.funker] += 1;
    s.captain = this.pickCaptain(s.active, s.funker);
    s.pair = this.pairs[(s.round - 1) % this.pairs.length];
    this.target = FUNK.TARGET_MIN + Math.floor(Math.random() * (FUNK.TARGET_MAX - FUNK.TARGET_MIN + 1));
    s.clue = null;
    s.dial = 50;
    s.dials = {};
    s.locked = false;
    s.bets = {};
    s.reveal = null;
    s.sub = 'intro';
    this.after = () => this.startClue();
    this.deadline = phaseTimer(this.timers, FUNK.INTRO_MS, () => this.startClue());
    this.ctx.onChange();
  }

  private startClue() {
    const s = this.state;
    this.timers.clear();
    this.after = null;
    s.sub = 'clue';
    s.phaseNo += 1;
    this.deadline = phaseTimer(this.timers, FUNK.CLUE_MS, () => this.startTune());
    this.ctx.onChange();
  }

  private startTune() {
    const s = this.state;
    this.timers.clear();
    this.after = null;
    s.sub = 'tune';
    s.phaseNo += 1;
    this.deadline = phaseTimer(this.timers, FUNK.TUNE_MS, () => this.lockTip());
    this.ctx.onChange();
  }

  private lockTip() {
    const s = this.state;
    if (s.sub !== 'tune') return;
    this.timers.clear();
    s.locked = true;
    s.dial = this.mean();
    s.sub = 'bet';
    s.phaseNo += 1;
    this.deadline = phaseTimer(this.timers, FUNK.BET_MS, () => this.resolve());
    if (!this.bettors().length) return this.resolve();
    this.ctx.onChange();
  }

  private bettors(): string[] {
    const s = this.state;
    return s.teams[funkOther(s.active)].filter((id) => this.ctx.isConnected(id));
  }

  /** Alle (verbundenen) Gegner haben gewettet → sofort auflösen */
  private checkAllBet(): boolean {
    const s = this.state;
    if (s.sub !== 'bet') return false;
    const need = this.bettors();
    if (need.length && !need.every((id) => id in s.bets)) return false;
    this.resolve();
    return true;
  }

  private resolve() {
    const s = this.state;
    if (s.sub !== 'bet') return;
    this.timers.clear();
    const target = this.target;
    const points = funkPoints(target, s.dial);
    const left = Object.values(s.bets).filter((b) => b === 'left').length;
    const right = Object.values(s.bets).filter((b) => b === 'right').length;
    const bet: FunkSide | null = left > right ? 'left' : right > left ? 'right' : null;
    const diff = target - s.dial;
    const truth: FunkSide | null = Math.abs(diff) < 0.5 ? null : diff < 0 ? 'left' : 'right';
    const betRight = bet && truth ? bet === truth : bet ? false : null;
    const other = funkOther(s.active);
    const gains: Record<Team, number> = { A: 0, B: 0 };
    gains[s.active] = points;
    if (betRight) gains[other] += FUNK.BET_POINTS;
    s.score.A += gains.A;
    s.score.B += gains.B;
    s.reveal = { target, dial: s.dial, points, bet, betRight, gains };
    s.sub = 'reveal';
    s.phaseNo += 1;
    this.after = () => this.nextRound();
    this.deadline = phaseTimer(this.timers, FUNK.REVEAL_MS, () => this.nextRound());
    this.ctx.onChange();
  }

  private finishGame() {
    const s = this.state;
    this.timers.clear();
    this.after = null;
    s.sub = 'over';
    s.phaseNo += 1;
    this.deadline = 0;
    this.ctx.onChange();
    const { A, B } = s.score;
    const win: Team | null = A > B ? 'A' : B > A ? 'B' : null;
    this.timers.later(1500, () =>
      this.ctx.finish({
        groups: win ? [s.teams[win], s.teams[funkOther(win)]].filter((g) => g.length) : [[...this.ids]],
        details: Object.fromEntries(
          this.ids.map((id) => {
            const t: Team = s.teams.A.includes(id) ? 'A' : 'B';
            const n = s.funkCount[id] ?? 0;
            return [id, `${TEAM_INFO[t].name}: ${s.score[t]} P.${n ? ` · ${n}× Funker` : ''}`];
          }),
        ),
        subtitle: win ? `${TEAM_INFO[win].name} trifft die Frequenz – ${Math.max(A, B)}:${Math.min(A, B)}!` : `Unentschieden – ${A}:${B}!`,
      }),
    );
  }

  // ---------------------------------------------------------------- VIP / Laptop

  skippable(): SkipInfo | null {
    const s = this.state;
    if (s.sub === 'intro' || s.sub === 'reveal') return { label: 'Weiter', info: true };
    if (s.sub === 'clue') return { label: `${possessive(this.ctx.nameOf(s.funker))} Hinweis überspringen` };
    if (s.sub === 'tune') return { label: 'Tipp festmachen' };
    if (s.sub === 'bet') {
      const missing = this.bettors().filter((id) => !(id in s.bets));
      return { label: waitLabel(this.ctx, missing, 'Wette', 'Wetten beenden') };
    }
    return null;
  }

  skip() {
    const s = this.state;
    if (s.sub === 'clue') return this.startTune();
    if (s.sub === 'tune') return this.lockTip();
    if (s.sub === 'bet') return this.resolve();
    const after = this.after;
    if (!after) return;
    this.after = null;
    after();
  }
}

function cleanClue(t: string): string | null {
  const c = t.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, FUNK.MAX_CLUE);
  return c || null;
}
