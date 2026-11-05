import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardAward, BoardState, BoardStats, MiniKind, MiniTeams, PartyResumeInfo, SkipInfo } from '../shared/types';
import {
  BOARD_KINDS, BOARD_SIZE, BOARD_TEAM_CHANCE, BOARD_TIMING, COCKTAIL_PRICE, DOUBLE_ROUNDS, FIELD_COINS, FIELD_TYPES, FINALE_COCKTAILS, FINALE_KINDS, MINI_INFO,
  MINI_LENGTH, TEAM_KINDS, UNEVEN_TEAM_KINDS, fitsPlayers, miniLabel, teamLabel,
} from '../shared/games';
import { Timers, shuffle } from './minigame';

const { STEP_MS, MOVE_LEAD_MS, PAUSE_MS, EVENT_PAUSE_MS, INTRO_MS, ROLL_WINDOW_MS, BONUS_DRUM_MS, BONUS_SHOW_MS } = BOARD_TIMING;

export interface BoardCtx {
  onChange(): void;
  /** `teams`: Team-Minispiel nach Feldfarbe (2 gegen 2, 1 gegen 3), sonst Jeder gegen jeden */
  startMini(kind: MiniKind, teams?: MiniTeams | null): void;
  isConnected(id: string): boolean;
  nameOf(id: string): string;
  connectedCount(): number;
  /** Vom VIP/Laptop entfernt → Züge werden übersprungen */
  isGone?(id: string): boolean;
  /** Wer gerade im Raum ist – wer davon noch nicht auf dem Brett steht, steigt zur nächsten Runde ein */
  present?(): string[];
  /** Party vorbei (nach den Bonus-Cocktails) → Endstand zeigen */
  onFinish(): void;
}

interface PartyEvent {
  text: (name: string) => string;
  apply: (board: Board, id: string) => void;
}

const EVENTS: PartyEvent[] = [
  { text: (n) => `Pool-Party! ${n} bekommt 5 Münzen.`, apply: (b, id) => b.addCoins(id, 5) },
  { text: (n) => `${n} hat Sonnenbrand und kauft teure After-Sun: −4`, apply: (b, id) => b.addCoins(id, -4) },
  { text: (n) => `Der Nachbar beschwert sich über ${n}: −3`, apply: (b, id) => b.addCoins(id, -3) },
  { text: (n) => `${n} bringt das Pfand weg: +4`, apply: (b, id) => b.addCoins(id, 4) },
  {
    text: (n) => `${n} schmeißt eine Runde – alle anderen bekommen 1 Münze von ${n}!`,
    apply: (b, id) => {
      for (const o of b.active) if (o !== id && b.state.coins[id] > 0) (b.addCoins(id, -1), b.addCoins(o, 1));
    },
  },
  {
    text: (n) => `Spülmaschinen-Dienst! ${n} kassiert von allen 1 Münze.`,
    apply: (b, id) => {
      for (const o of b.active) if (o !== id && b.state.coins[o] > 0) (b.addCoins(o, -1), b.addCoins(id, 1));
    },
  },
  {
    text: (n) => `Zimmertausch! ${n} tauscht den Platz mit jemand anderem.`,
    apply: (b, id) => {
      const others = b.active.filter((o) => o !== id);
      if (!others.length) return;
      const o = others[Math.floor(Math.random() * others.length)];
      [b.state.pos[id], b.state.pos[o]] = [b.state.pos[o], b.state.pos[id]];
    },
  },
];

// ------------------------------------------------------------------ Brettstand speichern (data/party.json)

const dir = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(dir, '../data/party.json');

/** Gespeicherter Brettstand – wird zu Beginn jeder Runde geschrieben, damit ein Server-Neustart die Party nicht beendet. */
export interface PartySave {
  v: 1;
  savedAt: number;
  maxRounds: number;
  longGames: boolean;
  round: number;
  /** Reihenfolge der Spieler (ID + Name; nach einem Neustart werden Spieler über den Namen wiedererkannt) */
  players: { id: string; name: string }[];
  pos: Record<string, number>;
  coins: Record<string, number>;
  cocktails: Record<string, number>;
  stats: Record<string, BoardStats>;
  barField: number;
  lastMini: MiniKind | null;
}

const num = (v: unknown, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const freshStats = (): BoardStats => ({ miniCoins: 0, red: 0, steps: 0 });

function readSave(): PartySave | null {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<PartySave>;
    if (raw?.v !== 1 || !Array.isArray(raw.players)) return null;
    const players = raw.players.filter((p) => typeof p?.id === 'string' && typeof p?.name === 'string');
    if (!players.length) return null;
    const rec = <T,>(r: Record<string, T> | undefined, def: () => T) => Object.fromEntries(players.map((p) => [p.id, r?.[p.id] ?? def()]));
    return {
      v: 1,
      savedAt: num(raw.savedAt),
      maxRounds: Math.max(1, num(raw.maxRounds, 5)),
      longGames: raw.longGames === true,
      round: Math.max(1, num(raw.round, 1)),
      players,
      pos: rec(raw.pos, () => 0),
      coins: rec(raw.coins, () => 10),
      cocktails: rec(raw.cocktails, () => 0),
      stats: rec(raw.stats, freshStats),
      barField: Math.abs(Math.floor(num(raw.barField, 6))) % BOARD_SIZE,
      lastMini: typeof raw.lastMini === 'string' && raw.lastMini in MINI_INFO ? (raw.lastMini as MiniKind) : null,
    };
  } catch {
    return null; // keine (lesbare) Party gespeichert
  }
}

let saved: PartySave | null = readSave();

function writeSave(data: PartySave | null) {
  saved = data;
  try {
    if (!data) return fs.rmSync(FILE, { force: true });
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('Konnte den Brettstand nicht speichern:', e);
  }
}

/** Gespeicherte Party (für „Party fortsetzen?“ in der Lobby) */
export function partyResumeInfo(): PartyResumeInfo | null {
  if (!saved) return null;
  return { round: saved.round, maxRounds: saved.maxRounds, names: saved.players.map((p) => p.name), savedAt: saved.savedAt };
}

/** Gespeicherte Party auf die Spieler im Raum abbilden: gleiche ID, sonst gleicher Name. Wer fehlt, fällt raus. */
export function resumeSave(present: { id: string; name: string }[]): PartySave | null {
  if (!saved) return null;
  const free = new Map(present.map((p) => [p.id, p]));
  const map = new Map<string, string>();
  for (const p of saved.players) {
    if (!free.has(p.id)) continue;
    map.set(p.id, p.id);
    free.delete(p.id);
  }
  for (const p of saved.players) {
    if (map.has(p.id)) continue;
    const hit = [...free.values()].find((o) => o.name.toLowerCase() === p.name.toLowerCase());
    if (!hit) continue;
    map.set(p.id, hit.id);
    free.delete(hit.id);
  }
  if (!map.size) return null;
  const re = <T,>(r: Record<string, T>) => Object.fromEntries([...map].map(([from, to]) => [to, r[from]]));
  return {
    ...saved,
    players: saved.players.filter((p) => map.has(p.id)).map((p) => ({ id: map.get(p.id)!, name: p.name })),
    pos: re(saved.pos),
    coins: re(saved.coins),
    cocktails: re(saved.cocktails),
    stats: re(saved.stats),
  };
}

/** Ergebniszeile eines Minispiels, wie der Raum sie ans Brett gibt */
export interface BoardMiniRow {
  playerId: string;
  place: number;
  coins: number;
}

/**
 * Das Spielbrett im Mario-Party-Stil: Pro Runde würfeln alle gleichzeitig (Würfelfenster), danach laufen die Züge
 * nacheinander im Schnelldurchlauf, dann folgt ein Minispiel. Münzen werden an der Cocktailbar gegen Cocktails getauscht.
 * Die letzten Runden zählen doppelt, das Finale bringt Cocktails, am Ende gibt es Bonus-Cocktails
 * (Minispiel-Star, Pechvogel, Wanderer) und erst dann den Endstand.
 */
export class Board {
  state: BoardState;
  private timers = new Timers();
  private lastMini: MiniKind | null = null;
  /** Ist das angesagte Minispiel das Finale? (Sieger bekommen Cocktails) */
  private finaleNow = false;
  private rollDeadline = 0;
  private closing = false;

  constructor(
    ids: string[],
    maxRounds: number,
    private ctx: BoardCtx,
    /** VIP-Option „Lange Spiele“: auch Minispiele über 4 min ziehen (sonst nur kurz + mittel) */
    private longGames = false,
    /** Gespeicherten Stand fortsetzen (IDs schon auf die Spieler im Raum abgebildet, siehe resumeSave) */
    from?: PartySave,
  ) {
    const order = from ? from.players.map((p) => p.id) : shuffle(ids);
    const each = <T,>(make: (id: string) => T) => Object.fromEntries(order.map((id) => [id, make(id)]));
    this.state = {
      round: from?.round ?? 1,
      maxRounds: from?.maxRounds ?? maxRounds,
      order,
      turnIdx: 0,
      sub: 'roll',
      pos: from ? { ...from.pos } : each(() => 0),
      coins: from ? { ...from.coins } : each(() => 10),
      cocktails: from ? { ...from.cocktails } : each(() => 0),
      barField: from?.barField ?? 0,
      lastRoll: null,
      rolls: {},
      rollMs: 0,
      double: false,
      timeOfDay: 0,
      stats: each((id) => ({ ...freshStats(), ...from?.stats[id] })),
      bonus: null,
      joined: [],
      message: from ? `Weiter geht's – Runde ${from.round} von ${from.maxRounds}!` : 'Willkommen im Ferienhaus! Alle starten mit 10 Münzen.',
      messageSeq: 1,
      nextMini: null,
    };
    if (from) {
      this.longGames = from.longGames;
      this.lastMini = from.lastMini;
    } else {
      // Erste Bar in Reichweite der ersten Würfe
      this.state.barField = [5, 6, 7, 8][Math.floor(Math.random() * 4)];
    }
    this.beginRound();
  }

  get finished(): boolean {
    return this.state.round > this.state.maxRounds;
  }

  /** Spieler auf dem Brett, die nicht entfernt wurden */
  get active(): string[] {
    return this.state.order.filter((id) => !this.gone(id));
  }

  addCoins(id: string, delta: number) {
    this.state.coins[id] = Math.max(0, (this.state.coins[id] ?? 0) + delta);
  }

  /** Würfeln im Würfelfenster (jeder einmal pro Runde) */
  roll(playerId: string) {
    const s = this.state;
    if (s.sub !== 'roll' || !(playerId in s.pos) || playerId in s.rolls || this.gone(playerId)) return;
    s.rolls[playerId] = 1 + Math.floor(Math.random() * 6);
    this.ctx.onChange();
    this.checkAllRolled();
  }

  /** VIP/Laptop: für alle würfeln, die noch nicht gewürfelt haben – bzw. Minispiel-Ansage überspringen */
  skippable(): SkipInfo | null {
    const s = this.state;
    if (s.sub === 'roll') return { label: 'Für alle würfeln' };
    if (s.sub === 'intro' && s.nextMini) return { label: 'Minispiel starten', info: true };
    return null;
  }

  skip() {
    const s = this.state;
    if (s.sub === 'roll') return this.closeWindow();
    if (s.sub === 'intro' && s.nextMini) {
      this.timers.clear();
      this.ctx.startMini(s.nextMini, s.teams);
    }
  }

  /** Handy weg (gesperrt, App gewechselt): nicht auf ihn warten – am Ende des Fensters würfelt der Server */
  playerDisconnected(_id: string) {
    this.checkAllRolled();
  }

  /** Spieler entfernt: Würfelfenster wartet nicht auf ihn, seine Züge werden übersprungen */
  playerGone(_id: string) {
    this.checkAllRolled();
  }

  /** Party-Finale: so viele Cocktails bekommen die Sieger dieses Minispiels (0 = kein Finale) */
  finaleCocktails(kind: MiniKind): number {
    return this.finaleNow && this.state.nextMini === kind ? FINALE_COCKTAILS : 0;
  }

  /** Nach einem Minispiel: Münzen gutschreiben (Finale: Sieger bekommen Cocktails), nächste Runde bzw. Bonus-Cocktails. */
  afterMini(rows: BoardMiniRow[]) {
    const s = this.state;
    const finale = this.finaleNow ? FINALE_COCKTAILS : 0;
    const champs: string[] = [];
    for (const row of rows) {
      if (!(row.playerId in s.coins)) continue;
      this.addCoins(row.playerId, row.coins);
      s.stats[row.playerId].miniCoins += Math.max(0, row.coins);
      if (finale && row.place === 1) {
        s.cocktails[row.playerId] += finale;
        champs.push(row.playerId);
      }
    }
    this.finaleNow = false;
    s.round += 1;
    // Startspieler rotiert: wer diese Runde als Erster gelaufen ist, läuft nächste Runde als Letzter.
    // So kommt nicht immer dieselbe Person zuerst an die Bar.
    if (s.order.length > 1) s.order = [...s.order.slice(1), s.order[0]];
    s.turnIdx = 0;
    s.nextMini = null;
    if (this.finished) {
      this.say(champs.length ? `Finale gewonnen: ${champs.map((id) => this.ctx.nameOf(id)).join(', ')} – je ${finale} Cocktails!` : 'Die Party ist vorbei!');
      return this.startBonus();
    }
    this.say(`Runde ${s.round} von ${s.maxRounds}!`);
    this.beginRound();
  }

  dispose() {
    this.timers.clear();
  }

  // ---------------------------------------------------------------- Runde: Würfelfenster → Schnelldurchlauf

  private gone(id: string) {
    return !!this.ctx.isGone?.(id);
  }

  private beginRound() {
    const s = this.state;
    this.timers.clear();
    this.closing = false;
    s.joined = this.addLatecomers();
    s.sub = 'roll';
    s.rolls = {};
    s.turnIdx = 0;
    s.teams = null;
    s.double = s.maxRounds >= 3 && s.round > s.maxRounds - DOUBLE_ROUNDS;
    s.timeOfDay = this.dayTime();
    if (s.double) this.say(`${s.message} ${s.round === s.maxRounds ? 'Letzte Runde' : 'Endspurt'}: Blaue und rote Felder zählen doppelt!`);
    if (s.joined.length) {
      const names = s.joined.map((id) => this.ctx.nameOf(id)).join(', ');
      this.say(`${s.message} ${names} ${s.joined.length > 1 ? 'steigen' : 'steigt'} mit ${s.coins[s.joined[0]]} Münzen ein!`);
    }
    this.persist();
    this.rollDeadline = Date.now() + ROLL_WINDOW_MS;
    s.rollMs = ROLL_WINDOW_MS;
    // Restzeit ~1×/s an TV und Handys (die zählen dazwischen selbst runter)
    this.timers.every(1000, () => {
      s.rollMs = Math.max(0, this.rollDeadline - Date.now());
      if (s.rollMs <= 300) this.closeWindow();
      else this.ctx.onChange();
    });
    this.ctx.onChange();
    this.checkAllRolled();
  }

  /** Nachzügler: Wer im Raum ist, aber noch nicht auf dem Brett steht, steigt am Start mit dem Median der Münzen ein */
  private addLatecomers(): string[] {
    const s = this.state;
    const late = (this.ctx.present?.() ?? []).filter((id) => !(id in s.pos) && !this.gone(id));
    if (!late.length) return [];
    const coins = this.active.map((id) => s.coins[id]).sort((a, b) => a - b);
    const mid = coins.length >> 1;
    const median = !coins.length ? 10 : coins.length % 2 ? coins[mid] : Math.round((coins[mid - 1] + coins[mid]) / 2);
    for (const id of late) {
      s.order.push(id);
      s.pos[id] = 0;
      s.coins[id] = median;
      s.cocktails[id] = 0;
      s.stats[id] = freshStats();
    }
    return late;
  }

  /** Haben alle, die da sind, gewürfelt? → Fenster kurz danach schließen */
  private checkAllRolled() {
    const s = this.state;
    if (s.sub !== 'roll' || this.closing) return;
    const here = this.active.filter((id) => this.ctx.isConnected(id));
    if (here.some((id) => !(id in s.rolls))) return;
    this.closing = true;
    this.timers.later(here.length ? 700 : 1500, () => this.closeWindow());
  }

  /** Würfelfenster zu: Für alle, die nicht gewürfelt haben, würfelt der Server – dann laufen die Züge nacheinander */
  private closeWindow() {
    const s = this.state;
    if (s.sub !== 'roll') return;
    this.timers.clear();
    for (const id of this.active) if (!(id in s.rolls)) s.rolls[id] = 1 + Math.floor(Math.random() * 6);
    s.sub = 'moving';
    s.rollMs = 0;
    s.turnIdx = -1;
    this.nextMove();
  }

  private nextMove() {
    const s = this.state;
    s.turnIdx += 1;
    while (s.turnIdx < s.order.length && (this.gone(s.order[s.turnIdx]) || !(s.order[s.turnIdx] in s.rolls))) s.turnIdx += 1;
    if (s.turnIdx >= s.order.length) {
      s.turnIdx = s.order.length - 1;
      this.ctx.onChange();
      this.timers.later(900, () => this.intro());
      return;
    }
    const id = s.order[s.turnIdx];
    const value = s.rolls[id];
    const start = s.pos[id];
    const path = Array.from({ length: value }, (_, i) => (start + i + 1) % BOARD_SIZE);
    s.lastRoll = { seq: (s.lastRoll?.seq ?? 0) + 1, playerId: id, value, path };
    this.ctx.onChange();
    this.timers.later(MOVE_LEAD_MS + value * STEP_MS, () => this.land(id, path));
  }

  private land(id: string, path: number[]) {
    const s = this.state;
    const name = this.ctx.nameOf(id);
    const msgs: string[] = [];
    let slow = false;
    s.stats[id].steps += path.length;

    // Cocktailbar: Kauf beim Vorbeilaufen oder Landen
    if (path.includes(s.barField)) {
      slow = true;
      if (s.coins[id] >= COCKTAIL_PRICE) {
        this.addCoins(id, -COCKTAIL_PRICE);
        s.cocktails[id] += 1;
        msgs.push(`${name} kauft einen Cocktail!`);
        this.moveBar();
      } else {
        msgs.push(`${name} kommt an der Bar vorbei, hat aber keine ${COCKTAIL_PRICE} Münzen.`);
      }
    }

    s.pos[id] = path[path.length - 1];
    const type = FIELD_TYPES[s.pos[id]];
    const mult = s.double ? 2 : 1;
    if (type === 'blue' || type === 'start') {
      this.addCoins(id, FIELD_COINS.blue * mult);
      msgs.push(`${name}: +${FIELD_COINS.blue * mult} Münzen`);
    } else if (type === 'red') {
      this.addCoins(id, FIELD_COINS.red * mult);
      s.stats[id].red += 1;
      msgs.push(`${name}: ${FIELD_COINS.red * mult} Münzen`);
    } else if (type === 'event') {
      slow = true;
      const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
      ev.apply(this, id);
      msgs.push(ev.text(name));
    }
    this.say(msgs.join(' '));
    this.ctx.onChange();
    this.timers.later(slow ? EVENT_PAUSE_MS : PAUSE_MS, () => this.nextMove());
  }

  /** 0 = Morgen … 0.8 = Sonnenuntergang (letzte Runde) … 1 = Nacht (Finale, Bonus) */
  private dayTime() {
    const s = this.state;
    if (s.round > s.maxRounds) return 1;
    if (s.maxRounds <= 1) return 0.8;
    return Math.round(((0.8 * (s.round - 1)) / (s.maxRounds - 1)) * 100) / 100;
  }

  private intro() {
    const s = this.state;
    // Finale: eines der Versteckte-Rollen-Spiele (Mord oder Verräter)
    const n = this.ctx.connectedCount();
    const finales = FINALE_KINDS.filter((k) => fitsPlayers(k, n));
    const isFinale = s.round === s.maxRounds && finales.length > 0;
    // Nur Spiele, die zur Spielerzahl passen (z. B. Urlaubs-Fangen ab 3, max. 8 Spieler)
    // … und standardmäßig nur kurze/mittlere (≤ 4 min), damit die Party nicht stockt
    const fitsAll = BOARD_KINDS.filter((k) => fitsPlayers(k, n));
    const short = fitsAll.filter((k) => MINI_LENGTH[k] !== 'lang');
    const fitting = this.longGames || !short.length ? fitsAll : short;
    const pool: MiniKind[] = fitting.filter((k) => k !== this.lastMini);
    if (!pool.length) pool.push(...(fitting.length ? fitting : BOARD_KINDS));
    const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
    // Team-Minispiel nach Feldfarbe (Rot gegen Blau): nur Spiele, die zu den Teamgrößen passen und gerade dran sein dürfen
    let teams = isFinale || Math.random() >= BOARD_TEAM_CHANCE ? null : this.teamsByField();
    const teamPool = teams ? (teams.A.length === teams.B.length ? TEAM_KINDS : UNEVEN_TEAM_KINDS).filter((k) => pool.includes(k)) : [];
    if (!teamPool.length) teams = null;
    // Fallback, falls zu wenige übrig sind (z. B. nach Entfernen von Spielern)
    const kind: MiniKind = (isFinale ? pick(finales) : teams ? pick(teamPool) : pick(pool)) ?? 'sprint';
    this.lastMini = kind;
    this.finaleNow = isFinale;
    s.sub = 'intro';
    s.nextMini = kind;
    s.teams = teams;
    if (isFinale) s.timeOfDay = 1;
    this.say(
      isFinale
        ? `FINALE: ${miniLabel(kind)}! Die Sieger bekommen ${FINALE_COCKTAILS} Cocktails.`
        : teams
          ? `${teams.label} nach Feldfarbe – Rot (Team Sonne) gegen Blau (Team Meer): ${miniLabel(kind)}!`
          : `Minispiel: ${miniLabel(kind)}!`,
    );
    this.ctx.onChange();
    this.timers.later(INTRO_MS, () => this.ctx.startMini(kind, teams));
  }

  /**
   * Teams nach Feldfarbe (Mario-Party-Prinzip): Rot = Team Sonne (A), Blau/Start = Team Meer (B), auf einem
   * Ereignisfeld kommt man in die kleinere Seite (bei Gleichstand per Los). Null, wenn weniger als 4 Spieler
   * auf dem Brett stehen oder eine Seite leer bliebe – dann wie bisher Jeder gegen jeden.
   */
  teamsByField(): MiniTeams | null {
    const s = this.state;
    const ids = this.active;
    if (ids.length < 4) return null;
    const A: string[] = [];
    const B: string[] = [];
    const undecided: string[] = [];
    for (const id of ids) {
      const t = FIELD_TYPES[s.pos[id]];
      if (t === 'red') A.push(id);
      else if (t === 'event') undecided.push(id);
      else B.push(id);
    }
    for (const id of shuffle(undecided)) (A.length < B.length || (A.length === B.length && Math.random() < 0.5) ? A : B).push(id);
    if (!A.length || !B.length) return null;
    return { A, B, label: teamLabel(A.length, B.length) };
  }

  // ---------------------------------------------------------------- Bonus-Cocktails am Ende

  private awards(): BoardAward[] {
    const s = this.state;
    const ids = this.active;
    const make = (key: BoardAward['key'], title: string, desc: string, unit: string, val: (st: BoardStats) => number): BoardAward | null => {
      const max = Math.max(0, ...ids.map((id) => val(s.stats[id])));
      if (max <= 0) return null;
      return { key, title, desc, unit, value: max, winners: ids.filter((id) => val(s.stats[id]) === max) };
    };
    return [
      make('star', 'Minispiel-Star', 'Meiste Münzen aus Minispielen', 'Münzen', (st) => st.miniCoins),
      make('pech', 'Pechvogel', 'Am öftesten auf Rot gelandet', 'rote Felder', (st) => st.red),
      make('wander', 'Wanderer', 'Die meisten Felder gelaufen', 'Felder', (st) => st.steps),
    ].filter((a): a is BoardAward => !!a);
  }

  /** Nach dem Finale: drei Bonus-Karten nacheinander (Trommelwirbel → Gewinner, je +1 Cocktail), dann der Endstand */
  private startBonus() {
    const s = this.state;
    this.timers.clear();
    s.sub = 'bonus';
    s.timeOfDay = 1;
    s.rolls = {};
    s.rollMs = 0;
    s.bonus = { awards: this.awards(), shown: 0, revealed: false };
    // Die Party ist durch – nichts mehr fortzusetzen
    writeSave(null);
    this.ctx.onChange();
    this.timers.later(2400, () => this.bonusStep());
  }

  private bonusStep() {
    const s = this.state;
    const b = s.bonus!;
    if (b.shown > 0 && !b.revealed) {
      b.revealed = true;
      const a = b.awards[b.shown - 1];
      for (const id of a.winners) s.cocktails[id] += 1;
      this.say(`${a.title}: ${a.winners.map((id) => this.ctx.nameOf(id)).join(', ')} – +1 Cocktail!`);
      this.ctx.onChange();
      this.timers.later(BONUS_SHOW_MS, () => this.bonusStep());
    } else if (b.shown < b.awards.length) {
      b.shown += 1;
      b.revealed = false;
      this.say(`Bonus-Cocktail: ${b.awards[b.shown - 1].title} …`);
      this.ctx.onChange();
      this.timers.later(BONUS_DRUM_MS, () => this.bonusStep());
    } else {
      this.ctx.onFinish();
    }
  }

  // ---------------------------------------------------------------- Helfer

  /** Brettstand zu Rundenbeginn sichern (data/party.json) */
  private persist() {
    const s = this.state;
    writeSave({
      v: 1,
      savedAt: Date.now(),
      maxRounds: s.maxRounds,
      longGames: this.longGames,
      round: s.round,
      players: this.active.map((id) => ({ id, name: this.ctx.nameOf(id) })),
      pos: s.pos,
      coins: s.coins,
      cocktails: s.cocktails,
      stats: s.stats,
      barField: s.barField,
      lastMini: this.lastMini,
    });
  }

  private moveBar() {
    const candidates = FIELD_TYPES.map((t, i) => (t === 'blue' ? i : -1)).filter(
      (i) => i >= 0 && i !== this.state.barField && !Object.values(this.state.pos).includes(i),
    );
    this.state.barField = candidates[Math.floor(Math.random() * candidates.length)] ?? 1;
  }

  private say(msg: string) {
    this.state.message = msg;
    this.state.messageSeq += 1;
  }
}
