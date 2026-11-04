import type { FlunkyState, Team } from '../shared/types';
import {
  DRINK_PER_TAP,
  FLIGHT_MS,
  RUN_TAPS,
  clamp,
  computeLanding,
  otherTeam,
} from '../shared/flunky';

/** Mindestabstand zwischen zwei Taps eines Spielers (gegen Auto-Clicker / Multi-Touch-Spam) */
const MIN_TAP_GAP_MS = 55;

/**
 * Flunkyball: Ein Team wirft auf die Flasche in der Mitte.
 * Treffer → das werfende Team trinkt (tippen), das andere Team schickt
 * einen Läufer, der die Flasche wieder aufstellt (ebenfalls tippen).
 * Wer zuerst als ganzes Team ausgetrunken hat, gewinnt.
 */
export class FlunkyGame {
  state: FlunkyState;
  private idx: Record<Team, number> = { A: 0, B: 0 };
  private lastTap = new Map<string, number>();
  private timers = new Set<NodeJS.Timeout>();
  private seq = 0;

  constructor(
    playerIds: string[],
    private onChange: () => void,
    private isConnected: (id: string) => boolean,
  ) {
    const shuffled = shuffle(playerIds);
    const beer: Record<string, number> = {};
    for (const id of playerIds) beer[id] = 100;
    this.state = {
      teams: {
        A: shuffled.filter((_, i) => i % 2 === 0),
        B: shuffled.filter((_, i) => i % 2 === 1),
      },
      beer,
      turnTeam: Math.random() < 0.5 ? 'A' : 'B',
      throwerId: '',
      sub: 'aim',
      wind: 0,
      runnerId: null,
      runProgress: 0,
      winner: null,
      lastThrow: null,
    };
    this.newTurn();
  }

  teamOf(id: string): Team | null {
    if (this.state.teams.A.includes(id)) return 'A';
    if (this.state.teams.B.includes(id)) return 'B';
    return null;
  }

  throw(playerId: string, angle: number, power: number) {
    const s = this.state;
    if (s.sub !== 'aim' || playerId !== s.throwerId) return;
    if (!Number.isFinite(angle) || !Number.isFinite(power)) return;
    const team = s.turnTeam;
    const { from, to, hit } = computeLanding(team, clamp(angle, -0.8, 0.8), clamp(power, 0, 1), s.wind);
    s.lastThrow = { seq: ++this.seq, throwerId: playerId, team, from, to, hit };
    s.sub = 'flight';
    this.onChange();
    this.later(FLIGHT_MS, () => {
      if (!hit) return this.advance();
      s.sub = 'chug';
      s.runnerId = this.pick(otherTeam(team));
      s.runProgress = 0;
      this.onChange();
    });
  }

  tap(playerId: string) {
    const s = this.state;
    if (s.sub !== 'chug') return;
    const now = Date.now();
    if (now - (this.lastTap.get(playerId) ?? 0) < MIN_TAP_GAP_MS) return;
    this.lastTap.set(playerId, now);

    const drinking = s.turnTeam;
    if (s.teams[drinking].includes(playerId) && s.beer[playerId] > 0) {
      s.beer[playerId] = Math.max(0, s.beer[playerId] - DRINK_PER_TAP);
      if (s.teams[drinking].every((id) => s.beer[id] <= 0)) {
        s.sub = 'over';
        s.winner = drinking;
        this.clearTimers();
      }
      this.onChange();
    } else if (playerId === s.runnerId) {
      s.runProgress += 1;
      if (s.runProgress >= RUN_TAPS) {
        s.runProgress = RUN_TAPS;
        s.sub = 'reset';
        this.later(700, () => this.advance());
      }
      this.onChange();
    }
  }

  /** Wird vom Raum aufgerufen, wenn ein Handy die Verbindung verliert. */
  playerDisconnected(id: string) {
    const s = this.state;
    if (s.sub === 'aim' && s.throwerId === id) {
      this.advance();
    } else if (s.sub === 'chug' && s.runnerId === id) {
      s.runnerId = this.pick(otherTeam(s.turnTeam));
      if (s.runnerId === id) {
        // Niemand mehr da zum Laufen → Runde einfach weitergeben
        this.advance();
      } else {
        this.onChange();
      }
    }
  }

  dispose() {
    this.clearTimers();
  }

  private newTurn() {
    const s = this.state;
    s.sub = 'aim';
    s.wind = Math.round((Math.random() * 2 - 1) * 10) / 10;
    s.throwerId = this.pick(s.turnTeam);
    s.runnerId = null;
    s.runProgress = 0;
    this.onChange();
  }

  private advance() {
    const s = this.state;
    const list = s.teams[s.turnTeam];
    this.idx[s.turnTeam] = (this.idx[s.turnTeam] + 1) % Math.max(1, list.length);
    s.turnTeam = otherTeam(s.turnTeam);
    this.newTurn();
  }

  /** Nächster verbundener Spieler eines Teams (reihum). */
  private pick(team: Team): string {
    const list = this.state.teams[team];
    for (let k = 0; k < list.length; k++) {
      const i = (this.idx[team] + k) % list.length;
      if (this.isConnected(list[i])) {
        this.idx[team] = i;
        return list[i];
      }
    }
    return list[this.idx[team] % list.length];
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
