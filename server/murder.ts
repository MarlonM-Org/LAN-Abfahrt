import type { MiniSnapshot, MurderPrivate, MurderState, PrivateState } from '../shared/types';
import { MURDER, ROOMS } from '../shared/games';
import { type MiniCtx, type MiniGame, Timers, asRecord, shuffle } from './minigame';

interface Body {
  victim: string;
  room: number;
  found: boolean;
  announced: boolean;
}

/**
 * Mord im Ferienhaus – Among-Us-light fürs Handy.
 *
 * Aufgabenphase: Jeder wählt am Handy einen Raum und erledigt dort Aufgaben.
 * Der Mörder kann jemanden ausschalten, wenn er mit genau einer Person allein im Raum ist.
 * Wer eine Leiche findet, kann sie melden → Besprechung → Abstimmung.
 * Urlauber gewinnen, wenn alle Aufgaben erledigt sind oder der Mörder rausgewählt wird.
 */
export class MurderGame implements MiniGame {
  readonly kind = 'murder' as const;
  private state: MurderState;
  private murderers: string[];
  private room = new Map<string, number | null>();
  private taps = new Map<string, number>();
  private done = new Map<string, Set<number>>();
  private killedThisPhase = new Set<string>();
  private bodies: Body[] = [];
  private votes = new Map<string, string>();
  private deadline = 0;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const count = ids.length >= 7 ? 2 : 1;
    this.murderers = shuffle(ids).slice(0, count);
    const urlauber = ids.length - count;
    this.state = {
      sub: 'roles',
      endsIn: 0,
      phaseNo: 0,
      alive: Object.fromEntries(ids.map((id) => [id, true])),
      roomCounts: ROOMS.map(() => 0),
      taskProgress: 0,
      taskTarget: urlauber * MURDER.TASKS_PER_PLAYER,
      deaths: [],
      reporter: null,
      voted: [],
      voteTally: null,
      ejected: null,
      ejectedWasMurderer: null,
      winner: null,
      winReason: null,
      murderers: null,
      screamSeq: 0,
    };
    this.setDeadline(MURDER.ROLES_MS);
    this.timers.later(MURDER.ROLES_MS, () => this.startTasks());
  }

  snapshot(): MiniSnapshot {
    const counts = ROOMS.map(() => 0);
    for (const id of this.ids) {
      const r = this.room.get(id);
      if (this.state.alive[id] && r !== null && r !== undefined) counts[r] += 1;
    }
    return {
      kind: 'murder',
      state: { ...this.state, roomCounts: counts, endsIn: Math.max(0, this.deadline - Date.now()) },
    };
  }

  privateFor(id: string): PrivateState {
    if (!this.ids.includes(id)) return null;
    const isMurderer = this.murderers.includes(id);
    const r = this.room.get(id) ?? null;
    const s = this.state;
    const priv: MurderPrivate = {
      role: isMurderer ? 'murderer' : 'urlauber',
      partners: isMurderer ? this.murderers.filter((m) => m !== id) : [],
      alive: s.alive[id],
      room: r,
      taskTaps: this.taps.get(id) ?? 0,
      doneRooms: [...(this.done.get(id) ?? [])],
      killTarget: s.sub === 'tasks' ? this.killTargetFor(id) : null,
      bodyHere: s.sub === 'tasks' && s.alive[id] && r !== null && this.bodies.some((b) => !b.found && b.room === r),
      myVote: this.votes.get(id) ?? null,
    };
    return { kind: 'murder', state: priv };
  }

  input(id: string, action: string, payload: unknown) {
    if (!this.ids.includes(id)) return;
    const s = this.state;
    const p = asRecord(payload);

    if (s.sub === 'tasks') {
      if (action === 'room') {
        const r = Number(p.room);
        if (!Number.isInteger(r) || r < 0 || r >= ROOMS.length) return;
        this.room.set(id, r);
        this.taps.set(id, 0);
        this.ctx.onChange();
      } else if (action === 'task') {
        this.task(id);
      } else if (action === 'kill') {
        this.kill(id);
      } else if (action === 'report') {
        const r = this.room.get(id);
        const body = this.bodies.find((b) => !b.found && b.room === r);
        if (s.alive[id] && body) this.meeting(id);
      }
    } else if (s.sub === 'vote' && action === 'vote') {
      if (!s.alive[id]) return;
      const target = String(p.target ?? '');
      if (target !== 'skip' && !(this.ids.includes(target) && s.alive[target])) return;
      this.votes.set(id, target);
      s.voted = [...this.votes.keys()];
      const voters = this.ids.filter((v) => s.alive[v] && this.ctx.isConnected(v));
      if (voters.every((v) => this.votes.has(v))) {
        this.timers.clear();
        this.tallyVotes();
      } else {
        this.ctx.onChange();
      }
    }
  }

  vipAction(action: string) {
    if (action === 'skip' && this.state.sub === 'meeting') {
      this.timers.clear();
      this.startVote();
    }
  }

  playerDisconnected() {
    // Spieler bleiben im Spiel – beim Wiederverbinden geht es weiter.
    // Läuft gerade eine Abstimmung, nicht auf Abwesende warten.
    const s = this.state;
    if (s.sub !== 'vote' || !this.votes.size) return;
    const voters = this.ids.filter((v) => s.alive[v] && this.ctx.isConnected(v));
    if (voters.every((v) => this.votes.has(v))) {
      this.timers.clear();
      this.tallyVotes();
    }
  }

  dispose() {
    this.timers.clear();
  }

  // ---------------------------------------------------------------- Phasen

  private startTasks() {
    const s = this.state;
    s.sub = 'tasks';
    s.phaseNo += 1;
    s.deaths = [];
    s.reporter = null;
    s.voteTally = null;
    s.ejected = null;
    s.ejectedWasMurderer = null;
    this.killedThisPhase.clear();
    for (const id of this.ids) {
      this.room.set(id, null);
      this.taps.set(id, 0);
      this.done.set(id, new Set());
    }
    this.setDeadline(MURDER.TASKS_MS);
    this.timers.later(MURDER.TASKS_MS, () => this.meeting(null));
    this.ctx.onChange();
  }

  private task(id: string) {
    const r = this.room.get(id);
    const done = this.done.get(id)!;
    if (r === null || r === undefined || done.has(r)) return;
    const taps = (this.taps.get(id) ?? 0) + 1;
    if (taps < MURDER.TASK_TAPS) {
      this.taps.set(id, taps);
    } else {
      this.taps.set(id, 0);
      done.add(r);
      // Mörder tun nur so, als ob
      if (!this.murderers.includes(id)) {
        this.state.taskProgress += 1;
        if (this.state.taskProgress >= this.state.taskTarget) {
          return this.end('urlauber', 'Alle Aufgaben erledigt – das Haus ist blitzblank!');
        }
      }
    }
    this.ctx.onChange();
  }

  private killTargetFor(id: string): string | null {
    const s = this.state;
    if (!this.murderers.includes(id) || !s.alive[id] || this.killedThisPhase.has(id)) return null;
    const r = this.room.get(id);
    if (r === null || r === undefined) return null;
    const others = this.ids.filter((o) => o !== id && s.alive[o] && this.room.get(o) === r);
    if (others.length !== 1 || this.murderers.includes(others[0])) return null;
    return others[0];
  }

  private kill(id: string) {
    const victim = this.killTargetFor(id);
    if (!victim) return;
    const s = this.state;
    s.alive[victim] = false;
    this.killedThisPhase.add(id);
    this.bodies.push({ victim, room: this.room.get(id)!, found: false, announced: false });
    s.screamSeq += 1;
    if (!this.checkWin()) this.ctx.onChange();
  }

  private meeting(reporter: string | null) {
    const s = this.state;
    this.timers.clear();
    s.sub = 'meeting';
    s.reporter = reporter;
    s.deaths = [];
    for (const b of this.bodies) {
      b.found = true;
      if (!b.announced) {
        b.announced = true;
        s.deaths.push(b.victim);
      }
    }
    this.setDeadline(MURDER.MEETING_MS);
    this.timers.later(MURDER.MEETING_MS, () => this.startVote());
    this.ctx.onChange();
  }

  private startVote() {
    const s = this.state;
    s.sub = 'vote';
    s.voted = [];
    this.votes.clear();
    this.setDeadline(MURDER.VOTE_MS);
    this.timers.later(MURDER.VOTE_MS, () => this.tallyVotes());
    this.ctx.onChange();
  }

  private tallyVotes() {
    const s = this.state;
    const tally: Record<string, number> = {};
    for (const t of this.votes.values()) tally[t] = (tally[t] ?? 0) + 1;
    const max = Math.max(0, ...Object.values(tally));
    const top = Object.keys(tally).filter((k) => tally[k] === max);
    s.voteTally = tally;
    s.ejected = max > 0 && top.length === 1 && top[0] !== 'skip' ? top[0] : null;
    s.ejectedWasMurderer = s.ejected ? this.murderers.includes(s.ejected) : null;
    if (s.ejected) s.alive[s.ejected] = false;
    s.sub = 'ejected';
    this.setDeadline(MURDER.EJECT_MS);
    this.ctx.onChange();
    this.timers.later(MURDER.EJECT_MS, () => {
      if (!this.checkWin()) this.startTasks();
    });
  }

  private checkWin(): boolean {
    const s = this.state;
    const aliveM = this.murderers.filter((m) => s.alive[m]).length;
    const aliveU = this.ids.filter((id) => s.alive[id] && !this.murderers.includes(id)).length;
    if (aliveM === 0) {
      this.end('urlauber', this.murderers.length > 1 ? 'Alle Mörder wurden enttarnt!' : 'Der Mörder wurde enttarnt!');
      return true;
    }
    if (aliveM >= aliveU) {
      this.end('murderer', 'Zu wenige Urlauber übrig – der Mörder hat gewonnen!');
      return true;
    }
    return false;
  }

  private end(winner: 'murderer' | 'urlauber', reason: string) {
    const s = this.state;
    this.timers.clear();
    s.sub = 'over';
    s.winner = winner;
    s.winReason = reason;
    s.murderers = [...this.murderers];
    this.setDeadline(0);
    this.ctx.onChange();
    const urlauber = this.ids.filter((id) => !this.murderers.includes(id));
    const [win, lose] = winner === 'murderer' ? [this.murderers, urlauber] : [urlauber, this.murderers];
    this.timers.later(6000, () =>
      this.ctx.finish({
        groups: [win, lose],
        details: Object.fromEntries(
          this.ids.map((id) => [id, `${this.murderers.includes(id) ? 'Mörder' : 'Urlauber'}${s.alive[id] ? '' : ' · tot'}`]),
        ),
        subtitle: reason,
        coins: [10, 3],
      }),
    );
  }

  private setDeadline(ms: number) {
    this.deadline = Date.now() + ms;
  }
}
