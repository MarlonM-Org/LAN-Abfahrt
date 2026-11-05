import type { MiniSnapshot, PrivateState } from '../shared/types';
import { WOLF, WOLF_ROLES, type WolfCause, type WolfPrivate, type WolfRole, type WolfState, isWolfTeam, wolfCount, wolfDayMs } from '../shared/werwolf';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

/**
 * Werwölfe im Ferienhaus – Werwolf ohne Spielleiter.
 *
 * Nacht: Alle tippen heimlich am Handy (Wölfe ein Opfer, die Seherin einen Blick,
 * alle anderen einen „Verdacht“), danach entscheidet die Hexe. Morgen: Tote werden
 * mit Rolle aufgedeckt. Tag: Diskussion (VIP kann abkürzen), dann Abstimmung.
 * Das Dorf gewinnt, wenn alle Wölfe tot sind; die Wölfe, sobald sie mindestens so viele sind wie der Rest.
 *
 * Wer offline ist, blockiert nichts (seine Stimme fehlt einfach, jede Phase hat einen Timer);
 * wer entfernt wird, verlässt das Ferienhaus (zählt als tot).
 */
export class WerwolfGame implements MiniGame {
  readonly kind = 'werwolf' as const;
  private state: WolfState;
  private roles = new Map<string, WolfRole>();
  /** Nacht-Wahl aller Spieler (Wölfe: Opfer, Seherin: Blick, sonst: Verdacht) */
  private nightPicks = new Map<string, string>();
  private seen: { id: string; wolf: boolean }[] = [];
  private healLeft = true;
  private poisonLeft = true;
  private victim: string | null = null;
  private witchHealed = false;
  private witchPoison: string | null = null;
  private witchDone = false;
  private votes = new Map<string, string>();
  private phaseStart = 0;
  private deadline = 0;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const n = ids.length;
    const order = shuffle(ids);
    const deck: WolfRole[] = [];
    for (let i = 0; i < wolfCount(n); i++) deck.push('wolf');
    if (n >= 3) deck.push('seherin');
    if (n >= 4) deck.push('hexe');
    if (n >= WOLF.HUNTER_FROM) deck.push('jaeger');
    order.forEach((id, i) => this.roles.set(id, deck[i] ?? 'dorf'));
    const roleCounts: Partial<Record<WolfRole, number>> = {};
    for (const r of this.roles.values()) roleCounts[r] = (roleCounts[r] ?? 0) + 1;

    this.state = {
      sub: 'roles',
      day: 0,
      endsIn: 0,
      phaseNo: 0,
      dayMs: wolfDayMs(n),
      alive: Object.fromEntries(ids.map((id) => [id, true])),
      revealed: {},
      roleCounts,
      deaths: [],
      nightDone: 0,
      nightTotal: 0,
      suspect: null,
      voted: [],
      votes: null,
      lynched: null,
      tie: false,
      hunter: null,
      hunterThenDay: false,
      shotDone: false,
      shot: null,
      winner: null,
      winReason: null,
      roles: null,
    };
    this.enter('roles', WOLF.ROLES_MS, () => this.startNight());
  }

  snapshot(): MiniSnapshot {
    const s = this.state;
    if (s.sub === 'night') {
      const active = this.ids.filter((id) => s.alive[id] && this.ctx.isConnected(id));
      s.nightTotal = active.length;
      s.nightDone = active.filter((id) => this.nightPicks.has(id)).length;
    }
    return { kind: 'werwolf', state: { ...s, endsIn: Math.max(0, this.deadline - Date.now()) } };
  }

  privateFor(id: string): PrivateState {
    const role = this.roles.get(id);
    if (!role) return null;
    const s = this.state;
    const wolf = role === 'wolf';
    const hexe = role === 'hexe';
    const night = s.sub === 'night' || s.sub === 'witch';
    const priv: WolfPrivate = {
      role,
      alive: s.alive[id],
      day: s.day,
      partners: wolf ? this.wolves().filter((w) => w !== id) : [],
      pack: wolf && night ? Object.fromEntries(this.wolves().filter((w) => s.alive[w] && this.nightPicks.has(w)).map((w) => [w, this.nightPicks.get(w)!])) : {},
      nightPick: night ? (this.nightPicks.get(id) ?? null) : null,
      seen: role === 'seherin' ? [...this.seen] : [],
      heal: hexe && this.healLeft,
      poison: hexe && this.poisonLeft,
      victim: hexe && s.sub === 'witch' ? this.victim : null,
      witchHealed: hexe && this.witchHealed,
      witchPoison: hexe ? this.witchPoison : null,
      witchDone: hexe && this.witchDone,
      myVote: this.votes.get(id) ?? null,
      allRoles: !s.alive[id] || s.sub === 'over' ? Object.fromEntries(this.roles) : null,
    };
    return { kind: 'werwolf', state: priv };
  }

  input(id: string, action: string, payload: unknown) {
    const role = this.roles.get(id);
    const s = this.state;
    // Nur der Jäger darf noch nach seinem Tod handeln (letzter Schuss)
    if (!role || (!s.alive[id] && action !== 'shoot')) return;
    const p = asRecord(payload);
    const target = String(p.target ?? '');
    const validTarget = target !== id && s.alive[target] === true;

    if (action === 'night' && s.sub === 'night') {
      if (!validTarget) return;
      if (role === 'wolf' && this.roles.get(target) === 'wolf') return;
      if (role === 'seherin') {
        if (this.nightPicks.has(id)) return; // ein Blick pro Nacht
        this.seen.push({ id: target, wolf: isWolfTeam(this.roles.get(target)!) });
      }
      this.nightPicks.set(id, target);
      this.ctx.onChange();
      this.checkNightDone();
    } else if (s.sub === 'witch' && role === 'hexe' && !this.witchDone) {
      if (action === 'heal' && this.healLeft && this.victim) {
        this.witchHealed = p.on === true;
        this.ctx.onChange();
      } else if (action === 'poison' && this.poisonLeft) {
        this.witchPoison = target === '' || target === 'none' ? null : validTarget ? target : this.witchPoison;
        this.ctx.onChange();
      } else if (action === 'witchDone') {
        this.witchDone = true;
        this.resolveNight();
      }
    } else if (action === 'vote' && s.sub === 'vote' && !this.votes.has(id)) {
      if (target !== 'none' && !validTarget) return;
      this.votes.set(id, target);
      s.voted = [...this.votes.keys()];
      if (this.voters().every((v) => this.votes.has(v))) this.tally();
      else this.ctx.onChange();
    } else if (action === 'shoot' && s.sub === 'hunter' && s.hunter === id && !s.shotDone) {
      if (!validTarget) return;
      this.hunterShot(target);
    }
  }

  vipAction(action: string) {
    if ((action === 'skip' || action === 'next') && this.state.sub === 'day') this.startVote();
  }

  playerDisconnected(id: string) {
    const s = this.state;
    if (s.sub === 'over' || !this.roles.has(id)) return;
    // Entfernt (nicht nur kurz offline) → verlässt das Ferienhaus
    if (this.ctx.isGone?.(id) && s.alive[id]) {
      this.kill(id, 'left');
      if (s.sub === 'hunter' && s.hunter === id && !s.shotDone) return this.hunterShot(null);
      if (s.sub === 'witch' && this.roles.get(id) === 'hexe') return this.resolveNight();
      // Steht der Sieger damit schon fest, nicht erst die Phase zu Ende spielen
      if (this.checkWin()) return;
    }
    if (s.sub === 'night') this.checkNightDone();
    if (s.sub === 'vote' && this.voters().every((v) => this.votes.has(v))) return this.tally();
    this.ctx.onChange();
  }

  dispose() {
    this.timers.clear();
  }

  // ---------------------------------------------------------------- Helfer

  private wolves() {
    return this.ids.filter((id) => this.roles.get(id) === 'wolf');
  }

  private alive() {
    return this.ids.filter((id) => this.state.alive[id]);
  }

  /** Wer jetzt abstimmen kann (lebt und ist verbunden) */
  private voters() {
    return this.alive().filter((id) => this.ctx.isConnected(id));
  }

  private kill(id: string, cause: WolfCause) {
    const s = this.state;
    if (!s.alive[id]) return false;
    s.alive[id] = false;
    s.revealed[id] = this.roles.get(id)!;
    if (cause !== 'left') s.deaths.push({ id, cause });
    return true;
  }

  /** Neue Phase: alte Timer weg, Deadline setzen, Ablauf-Timer starten */
  private enter(sub: WolfState['sub'], ms: number, then: () => void) {
    this.timers.clear();
    const s = this.state;
    s.sub = sub;
    s.phaseNo += 1;
    this.phaseStart = Date.now();
    this.deadline = Date.now() + ms;
    this.timers.later(ms, then);
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Nacht

  private startNight() {
    const s = this.state;
    s.day += 1;
    s.deaths = [];
    s.suspect = null;
    s.votes = null;
    s.voted = [];
    s.lynched = null;
    s.tie = false;
    s.hunter = null;
    s.shot = null;
    s.shotDone = false;
    this.nightPicks.clear();
    this.votes.clear();
    this.victim = null;
    this.witchHealed = false;
    this.witchPoison = null;
    this.witchDone = false;
    this.enter('night', WOLF.NIGHT_MS, () => this.endNightStage());
  }

  /** Alle (verbundenen, lebenden) haben getippt und das Rudel ist sich einig → Nacht früher vorbei */
  private checkNightDone() {
    const s = this.state;
    if (s.sub !== 'night') return;
    const active = this.voters();
    if (!active.every((id) => this.nightPicks.has(id))) return;
    const packPicks = this.wolves()
      .filter((w) => active.includes(w))
      .map((w) => this.nightPicks.get(w));
    if (packPicks.length && !packPicks.every((t) => t === packPicks[0])) return;
    const phase = s.phaseNo;
    const wait = Math.max(0, this.phaseStart + WOLF.NIGHT_MIN_MS - Date.now());
    this.timers.later(wait, () => {
      if (this.state.sub === 'night' && this.state.phaseNo === phase) this.endNightStage();
    });
  }

  private endNightStage() {
    const s = this.state;
    if (s.sub !== 'night') return;
    // Opfer: Mehrheit im Rudel, bei Gleichstand Zufall unter den Meistgenannten
    const tally = new Map<string, number>();
    for (const w of this.wolves()) {
      const t = this.nightPicks.get(w);
      if (s.alive[w] && t && s.alive[t]) tally.set(t, (tally.get(t) ?? 0) + 1);
    }
    const max = Math.max(0, ...tally.values());
    const top = [...tally.keys()].filter((t) => tally.get(t) === max);
    this.victim = max > 0 ? top[Math.floor(Math.random() * top.length)] : null;
    const hexeAlive = this.ids.some((id) => s.alive[id] && this.roles.get(id) === 'hexe');
    if (hexeAlive) this.enter('witch', WOLF.WITCH_MS, () => this.resolveNight());
    else this.resolveNight();
  }

  private resolveNight() {
    const s = this.state;
    if (s.sub !== 'night' && s.sub !== 'witch') return;
    s.deaths = [];
    if (this.witchHealed && this.victim) this.healLeft = false;
    else if (this.victim) this.kill(this.victim, 'wolf');
    if (this.witchPoison) {
      this.poisonLeft = false;
      this.kill(this.witchPoison, 'poison');
    }
    // Spaß-Umfrage: wen die Unschuldigen (und alle, die nur so tun) verdächtigt haben
    const sus = new Map<string, number>();
    for (const [id, t] of this.nightPicks) {
      const r = this.roles.get(id);
      if (r !== 'wolf' && r !== 'seherin' && s.alive[t]) sus.set(t, (sus.get(t) ?? 0) + 1);
    }
    const max = Math.max(0, ...sus.values());
    const top = [...sus.keys()].filter((t) => sus.get(t) === max);
    s.suspect = max > 1 && top.length === 1 ? top[0] : null;
    this.enter('dawn', WOLF.DAWN_MS, () => {
      const jaeger = s.deaths.find((d) => this.roles.get(d.id) === 'jaeger');
      if (jaeger) this.startHunter(jaeger.id, true);
      else if (!this.checkWin()) this.startDay();
    });
  }

  // ---------------------------------------------------------------- Jäger

  private startHunter(id: string, thenDay: boolean) {
    const s = this.state;
    s.hunter = id;
    s.hunterThenDay = thenDay;
    s.shot = null;
    s.shotDone = false;
    this.enter('hunter', WOLF.HUNTER_MS, () => this.hunterShot(null));
  }

  private hunterShot(target: string | null) {
    const s = this.state;
    if (s.sub !== 'hunter' || s.shotDone) return;
    this.timers.clear();
    s.shotDone = true;
    s.shot = target;
    s.deaths = [];
    if (target) this.kill(target, 'hunter');
    this.deadline = Date.now() + 5000;
    this.ctx.onChange();
    this.timers.later(5000, () => {
      if (this.checkWin()) return;
      if (s.hunterThenDay) this.startDay();
      else this.startNight();
    });
  }

  // ---------------------------------------------------------------- Tag

  private startDay() {
    this.enter('day', this.state.dayMs, () => this.startVote());
  }

  private startVote() {
    const s = this.state;
    this.votes.clear();
    s.voted = [];
    s.votes = null;
    this.enter('vote', WOLF.VOTE_MS, () => this.tally());
    if (this.voters().length === 0) this.tally();
  }

  private tally() {
    const s = this.state;
    if (s.sub !== 'vote') return;
    const count = new Map<string, number>();
    for (const t of this.votes.values()) count.set(t, (count.get(t) ?? 0) + 1);
    const max = Math.max(0, ...count.values());
    const top = [...count.keys()].filter((t) => count.get(t) === max);
    s.votes = Object.fromEntries(this.votes);
    s.tie = max > 0 && top.length > 1;
    s.lynched = max > 0 && top.length === 1 && top[0] !== 'none' && s.alive[top[0]] ? top[0] : null;
    s.deaths = [];
    if (s.lynched) this.kill(s.lynched, 'lynch');
    const lynched = s.lynched;
    this.enter('verdict', WOLF.VERDICT_MS, () => {
      if (lynched && this.roles.get(lynched) === 'jaeger') this.startHunter(lynched, false);
      else if (!this.checkWin()) this.startNight();
    });
  }

  // ---------------------------------------------------------------- Ende

  private checkWin(): boolean {
    const alive = this.alive();
    const wolves = alive.filter((id) => this.roles.get(id) === 'wolf').length;
    const others = alive.length - wolves;
    if (wolves === 0) {
      this.end('dorf', this.wolves().length > 1 ? 'Alle Werwölfe sind enttarnt – endlich Ruhe im Ferienhaus!' : 'Der Werwolf ist enttarnt – endlich Ruhe im Ferienhaus!');
      return true;
    }
    if (wolves >= others) {
      this.end('wolf', 'Die Werwölfe haben das Ferienhaus übernommen!');
      return true;
    }
    return false;
  }

  private end(winner: 'dorf' | 'wolf', reason: string) {
    const s = this.state;
    s.winner = winner;
    s.winReason = reason;
    s.roles = Object.fromEntries(this.roles);
    this.enter('over', WOLF.OVER_MS, () => {
      const won = (id: string) => (this.roles.get(id) === 'wolf') === (winner === 'wolf');
      const score = (id: string) => (won(id) ? WOLF.WIN_POINTS : 0) + (s.alive[id] ? WOLF.SURVIVE_POINTS : 0);
      this.ctx.finish({
        groups: groupByScore(this.ids, score),
        details: Object.fromEntries(
          this.ids.map((id) => [id, `${WOLF_ROLES[this.roles.get(id)!].name} · ${s.alive[id] ? 'überlebt' : 'tot'} · ${score(id)} P.`]),
        ),
        subtitle: reason,
      });
    });
  }
}
